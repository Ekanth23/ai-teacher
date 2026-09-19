import type {
  AttemptResultDetail,
  PracticeDetailResponse,
  PracticeListResponse,
  ResultsHistoryResponse,
  SaveAnswersRequest,
  SaveAnswersResponse,
  StartAttemptResponse,
  SubmitAttemptResponse,
} from "../../types/practice";
import { request } from "./client";

/**
 * GET /api/student/practices
 *
 * Published practices the authenticated student can attempt. Identity,
 * organization, enrollment, and visibility are derived by the backend from the
 * bearer token — the client sends no student_id or organization_id.
 */
export function getPractices() {
  return request<PracticeListResponse>("/api/student/practices");
}

/**
 * GET /api/student/practices/:practiceId
 *
 * Practice detail with a safe, preview-only question set. The backend omits
 * answers (`correct_option_key`, `explanation`) so a student can never see the
 * answer before submitting.
 */
export function getPractice(practiceId: string) {
  return request<PracticeDetailResponse>(
    `/api/student/practices/${encodeURIComponent(practiceId)}`,
  );
}

/**
 * POST /api/student/practices/:practiceId/attempts
 *
 * Starts a new attempt for a published practice. Returns the attempt id the
 * practice player (a later UI slice) will use to answer and submit.
 */
export function startPracticeAttempt(practiceId: string) {
  return request<StartAttemptResponse>(
    `/api/student/practices/${encodeURIComponent(practiceId)}/attempts`,
    { method: "POST" },
  );
}

/**
 * PUT /api/student/attempts/:attemptId/answers
 *
 * Persists the student's selected options for an in-progress attempt. Sends
 * only the selected option per question — never answers, scores, or
 * evaluation fields. Returns the saved answers echoed by the backend.
 */
export function saveAttemptAnswers(
  attemptId: string,
  body: SaveAnswersRequest,
) {
  return request<SaveAnswersResponse>(
    `/api/student/attempts/${encodeURIComponent(attemptId)}/answers`,
    { method: "PUT", body },
  );
}

/**
 * POST /api/student/attempts/:attemptId/submit
 *
 * Finalizes the attempt. Evaluation happens server-side; the response is used
 * only as a lifecycle transition point (submitted vs. not). Scores and results
 * render in a later UI slice.
 */
export function submitAttempt(attemptId: string) {
  return request<SubmitAttemptResponse>(
    `/api/student/attempts/${encodeURIComponent(attemptId)}/submit`,
    { method: "POST" },
  );
}

/**
 * GET /api/student/attempts/:attemptId/result
 *
 * Reads the backend's authoritative submitted-result projection: summary
 * fields plus per-question review. Only succeeds for SUBMITTED attempts owned
 * by the authenticated student; anything else surfaces as an error (404).
 * Values are rendered exactly as returned — never recalculated.
 */
export function getAttemptResult(attemptId: string) {
  return request<AttemptResultDetail>(
    `/api/student/attempts/${encodeURIComponent(attemptId)}/result`,
  );
}

/**
 * GET /api/student/results
 *
 * Reads the student's submitted-result history (newest-first). Empty history
 * is `{ results: [], total: 0 }`.
 */
export function getResults() {
  return request<ResultsHistoryResponse>("/api/student/results");
}