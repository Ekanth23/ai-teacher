-- Migration 040: Phase 1 Practice & Question Definition — practice_questions
--
-- Establishes the practice_questions table as the canonical model for the
-- structured questions owned by a practice. Questions are owned inline by
-- their practice (no separate question bank, no options table, no ordering
-- table). Ordering is a per-practice sequence_number. The correct answer is
-- stored as a dedicated correct_option_key column (never exposed to students
-- before submission in later slices).

BEGIN;

CREATE TABLE IF NOT EXISTS practice_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL,
  sequence_number INT NOT NULL,
  question_type VARCHAR(40) NOT NULL,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_option_key VARCHAR(10) NOT NULL,
  marks NUMERIC NOT NULL DEFAULT 1,
  explanation TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT practice_questions_practice_fk FOREIGN KEY (practice_id)
    REFERENCES practices (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT practice_questions_type_check CHECK (question_type IN ('MULTIPLE_CHOICE_SINGLE')),
  CONSTRAINT practice_questions_sequence_check CHECK (sequence_number >= 0),
  CONSTRAINT practice_questions_text_check CHECK (length(trim(question_text)) > 0),
  CONSTRAINT practice_questions_marks_check CHECK (marks >= 0),
  CONSTRAINT practice_questions_correct_option_key_check CHECK (length(trim(correct_option_key)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_practice_questions_practice_sequence ON practice_questions (practice_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_practice_questions_practice_id ON practice_questions (practice_id);

COMMIT;
