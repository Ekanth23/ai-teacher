-- Migration 027: teacher profile integrity (duplicate prevention + status validation)
-- A teacher profile represents WHO the teacher is (user identity) scoped to an organization.
-- One teacher profile per (organization, user) — the same user may be a teacher in many organizations.

CREATE UNIQUE INDEX IF NOT EXISTS ux_teachers_org_user ON teachers (organization_id, user_id);

ALTER TABLE teachers
  DROP CONSTRAINT IF EXISTS teachers_status_check;
ALTER TABLE teachers
  ADD CONSTRAINT teachers_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'));
