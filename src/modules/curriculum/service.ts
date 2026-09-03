import { AuthorizationError, isValidUuid, resolveOrganizationContext } from "../../auth/organization.js";
import type { AuthenticatedUser } from "../../auth/tokens.js";
import type { Request } from "express";
import * as repository from "./repository.js";
import type { CurriculumClass } from "./repository.js";

const MANAGEMENT_ROLES = new Set(["SCHOOL_ADMIN", "COACHING_ADMIN"]);

class CurriculumValidationError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "CurriculumValidationError";
  }
}

class CurriculumNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurriculumNotFoundError";
    (this as Error & { code?: string }).code = "NOT_FOUND";
  }
}

export function isActiveStatus(value: string | null | undefined) {
  return value === "ACTIVE";
}

export async function listBoards() {
  const result = await repository.listBoards();
  return result.rows;
}

export async function getBoardById(boardId: string) {
  if (!boardId || !isValidUuid(boardId)) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Board id is invalid.");
  }

  const result = await repository.getBoardById(boardId);
  if (result.rows.length === 0) {
    throw new CurriculumNotFoundError("Board not found.");
  }

  return result.rows[0];
}

export async function listMediums() {
  const result = await repository.listMediums();
  return result.rows;
}

export async function getMediumById(mediumId: string) {
  if (!mediumId || !isValidUuid(mediumId)) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Medium id is invalid.");
  }

  const result = await repository.getMediumById(mediumId);
  if (result.rows.length === 0) {
    throw new CurriculumNotFoundError("Medium not found.");
  }

  return result.rows[0];
}

export async function getClassForUser(req: Request, user: AuthenticatedUser, classId: string, mode: "read" | "manage"): Promise<{ classRecord: CurriculumClass; organizationContext: Awaited<ReturnType<typeof resolveOrganizationContext>> }> {
  if (!classId || !isValidUuid(classId)) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Class id is invalid.");
  }

  const classResult = await repository.getClassById(classId);
  if (classResult.rows.length === 0) {
    throw new CurriculumNotFoundError("Class not found.");
  }

  const classRecord = classResult.rows[0];
  const organizationContext = await resolveOrganizationContext(req, user, classRecord.organization_id);

  if (mode === "manage") {
    if (MANAGEMENT_ROLES.has(organizationContext.role.name)) {
      return { classRecord, organizationContext };
    }

    const teacherAssignmentResult = await repository.findTeacherAssignment(classId, organizationContext.organization.id, user.id);
    if (teacherAssignmentResult.rows.length > 0) {
      return { classRecord, organizationContext };
    }

    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to manage this class.");
  }

  if (MANAGEMENT_ROLES.has(organizationContext.role.name)) {
    return { classRecord, organizationContext };
  }

  const teacherAssignmentResult = await repository.findTeacherAssignment(classId, organizationContext.organization.id, user.id);
  if (teacherAssignmentResult.rows.length > 0) {
    return { classRecord, organizationContext };
  }

  const enrollmentResult = await repository.findActiveClassEnrollmentForStudent(user.id, classId);
  if (organizationContext.role.name === "STUDENT" && enrollmentResult.rows.length > 0) {
    return { classRecord, organizationContext };
  }

  throw new AuthorizationError("ROLE_REQUIRED", "You are not authorized to view this class syllabus.");
}

export async function listClassSyllabus(req: any, user: any, classId: string) {
  const { classRecord } = await getClassForUser(req, user, classId, "read");
  const result = await repository.listSyllabiForClass(classRecord.id);
  return result.rows;
}

export async function getSyllabusById(req: any, user: any, syllabusId: string) {
  if (!syllabusId || !isValidUuid(syllabusId)) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Syllabus id is invalid.");
  }

  const result = await repository.getSyllabusById(syllabusId);
  if (result.rows.length === 0) {
    throw new CurriculumNotFoundError("Syllabus not found.");
  }

  const syllabus = result.rows[0];
  await getClassForUser(req, user, syllabus.class_id, "read");
  return syllabus;
}

