BEGIN;

CREATE OR REPLACE FUNCTION enforce_curriculum_reference_dataset_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'Published or retired reference dataset is immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> NEW.status
     AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'VALIDATED')
       OR (OLD.status = 'VALIDATED' AND NEW.status = 'PUBLISHED')
       OR (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')
     ) THEN
    RAISE EXCEPTION 'Invalid curriculum reference dataset lifecycle transition: % -> %',
      OLD.status, NEW.status;
  END IF;

  IF OLD.status IN ('PUBLISHED', 'RETIRED')
     AND (
       NEW.curriculum_version_id IS DISTINCT FROM OLD.curriculum_version_id
       OR NEW.dataset_code IS DISTINCT FROM OLD.dataset_code
       OR NEW.dataset_version IS DISTINCT FROM OLD.dataset_version
       OR NEW.checksum IS DISTINCT FROM OLD.checksum
       OR NEW.source_name IS DISTINCT FROM OLD.source_name
       OR NEW.source_uri IS DISTINCT FROM OLD.source_uri
       OR NEW.citation_metadata IS DISTINCT FROM OLD.citation_metadata
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
     ) THEN
    RAISE EXCEPTION 'Published or retired reference dataset metadata is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS curriculum_reference_datasets_lifecycle
  ON curriculum_reference_datasets;
CREATE TRIGGER curriculum_reference_datasets_lifecycle
BEFORE UPDATE OR DELETE ON curriculum_reference_datasets
FOR EACH ROW EXECUTE FUNCTION enforce_curriculum_reference_dataset_lifecycle();

COMMIT;
