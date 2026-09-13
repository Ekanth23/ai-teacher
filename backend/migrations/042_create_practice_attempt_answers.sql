-- Migration 042: Phase 1 Practice loop — practice_attempt_answers
--
-- The student's selected option for a single question within an attempt.
-- One row per (attempt, question); uniqueness is enforced by the DB rule.
-- selected_option is nullable for future flexibility, but MVP always writes a
-- valid option key (unanswered = no row).

BEGIN;

CREATE TABLE IF NOT EXISTS practice_attempt_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL,
  question_id UUID NOT NULL,
  selected_option VARCHAR(10),
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT practice_attempt_answers_attempt_fk FOREIGN KEY (attempt_id)
    REFERENCES practice_attempts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT practice_attempt_answers_question_fk FOREIGN KEY (question_id)
    REFERENCES practice_questions (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT practice_attempt_answers_selected_option_check CHECK (selected_option IS NULL OR length(trim(selected_option)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_practice_attempt_answers_attempt_question ON practice_attempt_answers (attempt_id, question_id);
CREATE INDEX IF NOT EXISTS idx_practice_attempt_answers_attempt_id ON practice_attempt_answers (attempt_id);

COMMIT;
