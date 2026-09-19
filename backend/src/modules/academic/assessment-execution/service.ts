import type { Request } from "express";
import type { AuthenticatedUser } from "../../../auth/tokens.js";
import { AuthorizationError, resolveOrganizationContext } from "../../../auth/organization.js";
import { getStudentByUser } from "../../student/repository.js";
import * as repository from "./repository.js";
import { evaluateFormalAttempt } from "./evaluation.js";
import {
  AssessmentExecutionError,
  notFoundError,
  requiredUuid,
  validateCreateQuestion,
  validateSaveAnswers,
  validateUpdateQuestion,
} from "./validation.js";
import type {
  AssessmentAttemptRow,
  AssessmentQuestionRow,
  CreateAssessmentQuestionInput,
  UpdateAssessmentQuestionInput,
} from "./types.js";

const AUTHORING_ROLES = new Set(["SCHOOL_ADMIN", "COACHING_ADMIN", "TEACHER"]);

// Student identity is always derived from the authenticated user ->
// students_v2 relationship. A client-supplied student_id is never trusted.
async function requireStudent(req: Request, user: AuthenticatedUser) {
  const context = await resolveOrganizationContext(req, user, null, { autoResolveSingle: true });
  if (context.role.name !== "STUDENT") {
    throw new AuthorizationError("ROLE_REQUIRED", "Student access required.");
  }
  const student = (await getStudentByUser(context.organization.id, user.id)).rows[0];
  if (!student) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your student profile was not found in this organization.");
  }
  return { context, student };
}

async function requireAuthoringEvent(req: Request, user: AuthenticatedUser, eventId: string) {
  const context = await resolveOrganizationContext(req, user);
  if (!AUTHORING_ROLES.has(context.role.name)) {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to manage assessments.");
  }
  const normalized = requiredUuid(eventId, "Assessment id");
  const event = (await repository.getEventForOrganization(normalized, context.organization.id)).rows[0];
  if (!event) throw notFoundError("Assessment");
  return { context, event };
}

function requireDraftEvent(event: { id: string; status: string }) {
  if (event.status !== "DRAFT") {
    throw new AssessmentExecutionError("Questions can only be changed while the assessment is a draft.");
  }
}

// Student-facing projection. correct_option_key is omitted so a student can
// never see the answer before submission.
const safeQuestionDto = (row: AssessmentQuestionRow) => ({
  id: row.id,
  sequence_number: Number(row.sequence_number),
  question_text: row.question_text,
  options: row.options,
  marks: Number(row.marks),
});

const attemptDto = (row: AssessmentAttemptRow) => ({
  id: row.id,
  assessment_event_id: row.assessment_event_id,
  status: row.status,
  started_at: row.started_at,
});

export async function listQuestions(req: Request, user: AuthenticatedUser, eventId: string) {
  const { context, event } = await requireAuthoringEvent(req, user, eventId);
  const rows = (await repository.listQuestionsForEvent(context.organization.id, event.id)).rows;
  return rows;
}

export async function addQuestion(
  req: Request,
  user: AuthenticatedUser,
  eventId: string,
  input: CreateAssessmentQuestionInput
) {
  const { context, event } = await requireAuthoringEvent(req, user, eventId);
  requireDraftEvent(event);
  const validated = validateCreateQuestion(input);
  const sequenceNumber =
    validated.sequenceNumber ??
    Number((await repository.nextQuestionSequence(event.id)).rows[0].next_sequence);
  const existing = (await repository.findQuestionBySequence(event.id, sequenceNumber)).rows[0];
  if (existing) {
    const error = new AssessmentExecutionError(
      `A question with sequence_number ${sequenceNumber} already exists in this assessment.`
    );
    error.code = "DUPLICATE_ASSESSMENT_QUESTION";
    throw error;
  }
  const row = (
    await repository.createQuestion(context.organization.id, event.id, {
      sequenceNumber,
      questionType: validated.questionType,
      questionText: validated.questionText,
      options: validated.options,
      correctOptionKey: validated.correctOptionKey,
      marks: validated.marks,
      explanation: validated.explanation,
    })
  ).rows[0];
  return row;
}

export async function updateQuestion(
  req: Request,
  user: AuthenticatedUser,
  eventId: string,
  questionId: string,
  input: UpdateAssessmentQuestionInput
) {
  const { context, event } = await requireAuthoringEvent(req, user, eventId);
  requireDraftEvent(event);
  const normalized = requiredUuid(questionId, "Question id");
  const current = (await repository.getQuestion(context.organization.id, event.id, normalized)).rows[0];
  if (!current) throw notFoundError("Assessment question");
  const validated = validateUpdateQuestion(input);
  const options = validated.options ?? current.options;
  const correctOptionKey = validated.correctOptionKey ?? current.correct_option_key;
  if (validated.correctOptionKey !== undefined || validated.options !== undefined) {
    const keys = (options as { key: string }[]).map((o) => o.key);
    if (!keys.includes(correctOptionKey)) {
      throw new AssessmentExecutionError("correct_option_key must match one of the options.");
    }
  }
  const sequenceNumber = validated.sequenceNumber ?? Number(current.sequence_number);
  const clash = (await repository.findQuestionBySequence(event.id, sequenceNumber, current.id)).rows[0];
  if (clash) {
    const error = new AssessmentExecutionError(
      `A question with sequence_number ${sequenceNumber} already exists in this assessment.`
    );
    error.code = "DUPLICATE_ASSESSMENT_QUESTION";
    throw error;
  }
  const row = (
    await repository.updateQuestion(current.id, {
      questionText: validated.questionText ?? current.question_text,
      questionType: validated.questionType ?? current.question_type,
      options,
      correctOptionKey,
      marks: validated.marks ?? Number(current.marks),
      sequenceNumber,
      explanation: validated.explanation !== undefined ? validated.explanation : current.explanation,
    })
  ).rows[0];
  return row;
}

