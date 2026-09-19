/**
 * AI Teacher conversation types (Frontend Epic 9).
 *
 * Shapes mirror the authenticated /api/ai/* backend contract exactly.
 * Identity (student, organization) is derived server-side — it is never
 * sent from the client and is not modeled here. Message content is rendered
 * exactly as returned; nothing is calculated client-side.
 */

export type AiMessageRole = "user" | "assistant";

export interface AiConversation {
  id: string;
  subject: string | null;
  topic: string | null;
  /** Present on create responses; present on history entries as updated_at. */
  created_at?: string;
  updated_at?: string;
}

export interface AiMessage {
  id: string;
  role: AiMessageRole;
  content: string;
  created_at: string;
}

/** POST /api/ai/conversations request body. Subject/topic are optional context. */
export interface CreateConversationRequest {
  subject?: string;
  topic?: string;
}

/** POST /api/ai/conversations response body (201). */
export interface CreateConversationResponse {
  status: string;
  message: string;
  conversation: {
    id: string;
    subject: string | null;
    topic: string | null;
    created_at: string;
  };
}

/** GET /api/ai/conversations response body (newest-first). */
export interface ConversationsResponse {
  status: string;
  conversations: AiConversation[];
  total: number;
}

/** GET /api/ai/conversations/:id/messages response body (chronological). */
export interface ConversationMessagesResponse {
  status: string;
  messages: AiMessage[];
  total: number;
}

/** POST /api/ai/reply request body. */
export interface SendReplyRequest {
  conversation_id: string;
  question: string;
}

/** POST /api/ai/reply response body (201). `data` is the persisted assistant message. */
export interface SendReplyResponse {
  status: string;
  message: string;
  data: AiMessage;
}
