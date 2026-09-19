import type {
  ConversationMessagesResponse,
  ConversationsResponse,
  CreateConversationRequest,
  CreateConversationResponse,
  SendReplyResponse,
} from "../../types/ai";
import { request } from "./client";

/**
 * POST /api/ai/conversations
 *
 * Starts a student-owned conversation. Organization and student are derived
 * server-side from the bearer token — the client sends only optional
 * subject/topic context and never identity fields.
 */
export function createConversation(body: CreateConversationRequest = {}) {
  return request<CreateConversationResponse>("/api/ai/conversations", {
    method: "POST",
    body,
  });
}

/**
 * GET /api/ai/conversations
 *
 * The authenticated student's conversations, newest first.
 * Empty history is `{ conversations: [], total: 0 }`.
 */
export function getConversations() {
  return request<ConversationsResponse>("/api/ai/conversations");
}

/**
 * GET /api/ai/conversations/:id/messages
 *
 * Owned conversation's messages in chronological order. Unknown or foreign
 * conversation ids fail closed (404) — surfaced as an ApiError.
 */
export function getConversationMessages(conversationId: string) {
  return request<ConversationMessagesResponse>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
}

/**
 * POST /api/ai/reply
 *
 * Sends the student's question and receives the persisted assistant message.
 * The backend persists both sides and remains authoritative; the response is
 * rendered exactly as returned — never fabricated or recalculated.
 */
export function sendReply(conversationId: string, question: string) {
  return request<SendReplyResponse>("/api/ai/reply", {
    method: "POST",
    body: { conversation_id: conversationId, question },
  });
}
