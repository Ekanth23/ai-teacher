-- Migration 033: US-060 — Create homework / assignment
--
-- Establishes the assignments table as the canonical model for homework /
-- assignments created by an authorized teacher. The table is organization
-- scoped and links the assignment to its teacher owner, target class, subject,
-- and (optionally) a curriculum chapter/topic node.
--
-- Tenant isolation is enforced structurally:
--   * (teacher_id, organization_id)      -> teachers(id, organization_id)
--   * (class_id, organization_id)        -> classes(id, organization_id)
--   * (organization_id, class_id, subject_id) -> class_subjects(...)
-- These composite foreign keys guarantee the teacher, class, and subject all
-- belong to the same organization as the assignment, and that the subject is
-- actually mapped to the class. A client-supplied organization_id can therefore
-- never point at another tenant.

BEGIN;

-- Composite uniqueness backing the teacher tenant FK (mirrors ux_classes_id_organization).
-- Must exist before the assignments table references it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_teachers_id_organization ON teachers (id, organization_id);

CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  teacher_id UUID NOT NULL,
  class_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  curriculum_node_id UUID REFERENCES curriculum_nodes (id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assignments_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assignments_teacher_org_fk FOREIGN KEY (teacher_id, organization_id)
    REFERENCES teachers (id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assignments_class_org_fk FOREIGN KEY (class_id, organization_id)
    REFERENCES classes (id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assignments_class_subject_fk FOREIGN KEY (organization_id, class_id, subject_id)
    REFERENCES class_subjects (organization_id, class_id, subject_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT assignments_title_check CHECK (length(trim(title)) > 0),
  CONSTRAINT assignments_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'CLOSED'))
);

CREATE INDEX IF NOT EXISTS idx_assignments_organization_id ON assignments (organization_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class_id ON assignments (class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_subject_id ON assignments (subject_id);
CREATE INDEX IF NOT EXISTS idx_assignments_teacher_id ON assignments (teacher_id);
CREATE INDEX IF NOT EXISTS idx_assignments_curriculum_node_id ON assignments (curriculum_node_id);
CREATE INDEX IF NOT EXISTS idx_assignments_org_status ON assignments (organization_id, status);

COMMIT;
