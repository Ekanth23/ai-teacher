import { isValidUuid } from "../../../auth/organization.js";
import type {
  AssessmentOption,
  CreateAssessmentQuestionInput,
  UpdateAssessmentQuestionInput,
} from "./types.js";

export class AssessmentExecutionError extends Error {
  code = "VALIDATION_ERROR";
}

export const notFoundError = (name: string) => {
  const error = new AssessmentExecutionError(`${name} was not found.`);
  error.code = "NOT_FOUND";
  return error;
};

export function requiredUuid(value: string | null | undefined, field: string) {
  if (!value || !isValidUuid(value)) throw new AssessmentExecutionError(`${field} is invalid.`);
  return value.trim();
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AssessmentExecutionError(`${field} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AssessmentExecutionError("Explanation must be a string.");
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function validateOptionKeys(options: unknown, field: string): AssessmentOption[] {
  if (!Array.isArray(options)) {
    throw new AssessmentExecutionError(`${field} must be an array of options.`);
  }
  if (options.length === 0) {
    throw new AssessmentExecutionError(`${field} must contain at least one option.`);
  }
  const normalized: AssessmentOption[] = options.map((option, index) => {
    if (typeof option !== "object" || option === null || Array.isArray(option)) {
      throw new AssessmentExecutionError(`${field}[${index}] is invalid.`);
    }
    const raw = option as Record<string, unknown>;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!key) throw new AssessmentExecutionError(`${field}[${index}].key is required.`);
    if (!text) throw new AssessmentExecutionError(`${field}[${index}].text is required.`);
    return { key, text };
  });
  const seen = new Set<string>();
  for (const option of normalized) {
    if (seen.has(option.key)) {
      throw new AssessmentExecutionError(`Duplicate option key: ${option.key}.`);
    }
    seen.add(option.key);
  }
  return normalized;
}

function validateQuestionType(value: unknown) {
  if (value !== undefined && value !== null && value !== "MULTIPLE_CHOICE_SINGLE") {
    throw new AssessmentExecutionError("question_type must be MULTIPLE_CHOICE_SINGLE.");
  }
  return "MULTIPLE_CHOICE_SINGLE";
}

function validateMarks(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AssessmentExecutionError("marks must be a non-negative number.");
  }
  return parsed;
}

function validateSequenceNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AssessmentExecutionError("sequence_number must be a non-negative integer.");
  }
  return parsed;
}

export function validateCreateQuestion(input: CreateAssessmentQuestionInput) {
  const questionText = requiredText(input.questionText, "Question text");
  const questionType = validateQuestionType(input.questionType);
  const options = validateOptionKeys(input.options, "options");
  const correctOptionKey = requiredText(input.correctOptionKey, "Correct option key");
  if (!options.some((option) => option.key === correctOptionKey)) {
    throw new AssessmentExecutionError("correct_option_key must match one of the options.");
  }
  const marks = validateMarks(input.marks) ?? 1;
  const sequenceNumber = validateSequenceNumber(input.sequenceNumber);
  const explanation = optionalText(input.explanation);
  return { questionText, questionType, options, correctOptionKey, marks, sequenceNumber, explanation };
}

export function validateUpdateQuestion(input: UpdateAssessmentQuestionInput) {
  const questionText = input.questionText !== undefined ? requiredText(input.questionText, "Question text") : undefined;
  const questionType = input.questionType !== undefined ? validateQuestionType(input.questionType) : undefined;
  const options = input.options !== undefined ? validateOptionKeys(input.options, "options") : undefined;
  const correctOptionKey =
    input.correctOptionKey !== undefined ? requiredText(input.correctOptionKey, "Correct option key") : undefined;
  if (correctOptionKey !== undefined) {
    const effectiveOptions = options ?? [];
    if (effectiveOptions.length > 0 && !effectiveOptions.some((option) => option.key === correctOptionKey)) {
      throw new AssessmentExecutionError("correct_option_key must match one of the options.");
    }
  }
  const marks = validateMarks(input.marks);
  const sequenceNumber = validateSequenceNumber(input.sequenceNumber);
  const explanation = input.explanation !== undefined ? optionalText(input.explanation) : undefined;
  return { questionText, questionType, options, correctOptionKey, marks, sequenceNumber, explanation };
}

export function validateSaveAnswers(body: unknown): { answers: { questionId: string; selectedOption: string }[] } {
  const input = (body ?? {}) as { answers?: unknown };
  if (!Array.isArray(input.answers)) {
    throw new AssessmentExecutionError("answers must be an array.");
  }
  const answers = input.answers.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new AssessmentExecutionError(`answers[${index}] is invalid.`);
    }
    const raw = item as Record<string, unknown>;
    const questionId = typeof raw.question_id === "string" ? raw.question_id.trim() : "";
    const selectedOption = typeof raw.selected_option === "string" ? raw.selected_option.trim() : "";
    if (!questionId || !isValidUuid(questionId)) {
      throw new AssessmentExecutionError(`answers[${index}].question_id is invalid.`);
    }
    if (!selectedOption) {
      throw new AssessmentExecutionError(`answers[${index}].selected_option is required.`);
    }
    return { questionId, selectedOption };
  });
  return { answers };
}
