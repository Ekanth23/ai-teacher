CREATE TABLE IF NOT EXISTS curriculum_node_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT curriculum_node_types_code_not_blank CHECK (length(trim(code)) > 0),
  CONSTRAINT curriculum_node_types_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_curriculum_node_types_code ON curriculum_node_types (lower(code));

CREATE TABLE IF NOT EXISTS curriculum_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  syllabus_version_id UUID,
  structure_kind VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  reference_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT curriculum_structures_syllabus_version_fk FOREIGN KEY (syllabus_version_id)
    REFERENCES syllabus_versions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT curriculum_structures_kind_check CHECK (structure_kind IN ('SYLLABUS', 'TEXTBOOK')),
  CONSTRAINT curriculum_structures_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_curriculum_structures_syllabus_version_id ON curriculum_structures (syllabus_version_id);

CREATE TABLE IF NOT EXISTS curriculum_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_structure_id UUID NOT NULL,
  parent_node_id UUID,
  node_type_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  code VARCHAR(100),
  sequence_number INTEGER,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT curriculum_nodes_structure_fk FOREIGN KEY (curriculum_structure_id)
    REFERENCES curriculum_structures (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT curriculum_nodes_parent_fk FOREIGN KEY (parent_node_id)
    REFERENCES curriculum_nodes (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT curriculum_nodes_type_fk FOREIGN KEY (node_type_id)
    REFERENCES curriculum_node_types (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT curriculum_nodes_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT curriculum_nodes_sequence_check CHECK (sequence_number IS NULL OR sequence_number >= 0)
);
CREATE INDEX IF NOT EXISTS idx_curriculum_nodes_structure_id ON curriculum_nodes (curriculum_structure_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_nodes_parent_id ON curriculum_nodes (parent_node_id);

CREATE TABLE IF NOT EXISTS learning_element_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT learning_element_types_code_not_blank CHECK (length(trim(code)) > 0),
  CONSTRAINT learning_element_types_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_learning_element_types_code ON learning_element_types (lower(code));

CREATE TABLE IF NOT EXISTS learning_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_node_id UUID NOT NULL,
  element_type_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT learning_elements_node_fk FOREIGN KEY (curriculum_node_id)
    REFERENCES curriculum_nodes (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT learning_elements_type_fk FOREIGN KEY (element_type_id)
    REFERENCES learning_element_types (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT learning_elements_title_not_blank CHECK (length(trim(title)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_learning_elements_node_id ON learning_elements (curriculum_node_id);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(50) NOT NULL,
  code VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  expected_mastery NUMERIC,
  depth NUMERIC,
  complexity NUMERIC,
  difficulty NUMERIC,
  application_level NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT knowledge_items_kind_check CHECK (kind IN ('CONCEPT', 'SKILL', 'COMPETENCY', 'LEARNING_OUTCOME')),
  CONSTRAINT knowledge_items_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_knowledge_items_code ON knowledge_items (lower(code)) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_item_prerequisites (
  knowledge_item_id UUID NOT NULL,
  prerequisite_knowledge_item_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (knowledge_item_id, prerequisite_knowledge_item_id),
  CONSTRAINT knowledge_item_prerequisites_item_fk FOREIGN KEY (knowledge_item_id)
    REFERENCES knowledge_items (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT knowledge_item_prerequisites_prerequisite_fk FOREIGN KEY (prerequisite_knowledge_item_id)
    REFERENCES knowledge_items (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT knowledge_item_prerequisites_not_self CHECK (knowledge_item_id <> prerequisite_knowledge_item_id)
);

CREATE TABLE IF NOT EXISTS knowledge_item_problem_types (
  knowledge_item_id UUID NOT NULL,
  problem_type VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (knowledge_item_id, problem_type),
  CONSTRAINT knowledge_item_problem_types_item_fk FOREIGN KEY (knowledge_item_id)
    REFERENCES knowledge_items (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT knowledge_item_problem_types_not_blank CHECK (length(trim(problem_type)) > 0)
);

CREATE TABLE IF NOT EXISTS curriculum_node_knowledge_items (
  curriculum_node_id UUID NOT NULL,
  knowledge_item_id UUID NOT NULL,
  coverage_level VARCHAR(50) NOT NULL DEFAULT 'PARTIAL',
  depth NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (curriculum_node_id, knowledge_item_id),
  CONSTRAINT curriculum_node_knowledge_items_node_fk FOREIGN KEY (curriculum_node_id)
    REFERENCES curriculum_nodes (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT curriculum_node_knowledge_items_item_fk FOREIGN KEY (knowledge_item_id)
    REFERENCES knowledge_items (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS target_pathways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  pathway_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT target_pathways_code_not_blank CHECK (length(trim(code)) > 0),
  CONSTRAINT target_pathways_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_target_pathways_code ON target_pathways (lower(code));

CREATE TABLE IF NOT EXISTS target_pathway_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_pathway_id UUID NOT NULL,
  code VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  version VARCHAR(100) NOT NULL,
  variant_code VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT target_pathway_versions_pathway_fk FOREIGN KEY (target_pathway_id)
    REFERENCES target_pathways (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT target_pathway_versions_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT target_pathway_versions_version_not_blank CHECK (length(trim(version)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_target_pathway_versions_pathway_version
  ON target_pathway_versions (target_pathway_id, lower(version), lower(coalesce(variant_code, '')));

CREATE TABLE IF NOT EXISTS target_pathway_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_pathway_version_id UUID NOT NULL,
  code VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  sequence_number INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT target_pathway_stages_version_fk FOREIGN KEY (target_pathway_version_id)
    REFERENCES target_pathway_versions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT target_pathway_stages_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS target_pathway_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_pathway_version_id UUID NOT NULL,
  target_pathway_stage_id UUID,
  knowledge_item_id UUID NOT NULL,
  required_mastery NUMERIC,
  depth NUMERIC,
  complexity NUMERIC,
  difficulty NUMERIC,
  application_level NUMERIC,
  problem_type VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT target_pathway_requirements_version_fk FOREIGN KEY (target_pathway_version_id)
    REFERENCES target_pathway_versions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT target_pathway_requirements_stage_fk FOREIGN KEY (target_pathway_stage_id)
    REFERENCES target_pathway_stages (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT target_pathway_requirements_item_fk FOREIGN KEY (knowledge_item_id)
    REFERENCES knowledge_items (id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_target_pathway_requirements_version_id ON target_pathway_requirements (target_pathway_version_id);

CREATE TABLE IF NOT EXISTS curriculum_mapping_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_syllabus_version_id UUID NOT NULL,
  target_syllabus_version_id UUID,
  target_pathway_version_id UUID,
  target_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT curriculum_mapping_profiles_source_fk FOREIGN KEY (source_syllabus_version_id)
    REFERENCES syllabus_versions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT curriculum_mapping_profiles_target_syllabus_fk FOREIGN KEY (target_syllabus_version_id)
    REFERENCES syllabus_versions (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT curriculum_mapping_profiles_target_pathway_fk FOREIGN KEY (target_pathway_version_id)
    REFERENCES target_pathway_versions (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT curriculum_mapping_profiles_target_type_check CHECK (
    (target_type = 'CURRICULUM' AND target_syllabus_version_id IS NOT NULL AND target_pathway_version_id IS NULL)
    OR
    (target_type = 'PATHWAY' AND target_syllabus_version_id IS NULL AND target_pathway_version_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_curriculum_mapping_profiles_source_id ON curriculum_mapping_profiles (source_syllabus_version_id);

INSERT INTO curriculum_node_types (code, name) VALUES
  ('LEARNING_AREA', 'Learning Area'), ('DOMAIN', 'Domain'), ('UNIT', 'Unit'),
  ('THEME', 'Theme'), ('MODULE', 'Module'), ('CHAPTER', 'Chapter'),
  ('SECTION', 'Section'), ('SUBSECTION', 'Subsection'), ('TOPIC', 'Topic'),
  ('SUBTOPIC', 'Subtopic'), ('TERM', 'Term'), ('OTHER', 'Other')
ON CONFLICT (lower(code)) DO NOTHING;

INSERT INTO learning_element_types (code, name) VALUES
  ('EXAMPLE', 'Example'), ('ACTIVITY', 'Activity'), ('EXPERIMENT', 'Experiment'),
  ('FIGURE', 'Figure'), ('DIAGRAM', 'Diagram'), ('TABLE', 'Table'),
  ('READING', 'Reading'), ('POEM', 'Poem'), ('SONG', 'Song'), ('LISTENING', 'Listening'),
  ('SPEAKING', 'Speaking'), ('WRITING', 'Writing'), ('DISCUSSION', 'Discussion'),
  ('EXPLORATION', 'Exploration'), ('PROJECT', 'Project'), ('REFLECTION', 'Reflection'),
  ('EXERCISE', 'Exercise'), ('PRACTICE', 'Practice'), ('REVIEW', 'Review'),
  ('SUMMARY', 'Summary'), ('KEYWORDS', 'Keywords'), ('COMPETENCY_ACTIVITY', 'Competency Activity'),
  ('APPLICATION_ACTIVITY', 'Application Activity')
ON CONFLICT (lower(code)) DO NOTHING;
