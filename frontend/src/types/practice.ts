/**
 * Practice discovery + detail + attempt + results types
 * (UI Epic 6 + UI Epic 7 + UI Epic 8).
 *
 * Shapes mirror the student practice API exactly. Pre-submission projections
 * never include answers or scores. Result types below are display-only
 * mirrors of the backend's authoritative Slice C projections — the frontend
 * must never calculate score, correctness, or marks from them.
 */

export type PracticeType = "PRACTICE" | "QUIZ" | "SELF_ASSESSMENT";

export interface PracticeTopic {
  id: string;
  name: string;
}

/** Practice discovery list item (GET /api/student/practices). */
export interface PracticeSummary {
  id: string;
  title: string;
  description: string | null;
  practice_type: PracticeType;
  topic: PracticeTopic;
}

export interface PracticeOption {
  key: string;
  text: string;
}

/** Preview-safe multiple-choice question. Answers are never included. */
export interface PracticeQuestion {
  id: string;
  sequence_number: number;
  question_text: string;
  options: PracticeOption[];
  marks: number;
}

/** GET /api/student/practices/:practiceId */
export interface PracticeDetail extends PracticeSummary {
  question_count: number;
  questions: PracticeQuestion[];
}

export interface PracticeListResponse {
  practices: PracticeSummary[];
  total: number;
}

export interface PracticeDetailResponse {
  practice: PracticeDetail;
}

export type PracticeAttemptStatus = "IN_PROGRESS" | "SUBMITTED";

/** POST /api/student/practices/:practiceId/attempts (201) */
export interface PracticeAttempt {
  id: string;
  practice_id: string;
  status: PracticeAttemptStatus;
  started_at: string;
}

export interface StartAttemptResponse {
  attempt: PracticeAttempt;
  questions: PracticeQuestion[];
}

/** One selected answer sent to the backend (UI Epic 7). */
export interface SaveAnswerItem {
  question_id: string;
  selected_option: string;
}

/** PUT /api/student/attempts/:attemptId/answers request body. */
export interface SaveAnswersRequest {
  answers: SaveAnswerItem[];
}

/** A single answer echoed back by the backend after saving. */
export interface SavedAnswer {
  question_id: string;
  selected_option: string;
  answered_at: string;
}

/** PUT /api/student/attempts/:attemptId/answers response body. */
export interface SaveAnswersResponse {
  answers: SavedAnswer[];
}

/**
 * POST /api/student/attempts/:attemptId/submit response (transition point).
 *
 * Only the lifecycle fields are modeled. Score/correctness/result fields are
 * intentionally omitted — the backend remains authoritative and results render
 * in UI Epic 8. Extra runtime fields are ignored.
 */
export interface SubmitAttemptResponse {
  id: string;
  status: PracticeAttemptStatus;
  submitted_at: string;
}

/**
 * Practice context embedded in a submitted result (UI Epic 8, Slice C).
 * `topic` is the backend-provided topic title (null when unavailable).
 */
export interface ResultPractice {
  id: string;
  title: string;
  practice_type: PracticeType;
  topic: string | null;
}

/**
 * Authoritative result summary (UI Epic 8, Slice C).
 * Display-only: every numeric field is rendered exactly as returned.
 */
export interface AttemptResultSummary {
  id: string;
  practice: ResultPractice;
  status: PracticeAttemptStatus;
  started_at: string;
  submitted_at: string;
  score: number;
  max_score: number;
  percentage: number;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
}

/**
 * Backend-provided per-question review for a SUBMITTED attempt.
 * Display-only: correctness and awarded marks are never recalculated.
 */
export interface ResultQuestionReview {
  question_id: string;
  question_text: string;
  options: PracticeOption[];
  selected_option: string | null;
  correct_option: string;
  is_correct: boolean;
  marks: number;
  awarded_marks: number;
  explanation: string | null;
}

/** GET /api/student/attempts/:attemptId/result */
export interface AttemptResultDetail extends AttemptResultSummary {
  questions: ResultQuestionReview[];
}

/** GET /api/student/results (submitted attempts only, newest-first). */
export interface ResultsHistoryResponse {
  results: AttemptResultSummary[];
  total: number;
}