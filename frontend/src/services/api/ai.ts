import type {
  AiBranch,
  AiFeedback,
  ConversationMessagesResponse,
  ConversationResponse,
  ConversationsResponse,
  CreateConversationRequest,
  CreateConversationResponse,
  FeedbackRequest,
  GenerationResponse,
  SendMessageRequest,
  SendReplyResponse,
} from "../../types/ai";
import { request } from "./client";

/** Options shared by AI requests that may be cancelled or retried safely. */
export interface AiRequestOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
  /** Snake-case alias accepted for callers sharing the wire contract. */
  idempotency_key?: string;
  branchId?: string;
  branch_id?: string;
}

export type AiOptions = AiRequestOptions | AbortSignal | string | undefined;

function normalizeOptions(options?: AiOptions): AiRequestOptions {
  if (typeof options === "string") return { idempotencyKey: options };
  if (
    options &&
    typeof options === "object" &&
    ((typeof AbortSignal !== "undefined" && options instanceof AbortSignal) ||
      ("aborted" in options && "addEventListener" in options))
  ) {
    return { signal: options as AbortSignal };
  }
  if (!options) return {};
  return {
    ...options,
    ...(options.idempotencyKey || options.idempotency_key
      ? { idempotencyKey: options.idempotencyKey ?? options.idempotency_key }
      : {}),
  };
}

function requestOptions(
  method: string,
  body: unknown,
  options?: AiOptions,
): {
  method: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
} {
  const normalized = normalizeOptions(options);
  return {
    method,
    ...(body === undefined ? {} : { body }),
    ...(normalized.signal ? { signal: normalized.signal } : {}),
    ...(normalized.idempotencyKey
      ? { headers: { "Idempotency-Key": normalized.idempotencyKey } }
      : {}),
  };
}

function readOptions(
  branchOrOptions?: string | AiRequestOptions | AbortSignal,
  options?: AiRequestOptions | AbortSignal,
): { branchId?: string; options?: AiRequestOptions | AbortSignal } {
  if (typeof branchOrOptions === "string") {
    return { branchId: branchOrOptions, options };
  }
  if (branchOrOptions && typeof branchOrOptions === "object") {
    const options = branchOrOptions as AiRequestOptions;
    return {
      branchId: options.branchId ?? options.branch_id,
      options: branchOrOptions,
    };
  }
  return { options };
}

/** POST /api/ai/conversations — starts an owned conversation. */
export function createConversation(
  body: CreateConversationRequest = {},
  options?: AiOptions,
) {
  return request<CreateConversationResponse>(
    "/api/ai/conversations",
    requestOptions("POST", body, options),
  );
}

/** GET /api/ai/conversations — the student's active, non-deleted history. */
export function getConversations(options?: AiOptions) {
  const normalized = normalizeOptions(options);
  return normalized.signal
    ? request<ConversationsResponse>("/api/ai/conversations", { signal: normalized.signal })
    : request<ConversationsResponse>("/api/ai/conversations");
}

/** GET /api/ai/conversations/:id — conversation metadata and active branch history. */
export function getConversation(
  conversationId: string,
  branchOrOptions?: string | AiRequestOptions | AbortSignal,
  options?: AiRequestOptions | AbortSignal,
) {
  const read = readOptions(branchOrOptions, options);
  const query = read.branchId ? `?branch_id=${encodeURIComponent(read.branchId)}` : "";
  const normalized = normalizeOptions(read.options);
  return normalized.signal
    ? request<ConversationResponse>(
        `/api/ai/conversations/${encodeURIComponent(conversationId)}${query}`,
        { signal: normalized.signal },
      )
    : request<ConversationResponse>(
        `/api/ai/conversations/${encodeURIComponent(conversationId)}${query}`,
      );
}

/** GET /api/ai/conversations/:id/messages — owner-authorized history and lifecycle state. */
export function getConversationMessages(
  conversationId: string,
  branchOrOptions?: string | AiRequestOptions | AbortSignal,
  options?: AiRequestOptions | AbortSignal,
) {
  const read = readOptions(branchOrOptions, options);
  const query = read.branchId ? `?branch_id=${encodeURIComponent(read.branchId)}` : "";
  const normalized = normalizeOptions(read.options);
  return normalized.signal
    ? request<ConversationMessagesResponse>(
        `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages${query}`,
        { signal: normalized.signal },
      )
    : request<ConversationMessagesResponse>(
        `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages${query}`,
      );
}

/** POST /api/ai/conversations/:id/messages — durable US-117 request lifecycle. */
export function sendMessage(
  conversationId: string,
  body: SendMessageRequest,
  options?: AiOptions,
) {
  return request<GenerationResponse>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
    requestOptions("POST", body, options),
  );
}

/** Existing successful /api/ai/reply response contract. */
export function sendReply(
  conversationId: string,
  question: string,
  options?: AiOptions,
) {
  return request<SendReplyResponse>(
    "/api/ai/reply",
    requestOptions("POST", { conversation_id: conversationId, question }, options),
  );
}

export function renameConversation(
  conversationId: string,
  title: string,
  options?: AiOptions,
) {
  return request<{ status: string; conversation: ConversationResponse["conversation"] }>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}`,
    requestOptions("PATCH", { title }, options),
  );
}

export function deleteConversation(conversationId: string, options?: AiOptions) {
  return request<{ status: string; message: string }>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}`,
    requestOptions("DELETE", undefined, options),
  );
}

export function editMessage(
  conversationId: string,
  messageId: string,
  content: string,
  options?: AiOptions,
) {
  return request<GenerationResponse>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    requestOptions("PATCH", { content }, options),
  );
}

export function retryGeneration(
  conversationId: string,
  attemptId?: string,
  messageId?: string,
  options?: AiOptions,
) {
  return request<GenerationResponse>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/retry`,
    requestOptions("POST", { attempt_id: attemptId, message_id: messageId }, options),
  );
}

export function regenerateResponse(
  conversationId: string,
  responseMessageId: string,
  options?: AiOptions,
) {
  return request<GenerationResponse>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/regenerate`,
    requestOptions("POST", { response_message_id: responseMessageId }, options),
  );
}

export function getConversationBranches(
  conversationId: string,
  options?: AiOptions,
) {
  const normalized = normalizeOptions(options);
  return normalized.signal
    ? request<{ status: string; branches: AiBranch[] }>(
        `/api/ai/conversations/${encodeURIComponent(conversationId)}/branches`,
        { signal: normalized.signal },
      )
    : request<{ status: string; branches: AiBranch[] }>(
        `/api/ai/conversations/${encodeURIComponent(conversationId)}/branches`,
      );
}

export function activateConversationBranch(
  conversationId: string,
  branchId: string,
  options?: AiOptions,
) {
  return request<ConversationResponse>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/branches/${encodeURIComponent(branchId)}/activate`,
    requestOptions("POST", undefined, options),
  );
}

export function submitConversationFeedback(
  conversationId: string,
  responseMessageId: string,
  body: FeedbackRequest,
  options?: AiOptions,
) {
  return request<{ status: string; feedback: AiFeedback }>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(responseMessageId)}/feedback`,
    requestOptions("POST", body, options),
  );
}
