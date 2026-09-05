BEGIN;

-- Organization-owned learning resources (PDFs, notes, worksheets, question banks, mock tests, etc.)
-- linked optionally to a curriculum chapter/topic node and/or a class for scoped visibility.
CREATE TABLE IF NOT EXISTS learning_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  curriculum_node_id UUID REFERENCES curriculum_nodes(id) ON DELETE SET NULL,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  resource_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  language_code VARCHAR(32),
  file_url TEXT NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(150),
  file_size_bytes BIGINT,
  visibility VARCHAR(20) NOT NULL DEFAULT 'ORGANIZATION',
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_resources_class_org_fk FOREIGN KEY (class_id, organization_id)
    REFERENCES classes (id, organization_id),
  CONSTRAINT learning_resources_resource_type_check CHECK (resource_type IN (
    'TEXTBOOK', 'TEACHER_NOTES', 'WORKSHEET', 'ASSIGNMENT', 'QUESTION_BANK',
    'PREVIOUS_YEAR_PAPER', 'MOCK_TEST', 'SYLLABUS_DOCUMENT', 'FORMULA_SHEET', 'OTHER'
  )),
  CONSTRAINT learning_resources_visibility_check CHECK (visibility IN ('ORGANIZATION', 'CLASS', 'PRIVATE')),
  CONSTRAINT learning_resources_status_check CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'ARCHIVED')),
  CONSTRAINT learning_resources_title_check CHECK (length(trim(title)) > 0),
  CONSTRAINT learning_resources_file_url_check CHECK (length(trim(file_url)) > 0),
  CONSTRAINT learning_resources_visibility_class_check CHECK (visibility <> 'CLASS' OR class_id IS NOT NULL),
  CONSTRAINT learning_resources_file_size_check CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_learning_resources_organization_id ON learning_resources (organization_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_curriculum_node_id ON learning_resources (curriculum_node_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_class_id ON learning_resources (class_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_org_status ON learning_resources (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_learning_resources_created_by_user_id ON learning_resources (created_by_user_id);

COMMIT;
