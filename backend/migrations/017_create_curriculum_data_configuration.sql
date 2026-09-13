BEGIN;

CREATE TABLE IF NOT EXISTS languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL, status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT languages_code_not_blank CHECK (length(trim(code)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_languages_code ON languages (lower(code));

CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(32) NOT NULL, name VARCHAR(120) NOT NULL,
  start_date DATE NOT NULL, end_date DATE NOT NULL, status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT academic_years_dates CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_academic_years_code ON academic_years (lower(code));

CREATE TABLE IF NOT EXISTS examination_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(32) NOT NULL, name VARCHAR(120) NOT NULL,
  year_value INTEGER NOT NULL, status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_examination_years_code ON examination_years (lower(code));

CREATE TABLE IF NOT EXISTS curriculum_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), board_id UUID NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE RESTRICT,
  examination_year_id UUID REFERENCES examination_years(id) ON DELETE RESTRICT,
  version VARCHAR(100) NOT NULL, effective_from DATE, effective_to DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_versions_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_curriculum_versions_board_version ON curriculum_versions(board_id, lower(version));
CREATE UNIQUE INDEX IF NOT EXISTS ux_curriculum_versions_id_board ON curriculum_versions(id, board_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_versions_board_status ON curriculum_versions(board_id,status);

CREATE TABLE IF NOT EXISTS curriculum_reference_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_version_id UUID NOT NULL REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  dataset_code VARCHAR(120) NOT NULL, dataset_version VARCHAR(80) NOT NULL,
  source_name VARCHAR(255) NOT NULL, source_uri TEXT, citation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum VARCHAR(255) NOT NULL, loaded_at TIMESTAMPTZ, status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_reference_datasets_status CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','RETIRED')),
  CONSTRAINT curriculum_reference_datasets_identity CHECK (length(trim(dataset_code)) > 0 AND length(trim(dataset_version)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reference_datasets_identity ON curriculum_reference_datasets(curriculum_version_id,lower(dataset_code),lower(dataset_version));

ALTER TABLE syllabus_versions ADD COLUMN IF NOT EXISTS curriculum_version_id UUID;
ALTER TABLE syllabus_versions ADD COLUMN IF NOT EXISTS board_id UUID;
UPDATE syllabus_versions sv SET board_id = s.board_id FROM syllabi s WHERE s.id=sv.syllabus_id AND sv.board_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_syllabi_id_board ON syllabi(id, board_id);
ALTER TABLE syllabus_versions ADD CONSTRAINT syllabus_versions_board_fk FOREIGN KEY (curriculum_version_id, board_id) REFERENCES curriculum_versions(id, board_id);
ALTER TABLE syllabus_versions ADD CONSTRAINT syllabus_versions_board_matches_syllabus_fk FOREIGN KEY (syllabus_id, board_id) REFERENCES syllabi(id, board_id);
CREATE INDEX IF NOT EXISTS idx_syllabus_versions_curriculum_version ON syllabus_versions(curriculum_version_id);

CREATE TABLE IF NOT EXISTS syllabus_languages (
  syllabus_id UUID NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
  language_id UUID NOT NULL REFERENCES languages(id) ON DELETE RESTRICT,
  language_role VARCHAR(30) NOT NULL DEFAULT 'CONTENT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(syllabus_id,language_id,language_role)
);

ALTER TABLE curriculum_structures ADD COLUMN IF NOT EXISTS reference_dataset_id UUID REFERENCES curriculum_reference_datasets(id) ON DELETE RESTRICT;
ALTER TABLE curriculum_structures ADD COLUMN IF NOT EXISTS structure_key VARCHAR(160);
ALTER TABLE curriculum_nodes ADD COLUMN IF NOT EXISTS node_key VARCHAR(160);
ALTER TABLE learning_elements ADD COLUMN IF NOT EXISTS element_key VARCHAR(160);
ALTER TABLE syllabus_versions ADD COLUMN IF NOT EXISTS source_reference_dataset_id UUID REFERENCES curriculum_reference_datasets(id) ON DELETE RESTRICT;
ALTER TABLE curriculum_structures ADD CONSTRAINT curriculum_structures_scope_check CHECK (
 (syllabus_version_id IS NOT NULL AND reference_dataset_id IS NULL) OR
 (syllabus_version_id IS NULL AND reference_dataset_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reference_structures_key ON curriculum_structures(reference_dataset_id,lower(structure_key)) WHERE reference_dataset_id IS NOT NULL AND structure_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_reference_nodes_key ON curriculum_nodes(curriculum_structure_id,lower(node_key)) WHERE node_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_reference_elements_key ON learning_elements(curriculum_node_id,lower(element_key)) WHERE element_key IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_published_curriculum_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dataset_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'curriculum_reference_datasets' THEN
    IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' AND OLD.status IN ('PUBLISHED','RETIRED') THEN RAISE EXCEPTION 'Published or retired reference dataset is immutable'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('PUBLISHED','RETIRED') AND (NEW.curriculum_version_id,NEW.dataset_code,NEW.dataset_version,NEW.checksum,NEW.source_name) IS DISTINCT FROM
       (OLD.curriculum_version_id,OLD.dataset_code,OLD.dataset_version,OLD.checksum,OLD.source_name) THEN
      RAISE EXCEPTION 'Published or retired reference dataset content is immutable';
    END IF;
    RETURN COALESCE(NEW,OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME='curriculum_structures' THEN
      SELECT status INTO dataset_status FROM curriculum_reference_datasets WHERE id=NEW.reference_dataset_id;
    ELSIF TG_TABLE_NAME='curriculum_nodes' THEN
      SELECT d.status INTO dataset_status FROM curriculum_structures s JOIN curriculum_reference_datasets d ON d.id=s.reference_dataset_id WHERE s.id=NEW.curriculum_structure_id;
    ELSIF TG_TABLE_NAME='learning_elements' THEN
      SELECT d.status INTO dataset_status FROM curriculum_nodes n JOIN curriculum_structures s ON s.id=n.curriculum_structure_id JOIN curriculum_reference_datasets d ON d.id=s.reference_dataset_id WHERE n.id=NEW.curriculum_node_id;
    ELSIF TG_TABLE_NAME='curriculum_node_knowledge_items' THEN
      SELECT d.status INTO dataset_status FROM curriculum_nodes n JOIN curriculum_structures s ON s.id=n.curriculum_structure_id JOIN curriculum_reference_datasets d ON d.id=s.reference_dataset_id WHERE n.id=NEW.curriculum_node_id;
    END IF;
    IF dataset_status IN ('PUBLISHED','RETIRED') THEN RAISE EXCEPTION 'Published or retired curriculum content is immutable'; END IF;
    RETURN NEW;
  END IF;
  SELECT d.status INTO dataset_status FROM curriculum_reference_datasets d
    LEFT JOIN curriculum_structures s ON s.reference_dataset_id=d.id
    LEFT JOIN curriculum_nodes n ON n.curriculum_structure_id=s.id
    LEFT JOIN learning_elements e ON e.curriculum_node_id=n.id
   WHERE (TG_TABLE_NAME='curriculum_structures' AND d.id=OLD.reference_dataset_id)
      OR (TG_TABLE_NAME='curriculum_nodes' AND s.id=OLD.curriculum_structure_id)
      OR (TG_TABLE_NAME='learning_elements' AND n.id=OLD.curriculum_node_id)
      OR (TG_TABLE_NAME='curriculum_node_knowledge_items' AND n.id=OLD.curriculum_node_id) LIMIT 1;
  IF dataset_status IN ('PUBLISHED','RETIRED') THEN RAISE EXCEPTION 'Published or retired curriculum content is immutable'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS curriculum_reference_datasets_immutable ON curriculum_reference_datasets;
CREATE TRIGGER curriculum_reference_datasets_immutable BEFORE UPDATE OR DELETE ON curriculum_reference_datasets FOR EACH ROW EXECUTE FUNCTION reject_published_curriculum_content();
DROP TRIGGER IF EXISTS curriculum_structures_immutable ON curriculum_structures;
CREATE TRIGGER curriculum_structures_immutable BEFORE INSERT OR UPDATE OR DELETE ON curriculum_structures FOR EACH ROW EXECUTE FUNCTION reject_published_curriculum_content();
DROP TRIGGER IF EXISTS curriculum_nodes_immutable ON curriculum_nodes;
CREATE TRIGGER curriculum_nodes_immutable BEFORE INSERT OR UPDATE OR DELETE ON curriculum_nodes FOR EACH ROW EXECUTE FUNCTION reject_published_curriculum_content();
DROP TRIGGER IF EXISTS learning_elements_immutable ON learning_elements;
CREATE TRIGGER learning_elements_immutable BEFORE INSERT OR UPDATE OR DELETE ON learning_elements FOR EACH ROW EXECUTE FUNCTION reject_published_curriculum_content();
DROP TRIGGER IF EXISTS curriculum_node_knowledge_items_immutable ON curriculum_node_knowledge_items;
CREATE TRIGGER curriculum_node_knowledge_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON curriculum_node_knowledge_items FOR EACH ROW EXECUTE FUNCTION reject_published_curriculum_content();

INSERT INTO languages(code,name) VALUES ('EN','English'),('TA','Tamil'),('HI','Hindi') ON CONFLICT (lower(code)) DO NOTHING;
COMMIT;
