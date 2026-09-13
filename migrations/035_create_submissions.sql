-- Migration 035: US-065 — Student submits assignment
--
-- Introduces the submissions table for a student's submitted work against an
-- assignment. Tenant integrity is enforced structurally via composite foreign
-- keys mirroring the assignments table:
--   * (assignment_id, organization_id) -> assignments(id, organization_id)
--   * (student_id, organization_id)   -> students_v2(id, organization_id)
-- A submission therefore cannot be persisted for an assignment or student from
-- another organization. One submission per (organization, assignment, student)
-- is enforced by a unique index.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ux_assignments_id_organization ON assignments (id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_students_v2_id_organization ON students_v2 (id, organization_id);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  student_id UUID NOT NULL,
  content TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT submissions_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT submissions_assignment_org_fk FOREIGN KEY (assignment_id, organization_id)
    REFERENCES assignments (id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT submissions_student_org_fk FOREIGN KEY (student_id, organization_id)
    REFERENCES students_v2 (id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT submissions_content_check CHECK (length(trim(content)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_submissions_org_assignment_student ON submissions (organization_id, assignment_id, student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON submissions (assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student_id ON submissions (student_id);

COMMIT;
