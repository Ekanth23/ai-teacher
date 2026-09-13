import type { Request } from "express";
import type { AuthenticatedUser } from "../../auth/tokens.js";
import { AuthorizationError, resolveOrganizationContext } from "../../auth/organization.js";
import * as repository from "./repository.js";
import {
  PracticeValidationError,
  requiredText,
  requiredUuid,
  validateCreatePractice,
  validateCreateQuestion,
  validateUpdatePractice,
  validateUpdateQuestion,
} from "./validation.js";
import type { CreatePracticeInput, CreateQuestionInput, UpdatePracticeInput, UpdateQuestionInput } from "./types.js";

const AUTHORING_ROLES = new Set(["SCHOOL_ADMIN", "COACHING_ADMIN", "TEACHER"]);

const notFound = (name: string) => {
  const error = new PracticeValidationError(`${name} was not found.`);
  error.code = "NOT_FOUND";
  return error;
};

const duplicate = (message: string) => {
  const error = new PracticeValidationError(message);
  error.code = "DUPLICATE_PRACTICE_QUESTION";
  return error;
};

function requireAuthoring(role: string) {
  if (!AUTHORING_ROLES.has(role)) {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to manage practices.");
  }
}

async function requireTeacherClassAccess(classId: string, organizationId: string, user: AuthenticatedUser) {
  const assigned = await repository.teacherAssignedToClass(classId, organizationId, user.id);
  if (assigned.rows.length === 0) {
    throw new AuthorizationError("ROLE_REQUIRED", "You are not assigned to the class for this topic.");
  }
}

// Loads a practice and resolves the authenticated author. Cross-tenant access is
// impossible because resolveOrganizationContext fails unless the user is a member
// of the practice's organization.
async function resolvePracticeForAuthor(req: Request, user: AuthenticatedUser, practiceId: string) {
  const normalized = requiredUuid(practiceId, "Practice id");
  const practice = (await repository.getPractice(normalized)).rows[0];
  if (!practice) throw notFound("Practice");

  const context = await resolveOrganizationContext(req, user, practice.organization_id);
  requireAuthoring(context.role.name);

  if (context.role.name === "TEACHER") {
    const topic = (await repository.getTopicContext(practice.curriculum_node_id)).rows[0];
    if (!topic) throw notFound("Curriculum node");
    await requireTeacherClassAccess(topic.class_id, context.organization.id, user);
  }

  return { practice, context };
}

function requireEditable(status: string) {
  if (status !== "DRAFT") {
    throw new PracticeValidationError("Only draft practices can be edited.");
  }
}

export async function listPractices(req: Request, user: AuthenticatedUser) {
  const context = await resolveOrganizationContext(req, user);
  requireAuthoring(context.role.name);

  return context.role.name === "TEACHER"
    ? (await repository.listPracticesForTeacher(context.organization.id, user.id)).rows
    : (await repository.listPracticesForOrganization(context.organization.id)).rows;
}

export async function getPractice(req: Request, user: AuthenticatedUser, practiceId: string) {
  const { practice } = await resolvePracticeForAuthor(req, user, practiceId);
  return practice;
}

export async function createPractice(req: Request, user: AuthenticatedUser, input: CreatePracticeInput) {
  validateCreatePractice(input);
  const context = await resolveOrganizationContext(req, user);
  requireAuthoring(context.role.name);

  const topic = (await repository.getTopicContext(input.curriculumNodeId)).rows[0];
  if (!topic) throw notFound("Curriculum node");
  if (topic.node_type_code !== "TOPIC") {
    throw new PracticeValidationError("A practice must be attached to a topic.");
  }
  if (topic.organization_id !== context.organization.id) {
    throw new AuthorizationError("ORGANIZATION_ACCESS_DENIED", "Curriculum node belongs to another organization.");
  }
  if (context.role.name === "TEACHER") {
    await requireTeacherClassAccess(topic.class_id, context.organization.id, user);
  }

  const title = requiredText(input.title, "Title");
  const description = input.description === undefined || input.description === null ? null : String(input.description).trim() || null;

  return (
    await repository.createPractice({
      curriculumNodeId: input.curriculumNodeId,
      title,
      description,
      practiceType: input.practiceType,
      organizationId: context.organization.id,
      createdByUserId: user.id,
    })
  ).rows[0];
}

