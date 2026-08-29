-- Migration 010: Phase 1 academic foundation

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  designation VARCHAR(255),
  qualification VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teachers_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT teachers_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_teachers_organization_id ON teachers (organization_id);
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers (user_id);

-- Tenant-scoped students table (created with a non-colliding name to avoid legacy conflicts)
CREATE TABLE IF NOT EXISTS students_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  grade_level VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT students_v2_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT students_v2_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_students_v2_organization_id ON students_v2 (organization_id);
CREATE INDEX IF NOT EXISTS idx_students_v2_user_id ON students_v2 (user_id);

CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  section VARCHAR(100),
  academic_year VARCHAR(20),
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT classes_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT classes_created_by_user_fk FOREIGN KEY (created_by_user_id)
    REFERENCES users (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_classes_organization_id ON classes (organization_id);

CREATE TABLE IF NOT EXISTS class_teacher_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  class_id UUID NOT NULL,
  teacher_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cta_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT cta_class_fk FOREIGN KEY (class_id)
    REFERENCES classes (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT cta_teacher_fk FOREIGN KEY (teacher_id)
    REFERENCES teachers (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_class_teacher_assignments_org_class_teacher ON class_teacher_assignments (organization_id, class_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_cta_class_id ON class_teacher_assignments (class_id);

CREATE TABLE IF NOT EXISTS student_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_id UUID NOT NULL,
  class_id UUID NOT NULL,
  academic_year VARCHAR(20),
  enrolled_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enroll_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT enroll_student_fk FOREIGN KEY (student_id)
    REFERENCES students_v2 (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT enroll_class_fk FOREIGN KEY (class_id)
    REFERENCES classes (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

-- Prevent duplicate active enrollment for the same student, class and academic year
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_active_enrollment ON student_enrollments (organization_id, student_id, class_id, academic_year) WHERE (status = 'ACTIVE');
CREATE INDEX IF NOT EXISTS idx_enroll_student_id ON student_enrollments (student_id);
CREATE INDEX IF NOT EXISTS idx_enroll_class_id ON student_enrollments (class_id);
