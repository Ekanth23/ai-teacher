import { isValidUuid } from "../../../auth/organization.js";
import type { CreateAssignmentInput, CreateSubmissionInput, FeedbackSubmissionInput, ReviewSubmissionInput, SubmissionDecision, UpdateAssignmentInput } from "./types.js";

export class AssignmentValidationError extends Error {
  code = "VALIDATION_ERROR";
}

export const ASSIGNMENT_STATUSES = ["DRAFT", "PUBLISHED", "OPEN", "CLOSED"];

export function requiredUuid(value: string | null | undefined, field: string) {
  if (!value || !isValidUuid(value)) throw new AssignmentValidationError(`${field} is invalid.`);
  return value.trim();
}

export function requiredText(value: string | null | undefined, field: string) {
  const normalized = value?.trim();
  if (!normalized) throw new AssignmentValidationError(`${field} is required.`);
  return normalized;
}

function validateDueAt(value: string | null | undefined) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !value.trim() || Number.isNaN(new Date(value).getTime())) {
    throw new AssignmentValidationError("Due date is invalid.");
  }
}

export function validateCreateInput(input: CreateAssignmentInput) {
  requiredUuid(input.classId, "Class id");
  requiredUuid(input.subjectId, "Subject id");
  if (input.curriculumNodeId !== undefined && input.curriculumNodeId !== null) {
    requiredUuid(input.curriculumNodeId, "Curriculum node id");
  }
  requiredText(input.title, "Title");
  validateDueAt(input.dueAt);
}

export function validateUpdateInput(input: UpdateAssignmentInput) {
  if (input.classId !== undefined) requiredUuid(input.classId, "Class id");
  if (input.subjectId !== undefined) requiredUuid(input.subjectId, "Subject id");
  if (input.curriculumNodeId !== undefined && input.curriculumNodeId !== null) {
    requiredUuid(input.curriculumNodeId, "Curriculum node id");
  }
  if (input.title !== undefined) requiredText(input.title, "Title");
  if (input.dueAt !== undefined) validateDueAt(input.dueAt);
}

export function validateSubmitInput(input: CreateSubmissionInput) {
  requiredText(input.content, "Content");
}

export const SUBMISSION_DECISIONS: SubmissionDecision[] = ["ACCEPTED", "REDO_REQUIRED"];

export function validateReviewInput(input: ReviewSubmissionInput) {
  if (typeof input.decision !== "string" || !SUBMISSION_DECISIONS.includes(input.decision as SubmissionDecision)) {
    throw new AssignmentValidationError("Decision is required and must be either ACCEPTED or REDO_REQUIRED.");
  }
}

export const MAX_FEEDBACK_LENGTH = 2000;

export function validateFeedbackInput(input: FeedbackSubmissionInput): string | null {
  const value = input.feedback;
  if (value === undefined) {
    throw new AssignmentValidationError("Feedback is required.");
  }
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AssignmentValidationError("Feedback must be a string.");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new AssignmentValidationError("Feedback must not be empty.");
  }
  if (normalized.length > MAX_FEEDBACK_LENGTH) {
    throw new AssignmentValidationError(`Feedback must be at most ${MAX_FEEDBACK_LENGTH} characters.`);
  }
  return normalized;
}
