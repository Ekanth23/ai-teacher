import type { Request } from "express";
import type { AuthenticatedUser } from "../../../auth/tokens.js";
import { AuthorizationError, resolveOrganizationContext } from "../../../auth/organization.js";
import * as repository from "./repository.js";
import { AssignmentValidationError, requiredText, requiredUuid, validateCreateInput, validateFeedbackInput, validateReviewInput, validateSubmitInput, validateUpdateInput } from "./validation.js";
import type { CreateAssignmentInput, CreateSubmissionInput, FeedbackSubmissionInput, ReviewSubmissionInput, UpdateAssignmentInput } from "./types.js";

const notFound = (name: string) => {
  const error = new AssignmentValidationError(`${name} was not found.`);
  error.code = "NOT_FOUND";
  return error;
};

async function requireTeacherForClassSubject(organizationId: string, classId: string, subjectId: string, user: AuthenticatedUser) {
  const isClassTeacher = (await repository.teacherAssignedToClass(classId, organizationId, user.id)).rows.length > 0;
  const isSubjectTeacher = (await repository.subjectTeacherAssigned(organizationId, classId, subjectId, user.id)).rows.length > 0;
  if (!isClassTeacher && !isSubjectTeacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "You are not authorized to manage assignments for this class and subject.");
  }
}

export async function create(req: Request, user: AuthenticatedUser, input: CreateAssignmentInput) {
  validateCreateInput(input);
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "TEACHER") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to create assignments.");
  }

  const organizationId = context.organization.id;
  const classId = requiredUuid(input.classId, "Class id");
  const subjectId = requiredUuid(input.subjectId, "Subject id");
  const title = requiredText(input.title, "Title");

  const teacher = (await repository.getTeacherForUser(organizationId, user.id)).rows[0];
  if (!teacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your teacher profile was not found in this organization.");
  }

  const classRecord = (await repository.classInOrganization(classId, organizationId)).rows[0];
  if (!classRecord) {
    throw notFound("Class");
  }

  const classSubject = (await repository.classSubjectActive(organizationId, classId, subjectId)).rows[0];
  if (!classSubject) {
    throw new AssignmentValidationError("Subject is not assigned to the class.");
  }

  await requireTeacherForClassSubject(organizationId, classId, subjectId, user);

  if (input.curriculumNodeId) {
    const node = (await repository.nodeClassOrganization(input.curriculumNodeId)).rows[0];
    if (!node) throw notFound("Curriculum node");
    if (node.organization_id !== organizationId) {
      throw new AuthorizationError("ORGANIZATION_ACCESS_DENIED", "Curriculum node belongs to another organization.");
    }
    if (node.class_id !== classId) {
      throw new AssignmentValidationError("Curriculum node does not belong to the selected class.");
    }
  }

  return (
    await repository.createAssignment({
      organizationId,
      teacherId: teacher.id,
      classId,
      subjectId,
      curriculumNodeId: input.curriculumNodeId ?? null,
      title,
      description: typeof input.description === "string" && input.description.trim() ? input.description.trim() : null,
      dueAt: typeof input.dueAt === "string" && input.dueAt.trim() ? new Date(input.dueAt.trim()).toISOString() : null,
    })
  ).rows[0];
}

