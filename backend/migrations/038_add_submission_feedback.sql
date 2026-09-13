-- Migration 038: US-071 — Teacher feedback on submission
--
-- Adds an optional free-text feedback field to a submission, allowing an
-- authorized teacher to leave a brief explanation alongside their review
-- decision. A NULL feedback means no feedback has been provided. Marks and
-- automated/AI-generated feedback remain out of scope.

BEGIN;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS feedback TEXT;

COMMIT;
