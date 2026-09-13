-- Migration 036: US-067 — Assignment overdue tracking
--
-- Adds a single, nullable point-in-time deadline to assignments. Overdue is
-- DERIVED at read time as "due_at passed AND no submission", so no persisted
-- overdue flag or background job is introduced. A NULL due_at means the
-- assignment has no deadline and is never overdue.

BEGIN;

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

COMMIT;
