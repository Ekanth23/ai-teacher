-- Migration 044: Backend Epic 9 Slice C (US-091/US-092/US-093/US-094) — formal assessment results
--
-- Dedicated formal-assessment result store. Fully separate from Epic 8
-- practice_attempts / practice_attempt_answers (US-093 boundary).
--
-- Lifecycle: exactly ONE immutable result row per SUBMITTED
-- assessment_attempts row. Created atomically with the IN_PROGRESS ->
-- SUBMITTED transition inside the submission transaction. No UPDATE or
-- DELETE API exists; the UNIQUE(attempt_id) constraint plus the guarded
-- status transition prevents duplicate/concurrent results.
--
-- Zero-question / zero-max-score assessments are rejected by the service
-- before insert; the max_score > 0 CHECK enforces this at the DB level.

BEGIN;

CREATE TABLE IF NOT EXISTS assessment_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  assessment_event_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  student_id UUID NOT NULL,
  score NUMERIC NOT NULL,
  max_score NUMERIC NOT NULL,
  percentage NUMERIC NOT NULL,
  correct_count INTEGER NOT NULL,
  incorrect_count INTEGER NOT NULL,
  unanswered_count INTEGER NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_results_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assessment_results_event_fk FOREIGN KEY (assessment_event_id)
    REFERENCES assessment_events (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assessment_results_attempt_fk FOREIGN KEY (attempt_id)
    REFERENCES assessment_attempts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT assessment_results_student_org_fk FOREIGN KEY (student_id, organization_id)
    REFERENCES students_v2 (id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assessment_results_score_check CHECK (score >= 0),
  CONSTRAINT assessment_results_max_score_check CHECK (max_score > 0),
  CONSTRAINT assessment_results_score_within_max_check CHECK (score <= max_score),
  CONSTRAINT assessment_results_percentage_check CHECK (percentage >= 0 AND percentage <= 100),
  CONSTRAINT assessment_results_correct_count_check CHECK (correct_count >= 0),
  CONSTRAINT assessment_results_incorrect_count_check CHECK (incorrect_count >= 0),
  CONSTRAINT assessment_results_unanswered_count_check CHECK (unanswered_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_results_attempt_id
  ON assessment_results (attempt_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_organization_event
  ON assessment_results (organization_id, assessment_event_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_organization_student
  ON assessment_results (organization_id, student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_event_submitted
  ON assessment_results (assessment_event_id, submitted_at DESC);

COMMIT;
