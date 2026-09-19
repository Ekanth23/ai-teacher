import { Router, type Request, type Response } from "express";
import pool from "../../db.js";
import { requireAuth } from "../../auth/middleware.js";
import { AuthorizationError, isValidUuid, resolveOrganizationContext, type AuthenticatedRequest } from "../../auth/organization.js";
import type { AuthenticatedUser } from "../../auth/tokens.js";
import { generateTutorReply } from "./ai.service.js";
import { PostgresUsageTracker } from "./usage/postgres.usage.tracker.js";
import { getStudentByUser, listRecentConversationsForStudent } from "../student/repository.js";

const router = Router();

const HISTORY_LIMIT = 20;
const CONVERSATION_LIST_LIMIT = 20;
const CONTEXT_FIELD_MAX_LENGTH = 255;
const usageTracker = new PostgresUsageTracker();

// Student identity is always derived from the authenticated user -> students_v2
// relationship. A client-supplied student_id or organization_id is never trusted.
async function requireStudent(req: Request, user: AuthenticatedUser) {
  const context = await resolveOrganizationContext(req, user, null, { autoResolveSingle: true });
  if (context.role.name !== "STUDENT") {
    throw new AuthorizationError("ROLE_REQUIRED", "Student access required.");
  }
  const student = (await getStudentByUser(context.organization.id, user.id)).rows[0];
  if (!student) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your student profile was not found in this organization.");
  }
  return { context, student };
}

// Optional free-text context (subject/topic). Trims input; empty becomes null.
function optionalContextField(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new AuthorizationError("VALIDATION_ERROR", `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CONTEXT_FIELD_MAX_LENGTH) {
    throw new AuthorizationError("VALIDATION_ERROR", `${field} must be at most ${CONTEXT_FIELD_MAX_LENGTH} characters.`);
  }
  return trimmed;
}

function authErrorResponse(error: unknown, res: Response, fallbackMessage: string) {
  if (error instanceof AuthorizationError) {
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ status: "error", message: error.message });
    }
    return res.status(error.code === "INVALID_TOKEN" ? 401 : 403).json({
      status: "error",
      message: error.message,
    });
  }
  console.error("AI conversation error:", error);
  return res.status(500).json({ status: "error", message: fallbackMessage });
}

// Create a student-owned AI conversation. Organization and student are derived
// server-side; subject/topic are optional context only.
router.post("/conversations", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return res.status(401).json({ status: "error", message: "Authentication required." });
    }
    const { context, student } = await requireStudent(req, user);
    const subject = optionalContextField(req.body?.subject, "subject");
    const topic = optionalContextField(req.body?.topic, "topic");

    const result = await pool.query(
      `INSERT INTO ai_conversations (organization_id, student_id, subject, topic)
       VALUES ($1, $2, $3, $4)
       RETURNING id, subject, topic, created_at`,
      [context.organization.id, student.id, subject, topic]
    );

    return res.status(201).json({
      status: "success",
      message: "Conversation created successfully",
      conversation: result.rows[0],
    });
  } catch (error) {
    return authErrorResponse(error, res, "Failed to create conversation");
  }
});

// List the authenticated student's conversations, newest first.
router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return res.status(401).json({ status: "error", message: "Authentication required." });
    }
    const { context, student } = await requireStudent(req, user);
    const rows = (
      await listRecentConversationsForStudent(context.organization.id, student.id, CONVERSATION_LIST_LIMIT)
    ).rows;

    return res.status(200).json({
      status: "success",
      conversations: rows.map((row) => ({
        id: row.id,
        subject: row.subject ?? null,
        topic: row.topic ?? null,
        updated_at: row.updated_at,
      })),
      total: rows.length,
    });
  } catch (error) {
    return authErrorResponse(error, res, "Failed to list conversations");
  }
});

// Read a single owned conversation's messages in chronological order.
// Unknown or foreign conversation ids fail closed with 404.
//
// NOTE: the route parameter is intentionally named :conversationId (not :id)
// because resolveOrganizationContext treats req.params.id as an explicit
// organization id. Using :id here would make the conversation UUID hijack
// organization resolution and fail closed with 403 for headerless clients.
router.get("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return res.status(401).json({ status: "error", message: "Authentication required." });
    }
    const { context, student } = await requireStudent(req, user);
    const conversationId = typeof req.params.conversationId === "string" ? req.params.conversationId.trim() : "";
    if (!isValidUuid(conversationId)) {
      return res.status(400).json({ status: "error", message: "Conversation id is invalid." });
    }

    const conversation = (
      await pool.query(
        `SELECT id FROM ai_conversations
         WHERE id = $1 AND organization_id = $2 AND student_id = $3
         LIMIT 1`,
        [conversationId, context.organization.id, student.id]
      )
    ).rows[0];
    if (!conversation) {
      return res.status(404).json({ status: "error", message: "Conversation not found" });
    }

    const messages = (
      await pool.query(
        `SELECT id, role, content, created_at
         FROM ai_messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId]
      )
    ).rows;

    return res.status(200).json({ status: "success", messages, total: messages.length });
  } catch (error) {
    return authErrorResponse(error, res, "Failed to get messages");
  }
});

router.post("/reply", requireAuth, async (req, res) => {
  try {
    const { conversation_id, question } = req.body;

    if (!conversation_id || !question) {
      return res.status(400).json({
        status: "error",
        message: "conversation_id and question are required",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required.",
      });
    }

    const conversationResult = await pool.query(
      `SELECT id, organization_id, student_id, subject, topic
       FROM ai_conversations
       WHERE id = $1`,
      [conversation_id]
    );

    const conversation = conversationResult.rows[0];

    if (!conversation) {
      return res.status(404).json({
        status: "error",
        message: "Conversation not found",
      });
    }

    await resolveOrganizationContext(req, user, conversation.organization_id);

    const studentResult = await pool.query(
      `SELECT id, full_name AS name, grade_level AS grade
       FROM students_v2
       WHERE id = $1 AND organization_id = $2`,
      [conversation.student_id, conversation.organization_id]
    );

    const student = studentResult.rows[0];

    if (!student) {
      return res.status(404).json({
        status: "error",
        message: "Student not found for this conversation",
      });
    }

    // Persist the student's question first so the chronological history
    // contains both sides of the conversation.
    await pool.query(
      `INSERT INTO ai_messages (conversation_id, role, content)
       VALUES ($1, $2, $3)`,
      [conversation_id, "user", question]
    );

    const historyResult = await pool.query(
      `SELECT role, content
       FROM ai_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversation_id, HISTORY_LIMIT]
    );

    const conversationHistory = historyResult.rows.reverse();

    const aiAnswer = await generateTutorReply(
      {
        question,
        subject: conversation.subject,
        topic: conversation.topic,
        studentGrade: student.grade,
        conversationHistory,
      },
      {
        context: {
          conversationId: String(conversation_id),
          studentId: String(conversation.student_id),
          userId: user.id,
          organizationId: conversation.organization_id,
        },
        usageTracker,
      }
    );

    const result = await pool.query(
      `INSERT INTO ai_messages (conversation_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [conversation_id, "assistant", aiAnswer]
    );

    await pool.query(
      `UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1`,
      [conversation_id]
    );

    res.status(201).json({
      status: "success",
      message: "AI reply created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return res.status(error.code === "INVALID_TOKEN" ? 401 : 403).json({
        status: "error",
        message: error.message,
      });
    }

    console.error("AI reply error:", error);

    res.status(500).json({
      status: "error",
      message: "Failed to generate AI reply",
    });
  }
});

export default router;