export async function deleteQuestion(req: Request, user: AuthenticatedUser, eventId: string, questionId: string) {
  const { context, event } = await requireAuthoringEvent(req, user, eventId);
  requireDraftEvent(event);
  const normalized = requiredUuid(questionId, "Question id");
  const current = (await repository.getQuestion(context.organization.id, event.id, normalized)).rows[0];
  if (!current) throw notFoundError("Assessment question");
  const row = (await repository.deleteQuestion(current.id)).rows[0];
  return row;
}

export async function startAttempt(req: Request, user: AuthenticatedUser, eventId: string) {
  const { context, student } = await requireStudent(req, user);
  const normalized = requiredUuid(eventId, "Assessment id");
  const event = (await repository.getEventForOrganization(normalized, context.organization.id)).rows[0];
  if (!event) throw notFoundError("Assessment");
  if (event.status !== "SCHEDULED") {
    throw new AssessmentExecutionError("Assessment is not available to start.");
  }
  const now = Date.now();
  if (new Date(event.scheduled_start).valueOf() > now || new Date(event.scheduled_end).valueOf() < now) {
    throw new AssessmentExecutionError("Assessment is outside its scheduled window.");
  }
  const enrollment = await repository.studentActiveEnrollment(student.id, context.organization.id, event.class_id);
  if (enrollment.rows.length === 0) {
    throw new AuthorizationError("ROLE_REQUIRED", "You are not enrolled in this assessment's class.");
  }

  const open = (await repository.getOpenAttempt(context.organization.id, event.id, student.id)).rows[0];
  if (open) {
    const questions = (await repository.listQuestionsForEvent(context.organization.id, event.id)).rows.map(
      safeQuestionDto
    );
    return { attempt: attemptDto(open), questions, resumed: true };
  }

  try {
    const attempt = (await repository.createAttempt(context.organization.id, event.id, student.id)).rows[0];
    const questions = (await repository.listQuestionsForEvent(context.organization.id, event.id)).rows.map(
      safeQuestionDto
    );
    return { attempt: attemptDto(attempt), questions, resumed: false };
  } catch (error) {
    // A concurrent start may win the open-attempt race; resume instead.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "23505") {
      const openRetry = (await repository.getOpenAttempt(context.organization.id, event.id, student.id)).rows[0];
      if (openRetry) {
        const questions = (await repository.listQuestionsForEvent(context.organization.id, event.id)).rows.map(
          safeQuestionDto
        );
        return { attempt: attemptDto(openRetry), questions, resumed: true };
      }
    }
    throw error;
  }
}

async function loadOwnAttempt(attemptId: string, organizationId: string, studentId: string) {
  const normalized = requiredUuid(attemptId, "Attempt id");
  const attempt = (await repository.getAttemptForStudent(normalized, organizationId, studentId)).rows[0];
  if (!attempt) throw notFoundError("Attempt");
  return attempt;
}

export async function saveAnswers(req: Request, user: AuthenticatedUser, attemptId: string, body: unknown) {
  const { context, student } = await requireStudent(req, user);
  const input = validateSaveAnswers(body);

  const attempt = await loadOwnAttempt(attemptId, context.organization.id, student.id);
  if (attempt.status !== "IN_PROGRESS") {
    throw new AssessmentExecutionError("Attempt is already submitted.");
  }

  const questions = (await repository.listQuestionsForEvent(context.organization.id, attempt.assessment_event_id)).rows;
  const byId = new Map<string, { options: { key: string }[] }>(
    questions.map((q: AssessmentQuestionRow) => [q.id, q as unknown as { options: { key: string }[] }])
  );

  const saved: unknown[] = [];
  for (const item of input.answers) {
    const keys = (byId.get(item.questionId)?.options ?? []).map((o) => o.key);
    if (keys.length === 0) {
      throw new AssessmentExecutionError("Question does not belong to this assessment.");
    }
    if (!keys.includes(item.selectedOption)) {
      throw new AssessmentExecutionError("Selected option is invalid for this question.");
    }
    const row = (await repository.applyAnswer(attempt.id, item.questionId, item.selectedOption)).rows[0];
    saved.push({ question_id: row.question_id, selected_option: row.selected_option, answered_at: row.answered_at });
  }

  return saved;
}

