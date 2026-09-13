import { isValidUuid } from "../../auth/organization.js";
import type {
  CreatePracticeInput,
  CreateQuestionInput,
  PracticeOption,
  UpdatePracticeInput,
  UpdateQuestionInput,
} from "./types.js";

export class PracticeValidationError extends Error {
  code = "VALIDATION_ERROR";
}

export const PRACTICE_TYPES = ["PRACTICE", "QUIZ", "SELF_ASSESSMENT"];
export const PRACTICE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"];
export const QUESTION_TYPES = ["MULTIPLE_CHOICE_SINGLE"];

export function requiredUuid(value: string | null | undefined, field: string) {
  if (!value || !isValidUuid(value)) throw new PracticeValidationError(`${field} is invalid.`);
  return value.trim();
}

export function requiredText(value: string | null | undefined, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new PracticeValidationError(`${field} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function validatePracticeType(value: unknown) {
  if (typeof value !== "string" || !PRACTICE_TYPES.includes(value)) {
    throw new PracticeValidationError("practice_type must be one of PRACTICE, QUIZ, SELF_ASSESSMENT.");
  }
  return value;
}

export function validateCreatePractice(input: CreatePracticeInput) {
  requiredUuid(input.curriculumNodeId, "Curriculum node id");
  requiredText(input.title, "Title");
  validatePracticeType(input.practiceType);
}

export function validateUpdatePractice(input: UpdatePracticeInput) {
  if (input.title !== undefined) requiredText(input.title, "Title");
  if (input.practiceType !== undefined) validatePracticeType(input.practiceType);
}

function validateOptionKeys(options: unknown, field: string): PracticeOption[] {
  if (!Array.isArray(options)) {
    throw new PracticeValidationError(`${field} must be an array of options.`);
  }
  if (options.length === 0) {
    throw new PracticeValidationError(`${field} must contain at least one option.`);
  }

  const seen = new Set<string>();
  const normalized: PracticeOption[] = options.map((option, index) => {
    if (typeof option !== "object" || option === null || Array.isArray(option)) {
      throw new PracticeValidationError(`${field}[${index}] is invalid.`);
    }
    const raw = option as Record<string, unknown>;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!key) throw new PracticeValidationError(`${field}[${index}].key is required.`);
    if (!text) throw new PracticeValidationError(`${field}[${index}].text is required.`);
    return { key, text };
  });

  for (const option of normalized) {
    if (seen.has(option.key)) {
      throw new PracticeValidationError(`Duplicate option key: ${option.key}.`);
    }
    seen.add(option.key);
  }

  return normalized;
}

function validateQuestionType(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !QUESTION_TYPES.includes(value)) {
    throw new PracticeValidationError("question_type must be MULTIPLE_CHOICE_SINGLE.");
  }
  return value as "MULTIPLE_CHOICE_SINGLE";
}

function validateMarks(value: number | string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new PracticeValidationError("marks must be a non-negative number.");
  }
  return parsed;
}

function validateSequenceNumber(value: number | string | undefined | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new PracticeValidationError("sequence_number must be a non-negative integer.");
  }
  return parsed;
}

export function validateCreateQuestion(input: CreateQuestionInput) {
  const questionText = requiredText(input.questionText, "Question text");
  validateQuestionType(input.questionType);
  const options = validateOptionKeys(input.options, "options");
  const correctOptionKey = requiredText(input.correctOptionKey, "Correct option key");
  if (!options.some((option) => option.key === correctOptionKey)) {
    throw new PracticeValidationError("correct_option_key must match one of the options.");
  }
  const marks = validateMarks(input.marks) ?? 1;
  const sequenceNumber = validateSequenceNumber(input.sequenceNumber);
  const explanation = optionalText(input.explanation);

  return {
    questionText,
    options,
    correctOptionKey,
    marks,
    sequenceNumber,
    explanation,
  };
}

export function validateUpdateQuestion(input: UpdateQuestionInput) {
  let questionText: string | undefined;
  if (input.questionText !== undefined) questionText = requiredText(input.questionText, "Question text");
  validateQuestionType(input.questionType);
  let options: PracticeOption[] | undefined;
  if (input.options !== undefined) {
    options = validateOptionKeys(input.options, "options");
  }
  const correctOptionKey = input.correctOptionKey !== undefined ? requiredText(input.correctOptionKey, "Correct option key") : undefined;
  if (correctOptionKey !== undefined) {
    const effectiveOptions = options ?? [];
    if (effectiveOptions.length > 0 && !effectiveOptions.some((option) => option.key === correctOptionKey)) {
      throw new PracticeValidationError("correct_option_key must match one of the options.");
    }
  }
  const marks = validateMarks(input.marks);
  const sequenceNumber = validateSequenceNumber(input.sequenceNumber);
  const explanation = optionalText(input.explanation);

  return { questionText, options, correctOptionKey, marks, sequenceNumber, explanation };
}
