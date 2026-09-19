import type { Request } from "express";
import type { AuthenticatedUser } from "../../auth/tokens.js";
import { AuthorizationError, isValidUuid, resolveOrganizationContext } from "../../auth/organization.js";
import { getStudentByUser } from "../student/repository.js";
import { teacherAssignedToClass } from "../practice/repository.js";
import { listSubmittedAttemptsForStudent } from "../practice/attempt.repository.js";
import * as repository from "./repository.js";
import type {
  AssessmentPerformance,
  AvailablePractice,
  ChapterProgress,
  ConceptAnswerRow,
  FormalPerformanceResult,
  HomeworkAssignmentRow,
  HomeworkPerformance,
  HomeworkState,
  LearningProfile,
  PracticePerformanceResult,
  RepeatedMistake,
  RepeatedMistakesResponse,
  StudentProgress,
  StrongTopic,
  StrongTopicsResponse,
  SubjectProgress,
  TopicAnswerRow,
  TopicProgress,
  UnfinishedLearningResponse,
  UnfinishedTopic,
  UnfinishedTopicStatus,
  WeakTopic,
  WeakTopicsResponse,
} from "./types.js";

export class ProgressError extends Error {
  code = "VALIDATION_ERROR";
}

const notFound = (name: string) => {
  const error = new ProgressError(`${name} was not found.`);
  error.code = "NOT_FOUND";
  return error;
};

const STAFF_ROLES = new Set(["SCHOOL_ADMIN", "COACHING_ADMIN", "TEACHER"]);

// Repository percentage convention (see practice/evaluation.ts): round2.
function round2(value: number): number {
  return Number(value.toFixed(2));
}

// Pure derivation: completed published practices / available published
// practices x 100 per level. Score/percentage/counts never enter the
// formula. Multiple submissions collapse via the completed-practice set.
// Levels are enumerated from the curriculum (plus any level carrying
// available practices); zero available yields percentage null
// ("no progress data", never 0%).
export function buildProgress(
  available: AvailablePractice[],
  completedPracticeIds: ReadonlySet<string>,
  subjects: { id: string; name: string; code: string | null }[],
  chapters: { id: string; title: string; subject_id: string | null }[],
  topics: { id: string; title: string; chapter_id: string | null; subject_id: string | null }[]
): StudentProgress {
  type Acc = { completed: Set<string>; available: Set<string> };
  const topicMap = new Map<string, { title: string; chapter_id: string | null } & Acc>();
  const chapterMap = new Map<string, { title: string; subject_id: string | null } & Acc>();
  const subjectMap = new Map<string, { name: string; code: string | null } & Acc>();

  for (const t of topics) {
    topicMap.set(t.id, { title: t.title, chapter_id: t.chapter_id, completed: new Set(), available: new Set() });
  }
  for (const c of chapters) {
    if (!chapterMap.has(c.id)) chapterMap.set(c.id, { title: c.title, subject_id: c.subject_id, completed: new Set(), available: new Set() });
  }
  for (const s of subjects) {
    if (!subjectMap.has(s.id)) subjectMap.set(s.id, { name: s.name, code: s.code, completed: new Set(), available: new Set() });
  }

  const ensureTopic = (id: string, title: string, chapterId: string | null) => {
    let t = topicMap.get(id);
    if (!t) {
      t = { title, chapter_id: chapterId, completed: new Set(), available: new Set() };
      topicMap.set(id, t);
    }
    return t;
  };

  for (const row of available) {
    const t = ensureTopic(row.topic_id, row.topic_title, row.chapter_id);
    t.available.add(row.practice_id);
    if (completedPracticeIds.has(row.practice_id)) t.completed.add(row.practice_id);

    if (row.chapter_id) {
      let c = chapterMap.get(row.chapter_id);
      if (!c) {
        c = { title: row.chapter_title as string, subject_id: row.subject_id, completed: new Set(), available: new Set() };
        chapterMap.set(row.chapter_id, c);
      }
      c.available.add(row.practice_id);
      if (completedPracticeIds.has(row.practice_id)) c.completed.add(row.practice_id);
    }

    if (row.subject_id) {
      let s = subjectMap.get(row.subject_id);
      if (!s) {
        s = { name: row.subject_name as string, code: row.subject_code, completed: new Set(), available: new Set() };
        subjectMap.set(row.subject_id, s);
      }
      s.available.add(row.practice_id);
      if (completedPracticeIds.has(row.practice_id)) s.completed.add(row.practice_id);
    }
  }

  const byTitle = (a: { title?: string; name?: string }, b: { title?: string; name?: string }) =>
    (a.title ?? a.name ?? "").localeCompare(b.title ?? b.name ?? "");

  const toTopic = ([id, acc]: [string, { title: string; chapter_id: string | null } & Acc]): TopicProgress => ({
    id,
    title: acc.title,
    chapter_id: acc.chapter_id,
    completed: acc.completed.size,
    available: acc.available.size,
    percentage: acc.available.size === 0 ? null : round2((100 * acc.completed.size) / acc.available.size),
  });

  const toChapter = ([id, acc]: [string, { title: string; subject_id: string | null } & Acc]): ChapterProgress => ({
    id,
    title: acc.title,
    subject_id: acc.subject_id,
    completed: acc.completed.size,
    available: acc.available.size,
    percentage: acc.available.size === 0 ? null : round2((100 * acc.completed.size) / acc.available.size),
  });

  const toSubject = ([id, acc]: [string, { name: string; code: string | null } & Acc]): SubjectProgress => ({
    id,
    name: acc.name,
    code: acc.code,
    completed: acc.completed.size,
    available: acc.available.size,
    percentage: acc.available.size === 0 ? null : round2((100 * acc.completed.size) / acc.available.size),
  });

  return {
    subjects: [...subjectMap.entries()].map(toSubject).sort(byTitle),
    chapters: [...chapterMap.entries()].map(toChapter).sort(byTitle),
    topics: [...topicMap.entries()].map(toTopic).sort(byTitle),
  };
}

