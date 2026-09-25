-- Migration 048: explicit current enrollment selection for US-118.
--
-- The selection is intentionally stored on the canonical students_v2 row.
-- NULL means that the student has not selected a current enrollment.  No
-- ordering, recency, or other enrollment heuristic is used anywhere in this
-- migration.
--
-- Existing enrollment/class rows are not changed.  The composite ownership
-- checks below make a selected enrollment belong to the same student and
-- organization as the student row, while the service/read path still treats
-- an inactive or otherwise stale selection as unresolved.

-- Composite keys are required for tenant-safe foreign keys.  They are
-- additive and do not alter enrollment lifecycle semantics.
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_enrollments_id_student_organization
  ON student_enrollments (id, student_id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_classes_id_organization
  ON classes (id, organization_id);
-- Do not silently accept pre-existing cross-tenant enrollment/class graphs.
-- A deployment must reconcile such data before this migration can complete.
DO $$
DECLARE
  invalid_student_links BIGINT;
  invalid_class_links BIGINT;
BEGIN
  SELECT COUNT(*)
    INTO invalid_student_links
    FROM student_enrollments se
    LEFT JOIN students_v2 s
      ON s.id = se.student_id
     AND s.organization_id = se.organization_id
   WHERE s.id IS NULL;

  IF invalid_student_links > 0 THEN
    RAISE EXCEPTION
      'Migration 048 ownership preflight failed: % enrollment row(s) do not belong to a student in the same organization. Reconcile the rows before retrying; no rows were changed.',
      invalid_student_links;
  END IF;

  SELECT COUNT(*)
    INTO invalid_class_links
    FROM student_enrollments se
    LEFT JOIN classes c
      ON c.id = se.class_id
     AND c.organization_id = se.organization_id
   WHERE c.id IS NULL;

  IF invalid_class_links > 0 THEN
    RAISE EXCEPTION
      'Migration 048 ownership preflight failed: % enrollment row(s) do not belong to a class in the same organization. Reconcile the rows before retrying; no rows were changed.',
      invalid_class_links;
  END IF;
END $$;

-- Strengthen the existing enrollment relationships without changing their
-- lifecycle behavior.  IF NOT EXISTS is not valid for constraints, hence the
-- catalog guards.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'student_enrollments'::regclass
       AND conname = 'enroll_student_organization_fk_048'
  ) THEN
    ALTER TABLE student_enrollments
      ADD CONSTRAINT enroll_student_organization_fk_048
      FOREIGN KEY (student_id, organization_id)
      REFERENCES students_v2 (id, organization_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'student_enrollments'::regclass
       AND conname = 'enroll_class_organization_fk_048'
  ) THEN
    ALTER TABLE student_enrollments
      ADD CONSTRAINT enroll_class_organization_fk_048
      FOREIGN KEY (class_id, organization_id)
      REFERENCES classes (id, organization_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- A nullable column preserves the explicit-selection contract: no selection is
-- unresolved, never an inferred first/latest class.
ALTER TABLE students_v2
  ADD COLUMN IF NOT EXISTS current_enrollment_id UUID;

CREATE INDEX IF NOT EXISTS idx_students_v2_current_enrollment
  ON students_v2 (current_enrollment_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'students_v2'::regclass
       AND conname = 'students_v2_current_enrollment_fk_048'
  ) THEN
    ALTER TABLE students_v2
      ADD CONSTRAINT students_v2_current_enrollment_fk_048
      FOREIGN KEY (current_enrollment_id)
      REFERENCES student_enrollments (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'students_v2'::regclass
       AND conname = 'students_v2_current_enrollment_owner_fk_048'
  ) THEN
    ALTER TABLE students_v2
      ADD CONSTRAINT students_v2_current_enrollment_owner_fk_048
      FOREIGN KEY (current_enrollment_id, id, organization_id)
      REFERENCES student_enrollments (id, student_id, organization_id)
      ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;
END $$;

-- The simple foreign key above clears the nullable selection if an enrollment
-- is physically deleted.  The composite foreign key then preserves ownership
-- integrity for every non-null selection.  This trigger additionally keeps the
-- behavior explicit for databases/configuration where a parent delete is
-- handled by a cascade chain.
CREATE OR REPLACE FUNCTION clear_students_v2_current_enrollment_048()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE students_v2
     SET current_enrollment_id = NULL,
         updated_at = NOW()
   WHERE current_enrollment_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_students_v2_current_enrollment_048 ON student_enrollments;
CREATE TRIGGER trg_clear_students_v2_current_enrollment_048
  BEFORE DELETE ON student_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION clear_students_v2_current_enrollment_048();

-- A selected row must be active and point to an active class at the time the
-- selection is written.  Later lifecycle changes intentionally remain allowed;
-- the request-time resolver treats such a stale selection as unresolved.
CREATE OR REPLACE FUNCTION validate_students_v2_current_enrollment_048()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_enrollment_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM student_enrollments se
         JOIN classes c
           ON c.id = se.class_id
          AND c.organization_id = se.organization_id
        WHERE se.id = NEW.current_enrollment_id
          AND se.student_id = NEW.id
          AND se.organization_id = NEW.organization_id
          AND se.status = 'ACTIVE'
          AND c.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'Current enrollment must be an active enrollment of the same student and organization with an active class.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_students_v2_current_enrollment_048 ON students_v2;
CREATE TRIGGER trg_validate_students_v2_current_enrollment_048
  BEFORE INSERT OR UPDATE OF current_enrollment_id ON students_v2
  FOR EACH ROW
  EXECUTE FUNCTION validate_students_v2_current_enrollment_048();
