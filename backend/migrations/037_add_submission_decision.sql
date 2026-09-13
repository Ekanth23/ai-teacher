-- Migration 037: US-070 — Teacher submission review decision
--
-- Adds a single nullable decision to a submission, representing the teacher's
-- final review action (ACCEPTED or REDO_REQUIRED). A NULL decision means the
-- submission has not yet been reviewed. Marks and detailed feedback remain out
-- of scope for this story and are not stored here.

BEGIN;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS decision VARCHAR(20);

ALTER TABLE submissions
  DROP CONSTRAINT IF EXISTS submissions_decision_check;

ALTER TABLE submissions
  ADD CONSTRAINT submissions_decision_check
  CHECK (decision IS NULL OR decision IN ('ACCEPTED', 'REDO_REQUIRED'));

COMMIT;