async function progressForStudent(organizationId: string, studentId: string): Promise<StudentProgress> {
  const [availableRes, completedRes, subjectRes, chapterRes, topicRes] = await Promise.all([
    repository.listAvailablePractices(organizationId),
    repository.listCompletedPracticeIds(organizationId, studentId),
    repository.listSubjects(organizationId),
    repository.listChapters(organizationId),
    repository.listTopics(organizationId),
  ]);
  const available = availableRes.rows as AvailablePractice[];
  const completedRows = completedRes.rows as { practice_id: string }[];
  // Numerator is intersected with the available set inside buildProgress:
  // only completed practices that are still PUBLISHED count.
  return buildProgress(
    available,
    new Set(completedRows.map((r) => r.practice_id)),
    subjectRes.rows,
    chapterRes.rows,
    topicRes.rows
  );
}

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

export async function getOwnProgress(req: Request, user: AuthenticatedUser): Promise<StudentProgress> {
  const { context, student } = await requireStudent(req, user);
  return progressForStudent(context.organization.id, student.id);
}

export async function getStudentProgress(
  req: Request,
  user: AuthenticatedUser,
  organizationId: string,
  studentId: string
): Promise<StudentProgress & { student: { id: string; full_name: string } }> {
  const { context, student } = await requireStaffStudent(req, user, organizationId, studentId);
  const progress = await progressForStudent(context.organization.id, student.id);
  return { student: { id: student.id, full_name: student.full_name }, ...progress };
}

