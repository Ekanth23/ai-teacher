DROP INDEX IF EXISTS idx_student_profiles_organization_id;

ALTER TABLE student_profiles
  DROP COLUMN IF EXISTS organization_id;