// Submitted-result projection. Exposes only result-level fields; never
// correct_option_key, options, or explanations.
const resultDto = (row: {
  id: string;
  assessment_event_id: string;
  attempt_id: string;
  student_id: string;
  score: number | string;
  max_score: number | string;
  percentage: number | string;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  submitted_at: string;
  student_full_name?: string;
}) => ({
  id: row.id,
  assessment_event_id: row.assessment_event_id,
  attempt_id: row.attempt_id,
  student: { id: row.student_id, full_name: row.student_full_name ?? null },
  score: Number(row.score),
  max_score: Number(row.max_score),
  percentage: Number(row.percentage),
  correct_count: row.correct_count,
  incorrect_count: row.incorrect_count,
  unanswered_count: row.unanswered_count,
  submitted_at: row.submitted_at,
});

// US-091/US-092/US-093: submit an attempt, evaluate deterministically, and
// persist exactly one immutable assessment_results row — atomically.
// Unanswered questions are allowed; zero-question / zero-max-score
// assessments are rejected without a synthetic result.
export async function submitAttempt(req: Request, user: AuthenticatedUser, attemptId: string) {
  const { context, student } = await requireStudent(req, user);

  const attempt = await loadOwnAttempt(attemptId, context.organization.id, student.id);
  if (attempt.status !== "IN_PROGRESS") {
    throw new AssessmentExecutionError("Attempt is already submitted.");
  }

  const event = (await repository.getEventForOrganization(attempt.assessment_event_id, context.organization.id))
    .rows[0];
  if (!event) throw notFoundError("Assessment");
  if (event.status !== "SCHEDULED") {
    throw new AssessmentExecutionError("Assessment is not available for submission.");
  }
  const now = Date.now();
  if (new Date(event.scheduled_start).valueOf() > now || new Date(event.scheduled_end).valueOf() < now) {
    throw new AssessmentExecutionError("Assessment is outside its scheduled window.");
  }
  const enrollment = await repository.studentActiveEnrollment(student.id, context.organization.id, event.class_id);
  if (enrollment.rows.length === 0) {
    throw new AuthorizationError("ROLE_REQUIRED", "You are not enrolled in this assessment's class.");
  }

  const questions = (await repository.listQuestionsForEvent(context.organization.id, attempt.assessment_event_id))
    .rows as AssessmentQuestionRow[];
  if (questions.length === 0) {
    throw new AssessmentExecutionError("Assessment has no questions and cannot be submitted.");
  }
  const maxScore = questions.reduce((total, q) => total + Number(q.marks), 0);
  if (!(maxScore > 0)) {
    throw new AssessmentExecutionError("Assessment has no marks assigned and cannot be submitted.");
  }

  const answerRows = (await repository.getAnswersForAttempt(attempt.id)).rows as {
    question_id: string;
    selected_option: string;
  }[];
  const answerMap = new Map<string, string | undefined>(
    answerRows.map((a) => [a.question_id, a.selected_option])
  );

  const evaluation = evaluateFormalAttempt(
    questions.map((q) => ({
      id: q.id,
      marks: Number(q.marks),
      correctOptionKey: q.correct_option_key,
      optionKeys: (q.options as { key: string }[]).map((o) => o.key),
    })),
    answerMap
  );

  const stored = await repository.submitAttemptWithResult({
    attemptId: attempt.id,
    organizationId: context.organization.id,
    studentId: student.id,
    assessmentEventId: event.id,
    result: evaluation,
  });
  if (!stored) {
    throw new AssessmentExecutionError("Attempt is already submitted.");
  }

  return {
    attempt: {
      id: stored.attempt.id,
      assessment_event_id: stored.attempt.assessment_event_id,
      status: stored.attempt.status,
      started_at: stored.attempt.started_at,
      submitted_at: stored.attempt.submitted_at,
    },
    result: resultDto({ ...stored.result, student_full_name: student.full_name }),
  };
}

async function requireReviewEvent(req: Request, user: AuthenticatedUser, assessmentId: string) {
  const context = await resolveOrganizationContext(req, user);
  if (!AUTHORING_ROLES.has(context.role.name)) {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to review assessment results.");
  }
  const normalized = requiredUuid(assessmentId, "Assessment id");
  const event = (await repository.getEventForOrganization(normalized, context.organization.id)).rows[0];
  if (!event) throw notFoundError("Assessment");
  return { context, event };
}

// US-094: teacher review — submitted results for one assessment, tenant-scoped.
export async function listEventResults(req: Request, user: AuthenticatedUser, assessmentId: string) {
  const { context, event } = await requireReviewEvent(req, user, assessmentId);
  const rows = (await repository.listResultsForEvent(context.organization.id, event.id)).rows;
  return rows.map(resultDto);
}

// US-094: teacher review detail — one result bound to its event + org.
export async function getEventResult(
  req: Request,
  user: AuthenticatedUser,
  assessmentId: string,
  attemptId: string
) {
  const { context, event } = await requireReviewEvent(req, user, assessmentId);
  const normalized = requiredUuid(attemptId, "Attempt id");
  const row = (await repository.getResultForEventAttempt(context.organization.id, event.id, normalized)).rows[0];
  if (!row) throw notFoundError("Result");
  return resultDto(row);
}
