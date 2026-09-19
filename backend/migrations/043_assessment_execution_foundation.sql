-- Migration 043: Backend Epic 9 (Slices A+B) — formal assessment execution foundation
--
-- Formal/scheduled assessments are independent of Epic 8 self-directed
-- practice. Assessment execution state lives in dedicated tables:
--   * assessment_questions — inline questions owned by an assessment_event
--     (assessment-scoped only; NOT a reusable question bank — US-095 is deferred)
--   * assessment_attempts  — a student's run of a scheduled assessment
--   * assessment_answers   — the student's selected option per question attempt
--
-- Submission/evaluation/result persistence arrive in later slices; the attempt
-- status CHECK already admits SUBMITTED so no further migration is needed then.

BEGIN;

CREATE TABLE IF NOT EXISTS assessment_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  assessment_event_id UUID NOT NULL,
  sequence_number INT NOT NULL,
  question_type VARCHAR(40) NOT NULL,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_option_key VARCHAR(10) NOT NULL,
  marks NUMERIC NOT NULL DEFAULT 1,
  explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_questions_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assessment_questions_event_fk FOREIGN KEY (assessment_event_id)
    REFERENCES assessment_events (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assessment_questions_type_check CHECK (question_type IN ('MULTIPLE_CHOICE_SINGLE')),
  CONSTRAINT assessment_questions_sequence_check CHECK (sequence_number >= 0),
  CONSTRAINT assessment_questions_text_check CHECK (length(trim(question_text)) > 0),
  CONSTRAINT assessment_questions_marks_check CHECK (marks >= 0),
  CONSTRAINT assessment_questions_correct_option_key_check CHECK (length(trim(correct_option_key)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_questions_event_sequence
  ON assessment_questions (assessment_event_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_event_id ON assessment_questions (assessment_event_id);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_organization_id ON assessment_questions (organization_id);

CREATE TABLE IF NOT EXISTS assessment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  assessment_event_id UUID NOT NULL,
  student_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_attempts_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assessment_attempts_event_fk FOREIGN KEY (assessment_event_id)
    REFERENCES assessment_events (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assessment_attempts_student_org_fk FOREIGN KEY (student_id, organization_id)
    REFERENCES students_v2 (id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assessment_attempts_status_check CHECK (status IN ('IN_PROGRESS', 'SUBMITTED')),
  CONSTRAINT assessment_attempts_submitted_state_check CHECK (
    (status = 'IN_PROGRESS' AND submitted_at IS NULL)
    OR
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_organization_id ON assessment_attempts (organization_id);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_event_id ON assessment_attempts (assessment_event_id);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_student_id ON assessment_attempts (student_id);
-- Formal assessments allow a single IN_PROGRESS attempt per (event, student);
-- additional attempts resume the open one. (Attempt limits beyond this are a
-- follow-up product decision; no limit value is invented here.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_attempts_event_student_open
  ON assessment_attempts (assessment_event_id, student_id)
  WHERE status = 'IN_PROGRESS';

CREATE TABLE IF NOT EXISTS assessment_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL,
  question_id UUID NOT NULL,
  selected_option VARCHAR(10) NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_answers_attempt_fk FOREIGN KEY (attempt_id)
    REFERENCES assessment_attempts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT assessment_answers_question_fk FOREIGN KEY (question_id)
    REFERENCES assessment_questions (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assessment_answers_selected_option_check CHECK (length(trim(selected_option)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_answers_attempt_question
  ON assessment_answers (attempt_id, question_id);
CREATE INDEX IF NOT EXISTS idx_assessment_answers_attempt_id ON assessment_answers (attempt_id);

COMMIT;
