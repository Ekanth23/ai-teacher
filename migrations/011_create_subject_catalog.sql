-- Migration 011: Subject catalog and class subject mapping

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subjects_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subjects_organization_id ON subjects (organization_id);
CREATE INDEX IF NOT EXISTS idx_subjects_status ON subjects (status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_subjects_org_name ON subjects (organization_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS ux_subjects_org_code ON subjects (organization_id, code) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS class_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  class_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT class_subjects_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT class_subjects_class_fk FOREIGN KEY (class_id)
    REFERENCES classes (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT class_subjects_subject_fk FOREIGN KEY (subject_id)
    REFERENCES subjects (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_class_subjects_org_class_subject ON class_subjects (organization_id, class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_class_id ON class_subjects (class_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_subject_id ON class_subjects (subject_id);

CREATE OR REPLACE FUNCTION validate_class_subject_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  class_org_id UUID;
  subject_org_id UUID;
BEGIN
  SELECT organization_id INTO class_org_id FROM classes WHERE id = NEW.class_id;
  SELECT organization_id INTO subject_org_id FROM subjects WHERE id = NEW.subject_id;

  IF class_org_id IS NULL THEN
    RAISE EXCEPTION 'Class not found for class_subjects assignment';
  END IF;

  IF subject_org_id IS NULL THEN
    RAISE EXCEPTION 'Subject not found for class_subjects assignment';
  END IF;

  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required for class_subjects';
  END IF;

  IF NEW.organization_id <> class_org_id OR NEW.organization_id <> subject_org_id OR class_org_id <> subject_org_id THEN
    RAISE EXCEPTION 'Class and subject must belong to the same organization';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_class_subjects_validate_organization ON class_subjects;

CREATE TRIGGER trg_class_subjects_validate_organization
BEFORE INSERT OR UPDATE OF organization_id, class_id, subject_id
ON class_subjects
FOR EACH ROW
EXECUTE FUNCTION validate_class_subject_organization();