// === practice lifecycle methods ===
export async function updatePractice(req: Request, user: AuthenticatedUser, practiceId: string, input: UpdatePracticeInput) {
  validateUpdatePractice(input);
  const { practice, context } = await resolvePracticeForAuthor(req, user, practiceId);
  requireEditable(practice.status);

  const title = input.title !== undefined ? requiredText(input.title, "Title") : practice.title;
  const description =
    input.description !== undefined
      ? input.description === null
        ? null
        : String(input.description).trim() || null
      : practice.description;
  const practiceType = input.practiceType !== undefined ? input.practiceType : practice.practice_type;

  const result = await repository.updatePractice(practice.id, context.organization.id, { title, description, practiceType });
  if (result.rows.length === 0) {
    throw new PracticeValidationError("Practice is no longer editable.");
  }
  return result.rows[0];
}

export async function publishPractice(req: Request, user: AuthenticatedUser, practiceId: string) {
  const { practice, context } = await resolvePracticeForAuthor(req, user, practiceId);

  if (practice.status === "ARCHIVED") {
    throw new PracticeValidationError("Archived practices cannot be published.");
  }

  const result = await repository.publishPractice(practice.id, context.organization.id);
  if (result.rows.length === 0) {
    throw new PracticeValidationError(`Invalid practice lifecycle transition: ${practice.status} -> PUBLISHED`);
  }
  return result.rows[0];
}

export async function archivePractice(req: Request, user: AuthenticatedUser, practiceId: string) {
  const { practice, context } = await resolvePracticeForAuthor(req, user, practiceId);

  const result = await repository.archivePractice(practice.id, context.organization.id);
  if (result.rows.length === 0) {
    throw new PracticeValidationError(`Invalid practice lifecycle transition: ${practice.status} -> ARCHIVED`);
  }
  return result.rows[0];
}

// === question service methods ===
export async function listQuestions(req: Request, user: AuthenticatedUser, practiceId: string) {
  const { practice } = await resolvePracticeForAuthor(req, user, practiceId);
  return (await repository.listQuestionsForPractice(practice.id)).rows;
}

export async function addQuestion(req: Request, user: AuthenticatedUser, practiceId: string, input: CreateQuestionInput) {
  const validated = validateCreateQuestion(input);
  const { practice } = await resolvePracticeForAuthor(req, user, practiceId);
  requireEditable(practice.status);

  const sequenceNumber = validated.sequenceNumber ?? (await repository.nextQuestionSequence(practice.id)).rows[0].next_sequence;

  const existing = await repository.findQuestionBySequence(practice.id, sequenceNumber);
  if (existing.rows.length > 0) {
    throw duplicate(`A question with sequence_number ${sequenceNumber} already exists in this practice.`);
  }

  return (
    await repository.createQuestion({
      practiceId: practice.id,
      sequenceNumber,
      questionType: "MULTIPLE_CHOICE_SINGLE",
      questionText: validated.questionText,
      options: validated.options,
      correctOptionKey: validated.correctOptionKey,
      marks: validated.marks,
      explanation: validated.explanation,
    })
  ).rows[0];
}

export async function updateQuestion(req: Request, user: AuthenticatedUser, practiceId: string, questionId: string, input: UpdateQuestionInput) {
  const validated = validateUpdateQuestion(input);
  const { practice } = await resolvePracticeForAuthor(req, user, practiceId);
  requireEditable(practice.status);

  const question = (await repository.getQuestion(requiredUuid(questionId, "Question id"))).rows[0];
  if (!question || question.practice_id !== practice.id) throw notFound("Practice question");

  const options = validated.options ?? question.options;
  const correctOptionKey = validated.correctOptionKey ?? question.correct_option_key;
  if (!options.some((option: { key: string }) => option.key === correctOptionKey)) {
    throw new PracticeValidationError("correct_option_key must match one of the options.");
  }

  const sequenceNumber = validated.sequenceNumber ?? Number(question.sequence_number);
  const existing = await repository.findQuestionBySequence(practice.id, sequenceNumber, question.id);
  if (existing.rows.length > 0) {
    throw duplicate(`A question with sequence_number ${sequenceNumber} already exists in this practice.`);
  }

  const questionText = input.questionText !== undefined ? validated.questionText ?? question.question_text : question.question_text;

  return (
    await repository.updateQuestion(question.id, {
      questionText,
      options,
      correctOptionKey,
      marks: validated.marks ?? Number(question.marks),
      sequenceNumber,
      explanation: input.explanation !== undefined ? validated.explanation : question.explanation,
    })
  ).rows[0];
}

export async function deleteQuestion(req: Request, user: AuthenticatedUser, practiceId: string, questionId: string) {
  const { practice } = await resolvePracticeForAuthor(req, user, practiceId);
  requireEditable(practice.status);

  const question = (await repository.getQuestion(requiredUuid(questionId, "Question id"))).rows[0];
  if (!question || question.practice_id !== practice.id) throw notFound("Practice question");

  return (await repository.deleteQuestion(question.id)).rows[0];
}


