-- Migration 034: US-063 — Open / close assignment
--
-- Extends the assignment lifecycle to distinguish PUBLISHED (published but not
-- yet available) from OPEN (available for student activity) and CLOSED (no
-- longer available). Existing DRAFT / PUBLISHED / CLOSED rows remain valid and
-- are not rewritten: a previously PUBLISHED assignment stays PUBLISHED until an
-- explicit open operation is performed.

BEGIN;

ALTER TABLE assignments
  DROP CONSTRAINT IF EXISTS assignments_status_check;

ALTER TABLE assignments
  ADD CONSTRAINT assignments_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'OPEN', 'CLOSED'));

COMMIT;
