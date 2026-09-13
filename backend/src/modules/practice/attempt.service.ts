import type { Request } from "express";
import type { AuthenticatedUser } from "../../auth/tokens.js";
import { AuthorizationError, resolveOrganizationContext, isValidUuid } from "../../auth/organization.js";
import { getStudentByUser } from "../student/repository.js";
import { PracticeValidationError, requiredUuid } from "../practice/validation.js";
import * as practiceRepository from "../practice/repository.js";
import * as attemptRepository from "./attempt.repository.js";
import { evaluateAttempt } from "./evaluation.js";
import type { SaveAnswersInput } from "./attempt.types.js";

const notFound = (name: string) => {
  const error = new PracticeValidationError(`${name} was not found.`);
  error.code = "NOT_FOUND";
  return error;
};

// Student identity is always derived from the authenticated user -> students_v2
// relationship. A client-supplied student_id is never trusted.
async function requireStudent(req: Request, user: AuthenticatedUser) {
  const context = await resolveOrganizationContext(req, user);
  if (context.role.name !== "STUDENT") {
    throw new AuthorizationError("ROLE_REQUIRED", "Student access required.");
  }
  const student = (await getStudentByUser(context.organization.id, user.id)).rows[0];
  if (!student) {
    throw new AuthorizationError("ROLE_REQUIRED", "Your student profile was not found in this organization.");
  }
  return { context, student };
}

// Student-facing projections. correct_option_key and explanation are omitted so a
// student can never see the answer or the evaluation before submission.
const safeQuestionDto = (row: {
  id: string;
  sequence_number: number;
  question_text: string;
  options: { key: string; text: string }[];
  marks: number | string;
}) => ({
  id: row.id,
  sequence_number: row.sequence_number,
  question_text: row.question_text,
  options: row.options,
  marks: Number(row.marks),
});

const attemptDto = (row: { id: string; practice_id: string; status: string; started_at: string }) => ({
  id: row.id,
  practice_id: row.practice_id,
  status: row.status,
  started_at: row.started_at,
});

const resultDto = (row: {
  id: string;
  practice_id: string;
  status: string;
  started_at: string;
  submitted_at: string;
  score: number | string;
  max_score: number | string;
  percentage: number | string;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
}) => ({
  id: row.id,
  practice_id: row.practice_id,
  status: row.status,
  started_at: row.started_at,
  submitted_at: row.submitted_at,
  score: Number(row.score),
  max_score: Number(row.max_score),
  percentage: Number(row.percentage),
  correct_count: row.correct_count,
  incorrect_count: row.incorrect_count,
  unanswered_count: row.unanswered_count,
});

function normalizeAnswersInput(body: unknown): SaveAnswersInput {
  const input = (body ?? {}) as { answers?: unknown };
  if (!Array.isArray(input.answers)) {
    throw new PracticeValidationError("answers must be an array.");
  }
  const answers = input.answers.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new PracticeValidationError(`answers[${index}] is invalid.`);
    }
    const raw = item as Record<string, unknown>;
    const questionId = typeof raw.question_id === "string" ? raw.question_id.trim() : "";
    const selectedOption = typeof raw.selected_option === "string" ? raw.selected_option.trim() : "";
    if (!questionId || !isValidUuid(questionId)) {
      throw new PracticeValidationError(`answers[${index}].question_id is invalid.`);
    }
    if (!selectedOption) {
      throw new PracticeValidationError(`answers[${index}].selected_option is required.`);
    }
    return { questionId, selectedOption };
  });
  return { answers };
}

async function loadOwnAttempt(attemptId: string, organizationId: string, studentId: string) {
  const normalized = requiredUuid(attemptId, "Attempt id");
  const attempt = (await attemptRepository.getAttemptForStudent(normalized, organizationId, studentId)).rows[0];
  if (!attempt) throw notFound("Attempt");
  return attempt;
}