async function requireStaffStudent(
  req: Request,
  user: AuthenticatedUser,
  organizationId: string,
  studentId: string
) {
  if (!organizationId || !isValidUuid(organizationId)) throw new ProgressError("Organization id is invalid.");
  if (!studentId || !isValidUuid(studentId)) throw new ProgressError("Student id is invalid.");
  const context = await resolveOrganizationContext(req, user, organizationId.trim());
  if (!STAFF_ROLES.has(context.role.name)) {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to view student progress.");
  }
  const student = (await repository.getStudentInOrganization(studentId.trim(), context.organization.id)).rows[0];
  if (!student) throw notFound("Student");

  if (context.role.name === "TEACHER") {
    // Teacher scope = classes the teacher is assigned to intersected with
    // the student's active enrollments (existing class-assignment pattern).
    const classIds = ((await repository.listActiveEnrollmentClassIds(context.organization.id, student.id)).rows as {
      class_id: string;
    }[]).map((r) => r.class_id);
    let authorized = false;
    for (const classId of classIds) {
      const assigned = await teacherAssignedToClass(classId, context.organization.id, user.id);
      if (assigned.rows.length > 0) {
        authorized = true;
        break;
      }
    }
    if (!authorized) {
      throw new AuthorizationError("ROLE_REQUIRED", "You are not authorized to view this student's progress.");
    }
  }

  return { context, student };
}

// US-100: four-state homework classification (PO Decision #7). Pure and
// deterministic: completion + timeliness only, never a numeric score.
// submitted_at == due_at is ON_TIME; NULL due_at is never OVERDUE;
// "passed" is strictly now > due_at (equality is still PENDING).
export function classifyHomework(rows: HomeworkAssignmentRow[], now: number): HomeworkPerformance {
  let onTime = 0;
  let late = 0;
  let pending = 0;
  let overdue = 0;

  const stateOf = (row: HomeworkAssignmentRow): HomeworkState => {
    if (row.submitted_at) {
      if (!row.due_at) return "ON_TIME";
      return new Date(row.submitted_at).valueOf() <= new Date(row.due_at).valueOf() ? "ON_TIME" : "LATE";
    }
    if (!row.due_at) return "PENDING";
    return now > new Date(row.due_at).valueOf() ? "OVERDUE" : "PENDING";
  };

  for (const row of rows) {
    switch (stateOf(row)) {
      case "ON_TIME": onTime += 1; break;
      case "LATE": late += 1; break;
      case "PENDING": pending += 1; break;
      case "OVERDUE": overdue += 1; break;
    }
  }

  return { on_time: onTime, late, pending, overdue, total: rows.length };
}

async function homeworkForStudent(organizationId: string, studentId: string): Promise<HomeworkPerformance> {
  const rows = (await repository.listHomeworkRows(organizationId, studentId)).rows as HomeworkAssignmentRow[];
  return classifyHomework(rows, Date.now());
}

export async function getOwnHomework(req: Request, user: AuthenticatedUser): Promise<HomeworkPerformance> {
  const { context, student } = await requireStudent(req, user);
  return homeworkForStudent(context.organization.id, student.id);
}

export async function getStudentHomework(
  req: Request,
  user: AuthenticatedUser,
  organizationId: string,
  studentId: string
): Promise<HomeworkPerformance & { student: { id: string; full_name: string } }> {
  const { context, student } = await requireStaffStudent(req, user, organizationId, studentId);
  const homework = await homeworkForStudent(context.organization.id, student.id);
  return { student: { id: student.id, full_name: student.full_name }, ...homework };
}

// US-101: separate individual results, no aggregation. Practice rows come
// from the existing Epic 8 submitted-attempt read path (newest-first);
// formal rows come from Epic 9 assessment_results (newest-first). Values are
// projected unchanged — Epic 10 never recalculates or reinterprets them.
const practicePerformanceDto = (row: {
  id: string;
  practice_id: string;
  practice_title: string;
  practice_type: string;
  topic_title: string | null;
  score: number | string;
  max_score: number | string;
  percentage: number | string;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  submitted_at: string;
}): PracticePerformanceResult => ({
  attempt_id: row.id,
  practice_id: row.practice_id,
  practice_title: row.practice_title,
  practice_type: row.practice_type,
  topic: row.topic_title,
  score: Number(row.score),
  max_score: Number(row.max_score),
  percentage: Number(row.percentage),
  correct_count: row.correct_count,
  incorrect_count: row.incorrect_count,
  unanswered_count: row.unanswered_count,
  submitted_at: row.submitted_at,
});

