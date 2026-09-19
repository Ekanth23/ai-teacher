import pool from "../../../db.js";
import type { FormalEvaluationResult } from "./evaluation.js";

// Formal assessment execution state. Assessment_events rows remain the formal
// assessment identity; these tables carry only execution state and are fully
// separate from Epic 8 practice_attempts / practice_attempt_answers.

export const getEventForOrganization = (eventId: string, organizationId: string) =>
  pool.query("SELECT * FROM assessment_events WHERE id = $1 AND organization_id = $2 LIMIT 1", [
    eventId,
    organizationId,
  ]);

export const listQuestionsForEvent = (organizationId: string, eventId: string) =>
  pool.query(
    `SELECT * FROM assessment_questions
     WHERE organization_id = $1 AND assessment_event_id = $2
     ORDER BY sequence_number ASC`,
    [organizationId, eventId]
  );

export const getQuestion = (organizationId: string, eventId: string, questionId: string) =>
  pool.query(
    `SELECT * FROM assessment_questions
     WHERE id = $1 AND organization_id = $2 AND assessment_event_id = $3
     LIMIT 1`,
    [questionId, organizationId, eventId]
  );

export const nextQuestionSequence = (eventId: string) =>
  pool.query(
    `SELECT COALESCE(MAX(sequence_number), -1) + 1 AS next_sequence
     FROM assessment_questions WHERE assessment_event_id = $1`,
    [eventId]
  );

export const findQuestionBySequence = (eventId: string, sequenceNumber: number, excludeId?: string) =>
  excludeId
    ? pool.query(
        "SELECT id FROM assessment_questions WHERE assessment_event_id = $1 AND sequence_number = $2 AND id <> $3 LIMIT 1",
        [eventId, sequenceNumber, excludeId]
      )
    : pool.query(
        "SELECT id FROM assessment_questions WHERE assessment_event_id = $1 AND sequence_number = $2 LIMIT 1",
        [eventId, sequenceNumber]
      );

export const createQuestion = (
  organizationId: string,
  eventId: string,
  input: {
    sequenceNumber: number;
    questionType: string;
    questionText: string;
    options: unknown;
    correctOptionKey: string;
    marks: number;
    explanation: string | null;
  }
) =>
  pool.query(
    `INSERT INTO assessment_questions
      (organization_id, assessment_event_id, sequence_number, question_type, question_text, options, correct_option_key, marks, explanation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      organizationId,
      eventId,
      input.sequenceNumber,
      input.questionType,
      input.questionText,
      JSON.stringify(input.options),
      input.correctOptionKey,
      input.marks,
      input.explanation,
    ]
  );

export const updateQuestion = (
  questionId: string,
  input: {
    questionText: string;
    questionType: string;
    options: unknown;
    correctOptionKey: string;
    marks: number;
    sequenceNumber: number;
    explanation: string | null;
  }
) =>
  pool.query(
    `UPDATE assessment_questions
     SET question_text = $2, question_type = $3, options = $4, correct_option_key = $5,
         marks = $6, sequence_number = $7, explanation = $8, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      questionId,
      input.questionText,
      input.questionType,
      JSON.stringify(input.options),
      input.correctOptionKey,
      input.marks,
      input.sequenceNumber,
      input.explanation,
    ]
  );

export const deleteQuestion = (questionId: string) =>
  pool.query("DELETE FROM assessment_questions WHERE id = $1 RETURNING *", [questionId]);

// Active enrollment check: the student must be enrolled in the event's class.
export const studentActiveEnrollment = (studentId: string, organizationId: string, classId: string) =>
  pool.query(
    `SELECT 1 FROM student_enrollments
     WHERE student_id = $1 AND organization_id = $2 AND class_id = $3 AND status = 'ACTIVE'
     LIMIT 1`,
    [studentId, organizationId, classId]
  );

export const getOpenAttempt = (organizationId: string, eventId: string, studentId: string) =>
  pool.query(
    `SELECT * FROM assessment_attempts
     WHERE organization_id = $1 AND assessment_event_id = $2 AND student_id = $3 AND status = 'IN_PROGRESS'
     LIMIT 1`,
    [organizationId, eventId, studentId]
  );

export const createAttempt = (organizationId: string, eventId: string, studentId: string) =>
  pool.query(
    `INSERT INTO assessment_attempts (organization_id, assessment_event_id, student_id, status)
     VALUES ($1, $2, $3, 'IN_PROGRESS')
     RETURNING *`,
    [organizationId, eventId, studentId]
  );

export const getAttemptForStudent = (id: string, organizationId: string, studentId: string) =>
  pool.query(
    "SELECT * FROM assessment_attempts WHERE id = $1 AND organization_id = $2 AND student_id = $3 LIMIT 1",
    [id, organizationId, studentId]
  );

