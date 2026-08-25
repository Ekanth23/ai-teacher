CREATE TABLE IF NOT EXISTS student_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID,
  grade_level VARCHAR(50),
  board VARCHAR(100),
  class_name VARCHAR(100),
  parent_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_profiles_user_unique UNIQUE (user_id),
  CONSTRAINT student_profiles_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT student_profiles_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT student_profiles_parent_user_fk FOREIGN KEY (parent_user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_organization_id ON student_profiles (organization_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_parent_user_id ON student_profiles (parent_user_id);
