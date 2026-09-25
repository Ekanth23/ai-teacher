export const MESSAGE_STATUSES = ["PROCESSING", "COMPLETED", "FAILED"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const ATTEMPT_TYPES = ["ORIGINAL", "RETRY", "REGENERATION"] as const;
export type GenerationAttemptType = (typeof ATTEMPT_TYPES)[number];

export type AiMessageRole = "user" | "assistant";

export const FEEDBACK_REASONS = [
  "too difficult",
  "too easy",
  "not clear",
  "incorrect",
  "need more examples",
  "need simpler explanation",
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export type FeedbackSentiment = "HELPFUL" | "NOT_HELPFUL";

export interface ConversationScope {
  board: string | null;
  class: string | null;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  language: string | null;
  medium: string | null;
}

export interface ConversationRecord {
  id: string;
  organization_id: string;
  student_id: string;
  title: string;
  title_source: "DEFAULT" | "GENERATED" | "RENAMED";
  subject: string | null;
  topic: string | null;
  scope_board: string | null;
  scope_class: string | null;
  scope_chapter: string | null;
  scope_language: string | null;
  scope_medium: string | null;
  active_branch_id: string | null;
  /** Read-only branch selected by a history request; not a persisted mutation. */
  selected_branch_id?: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  status: MessageStatus | null;
  branch_id: string | null;
  parent_message_id: string | null;
  original_message_id: string | null;
  request_message_id: string | null;
  sequence_number: string | number | null;
  variant_number: number;
  generation_attempt_id: string | null;
  created_at: string;
  /** Hydrated by the owner-authorized history API from the feedback table. */
  feedback?: FeedbackRecord | null;
  /** Whether this response has a durable request relationship that permits regeneration. */
  regeneration_available?: boolean;
}

export interface GenerationAttemptRecord {
  id: string;
  conversation_id: string;
  organization_id: string;
  student_id: string;
  user_id: string | null;
  branch_id: string;
  request_message_id: string;
  response_message_id: string | null;
  attempt_type: GenerationAttemptType;
  attempt_number: number;
  retry_of_attempt_id: string | null;
  parent_attempt_id: string | null;
  status: MessageStatus;
  provider: string;
  model: string;
  request_id: string | null;
  error_category: string | null;
  usage_event_id: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackRecord {
  id: string;
  conversation_id: string;
  response_message_id: string;
  organization_id: string;
  student_id: string;
  sentiment: FeedbackSentiment;
  reason: FeedbackReason | null;
  created_at: string;
  updated_at: string;
}

export interface CreateConversationInput {
  subject?: string | null;
  topic?: string | null;
  scope?: Partial<ConversationScope>;
  question?: string;
}

export interface SendMessageInput {
  question: string;
  branchId?: string;
}

export type IdempotencyOperation = "CREATE_CONVERSATION" | "SEND_MESSAGE";

export interface IdempotencyRecord {
  id: string;
  organization_id: string;
  student_id: string;
  user_id: string;
  operation: IdempotencyOperation;
  idempotency_key: string;
  request_hash: string;
  conversation_id: string | null;
  request_message_id: string | null;
  attempt_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EditMessageInput {
  messageId: string;
  content: string;
}

export interface RetryInput {
  attemptId?: string;
  messageId?: string;
}

export interface RegenerateInput {
  responseMessageId?: string;
  attemptId?: string;
  messageId?: string;
}

export interface FeedbackInput {
  responseMessageId: string;
  sentiment: FeedbackSentiment;
  reason?: FeedbackReason | null;
}

export interface GenerationResult {
  conversation: ConversationRecord;
  requestMessage: MessageRecord;
  responseMessage: MessageRecord | null;
  attempt: GenerationAttemptRecord;
}

export interface ConversationHistoryResult {
  conversation: ConversationRecord;
  messages: MessageRecord[];
  branches: BranchRecord[];
  /** Durable lifecycle attempts, including attempts that are still PROCESSING. */
  attempts: GenerationAttemptRecord[];
  /** The active PROCESSING attempt, when one exists. */
  active_attempt: GenerationAttemptRecord | null;
  /** Backwards-compatible/readability alias for clients that call it processing_attempt. */
  processing_attempt: GenerationAttemptRecord | null;
  feedback: FeedbackRecord[];
}

export interface BranchRecord {
  id: string;
  conversation_id: string;
  parent_branch_id: string | null;
  branch_point_message_id: string | null;
  name: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}
