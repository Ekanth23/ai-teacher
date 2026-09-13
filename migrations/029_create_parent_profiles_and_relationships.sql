-- Migration 029: parent/guardian profile and parent-student relationship
--
-- A parent/guardian profile represents WHO the parent is (a user identity scoped
-- to an organization). The parent-student relationship is a SEPARATE model that
-- determines which student(s) the parent is authorized to represent. Keeping the
-- two distinct means a parent may have many students and a student may have many
-- parents/guardians, without duplicating the parent profile or the student profile.
--
-- Parent involvement is OPTIONAL: no student is required to have a parent, and no
-- parent profile requires a student. For COACHING_CENTRE organizations the student
-- is the primary communication participant, so a coaching student can exist with
-- no parent relationship at all.

CREATE TABLE IF NOT EXISTS parent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parent_profiles_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT parent_profiles_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT parent_profiles_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- One parent profile per (organization, user). The same user may be a parent in
-- many organizations, but must not have duplicate profiles within one organization.
CREATE UNIQUE INDEX IF NOT EXISTS ux_parent_profiles_org_user ON parent_profiles (organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_organization_id ON parent_profiles (organization_id);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_user_id ON parent_profiles (user_id);

CREATE TABLE IF NOT EXISTS parent_student_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  parent_profile_id UUID NOT NULL,
  student_id UUID NOT NULL,
  relationship_type VARCHAR(50) NOT NULL DEFAULT 'PARENT',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT psr_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT psr_parent_profile_fk FOREIGN KEY (parent_profile_id)
    REFERENCES parent_profiles (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT psr_student_fk FOREIGN KEY (student_id)
    REFERENCES students_v2 (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT psr_relationship_type_check CHECK (relationship_type IN ('PARENT', 'GUARDIAN')),
  CONSTRAINT psr_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- Prevent duplicate relationships between the same parent and student within an
-- organization. The relationship's organization must match both the parent's and
-- the student's organization (enforced at the service layer as ORGANIZATION_MISMATCH).
CREATE UNIQUE INDEX IF NOT EXISTS ux_psr_org_parent_student ON parent_student_relationships (organization_id, parent_profile_id, student_id);
CREATE INDEX IF NOT EXISTS idx_psr_parent_profile_id ON parent_student_relationships (parent_profile_id);
CREATE INDEX IF NOT EXISTS idx_psr_student_id ON parent_student_relationships (student_id);
CREATE INDEX IF NOT EXISTS idx_psr_organization_id ON parent_student_relationships (organization_id);