export async function update(req: Request, user: AuthenticatedUser, assignmentId: string, input: UpdateAssignmentInput) {
  validateUpdateInput(input);
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "TEACHER") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to update assignments.");
  }

  const organizationId = context.organization.id;
  const normalizedId = requiredUuid(assignmentId, "Assignment id");

  const assignment = (await repository.getAssignmentForOrganization(normalizedId, organizationId)).rows[0];
  if (!assignment) throw notFound("Assignment");

  if (assignment.status !== "DRAFT") {
    throw new AssignmentValidationError("Only draft assignments can be edited.");
  }

  const teacher = (await repository.getTeacherForUser(organizationId, user.id)).rows[0];
  if (!teacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your teacher profile was not found in this organization.");
  }

  // Ownership: the teacher must be authorized for the assignment's current class/subject
  // before it can be modified at all, preventing edits by UUID alone.
  await requireTeacherForClassSubject(organizationId, assignment.class_id, assignment.subject_id, user);

  const classId = input.classId !== undefined ? requiredUuid(input.classId, "Class id") : assignment.class_id;
  const subjectId = input.subjectId !== undefined ? requiredUuid(input.subjectId, "Subject id") : assignment.subject_id;
  const title = input.title !== undefined ? requiredText(input.title, "Title") : assignment.title;
  const description =
    input.description !== undefined
      ? typeof input.description === "string" && input.description.trim()
        ? input.description.trim()
        : null
      : assignment.description;
  const curriculumNodeId = input.curriculumNodeId !== undefined ? input.curriculumNodeId : assignment.curriculum_node_id;
  const dueAt =
    input.dueAt === undefined
      ? assignment.due_at
      : typeof input.dueAt === "string" && input.dueAt.trim()
        ? new Date(input.dueAt.trim()).toISOString()
        : null;

  const classRecord = (await repository.classInOrganization(classId, organizationId)).rows[0];
  if (!classRecord) throw notFound("Class");

  const classSubject = (await repository.classSubjectActive(organizationId, classId, subjectId)).rows[0];
  if (!classSubject) {
    throw new AssignmentValidationError("Subject is not assigned to the class.");
  }

  // Re-authorize the effective class/subject in case the context was changed.
  await requireTeacherForClassSubject(organizationId, classId, subjectId, user);

  if (curriculumNodeId) {
    const node = (await repository.nodeClassOrganization(curriculumNodeId)).rows[0];
    if (!node) throw notFound("Curriculum node");
    if (node.organization_id !== organizationId) {
      throw new AuthorizationError("ORGANIZATION_ACCESS_DENIED", "Curriculum node belongs to another organization.");
    }
    if (node.class_id !== classId) {
      throw new AssignmentValidationError("Curriculum node does not belong to the selected class.");
    }
  }

  return (
    await repository.updateAssignment(normalizedId, {
      classId,
      subjectId,
      curriculumNodeId,
      title,
      description,
      dueAt,
    })
  ).rows[0];
}

export async function publish(req: Request, user: AuthenticatedUser, assignmentId: string) {
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "TEACHER") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to publish assignments.");
  }

  const organizationId = context.organization.id;
  const normalizedId = requiredUuid(assignmentId, "Assignment id");

  const assignment = (await repository.getAssignmentForOrganization(normalizedId, organizationId)).rows[0];
  if (!assignment) throw notFound("Assignment");

  const teacher = (await repository.getTeacherForUser(organizationId, user.id)).rows[0];
  if (!teacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your teacher profile was not found in this organization.");
  }

  await requireTeacherForClassSubject(organizationId, assignment.class_id, assignment.subject_id, user);

  if (assignment.status !== "DRAFT") {
    throw new AssignmentValidationError(`Invalid assignment lifecycle transition: ${assignment.status} -> PUBLISHED`);
  }

  const result = await repository.publishDraftAssignment(normalizedId, organizationId);
  if (result.rows.length === 0) {
    throw new AssignmentValidationError("Assignment is no longer a draft and cannot be published.");
  }

  return result.rows[0];
}

export async function open(req: Request, user: AuthenticatedUser, assignmentId: string) {
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "TEACHER") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to open assignments.");
  }

  const organizationId = context.organization.id;
  const normalizedId = requiredUuid(assignmentId, "Assignment id");

  const assignment = (await repository.getAssignmentForOrganization(normalizedId, organizationId)).rows[0];
  if (!assignment) throw notFound("Assignment");

  const teacher = (await repository.getTeacherForUser(organizationId, user.id)).rows[0];
  if (!teacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your teacher profile was not found in this organization.");
  }

  await requireTeacherForClassSubject(organizationId, assignment.class_id, assignment.subject_id, user);

  if (assignment.status !== "PUBLISHED") {
    throw new AssignmentValidationError(`Invalid assignment lifecycle transition: ${assignment.status} -> OPEN`);
  }

  const result = await repository.openPublishedAssignment(normalizedId, organizationId);
  if (result.rows.length === 0) {
    throw new AssignmentValidationError("Assignment is no longer published and cannot be opened.");
  }

  return result.rows[0];
}

