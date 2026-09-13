import pool from "../../db.js";
import type { EvaluationResult } from "./evaluation.js";

// Active enrollment check: the student must be enrolled in the practice's class.
export const studentActiveEnrollment = (studentId: string, organizationId: string, classId: string) =>
  pool.query(
    `SELECT 1
     FROM student_enrollments
     WHERE student_id = $1 AND organization_id = $2 AND class_id = $3 AND status = 'ACTIVE'
     LIMIT 1`,
    [studentId, organizationId, classId]
  );

export const createAttempt = (organizationId: string, practiceId: string, studentId: string) =>
  pool.query(
    `INSERT INTO practice_attempts (organization_id, practice_id, student_id, status)
     VALUES ($1, $2, $3, 'IN_PROGRESS')
     RETURNING *`,
    [organizationId, practiceId, studentId]
  );

// Owner + organization scoped lookup. Cross-student and cross-tenant access is
// impossible because the row is filtered by both student_id and organization_id.
export const getAttemptForStudent = (id: string, organizationId: string, studentId: string) =>
  pool.query(
    "SELECT * FROM practice_attempts WHERE id = $1 AND organization_id = $2 AND student_id = $3 LIMIT 1",
    [id, organizationId, studentId]
  );

// Upsert a single answer; uniqueness is enforced by the (attempt_id, question_id)
// unique index so a second answer for the same question updates rather than inserts.
export const applyAnswer = (attemptId: string, questionId: string, selectedOption: string) =>
  pool.query(
    `INSERT INTO practice_attempt_answers (attempt_id, question_id, selected_option)
     VALUES ($1, $2, $3)
     ON CONFLICT (attempt_id, question_id)
     DO UPDATE SET selected_option = EXCLUDED.selected_option, answered_at = now()
     RETURNING id, attempt_id, question_id, selected_option, answered_at`,
    [attemptId, questionId, selectedOption]
  );

export const getAnswersForAttempt = (attemptId: string) =>
  pool.query(
    "SELECT question_id, selected_option FROM practice_attempt_answers WHERE attempt_id = $1",
    [attemptId]
  );

// Atomic IN_PROGRESS -> SUBMITTED transition with the result summary persisted in
// the same transaction. The status guard prevents a second/concurrent submission.
export const submitAttempt = async (
  id: string,
  organizationId: string,
  studentId: string,
  result: EvaluationResult
) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `UPDATE practice_attempts
       SET status = 'SUBMITTED',
           submitted_at = now(),
           score = $4,
           max_score = $5,
           percentage = $6,
           correct_count = $7,
           incorrect_count = $8,
           unanswered_count = $9,
           updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND student_id = $3 AND status = 'IN_PROGRESS'
       RETURNING *`,
      [
        id,
        organizationId,
        studentId,
        result.score,
        result.maxScore,
        result.percentage,
        result.correctCount,
        result.incorrectCount,
        result.unansweredCount,
      ]
    );
    await client.query("COMMIT");
    return res.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Read-only: a submitted attempt scoped to the owner + organization. Enriched with
// practice title/type and topic title for the result view (safe projections only).
export const getSubmittedAttemptForStudent = (id: string, organizationId: string, studentId: string) =>
  pool.query(
    `SELECT a.id, a.practice_id, a.status, a.started_at, a.submitted_at,
            a.score, a.max_score, a.percentage, a.correct_count, a.incorrect_count, a.unanswered_count,
            p.title AS practice_title, p.practice_type,
            n.title AS topic_title
     FROM practice_attempts a
     JOIN practices p ON p.id = a.practice_id
     LEFT JOIN curriculum_nodes n ON n.id = p.curriculum_node_id
     WHERE a.id = $1 AND a.organization_id = $2 AND a.student_id = $3 AND a.status = 'SUBMITTED'
     LIMIT 1`,
    [id, organizationId, studentId]
  );

// Read-only history: the student's submitted attempts, newest-first.
export const listSubmittedAttemptsForStudent = (organizationId: string, studentId: string) =>
  pool.query(
    `SELECT a.id, a.practice_id, a.status, a.started_at, a.submitted_at,
            a.score, a.max_score, a.percentage, a.correct_count, a.incorrect_count, a.unanswered_count,
            p.title AS practice_title, p.practice_type,
            n.title AS topic_title
     FROM practice_attempts a
     JOIN practices p ON p.id = a.practice_id
     LEFT JOIN curriculum_nodes n ON n.id = p.curriculum_node_id
     WHERE a.organization_id = $1 AND a.student_id = $2 AND a.status = 'SUBMITTED'
     ORDER BY a.submitted_at DESC`,
    [organizationId, studentId]
  );

