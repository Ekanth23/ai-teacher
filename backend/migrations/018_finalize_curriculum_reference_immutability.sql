BEGIN;

CREATE OR REPLACE FUNCTION reject_published_curriculum_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_dataset_status TEXT;
  dataset_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'curriculum_structures' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
      SELECT d.status
        INTO old_dataset_status
        FROM curriculum_reference_datasets d
        WHERE d.id = OLD.reference_dataset_id;
    END IF;

    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      SELECT d.status
        INTO dataset_status
        FROM curriculum_reference_datasets d
        WHERE d.id = NEW.reference_dataset_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'curriculum_nodes' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
      SELECT d.status
        INTO old_dataset_status
        FROM curriculum_structures s
        JOIN curriculum_reference_datasets d ON d.id = s.reference_dataset_id
       WHERE s.id = OLD.curriculum_structure_id;
    END IF;

    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      SELECT d.status
        INTO dataset_status
        FROM curriculum_structures s
        JOIN curriculum_reference_datasets d ON d.id = s.reference_dataset_id
       WHERE s.id = NEW.curriculum_structure_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'learning_elements' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
      SELECT d.status
        INTO old_dataset_status
        FROM curriculum_nodes n
        JOIN curriculum_structures s ON s.id = n.curriculum_structure_id
        JOIN curriculum_reference_datasets d ON d.id = s.reference_dataset_id
       WHERE n.id = OLD.curriculum_node_id;
    END IF;

    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      SELECT d.status
        INTO dataset_status
        FROM curriculum_nodes n
        JOIN curriculum_structures s ON s.id = n.curriculum_structure_id
        JOIN curriculum_reference_datasets d ON d.id = s.reference_dataset_id
       WHERE n.id = NEW.curriculum_node_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'curriculum_node_knowledge_items' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
      SELECT d.status
        INTO old_dataset_status
        FROM curriculum_nodes n
        JOIN curriculum_structures s ON s.id = n.curriculum_structure_id
        JOIN curriculum_reference_datasets d ON d.id = s.reference_dataset_id
       WHERE n.id = OLD.curriculum_node_id;
    END IF;

    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      SELECT d.status
        INTO dataset_status
        FROM curriculum_nodes n
        JOIN curriculum_structures s ON s.id = n.curriculum_structure_id
        JOIN curriculum_reference_datasets d ON d.id = s.reference_dataset_id
       WHERE n.id = NEW.curriculum_node_id;
    END IF;
  END IF;

  IF old_dataset_status IN ('PUBLISHED', 'RETIRED')
     OR dataset_status IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'Published or retired curriculum content is immutable';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS curriculum_structures_immutable ON curriculum_structures;
CREATE TRIGGER curriculum_structures_immutable
BEFORE INSERT OR UPDATE OR DELETE ON curriculum_structures
FOR EACH ROW EXECUTE FUNCTION reject_published_curriculum_content();

DROP TRIGGER IF EXISTS curriculum_nodes_immutable ON curriculum_nodes;
CREATE TRIGGER curriculum_nodes_immutable
BEFORE INSERT OR UPDATE OR DELETE ON curriculum_nodes
FOR EACH ROW EXECUTE FUNCTION reject_published_curriculum_content();

DROP TRIGGER IF EXISTS learning_elements_immutable ON learning_elements;
CREATE TRIGGER learning_elements_immutable
BEFORE INSERT OR UPDATE OR DELETE ON learning_elements
FOR EACH ROW EXECUTE FUNCTION reject_published_curriculum_content();

DROP TRIGGER IF EXISTS curriculum_node_knowledge_items_immutable ON curriculum_node_knowledge_items;
CREATE TRIGGER curriculum_node_knowledge_items_immutable
BEFORE INSERT OR UPDATE OR DELETE ON curriculum_node_knowledge_items
FOR EACH ROW EXECUTE FUNCTION reject_published_curriculum_content();

COMMIT;