export async function close(req: Request, user: AuthenticatedUser, assignmentId: string) {
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "TEACHER") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to close assignments.");
  }

  const organizationId = context.organization.id;
  const normalizedId = requiredUuid(assignmentId, "Assignment id");

  const assignment = (await repository.getAssignmentForOrganization(normalizedId, organizationId)).rows[0];
  if (!assignment) throw notFound("Assignment");

  const teacher = (await repository.getTeacherForUser(organizationId, user.id)).rows[0];
  if (!teacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your teacher profile was not found in this organization.");
  }

  await requireTeacherForClassSubject(organizationId, assignment.class_id, assignment.subject_id, user);

  if (assignment.status !== "OPEN") {
    throw new AssignmentValidationError(`Invalid assignment lifecycle transition: ${assignment.status} -> CLOSED`);
  }

  const result = await repository.closeOpenAssignment(normalizedId, organizationId);
  if (result.rows.length === 0) {
    throw new AssignmentValidationError("Assignment is no longer open and cannot be closed.");
  }

  return result.rows[0];
}

export async function listForStudent(req: Request, user: AuthenticatedUser) {
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "STUDENT") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to view student assignments.");
  }

  const organizationId = context.organization.id;

  const student = (await repository.getStudentForUser(organizationId, user.id)).rows[0];
  if (!student) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your student profile was not found in this organization.");
  }

  return (await repository.listOpenAssignmentsForStudent(organizationId, user.id)).rows;
}

export async function getForStudent(req: Request, user: AuthenticatedUser, assignmentId: string) {
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "STUDENT") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to view student assignments.");
  }

  const organizationId = context.organization.id;
  const normalizedId = requiredUuid(assignmentId, "Assignment id");

  const student = (await repository.getStudentForUser(organizationId, user.id)).rows[0];
  if (!student) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your student profile was not found in this organization.");
  }

  const assignment = (await repository.getOpenAssignmentForStudent(normalizedId, organizationId, user.id)).rows[0];
  if (!assignment) throw notFound("Assignment");

  return assignment;
}

export async function submit(req: Request, user: AuthenticatedUser, assignmentId: string, input: CreateSubmissionInput) {
  validateSubmitInput(input);
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "STUDENT") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to submit assignments.");
  }

  const organizationId = context.organization.id;
  const normalizedId = requiredUuid(assignmentId, "Assignment id");
  const content = requiredText(input.content, "Content");

  const student = (await repository.getStudentForUser(organizationId, user.id)).rows[0];
  if (!student) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your student profile was not found in this organization.");
  }

  const submission = (await repository.createSubmission(organizationId, student.id, normalizedId, content)).rows[0];
  if (!submission) throw notFound("Assignment");

  return submission;
}

export async function getCompletion(req: Request, user: AuthenticatedUser, assignmentId: string) {
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "STUDENT") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to view assignment completion.");
  }

  const organizationId = context.organization.id;
  const normalizedId = requiredUuid(assignmentId, "Assignment id");

  const student = (await repository.getStudentForUser(organizationId, user.id)).rows[0];
  if (!student) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your student profile was not found in this organization.");
  }

  const row = (await repository.getCompletionForStudent(organizationId, student.id, normalizedId)).rows[0];
  if (!row) throw notFound("Assignment");

  return {
    assignment_id: row.assignment_id,
    completed: row.submission_id !== null,
    completed_at: row.completed_at ?? null,
  };
}

export async function getOverdue(req: Request, user: AuthenticatedUser, assignmentId: string) {
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "STUDENT") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to view assignment overdue state.");
  }

  const organizationId = context.organization.id;
  const normalizedId = requiredUuid(assignmentId, "Assignment id");

  const student = (await repository.getStudentForUser(organizationId, user.id)).rows[0];
  if (!student) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your student profile was not found in this organization.");
  }

  const row = (await repository.getOverdueForStudent(organizationId, student.id, normalizedId)).rows[0];
  if (!row) throw notFound("Assignment");

  return {
    assignment_id: row.assignment_id,
    overdue: row.overdue === true,
    due_at: row.due_at ?? null,
  };
}

