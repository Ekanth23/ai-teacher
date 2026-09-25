import { isValidUuid } from "../../auth/organization.js";
import {
  FEEDBACK_REASONS,
  type ConversationScope,
  type CreateConversationInput,
  type FeedbackInput,
  type FeedbackReason,
  type FeedbackSentiment,
  type RegenerateInput,
  type RetryInput,
  type SendMessageInput,
} from "./conversation.types.js";

export const MAX_TITLE_LENGTH = 255;
export const MAX_LABEL_LENGTH = 255;
export const MAX_QUESTION_LENGTH = 20_000;

export class ConversationValidationError extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "ConversationValidationError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ConversationValidationError("Request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function optionalLabel(value: unknown, field: string, maxLength = MAX_LABEL_LENGTH): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ConversationValidationError(`${field} must be a string.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new ConversationValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function question(value: unknown): string {
  if (typeof value !== "string") {
    throw new ConversationValidationError("Question must be a string.");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new ConversationValidationError("Question is required.");
  }
  if (normalized.length > MAX_QUESTION_LENGTH) {
    throw new ConversationValidationError(`Question must be at most ${MAX_QUESTION_LENGTH} characters.`);
  }
  return normalized;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function scopeValue(body: Record<string, unknown>, scope: Record<string, unknown>, key: string): unknown {
  if (hasOwn(scope, key)) return scope[key];
  if (hasOwn(body, key)) return body[key];
  const prefixed = `scope_${key}`;
  if (hasOwn(body, prefixed)) return body[prefixed];
  return undefined;
}

export function parseConversationScopeInput(body: unknown): Partial<ConversationScope> {
  const input = record(body);
  const scope = record(input.scope);
  const result: Partial<ConversationScope> = {};
  const fields: Array<[keyof ConversationScope, string, number]> = [
    ["board", "scope.board", MAX_LABEL_LENGTH],
    ["class", "scope.class", MAX_LABEL_LENGTH],
    ["subject", "subject", MAX_LABEL_LENGTH],
    ["chapter", "scope.chapter", MAX_LABEL_LENGTH],
    ["topic", "topic", MAX_LABEL_LENGTH],
    ["language", "scope.language", 100],
    ["medium", "scope.medium", 100],
  ];
  for (const [key, label, maxLength] of fields) {
    const raw = scopeValue(input, scope, key);
    if (raw !== undefined || hasOwn(scope, key) || hasOwn(input, key) || hasOwn(input, `scope_${key}`)) {
      result[key] = optionalLabel(raw, label, maxLength);
    }
  }
  return result;
}

export function parseCreateConversationInput(body: unknown): CreateConversationInput {
  const input = record(body);
  const parsedScope = parseConversationScopeInput(input);
  const subject = parsedScope.subject ?? null;
  const topic = parsedScope.topic ?? null;

  const rawQuestion = input.question ?? input.message ?? input.content ?? input.text;
  return {
    subject,
    topic,
    scope: {
      board: parsedScope.board ?? null,
      class: parsedScope.class ?? null,
      subject,
      chapter: parsedScope.chapter ?? null,
      topic,
      language: parsedScope.language ?? null,
      medium: parsedScope.medium ?? null,
    },
    question: rawQuestion === undefined ? undefined : question(rawQuestion),
  };
}

export function parseSendMessageInput(body: unknown): SendMessageInput {
  const input = record(body);
  const rawQuestion = input.question ?? input.content ?? input.text ?? input.message;
  const branchId = input.branch_id ?? input.branchId;
  return {
    question: question(rawQuestion),
    branchId: branchId === undefined || branchId === null || branchId === "" ? undefined : uuid(branchId, "branch_id"),
  };
}

export function parseTitle(body: unknown): string {
  const input = record(body);
  const title = optionalLabel(input.title ?? input.name, "title", MAX_TITLE_LENGTH);
  if (!title) {
    throw new ConversationValidationError("Title is required.");
  }
  return title;
}

export function parseMessageId(value: unknown, field = "message_id"): string {
  return uuid(value, field);
}

export function parseBranchId(value: unknown, field = "branch_id"): string {
  return uuid(value, field);
}

function identifierValue(
  input: Record<string, unknown>,
  primary: string,
  camel: string,
  field: string
): unknown {
  if (hasOwn(input, primary)) return input[primary];
  if (hasOwn(input, camel)) return input[camel];
  return undefined;
}

function rejectExplicitNull(value: unknown, field: string): void {
  if (value === null) {
    throw new ConversationValidationError(`${field} must be a valid UUID.`);
  }
}

export function parseRetryInput(body: unknown, pathAttemptId?: string): RetryInput {
  const input = record(body);
  const attemptId = pathAttemptId ?? identifierValue(input, "attempt_id", "attemptId", "attempt_id");
  const messageId = identifierValue(input, "message_id", "messageId", "message_id");
  rejectExplicitNull(attemptId, "attempt_id");
  rejectExplicitNull(messageId, "message_id");
  if (attemptId === undefined && messageId === undefined) {
    throw new ConversationValidationError("attempt_id or message_id is required.");
  }
  return {
    attemptId: attemptId === undefined ? undefined : uuid(attemptId, "attempt_id"),
    messageId: messageId === undefined ? undefined : uuid(messageId, "message_id"),
  };
}

export function parseRegenerateInput(body: unknown, pathResponseId?: string): RegenerateInput {
  const input = record(body);
  const responseMessageId = pathResponseId ?? identifierValue(input, "response_message_id", "responseMessageId", "response_message_id");
  const attemptId = identifierValue(input, "attempt_id", "attemptId", "attempt_id");
  const messageId = identifierValue(input, "message_id", "messageId", "message_id");
  rejectExplicitNull(responseMessageId, "response_message_id");
  rejectExplicitNull(attemptId, "attempt_id");
  rejectExplicitNull(messageId, "message_id");
  if (responseMessageId === undefined && attemptId === undefined && messageId === undefined) {
    throw new ConversationValidationError("response_message_id, attempt_id, or message_id is required.");
  }
  return {
    responseMessageId: responseMessageId === undefined ? undefined : uuid(responseMessageId, "response_message_id"),
    attemptId: attemptId === undefined ? undefined : uuid(attemptId, "attempt_id"),
    messageId: messageId === undefined ? undefined : uuid(messageId, "message_id"),
  };
}

function sentiment(value: unknown): FeedbackSentiment {
  if (typeof value !== "string") {
    throw new ConversationValidationError("Feedback sentiment must be a string.");
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "helpful") return "HELPFUL";
  if (normalized === "not_helpful" || normalized === "nothelpful") return "NOT_HELPFUL";
  throw new ConversationValidationError("Feedback sentiment must be helpful or not helpful.");
}

function feedbackReason(value: unknown): FeedbackReason | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ConversationValidationError("Feedback reason must be a string.");
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!FEEDBACK_REASONS.includes(normalized as FeedbackReason)) {
    throw new ConversationValidationError("Feedback reason is not supported.");
  }
  return normalized as FeedbackReason;
}

export function parseFeedbackInput(body: unknown, pathResponseId?: string): FeedbackInput {
  const input = record(body);
  const responseMessageId = pathResponseId ?? input.response_message_id ?? input.responseMessageId ?? input.message_id;
  return {
    responseMessageId: uuid(responseMessageId, "response_message_id"),
    sentiment: sentiment(input.sentiment ?? input.rating ?? input.feedback),
    reason: feedbackReason(input.reason),
  };
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isValidUuid(value.trim())) {
    throw new ConversationValidationError(`${field} must be a valid UUID.`);
  }
  return value.trim();
}

export function parseOptionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return uuid(value, field);
}

export function parseIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ConversationValidationError("Idempotency-Key must be a string.");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 255) {
    throw new ConversationValidationError("Idempotency-Key must be between 1 and 255 characters.");
  }
  return normalized;
}