export async function createSyllabus(req: any, user: any, classId: string, input: Record<string, unknown>) {
  const { classRecord, organizationContext } = await getClassForUser(req, user, classId, "manage");

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const boardId = typeof input.board_id === "string" ? input.board_id.trim() : "";
  const mediumId = typeof input.medium_id === "string" ? input.medium_id.trim() : "";

  if (!name) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Syllabus name is required.");
  }

  if (!code) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Syllabus code is required.");
  }

  if (!boardId || !isValidUuid(boardId)) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Board id is invalid.");
  }

  if (!mediumId || !isValidUuid(mediumId)) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Medium id is invalid.");
  }

  const boardResult = await repository.getBoardById(boardId);
  if (boardResult.rows.length === 0) {
    throw new CurriculumNotFoundError("Board not found.");
  }

  if (boardResult.rows[0].status !== "ACTIVE") {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Board is inactive.");
  }

  const mediumResult = await repository.getMediumById(mediumId);
  if (mediumResult.rows.length === 0) {
    throw new CurriculumNotFoundError("Medium not found.");
  }

  if (mediumResult.rows[0].status !== "ACTIVE") {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Medium is inactive.");
  }

  const duplicateResult = await repository.findSyllabusByClassBoardMediumCode(classRecord.id, boardId, mediumId, code);
  if (duplicateResult.rows.length > 0) {
    const duplicateError = new Error("Duplicate syllabus already exists for this class, board, and medium.");
    (duplicateError as Error & { code?: string }).code = "DUPLICATE_SYLLABUS";
    throw duplicateError;
  }

  if (organizationContext.organization.id !== classRecord.organization_id) {
    throw new AuthorizationError("ORGANIZATION_MISMATCH", "Class and organization context do not match.");
  }

  const result = await repository.createSyllabus({
    classId: classRecord.id,
    boardId,
    mediumId,
    name,
    code,
    status: "ACTIVE",
  });

  return result.rows[0];
}

export async function listSyllabusVersions(req: any, user: any, syllabusId: string) {
  const syllabus = await getSyllabusById(req, user, syllabusId);
  const result = await repository.listVersionsForSyllabus(syllabus.id);
  return result.rows;
}

export async function createSyllabusVersion(req: any, user: any, syllabusId: string, input: Record<string, unknown>) {
  const syllabusResult = await repository.getSyllabusById(syllabusId);
  if (syllabusResult.rows.length === 0) {
    throw new CurriculumNotFoundError("Syllabus not found.");
  }

  const syllabus = syllabusResult.rows[0];
  await getClassForUser(req, user, syllabus.class_id, "manage");

  const version = typeof input.version === "string" ? input.version.trim() : "";
  if (!version) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "Syllabus version is required.");
  }

  const existingVersionResult = await repository.findVersionForSyllabus(syllabus.id, version);
  if (existingVersionResult.rows.length > 0) {
    const duplicateError = new Error("A syllabus version with this name already exists.");
    (duplicateError as Error & { code?: string }).code = "DUPLICATE_SYLLABUS_VERSION";
    throw duplicateError;
  }

  const effectiveFromRaw = input.effective_from;
  const effectiveToRaw = input.effective_to;
  const effectiveFrom = effectiveFromRaw === undefined || effectiveFromRaw === null || effectiveFromRaw === "" ? null : String(effectiveFromRaw);
  const effectiveTo = effectiveToRaw === undefined || effectiveToRaw === null || effectiveToRaw === "" ? null : String(effectiveToRaw);

  if (effectiveFrom && effectiveTo && new Date(effectiveTo) < new Date(effectiveFrom)) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "effective_to cannot be earlier than effective_from.");
  }

  const status = typeof input.status === "string" && input.status.trim() ? input.status.trim().toUpperCase() : "ACTIVE";
  if (!["ACTIVE", "INACTIVE"].includes(status)) {
    throw new CurriculumValidationError("VALIDATION_ERROR", "status must be ACTIVE or INACTIVE.");
  }

  const result = await repository.createSyllabusVersion({
    syllabusId: syllabus.id,
    version,
    effectiveFrom,
    effectiveTo,
    status,
  });

  return result.rows[0];
}

export default {
  listBoards,
  getBoardById,
  listMediums,
  getMediumById,
  getClassForUser,
  listClassSyllabus,
  getSyllabusById,
  createSyllabus,
  listSyllabusVersions,
  createSyllabusVersion,
};