const formalPerformanceDto = (row: {
  result_id: string;
  attempt_id: string;
  assessment_event_id: string;
  assessment_title: string;
  subject_id: string | null;
  topics: string[];
  score: number | string;
  max_score: number | string;
  percentage: number | string;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  submitted_at: string;
}): FormalPerformanceResult => ({
  result_id: row.result_id,
  attempt_id: row.attempt_id,
  assessment_event_id: row.assessment_event_id,
  assessment_title: row.assessment_title,
  subject_id: row.subject_id,
  topics: row.topics ?? [],
  score: Number(row.score),
  max_score: Number(row.max_score),
  percentage: Number(row.percentage),
  correct_count: row.correct_count,
  incorrect_count: row.incorrect_count,
  unanswered_count: row.unanswered_count,
  submitted_at: row.submitted_at,
});

async function assessmentPerformanceForStudent(
  organizationId: string,
  studentId: string
): Promise<AssessmentPerformance> {
  const [practiceRows, formalRows] = await Promise.all([
    listSubmittedAttemptsForStudent(organizationId, studentId),
    repository.listFormalResultsForStudent(organizationId, studentId),
  ]);
  return {
    practice_results: practiceRows.rows.map(practicePerformanceDto),
    formal_assessment_results: formalRows.rows.map(formalPerformanceDto),
  };
}

export async function getOwnAssessmentPerformance(req: Request, user: AuthenticatedUser): Promise<AssessmentPerformance> {
  const { context, student } = await requireStudent(req, user);
  return assessmentPerformanceForStudent(context.organization.id, student.id);
}

export async function getStudentAssessmentPerformance(
  req: Request,
  user: AuthenticatedUser,
  organizationId: string,
  studentId: string
): Promise<AssessmentPerformance & { student: { id: string; full_name: string } }> {
  const { context, student } = await requireStaffStudent(req, user, organizationId, studentId);
  const performance = await assessmentPerformanceForStudent(context.organization.id, student.id);
  return { student: { id: student.id, full_name: student.full_name }, ...performance };
}

// US-102: weak-topic derivation (Decisions #13-16). Pure and deterministic.
// Per submitted attempt: correct answered / answered x 100 (exact Epic 8
// correctness: selected_option === correct_option_key; unanswered excluded).
// Topic performance = round2(mean of per-attempt percentages). Evidence =
// total answered responses across all submitted attempts (repeats count
// separately). WEAK iff performance < 60 AND evidence >= 10. An attempt with
// zero answered questions provides no performance evidence (Decision #14:
// "only answered questions are included") and is excluded from the mean
// rather than manufacturing a 0%.
export function buildWeakTopics(rows: TopicAnswerRow[]): WeakTopicsResponse {
  type AttemptAcc = { correct: number; answered: number };
  type TopicAcc = { title: string; chapter_id: string | null; attempts: Map<string, AttemptAcc> };
  const topics = new Map<string, TopicAcc>();

  for (const row of rows) {
    let t = topics.get(row.topic_id);
    if (!t) {
      t = { title: row.topic_title, chapter_id: row.chapter_id, attempts: new Map() };
      topics.set(row.topic_id, t);
    }
    let a = t.attempts.get(row.attempt_id);
    if (!a) {
      a = { correct: 0, answered: 0 };
      t.attempts.set(row.attempt_id, a);
    }
    a.answered += 1;
    if (row.selected_option === row.correct_option_key) a.correct += 1;
  }

  const weak: WeakTopic[] = [];
  for (const [id, t] of topics) {
    const attemptPercentages: number[] = [];
    let evidence = 0;
    for (const a of t.attempts.values()) {
      if (a.answered === 0) continue;
      attemptPercentages.push((100 * a.correct) / a.answered);
      evidence += a.answered;
    }
    if (attemptPercentages.length === 0) continue;
    const performance = round2(attemptPercentages.reduce((s, p) => s + p, 0) / attemptPercentages.length);
    if (performance < 60 && evidence >= 10) {
      weak.push({ id, title: t.title, chapter_id: t.chapter_id, performance, answered_responses: evidence });
    }
  }

  weak.sort((a, b) => a.title.localeCompare(b.title));
  return { weak_topics: weak };
}