export async function startAttempt(req: Request, user: AuthenticatedUser, practiceId: string) {
  const { context, student } = await requireStudent(req, user);
  const normalized = requiredUuid(practiceId, "Practice id");

  const practice = (await practiceRepository.getPractice(normalized)).rows[0];
  if (!practice) throw notFound("Practice");
  if (practice.organization_id !== context.organization.id) {
    throw new AuthorizationError("ORGANIZATION_ACCESS_DENIED", "Practice belongs to another organization.");
  }
  if (practice.status !== "PUBLISHED") {
    throw new PracticeValidationError("Practice is not available to start.");
  }

  const topic = (await practiceRepository.getTopicContext(practice.curriculum_node_id)).rows[0];
  if (!topic) throw notFound("Curriculum node");

  const enrollment = await attemptRepository.studentActiveEnrollment(student.id, context.organization.id, topic.class_id);
  if (enrollment.rows.length === 0) {
    throw new AuthorizationError("ROLE_REQUIRED", "You are not enrolled in this topic's class.");
  }

  const attempt = (await attemptRepository.createAttempt(context.organization.id, practice.id, student.id)).rows[0];
  const questions = (await practiceRepository.listQuestionsForPractice(practice.id)).rows.map(safeQuestionDto);

  return { attempt: attemptDto(attempt), questions };
}

export async function saveAnswers(req: Request, user: AuthenticatedUser, attemptId: string, body: unknown) {
  const { context, student } = await requireStudent(req, user);
  const input = normalizeAnswersInput(body);

  const attempt = await loadOwnAttempt(attemptId, context.organization.id, student.id);
  if (attempt.status !== "IN_PROGRESS") {
    throw new PracticeValidationError("Attempt is already submitted.");
  }

  const questions = (await practiceRepository.listQuestionsForPractice(attempt.practice_id)).rows;
  const byId = new Map<string, { options: { key: string }[] }>(
    questions.map((q: { id: string; options: { key: string }[] }) => [q.id, q])
  );

  const saved: unknown[] = [];
  for (const item of input.answers) {
    const keys = (byId.get(item.questionId)?.options ?? []).map((o) => o.key);
    if (keys.length === 0) {
      throw new PracticeValidationError("Question does not belong to this practice.");
    }
    if (!keys.includes(item.selectedOption)) {
      throw new PracticeValidationError("Selected option is invalid for this question.");
    }
    const row = (await attemptRepository.applyAnswer(attempt.id, item.questionId, item.selectedOption)).rows[0];
    saved.push({ question_id: row.question_id, selected_option: row.selected_option, answered_at: row.answered_at });
  }

  return saved;
}

export async function submitAttempt(req: Request, user: AuthenticatedUser, attemptId: string) {
  const { context, student } = await requireStudent(req, user);

  const attempt = await loadOwnAttempt(attemptId, context.organization.id, student.id);
  if (attempt.status !== "IN_PROGRESS") {
    throw new PracticeValidationError("Attempt is already submitted.");
  }

  const questions = (await practiceRepository.listQuestionsForPractice(attempt.practice_id)).rows;
  const answerRows = (await attemptRepository.getAnswersForAttempt(attempt.id)).rows;
  const answerMap = new Map<string, string | undefined>(
    answerRows.map((a: { question_id: string; selected_option: string }) => [a.question_id, a.selected_option])
  );

  const result = evaluateAttempt(
    questions.map((q: { id: string; marks: number | string; correct_option_key: string }) => ({
      id: q.id,
      marks: Number(q.marks),
      correctOptionKey: q.correct_option_key,
    })),
    answerMap
  );

  const updated = await attemptRepository.submitAttempt(attempt.id, context.organization.id, student.id, result);
  if (updated.length === 0) {
    throw new PracticeValidationError("Attempt is already submitted.");
  }

  return resultDto(updated[0]);
}

