-- Migration 039: Phase 1 Practice & Question Definition — practices
--
-- Establishes the practices table as the canonical model for a Phase 1
-- self-directed practice / quiz / self-assessment activity. A practice is
-- organization-scoped, is authored by a user, and is always attached to a
-- curriculum TOPIC node (a practice must never exist detached from a topic).
--
-- Tenant isolation is enforced structurally:
--   * organization_id          -> organizations(id)
--   * created_by_user_id       -> users(id)
--   * curriculum_node_id       -> curriculum_nodes(id)  (TOPIC, validated in service)

BEGIN;

CREATE TABLE IF NOT EXISTS practices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  curriculum_node_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  practice_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT practices_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT practices_curriculum_node_fk FOREIGN KEY (curriculum_node_id)
    REFERENCES curriculum_nodes (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT practices_created_by_fk FOREIGN KEY (created_by_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT practices_practice_type_check CHECK (practice_type IN ('PRACTICE', 'QUIZ', 'SELF_ASSESSMENT')),
  CONSTRAINT practices_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  CONSTRAINT practices_title_check CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_practices_organization_id ON practices (organization_id);
CREATE INDEX IF NOT EXISTS idx_practices_curriculum_node_id ON practices (curriculum_node_id);
CREATE INDEX IF NOT EXISTS idx_practices_status ON practices (status);
CREATE INDEX IF NOT EXISTS idx_practices_org_node ON practices (organization_id, curriculum_node_id);

COMMIT;