async function weakTopicsForStudent(organizationId: string, studentId: string): Promise<WeakTopicsResponse> {
  const rows = (await repository.listTopicAnswerRows(organizationId, studentId)).rows as TopicAnswerRow[];
  return buildWeakTopics(rows);
}

export async function getOwnWeakTopics(req: Request, user: AuthenticatedUser): Promise<WeakTopicsResponse> {
  const { context, student } = await requireStudent(req, user);
  return weakTopicsForStudent(context.organization.id, student.id);
}

export async function getStudentWeakTopics(
  req: Request,
  user: AuthenticatedUser,
  organizationId: string,
  studentId: string
): Promise<WeakTopicsResponse & { student: { id: string; full_name: string } }> {
  const { context, student } = await requireStaffStudent(req, user, organizationId, studentId);
  const weak = await weakTopicsForStudent(context.organization.id, student.id);
  return { student: { id: student.id, full_name: student.full_name }, ...weak };
}

// US-103: strong-topic derivation (Decision #17). Pure and deterministic.
// Same per-attempt performance semantics as US-102 (exact Epic 8
// correctness, unanswered excluded, zero-answered attempts excluded from the
// mean, repeats count toward evidence), with the Strong rule applied:
// performance >= 90 AND answered_responses >= 10. Separate function so
// US-102 semantics stay byte-identical.
export function buildStrongTopics(rows: TopicAnswerRow[]): StrongTopicsResponse {
  type AttemptAcc = { correct: number; answered: number };
  type TopicAcc = { title: string; chapter_id: string | null; attempts: Map<string, AttemptAcc> };
  const topics = new Map<string, TopicAcc>();

  for (const row of rows) {
    let t = topics.get(row.topic_id);
    if (!t) {
      t = { title: row.topic_title, chapter_id: row.chapter_id, attempts: new Map() };
      topics.set(row.topic_id, t);
    }
    let a = t.attempts.get(row.attempt_id);
    if (!a) {
      a = { correct: 0, answered: 0 };
      t.attempts.set(row.attempt_id, a);
    }
    a.answered += 1;
    if (row.selected_option === row.correct_option_key) a.correct += 1;
  }

  const strong: StrongTopic[] = [];
  for (const [id, t] of topics) {
    const attemptPercentages: number[] = [];
    let evidence = 0;
    for (const a of t.attempts.values()) {
      if (a.answered === 0) continue;
      attemptPercentages.push((100 * a.correct) / a.answered);
      evidence += a.answered;
    }
    if (attemptPercentages.length === 0) continue;
    const performance = round2(attemptPercentages.reduce((s, p) => s + p, 0) / attemptPercentages.length);
    if (performance >= 90 && evidence >= 10) {
      strong.push({ id, title: t.title, chapter_id: t.chapter_id, performance, answered_responses: evidence });
    }
  }

  strong.sort((a, b) => a.title.localeCompare(b.title));
  return { strong_topics: strong };
}

async function strongTopicsForStudent(organizationId: string, studentId: string): Promise<StrongTopicsResponse> {
  const rows = (await repository.listTopicAnswerRows(organizationId, studentId)).rows as TopicAnswerRow[];
  return buildStrongTopics(rows);
}

export async function getOwnStrongTopics(req: Request, user: AuthenticatedUser): Promise<StrongTopicsResponse> {
  const { context, student } = await requireStudent(req, user);
  return strongTopicsForStudent(context.organization.id, student.id);
}

export async function getStudentStrongTopics(
  req: Request,
  user: AuthenticatedUser,
  organizationId: string,
  studentId: string
): Promise<StrongTopicsResponse & { student: { id: string; full_name: string } }> {
  const { context, student } = await requireStaffStudent(req, user, organizationId, studentId);
  const strong = await strongTopicsForStudent(context.organization.id, student.id);
  return { student: { id: student.id, full_name: student.full_name }, ...strong };
}

