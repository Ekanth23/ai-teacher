/**
 * AI Teacher conversation types.
 *
 * Existing fields remain compatible with the original Epic 9 contract. US-117
 * adds optional lifecycle metadata so older fixtures and successful replies
 * remain valid while the client can use title, status, branch, and attempt
 * identities when the server provides them.
 */

export type AiMessageRole = "user" | "assistant";
export type AiMessageStatus = "PROCESSING" | "COMPLETED" | "FAILED";
export type AiAttemptType = "ORIGINAL" | "RETRY" | "REGENERATION";
export type AiFeedbackSentiment =
  | "HELPFUL"
  | "NOT_HELPFUL"
  | "helpful"
  | "not helpful";

export const AI_FEEDBACK_REASONS = [
  "too difficult",
  "too easy",
  "not clear",
  "incorrect",
  "need more examples",
  "need simpler explanation",
] as const;
export type AiFeedbackReason = (typeof AI_FEEDBACK_REASONS)[number];

export interface AiConversationScope {
  board: string | null;
  class: string | null;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  language: string | null;
  medium: string | null;
}

export interface AiConversation {
  id: string;
  title?: string;
  subject: string | null;
  topic: string | null;
  scope?: AiConversationScope;
  latest_message_preview?: string | null;
  active_branch_id?: string | null;
  selected_branch_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AiMessage {
  id: string;
  conversation_id?: string;
  role: AiMessageRole;
  content: string;
  created_at: string;
  status?: AiMessageStatus;
  branch_id?: string | null;
  parent_message_id?: string | null;
  original_message_id?: string | null;
  /** Durable link from an assistant response to the student's request. */
  request_message_id?: string | null;
  sequence_number?: number | null;
  variant_number?: number;
  generation_attempt_id?: string | null;
  /** Feedback is hydrated by the history endpoint after a reload. */
  feedback?: AiFeedback | null;
  /** Explicit legacy-safety signal supplied by the server when available. */
  regeneration_available?: boolean;
}

export interface AiGenerationAttempt {
  id: string;
  conversation_id: string;
  /** Present in the lifecycle API; optional for older fixtures. */
  branch_id?: string | null;
  request_message_id: string;
  response_message_id: string | null;
  attempt_type: AiAttemptType;
  attempt_number: number;
  retry_of_attempt_id: string | null;
  parent_attempt_id: string | null;
  status: AiMessageStatus;
  provider: string;
  model: string;
  request_id: string | null;
  error_category: string | null;
  usage_event_id: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface AiBranch {
  id: string;
  conversation_id: string;
  parent_branch_id: string | null;
  branch_point_message_id: string | null;
  name: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiFeedback {
  id: string;
  conversation_id: string;
  response_message_id: string;
  sentiment: AiFeedbackSentiment;
  reason: AiFeedbackReason | null;
  created_at: string;
  updated_at: string;
}

export interface CreateConversationRequest {
  subject?: string;
  topic?: string;
  scope?: Partial<AiConversationScope>;
  question?: string;
}

export interface CreateConversationResponse {
  status: string;
  message: string;
  conversation: AiConversation;
  student_message?: AiMessage;
  response_message?: AiMessage | null;
  data?: AiMessage | null;
  attempt?: AiGenerationAttempt;
  generation_status?: "PROCESSING" | "COMPLETED" | "FAILED";
}

export interface ConversationsResponse {
  status: string;
  conversations: AiConversation[];
  total: number;
}

export interface ConversationMessagesResponse {
  status: string;
  messages: AiMessage[];
  /** Legacy message endpoints did not always include a total. */
  total?: number;
  conversation?: AiConversation;
  branches?: AiBranch[];
  /** Durable lifecycle state used to resume processing after a reload. */
  attempts?: AiGenerationAttempt[];
  active_attempt?: AiGenerationAttempt | null;
  processing_attempt?: AiGenerationAttempt | null;
  feedback?: AiFeedback[];
}

export interface ConversationResponse {
  status: string;
  conversation: AiConversation;
  messages: AiMessage[];
  branches: AiBranch[];
  attempts?: AiGenerationAttempt[];
  active_attempt?: AiGenerationAttempt | null;
  processing_attempt?: AiGenerationAttempt | null;
  feedback?: AiFeedback[];
}

export interface SendMessageRequest {
  question: string;
  branch_id?: string;
}

export interface GenerationResponse {
  status: string;
  message?: string;
  conversation: AiConversation;
  student_message: AiMessage;
  response_message: AiMessage | null;
  /** Compatibility alias used by the original reply contract. */
  data?: AiMessage | null;
  attempt: AiGenerationAttempt;
  generation_status: "PROCESSING" | "COMPLETED" | "FAILED";
}

export interface SendReplyRequest {
  conversation_id: string;
  question: string;
}

export interface SendReplyResponse {
  status: string;
  message: string;
  data: AiMessage;
  student_message?: AiMessage;
  attempt?: AiGenerationAttempt;
}

export interface FeedbackRequest {
  sentiment: "helpful" | "not helpful";
  reason?: AiFeedbackReason;
}
