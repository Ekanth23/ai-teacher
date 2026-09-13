-- Migration 041: Phase 1 Practice loop — practice_attempts
--
-- A student's run of a practice. Carries the immutable result summary after
-- submission (no separate results table). Attempts are unlimited; historical
-- attempts are retained. Tenant isolation is enforced structurally via the
-- (student_id, organization_id) composite FK mirroring students_v2.

BEGIN;

CREATE TABLE IF NOT EXISTS practice_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  practice_id UUID NOT NULL,
  student_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  score NUMERIC,
  max_score NUMERIC,
  percentage NUMERIC,
  correct_count INTEGER,
  incorrect_count INTEGER,
  unanswered_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT practice_attempts_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT practice_attempts_practice_fk FOREIGN KEY (practice_id)
    REFERENCES practices (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT practice_attempts_student_org_fk FOREIGN KEY (student_id, organization_id)
    REFERENCES students_v2 (id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT practice_attempts_status_check CHECK (status IN ('IN_PROGRESS', 'SUBMITTED')),
  CONSTRAINT practice_attempts_result_state_check CHECK (
    (status = 'IN_PROGRESS' AND score IS NULL AND max_score IS NULL AND percentage IS NULL
     AND correct_count IS NULL AND incorrect_count IS NULL AND unanswered_count IS NULL AND submitted_at IS NULL)
    OR
    (status = 'SUBMITTED' AND score IS NOT NULL AND max_score IS NOT NULL AND percentage IS NOT NULL
     AND correct_count IS NOT NULL AND incorrect_count IS NOT NULL AND unanswered_count IS NOT NULL AND submitted_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_practice_attempts_organization_id ON practice_attempts (organization_id);
CREATE INDEX IF NOT EXISTS idx_practice_attempts_practice_id ON practice_attempts (practice_id);
CREATE INDEX IF NOT EXISTS idx_practice_attempts_student_id ON practice_attempts (student_id);
CREATE INDEX IF NOT EXISTS idx_practice_attempts_org_student_submitted ON practice_attempts (organization_id, student_id, submitted_at);

COMMIT;