export async function listSubmissions(req: Request, user: AuthenticatedUser, assignmentId: string) {
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "TEACHER") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to view assignment submissions.");
  }

  const organizationId = context.organization.id;
  const normalizedId = requiredUuid(assignmentId, "Assignment id");

  const teacher = (await repository.getTeacherForUser(organizationId, user.id)).rows[0];
  if (!teacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your teacher profile was not found in this organization.");
  }

  const assignment = (await repository.getAssignmentForOrganization(normalizedId, organizationId)).rows[0];
  if (!assignment) throw notFound("Assignment");

  await requireTeacherForClassSubject(organizationId, assignment.class_id, assignment.subject_id, user);

  return (await repository.listSubmissionsForAssignment(normalizedId, organizationId)).rows;
}

export async function reviewSubmission(req: Request, user: AuthenticatedUser, assignmentId: string, submissionId: string) {
  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "TEACHER") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to review assignment submissions.");
  }

  const organizationId = context.organization.id;
  const normalizedAssignmentId = requiredUuid(assignmentId, "Assignment id");
  const normalizedSubmissionId = requiredUuid(submissionId, "Submission id");

  const teacher = (await repository.getTeacherForUser(organizationId, user.id)).rows[0];
  if (!teacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your teacher profile was not found in this organization.");
  }

  const assignment = (await repository.getAssignmentForOrganization(normalizedAssignmentId, organizationId)).rows[0];
  if (!assignment) throw notFound("Assignment");

  await requireTeacherForClassSubject(organizationId, assignment.class_id, assignment.subject_id, user);

  const submission = (
    await repository.getSubmissionForAssignment(normalizedAssignmentId, normalizedSubmissionId, organizationId)
  ).rows[0];
  if (!submission) throw notFound("Submission");

  return submission;
}

export async function recordReviewDecision(req: Request, user: AuthenticatedUser, assignmentId: string, submissionId: string, input: ReviewSubmissionInput) {
  validateReviewInput(input);

  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "TEACHER") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to review assignment submissions.");
  }

  const organizationId = context.organization.id;
  const normalizedAssignmentId = requiredUuid(assignmentId, "Assignment id");
  const normalizedSubmissionId = requiredUuid(submissionId, "Submission id");

  const teacher = (await repository.getTeacherForUser(organizationId, user.id)).rows[0];
  if (!teacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your teacher profile was not found in this organization.");
  }

  const assignment = (await repository.getAssignmentForOrganization(normalizedAssignmentId, organizationId)).rows[0];
  if (!assignment) throw notFound("Assignment");

  await requireTeacherForClassSubject(organizationId, assignment.class_id, assignment.subject_id, user);

  const result = await repository.setSubmissionDecision(
    normalizedAssignmentId,
    normalizedSubmissionId,
    organizationId,
    input.decision as string
  );
  const submission = result.rows[0];
  if (!submission) throw notFound("Submission");

  return submission;
}

export async function recordFeedback(req: Request, user: AuthenticatedUser, assignmentId: string, submissionId: string, input: FeedbackSubmissionInput) {
  const feedback = validateFeedbackInput(input);

  const context = await resolveOrganizationContext(req, user);

  if (context.role.name !== "TEACHER") {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to review assignment submissions.");
  }

  const organizationId = context.organization.id;
  const normalizedAssignmentId = requiredUuid(assignmentId, "Assignment id");
  const normalizedSubmissionId = requiredUuid(submissionId, "Submission id");

  const teacher = (await repository.getTeacherForUser(organizationId, user.id)).rows[0];
  if (!teacher) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your teacher profile was not found in this organization.");
  }

  const assignment = (await repository.getAssignmentForOrganization(normalizedAssignmentId, organizationId)).rows[0];
  if (!assignment) throw notFound("Assignment");

  await requireTeacherForClassSubject(organizationId, assignment.class_id, assignment.subject_id, user);

  const result = await repository.setSubmissionFeedback(normalizedAssignmentId, normalizedSubmissionId, organizationId, feedback);
  const submission = result.rows[0];
  if (!submission) throw notFound("Submission");

  return submission;
}