// Read-only result projection (US-085). Includes safe practice/topic context.
const viewResultDto = (row: {
  id: string;
  practice_id: string;
  practice_title: string;
  practice_type: string;
  topic_title: string | null;
  status: string;
  started_at: string;
  submitted_at: string;
  score: number | string;
  max_score: number | string;
  percentage: number | string;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
}) => ({
  id: row.id,
  practice: {
    id: row.practice_id,
    title: row.practice_title,
    practice_type: row.practice_type,
    topic: row.topic_title ?? null,
  },
  status: row.status,
  started_at: row.started_at,
  submitted_at: row.submitted_at,
  score: Number(row.score),
  max_score: Number(row.max_score),
  percentage: Number(row.percentage),
  correct_count: row.correct_count,
  incorrect_count: row.incorrect_count,
  unanswered_count: row.unanswered_count,
});

// Display-only per-question correctness for a SUBMITTED attempt. Reuses the
// persisted summary as authoritative (this does not recalculate or mutate it).
function buildPerQuestionReview(
  questions: { id: string; question_text: string; options: { key: string; text: string }[]; correct_option_key: string; explanation: string | null; marks: number | string }[],
  answerMap: Map<string, string>
) {
  return questions.map((q) => {
    const marks = Number(q.marks);
    const selected = answerMap.get(q.id) ?? null;
    const correctOption = q.correct_option_key;
    const isCorrect = selected !== null && selected === correctOption;
    return {
      question_id: q.id,
      question_text: q.question_text,
      options: q.options,
      selected_option: selected,
      correct_option: correctOption,
      is_correct: isCorrect,
      marks,
      awarded_marks: isCorrect ? marks : 0,
      explanation: q.explanation ?? null,
    };
  });
}

export async function getResult(req: Request, user: AuthenticatedUser, attemptId: string) {
  const { context, student } = await requireStudent(req, user);
  const normalized = requiredUuid(attemptId, "Attempt id");

  const row = (await attemptRepository.getSubmittedAttemptForStudent(normalized, context.organization.id, student.id)).rows[0];
  if (!row) throw notFound("Result");

  const questions = (await practiceRepository.listQuestionsForPractice(row.practice_id)).rows;
  const answerRows = (await attemptRepository.getAnswersForAttempt(row.id)).rows;
  const answerMap = new Map<string, string>(
    answerRows.map((a: { question_id: string; selected_option: string }) => [a.question_id, a.selected_option])
  );

  return { ...viewResultDto(row), questions: buildPerQuestionReview(questions, answerMap) };
}

export async function listResults(req: Request, user: AuthenticatedUser) {
  const { context, student } = await requireStudent(req, user);
  const rows = (await attemptRepository.listSubmittedAttemptsForStudent(context.organization.id, student.id)).rows;
  return rows.map(viewResultDto);
}

// Student-facing practice summary (US-085 discovery). Safe projection only.
const practiceSummaryDto = (row: {
  id: string;
  title: string;
  description: string | null;
  practice_type: string;
  topic_id: string;
  topic_name: string;
}) => ({
  id: row.id,
  title: row.title,
  description: row.description ?? null,
  practice_type: row.practice_type,
  topic: { id: row.topic_id, name: row.topic_name },
});

export async function listStudentPractices(req: Request, user: AuthenticatedUser) {
  const { context, student } = await requireStudent(req, user);
  const rows = (await practiceRepository.listPublishedPracticesForStudent(context.organization.id, student.id)).rows;
  return rows.map(practiceSummaryDto);
}

export async function getStudentPractice(req: Request, user: AuthenticatedUser, practiceId: string) {
  const { context, student } = await requireStudent(req, user);
  const normalized = requiredUuid(practiceId, "Practice id");

  const row = (await practiceRepository.getPublishedPracticeForStudent(normalized, context.organization.id, student.id)).rows[0];
  if (!row) throw notFound("Practice");

  const questions = (await practiceRepository.listQuestionsForPractice(row.id)).rows.map(safeQuestionDto);

  return {
    ...practiceSummaryDto(row),
    question_count: questions.length,
    questions,
  };
}



