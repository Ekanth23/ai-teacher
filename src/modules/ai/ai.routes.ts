import { Router } from "express";
import pool from "../../db.js";
import { requireAuth } from "../../auth/middleware.js";
import { AuthorizationError, resolveOrganizationContext, type AuthenticatedRequest } from "../../auth/organization.js";
import { generateTutorReply } from "./ai.service.js";
import { PostgresUsageTracker } from "./usage/postgres.usage.tracker.js";

const router = Router();

const HISTORY_LIMIT = 20;
const usageTracker = new PostgresUsageTracker();

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