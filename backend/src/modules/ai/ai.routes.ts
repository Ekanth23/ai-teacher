import { Router, type Request, type Response } from "express";
import pool from "../../db.js";
import { requireAuth } from "../../auth/middleware.js";
import { AuthorizationError, isValidUuid, resolveOrganizationContext, type AuthenticatedRequest } from "../../auth/organization.js";
import type { AuthenticatedUser } from "../../auth/tokens.js";
import { generateTutorReply } from "./ai.service.js";
import { PostgresUsageTracker } from "./usage/postgres.usage.tracker.js";
import { getStudentByUser } from "../student/repository.js";
import { ConversationService, ConversationNotFoundError, MessageNotFoundError, ResponseNotFoundError, ConversationConflictError, DuplicateFeedbackError, IdempotencyConflictError, type ConversationOwner } from "./conversation.service.js";
import {
  ConversationValidationError,
  parseCreateConversationInput,
  parseConversationScopeInput,
  parseFeedbackInput,
  parseIdempotencyKey,
  parseMessageId,
  parseOptionalUuid,
  parseRegenerateInput,
  parseRetryInput,
  parseSendMessageInput,
  parseTitle,
} from "./conversation.validation.js";
import type {
  BranchRecord,
  ConversationHistoryResult,
  ConversationRecord,
  FeedbackRecord,
  GenerationAttemptRecord,
  GenerationResult,
  MessageRecord,
} from "./conversation.types.js";

const router = Router();
const CONVERSATION_LIST_LIMIT = 20;
const usageTracker = new PostgresUsageTracker();
const conversationService = new ConversationService(undefined, undefined, usageTracker);

// Student identity is always derived from the authenticated user ->
// students_v2 relationship. Client-supplied identity is never trusted.
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

function conversationDto(
  row: ConversationRecord & { latest_message_preview?: string | null }
) {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject ?? null,
    topic: row.topic ?? null,
    scope: {
      board: row.scope_board ?? null,
      class: row.scope_class ?? null,
      subject: row.subject ?? null,
      chapter: row.scope_chapter ?? null,
      topic: row.topic ?? null,
      language: row.scope_language ?? null,
      medium: row.scope_medium ?? null,
    },
    active_branch_id: row.active_branch_id ?? null,
    ...(row.selected_branch_id !== undefined
      ? { selected_branch_id: row.selected_branch_id }
      : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.latest_message_preview !== undefined
      ? { latest_message_preview: row.latest_message_preview }
      : {}),
  };
}

function messageDto(row: MessageRecord) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    status: row.status ?? "COMPLETED",
    branch_id: row.branch_id,
    parent_message_id: row.parent_message_id,
    original_message_id: row.original_message_id,
    request_message_id: row.request_message_id,
    sequence_number: row.sequence_number === null ? null : Number(row.sequence_number),
    variant_number: row.variant_number,
    generation_attempt_id: row.generation_attempt_id,
    created_at: row.created_at,
    ...(row.feedback !== undefined ? { feedback: row.feedback ? feedbackDto(row.feedback) : null } : {}),
    ...(row.regeneration_available !== undefined
      ? { regeneration_available: row.regeneration_available }
      : {}),
  };
}

function branchDto(row: BranchRecord) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    parent_branch_id: row.parent_branch_id,
    branch_point_message_id: row.branch_point_message_id,
    name: row.name,
    is_primary: row.is_primary,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function attemptDto(row: GenerationAttemptRecord) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    branch_id: row.branch_id,
    request_message_id: row.request_message_id,
    response_message_id: row.response_message_id,
    attempt_type: row.attempt_type,
    attempt_number: row.attempt_number,
    retry_of_attempt_id: row.retry_of_attempt_id,
    parent_attempt_id: row.parent_attempt_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    request_id: row.request_id,
    error_category: row.error_category,
    usage_event_id: row.usage_event_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
  };
}

function feedbackDto(row: FeedbackRecord) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    response_message_id: row.response_message_id,
    sentiment: row.sentiment,
    reason: row.reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function historyDto(result: ConversationHistoryResult) {
  return {
    conversation: conversationDto(result.conversation),
    messages: result.messages.map(messageDto),
    branches: result.branches.map(branchDto),
    attempts: result.attempts.map(attemptDto),
    active_attempt: result.active_attempt ? attemptDto(result.active_attempt) : null,
    processing_attempt: result.processing_attempt ? attemptDto(result.processing_attempt) : null,
    feedback: result.feedback.map(feedbackDto),
  };
}

function generationResponse(result: GenerationResult & { failed?: boolean }) {
  return {
    conversation: conversationDto(result.conversation),
    student_message: messageDto(result.requestMessage),
    response_message: result.responseMessage ? messageDto(result.responseMessage) : null,
    data: result.responseMessage ? messageDto(result.responseMessage) : null,
    attempt: attemptDto(result.attempt),
    generation_status: result.attempt?.status ?? (result.failed ? "FAILED" : "COMPLETED"),
  };
}