// US-104: unfinished-learning status mapping (Decision #18). Pure and
// deterministic over the existing Slice A topic coverage (PUBLISHED-only
// availability, DISTINCT SUBMITTED completion): COMPLETED iff
// completed === available, UNFINISHED iff completed < available, null when
// available === 0. No score, correctness, or performance input.
export function buildUnfinishedLearning(topics: TopicProgress[]): UnfinishedLearningResponse {
  const statusOf = (t: TopicProgress): UnfinishedTopicStatus | null => {
    if (t.available === 0) return null;
    return t.completed === t.available ? "COMPLETED" : "UNFINISHED";
  };
  return {
    topics: topics.map((t) => ({
      id: t.id,
      title: t.title,
      chapter_id: t.chapter_id,
      completed: t.completed,
      available: t.available,
      status: statusOf(t),
    })),
  };
}

async function unfinishedLearningForStudent(
  organizationId: string,
  studentId: string
): Promise<UnfinishedLearningResponse> {
  const progress = await progressForStudent(organizationId, studentId);
  return buildUnfinishedLearning(progress.topics);
}

export async function getOwnUnfinishedLearning(req: Request, user: AuthenticatedUser): Promise<UnfinishedLearningResponse> {
  const { context, student } = await requireStudent(req, user);
  return unfinishedLearningForStudent(context.organization.id, student.id);
}

export async function getStudentUnfinishedLearning(
  req: Request,
  user: AuthenticatedUser,
  organizationId: string,
  studentId: string
): Promise<UnfinishedLearningResponse & { student: { id: string; full_name: string } }> {
  const { context, student } = await requireStaffStudent(req, user, organizationId, studentId);
  const unfinished = await unfinishedLearningForStudent(context.organization.id, student.id);
  return { student: { id: student.id, full_name: student.full_name }, ...unfinished };
}

// US-105: repeated-mistake detection (Decisions #21-24). Pure and
// deterministic over incorrect-response rows already scoped to SUBMITTED
// attempts and primary-concept mappings. Groups by concept with
// scope-qualified identities: repeats of the same question across attempts
// count as separate responses but never as distinct questions, and PRACTICE
// vs FORMAL records never merge. Emits only concepts with >= 3 incorrect
// responses across >= 3 distinct questions spanning >= 2 attempts.
export function buildRepeatedMistakes(rows: ConceptAnswerRow[]): RepeatedMistakesResponse {
  type Acc = {
    name: string;
    code: string | null;
    responses: number;
    questions: Set<string>;
    attempts: Set<string>;
  };
  const concepts = new Map<string, Acc>();

  for (const row of rows) {
    let acc = concepts.get(row.concept_id);
    if (!acc) {
      acc = { name: row.concept_name, code: row.concept_code, responses: 0, questions: new Set(), attempts: new Set() };
      concepts.set(row.concept_id, acc);
    }
    acc.responses += 1;
    acc.questions.add(`${row.question_scope}:${row.question_id}`);
    acc.attempts.add(`${row.attempt_scope}:${row.attempt_id}`);
  }

  const mistakes: RepeatedMistake[] = [];
  for (const [id, acc] of concepts) {
    if (acc.responses >= 3 && acc.questions.size >= 3 && acc.attempts.size >= 2) {
      mistakes.push({
        concept: { id, name: acc.name, code: acc.code },
        incorrect_responses: acc.responses,
        distinct_questions: acc.questions.size,
        distinct_attempts: acc.attempts.size,
      });
    }
  }

  mistakes.sort((a, b) => a.concept.name.localeCompare(b.concept.name));
  return { repeated_mistakes: mistakes };
}

async function repeatedMistakesForStudent(
  organizationId: string,
  studentId: string
): Promise<RepeatedMistakesResponse> {
  const rows = (await repository.listConceptMistakeRows(organizationId, studentId)).rows as ConceptAnswerRow[];
  return buildRepeatedMistakes(rows);
}