// Upsert a single answer; uniqueness on (attempt_id, question_id) turns a
// second answer for the same question into an update.
export const applyAnswer = (attemptId: string, questionId: string, selectedOption: string) =>
  pool.query(
    `INSERT INTO assessment_answers (attempt_id, question_id, selected_option)
     VALUES ($1, $2, $3)
     ON CONFLICT (attempt_id, question_id)
     DO UPDATE SET selected_option = EXCLUDED.selected_option, answered_at = now()
     RETURNING id, attempt_id, question_id, selected_option, answered_at`,
    [attemptId, questionId, selectedOption]
  );

export const getAnswersForAttempt = (attemptId: string) =>
  pool.query("SELECT question_id, selected_option FROM assessment_answers WHERE attempt_id = $1", [attemptId]);

// Atomic IN_PROGRESS -> SUBMITTED transition with exactly one
// assessment_results row persisted in the same transaction (US-091/092/093).
// The guarded status UPDATE serializes concurrent submissions: only one
// transaction wins; the loser updates zero rows and gets null back.
// Never leaves a SUBMITTED attempt without a result or vice versa.
export const submitAttemptWithResult = async (input: {
  attemptId: string;
  organizationId: string;
  studentId: string;
  assessmentEventId: string;
  result: FormalEvaluationResult;
}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE assessment_attempts
       SET status = 'SUBMITTED', submitted_at = now(), updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND student_id = $3 AND status = 'IN_PROGRESS'
       RETURNING *`,
      [input.attemptId, input.organizationId, input.studentId]
    );
    if (updated.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const attempt = updated.rows[0];
    if (attempt.assessment_event_id !== input.assessmentEventId) {
      await client.query("ROLLBACK");
      throw new Error("Attempt does not belong to the expected assessment.");
    }
    const inserted = await client.query(
      `INSERT INTO assessment_results
        (organization_id, assessment_event_id, attempt_id, student_id,
         score, max_score, percentage, correct_count, incorrect_count, unanswered_count, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.organizationId,
        input.assessmentEventId,
        attempt.id,
        input.studentId,
        input.result.score,
        input.result.maxScore,
        input.result.percentage,
        input.result.correctCount,
        input.result.incorrectCount,
        input.result.unansweredCount,
        attempt.submitted_at,
      ]
    );
    await client.query("COMMIT");
    return { attempt, result: inserted.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Read-only: existing immutable result for an attempt (org + student scoped).
// Used to answer duplicate submissions without recalculating.
export const getResultForAttempt = (attemptId: string, organizationId: string, studentId: string) =>
  pool.query(
    `SELECT * FROM assessment_results
     WHERE attempt_id = $1 AND organization_id = $2 AND student_id = $3
     LIMIT 1`,
    [attemptId, organizationId, studentId]
  );

// Teacher review (US-094): submitted results for an event, tenant-scoped,
// newest first. Only result-bearing (hence submitted) attempts can appear.
export const listResultsForEvent = (organizationId: string, eventId: string) =>
  pool.query(
    `SELECT r.id, r.organization_id, r.assessment_event_id, r.attempt_id, r.student_id,
            r.score, r.max_score, r.percentage,
            r.correct_count, r.incorrect_count, r.unanswered_count,
            r.submitted_at, r.created_at,
            s.full_name AS student_full_name
     FROM assessment_results r
     JOIN assessment_attempts a ON a.id = r.attempt_id
     JOIN students_v2 s ON s.id = r.student_id AND s.organization_id = r.organization_id
     WHERE r.organization_id = $1 AND r.assessment_event_id = $2 AND a.status = 'SUBMITTED'
     ORDER BY r.submitted_at DESC`,
    [organizationId, eventId]
  );

// Teacher review detail (US-094): one result bound to its event + org.
// A result from another assessment never matches.
export const getResultForEventAttempt = (organizationId: string, eventId: string, attemptId: string) =>
  pool.query(
    `SELECT r.id, r.organization_id, r.assessment_event_id, r.attempt_id, r.student_id,
            r.score, r.max_score, r.percentage,
            r.correct_count, r.incorrect_count, r.unanswered_count,
            r.submitted_at, r.created_at,
            s.full_name AS student_full_name
     FROM assessment_results r
     JOIN assessment_attempts a ON a.id = r.attempt_id
     JOIN students_v2 s ON s.id = r.student_id AND s.organization_id = r.organization_id
     WHERE r.organization_id = $1 AND r.assessment_event_id = $2 AND r.attempt_id = $3
       AND a.status = 'SUBMITTED'
     LIMIT 1`,
    [organizationId, eventId, attemptId]
  );