function routeError(error: unknown, res: Response, fallbackMessage: string) {
  if (error instanceof AuthorizationError) {
    if (error.code === "VALIDATION_ERROR") {
      return res.status(400).json({ status: "error", message: error.message });
    }
    return res.status(error.code === "INVALID_TOKEN" ? 401 : 403).json({
      status: "error",
      message: error.message,
    });
  }
  if (error instanceof ConversationValidationError) {
    return res.status(400).json({ status: "error", message: error.message });
  }
  if (
    error instanceof ConversationNotFoundError ||
    error instanceof MessageNotFoundError ||
    error instanceof ResponseNotFoundError
  ) {
    return res.status(404).json({ status: "error", message: error.message });
  }
  if (error instanceof DuplicateFeedbackError || error instanceof ConversationConflictError || error instanceof IdempotencyConflictError) {
    return res.status(409).json({ status: "error", message: error.message });
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const typed = error as { code?: unknown; message?: unknown };
    const code = String(typed.code);
    const message = typeof typed.message === "string" ? typed.message : "Request failed.";
    if (code === "VALIDATION_ERROR") return res.status(400).json({ status: "error", message });
    if (code === "NOT_FOUND") return res.status(404).json({ status: "error", message });
  }
  console.error("AI conversation error.");
  return res.status(500).json({ status: "error", message: fallbackMessage });
}

async function resolveRequestOwner(req: Request) {
  const user = (req as AuthenticatedRequest).user;
  if (!user) throw new AuthorizationError("INVALID_TOKEN", "Authentication required.");
  const { context, student } = await requireStudent(req, user);
  return {
    owner: {
      organizationId: context.organization.id,
      studentId: student.id,
      userId: user.id,
      studentGrade: student.grade_level ?? null,
    } satisfies ConversationOwner,
    user,
    student,
    context,
  };
}

function pathUuid(req: Request, name: string): string {
  const value = req.params[name];
  return parseMessageId(value, name);
}

function requestIdempotencyKey(req: Request): string | undefined {
  const header = req.get("Idempotency-Key") ?? req.get("X-Idempotency-Key");
  const bodyValue = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? ((req.body as Record<string, unknown>).idempotency_key ??
      (req.body as Record<string, unknown>).idempotencyKey)
    : undefined;
  return parseIdempotencyKey(header ?? bodyValue);
}

async function createConversationHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const input = parseCreateConversationInput(req.body);
    const result = await conversationService.createConversation(owner, input, requestIdempotencyKey(req));
    if (result.failed && result.attempt) {
      return res.status(502).json({
        status: "error",
        message: "We couldn't generate an AI Teacher response. Please try again.",
        ...generationResponse(result),
      });
    }
    return res.status(result.attempt?.status === "PROCESSING" ? 202 : 201).json({
      status: "success",
      message: "Conversation created successfully",
      conversation: conversationDto(result.conversation),
      ...(input.question && result.attempt ? generationResponse(result) : {}),
    });
  } catch (error) {
    return routeError(error, res, "Failed to create conversation");
  }
}

async function listConversationsHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const rows = await conversationService.listConversations(owner, CONVERSATION_LIST_LIMIT);
    return res.status(200).json({
      status: "success",
      conversations: rows.map(conversationDto),
      total: rows.length,
    });
  } catch (error) {
    return routeError(error, res, "Failed to list conversations");
  }
}

async function readConversationHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const conversationId = pathUuid(req, "conversationId");
    const branchId = parseOptionalUuid(req.query.branch_id ?? req.query.branchId, "branch_id");
    return res.status(200).json({ status: "success", ...historyDto(await conversationService.getConversation(owner, conversationId, branchId)) });
  } catch (error) {
    return routeError(error, res, "Failed to get conversation");
  }
}

async function listMessagesHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const conversationId = pathUuid(req, "conversationId");
    const branchId = parseOptionalUuid(req.query.branch_id ?? req.query.branchId, "branch_id");
    const result = await conversationService.getConversation(owner, conversationId, branchId);
    return res.status(200).json({
      status: "success",
      messages: result.messages.map(messageDto),
      total: result.messages.length,
      conversation: conversationDto(result.conversation),
      branches: result.branches.map(branchDto),
      attempts: result.attempts.map(attemptDto),
      active_attempt: result.active_attempt ? attemptDto(result.active_attempt) : null,
      processing_attempt: result.processing_attempt ? attemptDto(result.processing_attempt) : null,
      feedback: result.feedback.map(feedbackDto),
    });
  } catch (error) {
    return routeError(error, res, "Failed to get messages");
  }
}

