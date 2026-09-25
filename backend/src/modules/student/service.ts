import type { Request } from "express";
import type { AuthenticatedUser } from "../../auth/tokens.js";
import { AuthorizationError, isValidUuid, resolveOrganizationContext } from "../../auth/organization.js";
import { getClassForUser } from "../curriculum/service.js";
import * as resourceService from "../content/learning-resources/service.js";
import * as repository from "./repository.js";

class StudentValidationError extends Error {
  code = "VALIDATION_ERROR";
}

const requiredUuid = (value: string | null | undefined, field: string) => {
  if (!value || !isValidUuid(value)) throw new StudentValidationError(`${field} is invalid.`);
  return value.trim();
};

const RECENT_ACTIVITY_LIMIT = 5;
const RESOURCE_LIMIT = 10;

// Establishes the authenticated student and their organization context.
// Identity comes exclusively from the authenticated request context.
async function requireStudent(req: Request, user: AuthenticatedUser) {
  const context = await resolveOrganizationContext(req, user, null, { autoResolveSingle: true });
  if (context.role.name !== "STUDENT") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to access the student dashboard.");
  }
  const student = (await repository.getStudentByUser(context.organization.id, user.id)).rows[0];
  if (!student) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your student profile was not found in this organization.");
  }
  return { context, student };
}

const classDto = (row: { id: string; name: string | null; section: string | null }) => ({
  id: row.id,
  name: row.name,
  section: row.section ?? null,
});

const subjectDto = (row: { id: string; name: string; code: string | null }) => ({
  id: row.id,
  name: row.name,
  code: row.code ?? null,
});

// Intentional projection that omits internal tenant/ownership/authorization fields.
const resourceDto = (row: Record<string, unknown>) => ({
  id: row.id,
  resource_type: row.resource_type,
  title: row.title,
  description: row.description ?? null,
  language_code: row.language_code ?? null,
  file_url: row.file_url,
  file_name: row.file_name ?? null,
  mime_type: row.mime_type ?? null,
  file_size_bytes: row.file_size_bytes ?? null,
  curriculum_node_id: row.curriculum_node_id ?? null,
  class_id: row.class_id ?? null,
});

export async function listClasses(req: Request, user: AuthenticatedUser) {
  const { context, student } = await requireStudent(req, user);
  const classes = (await repository.listActiveEnrollmentsForStudent(context.organization.id, student.id)).rows;
  return classes.map(classDto);
}

export async function listEnrollments(req: Request, user: AuthenticatedUser) {
  const { context, student } = await requireStudent(req, user);
  return (await repository.listStudentEnrollments(context.organization.id, student.id)).rows.map((row) => ({
    enrollment_id: row.enrollment_id,
    class: {
      id: row.class_id,
      name: row.class_name,
      section: row.class_section,
    },
    academic_year: row.academic_year,
    status: row.enrollment_status,
    is_current: row.is_current,
  }));
}

function currentEnrollmentDto(
  row: repository.CurrentEnrollmentRow | undefined,
  organizationId?: string
) {
  if (
    !row ||
    !row.current_enrollment_id ||
    !row.enrollment_id ||
    row.enrollment_status !== "ACTIVE" ||
    !row.class_id ||
    row.class_status !== "ACTIVE" ||
    row.class_organization_id !== row.student_organization_id ||
    (organizationId !== undefined && row.student_organization_id !== organizationId)
  ) {
    return {
      status: "unresolved" as const,
      enrollment: null,
      current_class: null,
    };
  }
  return {
    status: "resolved" as const,
    enrollment: {
      id: row.enrollment_id,
      academic_year: row.academic_year,
      status: row.enrollment_status,
    },
    current_class: {
      id: row.class_id,
      name: row.class_name,
      section: row.class_section,
    },
  };
}

export async function getCurrentEnrollment(req: Request, user: AuthenticatedUser) {
  const { context, student } = await requireStudent(req, user);
  const row = (await repository.getCurrentEnrollmentForStudent(context.organization.id, student.id)).rows[0];
  return currentEnrollmentDto(row, context.organization.id);
}

export async function selectCurrentEnrollment(
  req: Request,
  user: AuthenticatedUser,
  enrollmentId: string
) {
  const { context, student } = await requireStudent(req, user);
  const normalizedEnrollmentId = requiredUuid(enrollmentId, "Enrollment id");
  let result;
  try {
    result = await repository.setCurrentEnrollmentForStudent(
      context.organization.id,
      student.id,
      normalizedEnrollmentId
    );
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = String((error as { code?: unknown }).code);
      if (code === "23503" || code === "P0001") {
        throw new AuthorizationError("ENROLLMENT_NOT_FOUND", "The enrollment is not available for this student.");
      }
    }
    throw error;
  }
  if (result.rows.length === 0) {
    throw new AuthorizationError("ENROLLMENT_NOT_FOUND", "The enrollment is not available for this student.");
  }
  return currentEnrollmentDto(result.rows[0], context.organization.id);
}

export async function listClassSubjects(req: Request, user: AuthenticatedUser, classId: string) {
  await requireStudent(req, user);
  const normalizedClassId = requiredUuid(classId, "Class id");

  // Enrollment-aware class access (reuses the existing curriculum authorization).
  const access = await getClassForUser(req, user, normalizedClassId, "read");

  const subjects = (await repository.listSubjectsForClass(access.classRecord.organization_id, normalizedClassId)).rows;
  return subjects.map(subjectDto);
}

export async function getDashboard(req: Request, user: AuthenticatedUser) {
  const { context, student } = await requireStudent(req, user);
  const organizationId = context.organization.id;

  const classes = (await repository.listActiveEnrollmentsForStudent(organizationId, student.id)).rows;
  const currentEnrollmentRow = (
    await repository.getCurrentEnrollmentForStudent(organizationId, student.id)
  ).rows[0];
  const currentEnrollment = currentEnrollmentDto(currentEnrollmentRow, organizationId);
  const currentClass =
    currentEnrollment.current_class && currentEnrollment.current_class.name
      ? currentEnrollment.current_class
      : null;

  const subjects = currentClass
    ? (await repository.listSubjectsForClass(organizationId, currentClass.id)).rows.map(subjectDto)
    : [];

  const recentActivity = (await repository.listRecentConversationsForStudent(organizationId, student.id, RECENT_ACTIVITY_LIMIT)).rows.map((c) => ({
    id: c.id,
    subject: c.subject ?? null,
    topic: c.topic ?? null,
    updated_at: c.updated_at,
  }));

  // Published/visible resources are computed by the existing learning-resource
  // service (status + visibility + class membership), then projected to a safe DTO.
  const resources = (await resourceService.list(req, user, organizationId, {}))
    .slice(0, RESOURCE_LIMIT)
    .map(resourceDto);

  const curriculumStructures: { id: string; class_id: string; subject_id: string | null }[] = [];
  for (const c of classes) {
    const structures = (await repository.listCurriculumStructuresForClass(c.id)).rows;
    for (const s of structures) {
      curriculumStructures.push({ id: s.id, class_id: c.id, subject_id: s.subject_id ?? null });
    }
  }

  return {
    student: {
      id: student.id,
      full_name: student.full_name,
      grade_level: student.grade_level ?? null,
    },
    classes: classes.map(classDto),
    current_class: currentClass ? classDto(currentClass) : null,
    subjects,
    recent_activity: recentActivity,
    learning_resources: resources,
    curriculum_structures: curriculumStructures,
    // No authoritative per-student progress/results data source exists yet.
    progress: null,
  };
}
