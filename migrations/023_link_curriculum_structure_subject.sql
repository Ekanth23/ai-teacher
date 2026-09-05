BEGIN;

-- Requirement A: link organization-owned curriculum structures (the root container for a
-- syllabus/textbook's chapter/topic tree) to an existing subject, and validate that the
-- linked subject is actually assigned to the structure's class via class_subjects.
ALTER TABLE curriculum_structures
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_curriculum_structures_subject_id ON curriculum_structures (subject_id);

ALTER TABLE curriculum_structures
  DROP CONSTRAINT IF EXISTS curriculum_structures_subject_scope_check;
ALTER TABLE curriculum_structures
  ADD CONSTRAINT curriculum_structures_subject_scope_check CHECK (
    subject_id IS NULL OR syllabus_version_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION validate_curriculum_structure_subject()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  structure_class_id UUID;
BEGIN
  IF NEW.subject_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.syllabus_version_id IS NULL THEN
    RAISE EXCEPTION 'A curriculum structure subject requires an organization-scoped syllabus version';
  END IF;

  SELECT s.class_id
    INTO structure_class_id
    FROM syllabus_versions sv
    JOIN syllabi s ON s.id = sv.syllabus_id
   WHERE sv.id = NEW.syllabus_version_id;

  IF structure_class_id IS NULL THEN
    RAISE EXCEPTION 'Curriculum structure syllabus version was not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM class_subjects cs
     WHERE cs.class_id = structure_class_id
       AND cs.subject_id = NEW.subject_id
  ) THEN
    RAISE EXCEPTION 'Curriculum structure subject must be assigned to its class via class_subjects';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_curriculum_structures_validate_subject ON curriculum_structures;
CREATE TRIGGER trg_curriculum_structures_validate_subject
BEFORE INSERT OR UPDATE OF subject_id, syllabus_version_id ON curriculum_structures
FOR EACH ROW EXECUTE FUNCTION validate_curriculum_structure_subject();

COMMIT;
