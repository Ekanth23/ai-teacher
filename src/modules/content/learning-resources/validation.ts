import { isValidUuid } from "../../../auth/organization.js";
import type { CreateLearningResourceInput, UpdateLearningResourceInput } from "./types.js";

export class LearningResourceValidationError extends Error {
  code = "VALIDATION_ERROR";
}

export const RESOURCE_TYPES = [
  "TEXTBOOK",
  "TEACHER_NOTES",
  "WORKSHEET",
  "ASSIGNMENT",
  "QUESTION_BANK",
  "PREVIOUS_YEAR_PAPER",
  "MOCK_TEST",
  "SYLLABUS_DOCUMENT",
  "FORMULA_SHEET",
  "OTHER",
];

export const VISIBILITIES = ["ORGANIZATION", "CLASS", "PRIVATE"];
export const STATUSES = ["DRAFT", "PENDING_APPROVAL", "PUBLISHED", "ARCHIVED"];

export function requiredUuid(value: string | null | undefined, field: string) {
  if (!value || !isValidUuid(value)) throw new LearningResourceValidationError(`${field} is invalid.`);
  return value.trim();
}

export function text(value: string | null | undefined, field: string) {
  const normalized = value?.trim();
  if (!normalized) throw new LearningResourceValidationError(`${field} is required.`);
  return normalized;
}

function validateCommonFields(input: CreateLearningResourceInput | UpdateLearningResourceInput) {
  if (input.resourceType !== undefined && !RESOURCE_TYPES.includes(input.resourceType)) {
    throw new LearningResourceValidationError("Resource type is invalid.");
  }
  if (input.visibility !== undefined && !VISIBILITIES.includes(input.visibility)) {
    throw new LearningResourceValidationError("Visibility is invalid.");
  }
  if (input.curriculumNodeId) requiredUuid(input.curriculumNodeId, "Curriculum node id");
  if (input.classId) requiredUuid(input.classId, "Class id");
  if (
    input.fileSizeBytes !== undefined &&
    input.fileSizeBytes !== null &&
    (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes < 0)
  ) {
    throw new LearningResourceValidationError("File size is invalid.");
  }
}

export function validateCreateInput(input: CreateLearningResourceInput) {
  text(input.title, "Title");
  text(input.fileUrl, "File URL");
  if (!RESOURCE_TYPES.includes(input.resourceType)) {
    throw new LearningResourceValidationError("Resource type is invalid.");
  }
  validateCommonFields(input);
  if (input.visibility === "CLASS" && !input.classId) {
    throw new LearningResourceValidationError("classId is required when visibility is CLASS.");
  }
}

export function validateUpdateInput(input: UpdateLearningResourceInput) {
  if (input.title !== undefined) text(input.title, "Title");
  if (input.fileUrl !== undefined) text(input.fileUrl, "File URL");
  validateCommonFields(input);
  if (input.visibility === "CLASS" && input.classId === null) {
    throw new LearningResourceValidationError("classId is required when visibility is CLASS.");
  }
}
