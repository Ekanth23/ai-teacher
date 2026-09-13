-- Migration 028: student academic profile integrity
-- Adds the institution-specific enrollment/admission number, org-scoped uniqueness,
-- and status validation. Enrollment number is NOT globally unique: each organization
-- may use its own numbering scheme.

ALTER TABLE students_v2
  ADD COLUMN IF NOT EXISTS enrollment_number VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS ux_students_v2_org_user ON students_v2 (organization_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_students_v2_org_enrollment_number ON students_v2 (organization_id, enrollment_number) WHERE enrollment_number IS NOT NULL;

ALTER TABLE students_v2
  DROP CONSTRAINT IF EXISTS students_v2_status_check;
ALTER TABLE students_v2
  ADD CONSTRAINT students_v2_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'));
