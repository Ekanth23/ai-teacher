BEGIN;

CREATE TABLE IF NOT EXISTS academic_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  board_id UUID REFERENCES boards(id) ON DELETE RESTRICT,
  calendar_code VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(80) NOT NULL,
  scope VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT academic_calendars_scope_check CHECK (
    (scope = 'REFERENCE' AND organization_id IS NULL)
    OR (scope = 'ORGANIZATION' AND organization_id IS NOT NULL)
  ),
  CONSTRAINT academic_calendars_scope_values_check CHECK (scope IN ('REFERENCE', 'ORGANIZATION')),
  CONSTRAINT academic_calendars_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  CONSTRAINT academic_calendars_identity_check CHECK (
    length(trim(calendar_code)) > 0 AND length(trim(name)) > 0 AND length(trim(version)) > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_academic_calendars_reference_identity
  ON academic_calendars (academic_year_id, board_id, lower(calendar_code), lower(version))
  WHERE scope = 'REFERENCE';
CREATE UNIQUE INDEX IF NOT EXISTS ux_academic_calendars_organization_identity
  ON academic_calendars (organization_id, academic_year_id, lower(calendar_code), lower(version))
  WHERE scope = 'ORGANIZATION';
CREATE UNIQUE INDEX IF NOT EXISTS ux_academic_calendars_id_year_org_scope
  ON academic_calendars (id, academic_year_id, organization_id, scope);
CREATE UNIQUE INDEX IF NOT EXISTS ux_academic_calendars_id_year
  ON academic_calendars (id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_academic_calendars_year_status
  ON academic_calendars (academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_academic_calendars_org_year_status
  ON academic_calendars (organization_id, academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_academic_calendars_board_year_status
  ON academic_calendars (board_id, academic_year_id, status);

CREATE TABLE IF NOT EXISTS academic_calendar_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES academic_calendars(id) ON DELETE CASCADE,
  parent_period_id UUID,
  period_type VARCHAR(60) NOT NULL,
  name VARCHAR(255) NOT NULL,
  sequence_number INTEGER NOT NULL DEFAULT 0,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT academic_calendar_periods_dates_check CHECK (ends_on >= starts_on),
  CONSTRAINT academic_calendar_periods_sequence_check CHECK (sequence_number >= 0),
  CONSTRAINT academic_calendar_periods_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  CONSTRAINT academic_calendar_periods_period_type_check CHECK (length(trim(period_type)) > 0),
  CONSTRAINT academic_calendar_periods_name_check CHECK (length(trim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_academic_calendar_periods_id_calendar
  ON academic_calendar_periods (id, calendar_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_academic_calendar_periods_calendar_sequence
  ON academic_calendar_periods (calendar_id, sequence_number, lower(name));
CREATE INDEX IF NOT EXISTS idx_academic_calendar_periods_calendar_dates
  ON academic_calendar_periods (calendar_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_periods_parent
  ON academic_calendar_periods (parent_period_id);

ALTER TABLE academic_calendar_periods
  DROP CONSTRAINT IF EXISTS academic_calendar_periods_parent_same_calendar_fk;
ALTER TABLE academic_calendar_periods
  ADD CONSTRAINT academic_calendar_periods_parent_same_calendar_fk
  FOREIGN KEY (parent_period_id, calendar_id)
  REFERENCES academic_calendar_periods (id, calendar_id);

CREATE TABLE IF NOT EXISTS assessment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_types_code_check CHECK (length(trim(code)) > 0),
  CONSTRAINT assessment_types_name_check CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_types_code ON assessment_types (lower(code));
CREATE INDEX IF NOT EXISTS idx_assessment_types_status ON assessment_types (status);

CREATE TABLE IF NOT EXISTS assessment_scheme_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE RESTRICT,
  scheme_code VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_scheme_versions_status_check CHECK (status IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'RETIRED')),
  CONSTRAINT assessment_scheme_versions_identity_check CHECK (
    length(trim(scheme_code)) > 0 AND length(trim(name)) > 0 AND length(trim(version)) > 0
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_scheme_versions_identity
  ON assessment_scheme_versions (board_id, academic_year_id, lower(scheme_code), lower(version));
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_scheme_versions_id_board_year
  ON assessment_scheme_versions (id, board_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_assessment_scheme_versions_board_year_status
  ON assessment_scheme_versions (board_id, academic_year_id, status);

CREATE TABLE IF NOT EXISTS assessment_scheme_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_scheme_version_id UUID NOT NULL REFERENCES assessment_scheme_versions(id) ON DELETE RESTRICT,
  assessment_type_id UUID NOT NULL REFERENCES assessment_types(id) ON DELETE RESTRICT,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  maximum_marks NUMERIC,
  weightage NUMERIC,
  duration_minutes INTEGER,
  sequence_number INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT true,
  assessment_method VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_scheme_components_identity_check CHECK (
    length(trim(code)) > 0 AND length(trim(name)) > 0
  ),
  CONSTRAINT assessment_scheme_components_marks_check CHECK (maximum_marks IS NULL OR maximum_marks >= 0),
  CONSTRAINT assessment_scheme_components_weightage_check CHECK (weightage IS NULL OR weightage >= 0),
  CONSTRAINT assessment_scheme_components_duration_check CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  CONSTRAINT assessment_scheme_components_sequence_check CHECK (sequence_number >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_scheme_components_scheme_code
  ON assessment_scheme_components (assessment_scheme_version_id, lower(code));
CREATE INDEX IF NOT EXISTS idx_assessment_scheme_components_scheme_sequence
  ON assessment_scheme_components (assessment_scheme_version_id, sequence_number);

CREATE TABLE IF NOT EXISTS assessment_scheme_curriculum_versions (
  assessment_scheme_version_id UUID NOT NULL REFERENCES assessment_scheme_versions(id) ON DELETE RESTRICT,
  curriculum_version_id UUID NOT NULL REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_scheme_version_id, curriculum_version_id)
);
CREATE INDEX IF NOT EXISTS idx_assessment_scheme_curriculum_versions_curriculum
  ON assessment_scheme_curriculum_versions (curriculum_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_classes_id_organization
  ON classes (id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_syllabus_versions_id_curriculum
  ON syllabus_versions (id, curriculum_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_curriculum_versions_id_year
  ON curriculum_versions (id, academic_year_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_curriculum_structures_id_scope
  ON curriculum_structures (id, syllabus_version_id, reference_dataset_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_curriculum_reference_datasets_id_version
  ON curriculum_reference_datasets (id, curriculum_version_id);

CREATE TABLE IF NOT EXISTS assessment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id UUID NOT NULL,
  subject_id UUID,
  calendar_id UUID,
  calendar_period_id UUID,
  assessment_scheme_version_id UUID,
  assessment_type_id UUID REFERENCES assessment_types(id) ON DELETE RESTRICT,
  title VARCHAR(255) NOT NULL,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_events_class_organization_fk
    FOREIGN KEY (class_id, organization_id) REFERENCES classes (id, organization_id),
  CONSTRAINT assessment_events_subject_class_fk
    FOREIGN KEY (organization_id, class_id, subject_id)
    REFERENCES class_subjects (organization_id, class_id, subject_id),
  CONSTRAINT assessment_events_calendar_year_fk
    FOREIGN KEY (calendar_id, academic_year_id)
    REFERENCES academic_calendars (id, academic_year_id),
  CONSTRAINT assessment_events_calendar_period_fk
    FOREIGN KEY (calendar_period_id, calendar_id)
    REFERENCES academic_calendar_periods (id, calendar_id),
  CONSTRAINT assessment_events_scheme_fk
    FOREIGN KEY (assessment_scheme_version_id) REFERENCES assessment_scheme_versions(id),
  CONSTRAINT assessment_events_period_requires_calendar_check CHECK (
    calendar_period_id IS NULL OR calendar_id IS NOT NULL
  ),
  CONSTRAINT assessment_events_dates_check CHECK (scheduled_end >= scheduled_start),
  CONSTRAINT assessment_events_status_check CHECK (status IN ('DRAFT', 'SCHEDULED', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT assessment_events_title_check CHECK (length(trim(title)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_assessment_events_org_year_status
  ON assessment_events (organization_id, academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_assessment_events_class_start
  ON assessment_events (class_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_assessment_events_calendar ON assessment_events (calendar_id);
CREATE INDEX IF NOT EXISTS idx_assessment_events_period ON assessment_events (calendar_period_id);
CREATE INDEX IF NOT EXISTS idx_assessment_events_scheme ON assessment_events (assessment_scheme_version_id);

CREATE TABLE IF NOT EXISTS assessment_event_curriculum_portions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_event_id UUID NOT NULL,
  curriculum_structure_id UUID NOT NULL,
  curriculum_node_id UUID,
  source_type VARCHAR(60) NOT NULL DEFAULT 'BOARD_CURRICULUM',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assessment_event_portions_event_fk
    FOREIGN KEY (assessment_event_id) REFERENCES assessment_events(id) ON DELETE RESTRICT,
  CONSTRAINT assessment_event_portions_node_structure_fk
    FOREIGN KEY (curriculum_node_id, curriculum_structure_id)
    REFERENCES curriculum_nodes (id, curriculum_structure_id),
  CONSTRAINT assessment_event_portions_source_check CHECK (length(trim(source_type)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_event_portions_identity
  ON assessment_event_curriculum_portions (assessment_event_id, curriculum_structure_id, curriculum_node_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_event_portions_whole_structure
  ON assessment_event_curriculum_portions (assessment_event_id, curriculum_structure_id)
  WHERE curriculum_node_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_assessment_event_portions_event
  ON assessment_event_curriculum_portions (assessment_event_id);
CREATE INDEX IF NOT EXISTS idx_assessment_event_portions_structure_node
  ON assessment_event_curriculum_portions (curriculum_structure_id, curriculum_node_id);

CREATE OR REPLACE FUNCTION enforce_reference_calendar_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  calendar_scope TEXT;
  calendar_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'academic_calendars' THEN
    IF TG_OP = 'DELETE' AND OLD.scope = 'REFERENCE' AND OLD.status IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'Published or retired reference calendar is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.scope = 'REFERENCE' AND OLD.status IN ('PUBLISHED', 'RETIRED') THEN
      IF NEW.academic_year_id IS DISTINCT FROM OLD.academic_year_id
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.board_id IS DISTINCT FROM OLD.board_id
         OR NEW.calendar_code IS DISTINCT FROM OLD.calendar_code
         OR NEW.name IS DISTINCT FROM OLD.name
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.scope IS DISTINCT FROM OLD.scope
         OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
        RAISE EXCEPTION 'Published or retired reference calendar is immutable';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.scope = 'REFERENCE' AND OLD.status <> NEW.status
       AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED')
         OR (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')
       ) THEN
      RAISE EXCEPTION 'Invalid reference calendar lifecycle transition: % -> %', OLD.status, NEW.status;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT scope, status INTO calendar_scope, calendar_status
    FROM academic_calendars WHERE id = COALESCE(NEW.calendar_id, OLD.calendar_id);
  IF calendar_scope = 'REFERENCE' AND calendar_status IN ('PUBLISHED', 'RETIRED')
     AND TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Published or retired reference calendar period is immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS academic_calendars_reference_immutability ON academic_calendars;
CREATE TRIGGER academic_calendars_reference_immutability
BEFORE UPDATE OR DELETE ON academic_calendars
FOR EACH ROW EXECUTE FUNCTION enforce_reference_calendar_immutability();
DROP TRIGGER IF EXISTS academic_calendar_periods_reference_immutability ON academic_calendar_periods;
CREATE TRIGGER academic_calendar_periods_reference_immutability
BEFORE UPDATE OR DELETE ON academic_calendar_periods
FOR EACH ROW EXECUTE FUNCTION enforce_reference_calendar_immutability();

CREATE OR REPLACE FUNCTION enforce_reference_assessment_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  scheme_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'assessment_scheme_versions' THEN
    IF TG_OP = 'DELETE' AND OLD.status IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'Published or retired assessment scheme is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('PUBLISHED', 'RETIRED') THEN
      IF NEW.board_id IS DISTINCT FROM OLD.board_id
         OR NEW.academic_year_id IS DISTINCT FROM OLD.academic_year_id
         OR NEW.scheme_code IS DISTINCT FROM OLD.scheme_code
         OR NEW.name IS DISTINCT FROM OLD.name
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.source_metadata IS DISTINCT FROM OLD.source_metadata
         OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
        RAISE EXCEPTION 'Published or retired assessment scheme is immutable';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> NEW.status
       AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'VALIDATED')
         OR (OLD.status = 'VALIDATED' AND NEW.status = 'PUBLISHED')
         OR (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')
       ) THEN
      RAISE EXCEPTION 'Invalid assessment scheme lifecycle transition: % -> %', OLD.status, NEW.status;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO scheme_status
    FROM assessment_scheme_versions
    WHERE id = COALESCE(NEW.assessment_scheme_version_id, OLD.assessment_scheme_version_id);
  IF scheme_status IN ('PUBLISHED', 'RETIRED') AND TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Published or retired assessment scheme content is immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS assessment_scheme_versions_reference_immutability ON assessment_scheme_versions;
CREATE TRIGGER assessment_scheme_versions_reference_immutability
BEFORE UPDATE OR DELETE ON assessment_scheme_versions
FOR EACH ROW EXECUTE FUNCTION enforce_reference_assessment_immutability();
DROP TRIGGER IF EXISTS assessment_scheme_components_reference_immutability ON assessment_scheme_components;
CREATE TRIGGER assessment_scheme_components_reference_immutability
BEFORE UPDATE OR DELETE ON assessment_scheme_components
FOR EACH ROW EXECUTE FUNCTION enforce_reference_assessment_immutability();
DROP TRIGGER IF EXISTS assessment_scheme_curriculum_versions_reference_immutability ON assessment_scheme_curriculum_versions;
CREATE TRIGGER assessment_scheme_curriculum_versions_reference_immutability
BEFORE UPDATE OR DELETE ON assessment_scheme_curriculum_versions
FOR EACH ROW EXECUTE FUNCTION enforce_reference_assessment_immutability();

CREATE OR REPLACE FUNCTION validate_assessment_event_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  calendar_org UUID;
  calendar_scope TEXT;
  calendar_status TEXT;
  calendar_year UUID;
  period_calendar UUID;
  scheme_status TEXT;
BEGIN
  IF NEW.calendar_id IS NOT NULL THEN
    SELECT organization_id, scope, status, academic_year_id
      INTO calendar_org, calendar_scope, calendar_status, calendar_year
      FROM academic_calendars WHERE id = NEW.calendar_id;
    IF calendar_year IS NULL OR calendar_year <> NEW.academic_year_id THEN
      RAISE EXCEPTION 'Assessment event academic year must match its calendar';
    END IF;
    IF calendar_scope = 'ORGANIZATION' AND calendar_org <> NEW.organization_id THEN
      RAISE EXCEPTION 'Assessment event calendar belongs to another organization';
    END IF;
    IF calendar_scope = 'REFERENCE' AND calendar_status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'Assessment event may use only a published reference calendar';
    END IF;
  END IF;
  IF NEW.calendar_period_id IS NOT NULL THEN
    SELECT calendar_id INTO period_calendar FROM academic_calendar_periods WHERE id = NEW.calendar_period_id;
    IF period_calendar IS NULL OR period_calendar <> NEW.calendar_id THEN
      RAISE EXCEPTION 'Assessment event calendar period belongs to another calendar';
    END IF;
  END IF;
  IF NEW.assessment_scheme_version_id IS NOT NULL THEN
    SELECT status INTO scheme_status FROM assessment_scheme_versions WHERE id = NEW.assessment_scheme_version_id;
    IF scheme_status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'Assessment event may use only a published assessment scheme';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assessment_events_scope_validation ON assessment_events;
CREATE TRIGGER assessment_events_scope_validation
BEFORE INSERT OR UPDATE ON assessment_events
FOR EACH ROW EXECUTE FUNCTION validate_assessment_event_scope();

COMMIT;
