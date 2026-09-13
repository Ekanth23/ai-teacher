-- Migration 031: US-031 — Class / Batch management lifecycle & teacher assignment
--
-- 1. Class status lifecycle constraint (ACTIVE / INACTIVE).
-- 2. Class uniqueness refined to (organization, name, section, academic_year) so the
--    same class/grade name may represent distinct academic instances across sections
--    and academic years while still preventing accidental duplicates.
-- 3. Class Teacher (class_teacher_assignments) lifecycle: one ACTIVE class teacher per
--    class, with historical (INACTIVE) assignments preserved rather than deleted.
-- 4. Subject Teacher (class_subject_teachers): teacher <-> class <-> subject assignment,
--    kept logically separate from the Class Teacher designation.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Class status lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE classes
  DROP CONSTRAINT IF EXISTS classes_status_check;
ALTER TABLE classes
  ADD CONSTRAINT classes_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'));

-- ---------------------------------------------------------------------------
-- 2. Class uniqueness within the organization + academic context
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS ux_classes_org_name;
CREATE UNIQUE INDEX IF NOT EXISTS ux_classes_org_name_section_year
  ON classes (organization_id, lower(name), COALESCE(section, ''), COALESCE(academic_year, ''));

-- ---------------------------------------------------------------------------
-- 3. Class Teacher lifecycle (historical preservation)
-- ---------------------------------------------------------------------------
ALTER TABLE class_teacher_assignments
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE class_teacher_assignments
  DROP CONSTRAINT IF EXISTS cta_status_check;
ALTER TABLE class_teacher_assignments
  ADD CONSTRAINT cta_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'));

DROP INDEX IF EXISTS ux_class_teacher_assignments_org_class_teacher;

-- One ACTIVE Class Teacher per class. A teacher may still be the Class Teacher
-- for multiple classes (no teacher-level restriction), matching existing behavior.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cta_one_active_per_class
  ON class_teacher_assignments (class_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_cta_teacher_id ON class_teacher_assignments (teacher_id);

-- ---------------------------------------------------------------------------
-- 4. Subject Teacher assignment (teacher <-> class <-> subject)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_subject_teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  class_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  teacher_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cst_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT cst_class_fk FOREIGN KEY (class_id)
    REFERENCES classes (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT cst_subject_fk FOREIGN KEY (subject_id)
    REFERENCES subjects (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT cst_teacher_fk FOREIGN KEY (teacher_id)
    REFERENCES teachers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT cst_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- One ACTIVE assignment per (class, subject, teacher). Multiple teachers may teach
-- the same subject in a class, and one teacher may teach multiple subjects/classes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cst_org_class_subject_teacher
  ON class_subject_teachers (organization_id, class_id, subject_id, teacher_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_cst_class_id ON class_subject_teachers (class_id);
CREATE INDEX IF NOT EXISTS idx_cst_subject_id ON class_subject_teachers (subject_id);
CREATE INDEX IF NOT EXISTS idx_cst_teacher_id ON class_subject_teachers (teacher_id);

COMMIT;