export async function getOwnRepeatedMistakes(req: Request, user: AuthenticatedUser): Promise<RepeatedMistakesResponse> {
  const { context, student } = await requireStudent(req, user);
  return repeatedMistakesForStudent(context.organization.id, student.id);
}

export async function getStudentRepeatedMistakes(
  req: Request,
  user: AuthenticatedUser,
  organizationId: string,
  studentId: string
): Promise<RepeatedMistakesResponse & { student: { id: string; full_name: string } }> {
  const { context, student } = await requireStaffStudent(req, user, organizationId, studentId);
  const mistakes = await repeatedMistakesForStudent(context.organization.id, student.id);
  return { student: { id: student.id, full_name: student.full_name }, ...mistakes };
}

// US-106: student learning profile (Decision #8). Pure fan-in over the
// existing US-097-105 getters: no new queries, no new calculations, no
// reinterpretation. Each section preserves its source output exactly,
// including null/empty states.
async function learningProfileForStudent(organizationId: string, studentId: string): Promise<LearningProfile> {
  const [
    progress,
    homework,
    assessment,
    strong,
    weak,
    unfinished,
    mistakes,
  ] = await Promise.all([
    progressForStudent(organizationId, studentId),
    homeworkForStudent(organizationId, studentId),
    assessmentPerformanceForStudent(organizationId, studentId),
    strongTopicsForStudent(organizationId, studentId),
    weakTopicsForStudent(organizationId, studentId),
    unfinishedLearningForStudent(organizationId, studentId),
    repeatedMistakesForStudent(organizationId, studentId),
  ]);
  return {
    subject_progress: { subjects: progress.subjects },
    chapter_progress: { chapters: progress.chapters },
    topic_progress: { topics: progress.topics },
    homework_performance: homework,
    practice_performance: { practice_results: assessment.practice_results },
    formal_assessment_performance: { formal_assessment_results: assessment.formal_assessment_results },
    strong_topics: { strong_topics: strong.strong_topics },
    weak_topics: { weak_topics: weak.weak_topics },
    unfinished_learning: { topics: unfinished.topics },
    repeated_mistakes: { repeated_mistakes: mistakes.repeated_mistakes },
  };
}

export async function getOwnLearningProfile(req: Request, user: AuthenticatedUser): Promise<LearningProfile> {
  const { context, student } = await requireStudent(req, user);
  return learningProfileForStudent(context.organization.id, student.id);
}

export async function getStudentLearningProfile(
  req: Request,
  user: AuthenticatedUser,
  organizationId: string,
  studentId: string
): Promise<LearningProfile & { student: { id: string; full_name: string } }> {
  const { context, student } = await requireStaffStudent(req, user, organizationId, studentId);
  const profile = await learningProfileForStudent(context.organization.id, student.id);
  return { student: { id: student.id, full_name: student.full_name }, ...profile };
}

// Internal/test-seeded mapping path (no authoring routes in this slice).
// Validates scope, question existence in its domain, and CONCEPT kind
// before insert; DB constraints reject duplicates and second primaries.
export async function assignQuestionConcept(
  organizationId: string,
  scope: "PRACTICE" | "FORMAL",
  questionId: string,
  knowledgeItemId: string,
  isPrimary: boolean
) {
  if (scope !== "PRACTICE" && scope !== "FORMAL") {
    throw new ProgressError("Question scope must be PRACTICE or FORMAL.");
  }
  const exists =
    scope === "PRACTICE"
      ? (await repository.practiceQuestionExists(organizationId, questionId)).rows[0]
      : (await repository.formalQuestionExists(organizationId, questionId)).rows[0];
  if (!exists) throw notFound("Question");
  const item = (await repository.getKnowledgeItemKind(knowledgeItemId)).rows[0];
  if (!item) throw notFound("Knowledge item");
  if (item.kind !== "CONCEPT") {
    throw new ProgressError("Only knowledge items with kind CONCEPT may be linked to questions.");
  }
  return (await repository.insertQuestionConcept(scope, questionId, knowledgeItemId, isPrimary)).rows[0];
}