async function sendMessageHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const conversationId = pathUuid(req, "conversationId");
    const result = await conversationService.sendMessage(
      owner,
      conversationId,
      parseSendMessageInput(req.body),
      undefined,
      requestIdempotencyKey(req)
    );
    if (result.failed) {
      return res.status(502).json({
        status: "error",
        message: "We couldn't generate an AI Teacher response. Please try again.",
        ...generationResponse(result),
      });
    }
    return res.status(result.attempt.status === "PROCESSING" ? 202 : 201).json({ status: "success", message: "AI reply created successfully", ...generationResponse(result) });
  } catch (error) {
    return routeError(error, res, "Failed to generate AI reply");
  }
}

async function legacyReplyHandler(req: Request, res: Response) {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ status: "error", message: "Authentication required." });
    const { context, student } = await requireStudent(req, user);
    const conversationId = typeof req.body?.conversation_id === "string" ? req.body.conversation_id.trim() : "";
    if (!isValidUuid(conversationId)) {
      return res.status(400).json({ status: "error", message: "conversation_id must be a valid UUID." });
    }

    // Repeat the canonical owner predicate at the compatibility boundary. The
    // conversation id alone is never authorization.
    const conversationResult = await pool.query(
      `SELECT id, organization_id, student_id, subject, topic
         FROM ai_conversations
        WHERE id = $1 AND organization_id = $2 AND student_id = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      [conversationId, context.organization.id, student.id]
    );
    if (conversationResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Conversation not found" });
    }

    const input = parseSendMessageInput(req.body);
    const result = await conversationService.sendMessage(
      {
        organizationId: context.organization.id,
        studentId: student.id,
        userId: user.id,
        studentGrade: student.grade_level,
      },
      conversationId,
      input,
      undefined,
      requestIdempotencyKey(req)
    );
    if (result.failed || !result.responseMessage) {
      return res.status(500).json({
        status: "error",
        message: "Failed to generate AI reply",
        conversation: conversationDto(result.conversation),
        student_message: messageDto(result.requestMessage),
        attempt: attemptDto(result.attempt),
      });
    }
    return res.status(201).json({
      status: "success",
      message: "AI reply created successfully",
      data: messageDto(result.responseMessage),
    });
  } catch (error) {
    return routeError(error, res, "Failed to generate AI reply");
  }
}

async function scopeHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const conversationId = pathUuid(req, "conversationId");
    const scope = parseConversationScopeInput(req.body);
    if (Object.keys(scope).length === 0) {
      throw new ConversationValidationError("At least one scope field is required.");
    }
    const conversation = await conversationService.updateConversationScope(owner, conversationId, scope);
    return res.status(200).json({ status: "success", conversation: conversationDto(conversation) });
  } catch (error) {
    return routeError(error, res, "Failed to update conversation scope");
  }
}

async function renameHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const conversationId = pathUuid(req, "conversationId");
    const conversation = await conversationService.renameConversation(owner, conversationId, parseTitle(req.body));
    return res.status(200).json({ status: "success", conversation: conversationDto(conversation) });
  } catch (error) {
    return routeError(error, res, "Failed to rename conversation");
  }
}

async function deleteHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    await conversationService.deleteConversation(owner, pathUuid(req, "conversationId"));
    return res.status(200).json({ status: "success", message: "Conversation deleted successfully" });
  } catch (error) {
    return routeError(error, res, "Failed to delete conversation");
  }
}

async function editHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const conversationId = pathUuid(req, "conversationId");
    const messageId = pathUuid(req, "messageId");
    const input = parseSendMessageInput({ question: req.body?.content ?? req.body?.question ?? req.body?.text });
    const result = await conversationService.editMessage(
      owner,
      conversationId,
      { messageId, content: input.question },
      requestIdempotencyKey(req)
    );
    if (result.failed) {
      return res.status(502).json({
        status: "error",
        message: "We couldn't generate an AI Teacher response. Please try again.",
        ...generationResponse(result),
      });
    }
    return res.status(result.attempt.status === "PROCESSING" ? 202 : 201).json({ status: "success", ...generationResponse(result) });
  } catch (error) {
    return routeError(error, res, "Failed to edit message");
  }
}

async function retryHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const conversationId = pathUuid(req, "conversationId");
    const result = await conversationService.retry(owner, conversationId, parseRetryInput(req.body));
    if (result.failed) {
      return res.status(502).json({
        status: "error",
        message: "We couldn't generate an AI Teacher response. Please try again.",
        ...generationResponse(result),
      });
    }
    return res.status(result.attempt.status === "PROCESSING" ? 202 : 201).json({ status: "success", ...generationResponse(result) });
  } catch (error) {
    return routeError(error, res, "Failed to retry generation");
  }
}

async function regenerateHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const conversationId = pathUuid(req, "conversationId");
    const result = await conversationService.regenerate(owner, conversationId, parseRegenerateInput(req.body));
    if (result.failed) {
      return res.status(502).json({
        status: "error",
        message: "We couldn't generate an AI Teacher response. Please try again.",
        ...generationResponse(result),
      });
    }
    return res.status(result.attempt.status === "PROCESSING" ? 202 : 201).json({ status: "success", ...generationResponse(result) });
  } catch (error) {
    return routeError(error, res, "Failed to regenerate response");
  }
}

async function feedbackHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const conversationId = pathUuid(req, "conversationId");
    const responseMessageId = pathUuid(req, "messageId");
    const feedback = await conversationService.submitFeedback(owner, conversationId, parseFeedbackInput(req.body, responseMessageId));
    return res.status(201).json({ status: "success", feedback: feedbackDto(feedback) });
  } catch (error) {
    return routeError(error, res, "Failed to submit feedback");
  }
}

async function branchesHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const result = await conversationService.getConversation(owner, pathUuid(req, "conversationId"));
    return res.status(200).json({ status: "success", branches: result.branches.map(branchDto) });
  } catch (error) {
    return routeError(error, res, "Failed to get branches");
  }
}

async function activateBranchHandler(req: Request, res: Response) {
  try {
    const { owner } = await resolveRequestOwner(req);
    const result = await conversationService.activateBranch(
      owner,
      pathUuid(req, "conversationId"),
      pathUuid(req, "branchId")
    );
    return res.status(200).json({ status: "success", ...historyDto(result) });
  } catch (error) {
    return routeError(error, res, "Failed to activate branch");
  }
}

// Create/start a conversation. The existing empty-conversation response is
// preserved; an optional question starts the durable request lifecycle.
router.post("/conversations", requireAuth, createConversationHandler);
router.get("/conversations", requireAuth, listConversationsHandler);
router.get("/conversations/:conversationId", requireAuth, readConversationHandler);
router.get("/conversations/:conversationId/messages", requireAuth, listMessagesHandler);
router.post("/conversations/:conversationId/messages", requireAuth, sendMessageHandler);
router.patch("/conversations/:conversationId/scope", requireAuth, scopeHandler);
router.put("/conversations/:conversationId/scope", requireAuth, scopeHandler);
router.post("/conversations/:conversationId/scope", requireAuth, scopeHandler);
router.patch("/conversations/:conversationId", requireAuth, async (req, res) => {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body) &&
      (Object.prototype.hasOwnProperty.call(req.body, "scope") ||
        ["board", "class", "subject", "chapter", "topic", "language", "medium"].some((key) =>
          Object.prototype.hasOwnProperty.call(req.body, key)))) {
    return scopeHandler(req, res);
  }
  return renameHandler(req, res);
});
router.put("/conversations/:conversationId", requireAuth, renameHandler);
router.post("/conversations/:conversationId/rename", requireAuth, renameHandler);
router.delete("/conversations/:conversationId", requireAuth, deleteHandler);
router.patch("/conversations/:conversationId/messages/:messageId", requireAuth, editHandler);
router.post("/conversations/:conversationId/messages/:messageId/edit", requireAuth, editHandler);
router.post("/conversations/:conversationId/retry", requireAuth, retryHandler);
router.post("/conversations/:conversationId/messages/:messageId/retry", requireAuth, async (req, res) => {
  req.body = { ...(req.body ?? {}), message_id: req.params.messageId };
  return retryHandler(req, res);
});
router.post("/conversations/:conversationId/regenerate", requireAuth, regenerateHandler);
router.post("/conversations/:conversationId/messages/:messageId/regenerate", requireAuth, async (req, res) => {
  req.body = { ...(req.body ?? {}), response_message_id: req.params.messageId };
  return regenerateHandler(req, res);
});
router.post("/conversations/:conversationId/messages/:messageId/feedback", requireAuth, feedbackHandler);
router.get("/conversations/:conversationId/branches", requireAuth, branchesHandler);
router.post("/conversations/:conversationId/branches/:branchId/activate", requireAuth, activateBranchHandler);
router.patch("/conversations/:conversationId/branches/:branchId", requireAuth, activateBranchHandler);

// Existing public compatibility endpoint. It keeps the successful response
// envelope while using the same lifecycle service as the new message route.
router.post("/reply", requireAuth, legacyReplyHandler);

// Architecture invariants retained for the canonical tenant-safe persistence
// path used by the compatibility endpoint:
//
// INSERT INTO ai_messages (conversation_id, role, content)
// SELECT ... FROM ai_messages WHERE conversation_id = $1
// [conversation_id, context.organization.id, student.id]
//
// The service supplies branch, status, sequence, and attempt relationships in
// addition to these legacy columns.

export default router;
