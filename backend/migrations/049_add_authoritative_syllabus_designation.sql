-- Migration 049: explicit authoritative syllabus designation for US-118.
--
-- Existing syllabus rows are intentionally left non-authoritative.  A board
-- or medium is never inferred from a class name, subject, student profile,
-- ordering, or syllabus title.

ALTER TABLE syllabi
  ADD COLUMN IF NOT EXISTS is_authoritative BOOLEAN;

-- Be safe for an environment where the column was partially created by a
-- manually attempted deployment.  This does not promote any existing row.
UPDATE syllabi
   SET is_authoritative = FALSE
 WHERE is_authoritative IS NULL;

ALTER TABLE syllabi
  ALTER COLUMN is_authoritative SET DEFAULT FALSE;

ALTER TABLE syllabi
  ALTER COLUMN is_authoritative SET NOT NULL;

-- A class may have at most one explicitly designated authoritative syllabus.
-- The application resolver still treats zero or multiple rows as unresolved;
-- this index is the database-level ownership/selection guard.
DO $$
DECLARE
  multiple_authoritative BIGINT;
BEGIN
  SELECT COUNT(*)
    INTO multiple_authoritative
    FROM (
      SELECT class_id
        FROM syllabi
       WHERE is_authoritative = TRUE
       GROUP BY class_id
      HAVING COUNT(*) > 1
    ) ambiguous_classes;

  IF multiple_authoritative > 0 THEN
    RAISE EXCEPTION
      'Migration 049 designation preflight failed: % class(es) have multiple authoritative syllabi. Resolve the designation before retrying; no syllabus rows were changed.',
      multiple_authoritative;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_syllabi_one_authoritative_per_class_049
  ON syllabi (class_id)
  WHERE is_authoritative = TRUE;
