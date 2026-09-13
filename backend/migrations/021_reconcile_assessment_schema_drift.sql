BEGIN;

DO $$
DECLARE
  event_legacy_rows BIGINT;
  portion_legacy_rows BIGINT;
BEGIN
  event_legacy_rows := 0;
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'assessment_events'
       AND column_name = 'syllabus_version_id'
  ) OR EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'assessment_events'
       AND column_name = 'curriculum_version_id'
  ) THEN
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_name = 'assessment_events'
         AND column_name = 'syllabus_version_id'
    ) AND EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_name = 'assessment_events'
         AND column_name = 'curriculum_version_id'
    ) THEN
      EXECUTE
        'SELECT count(*) FROM assessment_events
          WHERE syllabus_version_id IS NOT NULL
             OR curriculum_version_id IS NOT NULL'
        INTO event_legacy_rows;
    ELSIF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_name = 'assessment_events'
         AND column_name = 'syllabus_version_id'
    ) THEN
      EXECUTE
        'SELECT count(*) FROM assessment_events
          WHERE syllabus_version_id IS NOT NULL'
        INTO event_legacy_rows;
    ELSE
      EXECUTE
        'SELECT count(*) FROM assessment_events
          WHERE curriculum_version_id IS NOT NULL'
        INTO event_legacy_rows;
    END IF;
  END IF;

  IF event_legacy_rows <> 0 THEN
    RAISE EXCEPTION
      'Cannot reconcile assessment schema: % assessment event rows contain legacy curriculum references',
      event_legacy_rows;
  END IF;

  portion_legacy_rows := 0;
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'assessment_event_curriculum_portions'
       AND column_name = 'syllabus_version_id'
  ) OR EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'assessment_event_curriculum_portions'
       AND column_name = 'curriculum_version_id'
  ) OR EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'assessment_event_curriculum_portions'
       AND column_name = 'reference_dataset_id'
  ) THEN
    EXECUTE
      'SELECT count(*) FROM assessment_event_curriculum_portions
        WHERE ' ||
        CASE WHEN EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'assessment_event_curriculum_portions'
             AND column_name = 'syllabus_version_id'
        ) THEN 'syllabus_version_id IS NOT NULL' ELSE 'FALSE' END ||
        ' OR ' ||
        CASE WHEN EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'assessment_event_curriculum_portions'
             AND column_name = 'curriculum_version_id'
        ) THEN 'curriculum_version_id IS NOT NULL' ELSE 'FALSE' END ||
        ' OR ' ||
        CASE WHEN EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'assessment_event_curriculum_portions'
             AND column_name = 'reference_dataset_id'
        ) THEN 'reference_dataset_id IS NOT NULL' ELSE 'FALSE' END
      INTO portion_legacy_rows;
  END IF;

  IF portion_legacy_rows <> 0 THEN
    RAISE EXCEPTION
      'Cannot reconcile assessment schema: % assessment portion rows contain legacy curriculum references',
      portion_legacy_rows;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS assessment_event_portions_scope_validation
  ON assessment_event_curriculum_portions;

DO $$
DECLARE
  portion_scope_function OID;
  remaining_trigger_count INTEGER;
  remaining_dependency_count INTEGER;
BEGIN
  SELECT p.oid
    INTO portion_scope_function
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'validate_assessment_event_portion_scope'
     AND pg_get_function_identity_arguments(p.oid) = '';

  IF portion_scope_function IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO remaining_trigger_count
    FROM pg_trigger
   WHERE tgfoid = portion_scope_function
     AND NOT tgisinternal;

  IF remaining_trigger_count <> 0 THEN
    RAISE EXCEPTION
      'Cannot remove validate_assessment_event_portion_scope(): % trigger dependencies remain',
      remaining_trigger_count;
  END IF;

  SELECT count(*)
    INTO remaining_dependency_count
    FROM pg_depend d
   WHERE d.refobjid = portion_scope_function
     AND NOT (
       d.classid = 'pg_class'::regclass
       AND EXISTS (
         SELECT 1
           FROM pg_trigger t
          WHERE t.oid = d.objid
       )
     );

  IF remaining_dependency_count <> 0 THEN
    RAISE EXCEPTION
      'Cannot remove validate_assessment_event_portion_scope(): % dependencies remain',
      remaining_dependency_count;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.validate_assessment_event_portion_scope();

ALTER TABLE assessment_events
  DROP CONSTRAINT IF EXISTS assessment_events_syllabus_curriculum_fk,
  DROP CONSTRAINT IF EXISTS assessment_events_curriculum_year_fk,
  DROP CONSTRAINT IF EXISTS assessment_events_context_check;

DROP INDEX IF EXISTS ux_assessment_events_id_context;

ALTER TABLE assessment_events
  DROP COLUMN IF EXISTS syllabus_version_id,
  DROP COLUMN IF EXISTS curriculum_version_id;

ALTER TABLE assessment_event_curriculum_portions
  DROP CONSTRAINT IF EXISTS assessment_event_portions_dataset_curriculum_fk,
  DROP CONSTRAINT IF EXISTS assessment_event_portions_structure_scope_fk,
  DROP CONSTRAINT IF EXISTS assessment_event_portions_syllabus_curriculum_fk,
  DROP CONSTRAINT IF EXISTS assessment_event_portions_context_check;

ALTER TABLE assessment_event_curriculum_portions
  DROP COLUMN IF EXISTS syllabus_version_id,
  DROP COLUMN IF EXISTS curriculum_version_id,
  DROP COLUMN IF EXISTS reference_dataset_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'assessment_event_curriculum_portions'::regclass
       AND conname = 'assessment_event_portions_event_fk'
  ) THEN
    ALTER TABLE assessment_event_curriculum_portions
      ADD CONSTRAINT assessment_event_portions_event_fk
      FOREIGN KEY (assessment_event_id)
      REFERENCES assessment_events(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'assessment_event_curriculum_portions'::regclass
       AND conname = 'assessment_event_portions_node_structure_fk'
  ) THEN
    ALTER TABLE assessment_event_curriculum_portions
      ADD CONSTRAINT assessment_event_portions_node_structure_fk
      FOREIGN KEY (curriculum_node_id, curriculum_structure_id)
      REFERENCES curriculum_nodes (id, curriculum_structure_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'assessment_event_curriculum_portions'::regclass
       AND conname = 'assessment_event_portions_source_check'
  ) THEN
    ALTER TABLE assessment_event_curriculum_portions
      ADD CONSTRAINT assessment_event_portions_source_check
      CHECK (length(trim(source_type)) > 0);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_event_portions_identity
  ON assessment_event_curriculum_portions
    (assessment_event_id, curriculum_structure_id, curriculum_node_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_event_portions_whole_structure
  ON assessment_event_curriculum_portions
    (assessment_event_id, curriculum_structure_id)
  WHERE curriculum_node_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_assessment_event_portions_event
  ON assessment_event_curriculum_portions (assessment_event_id);

CREATE INDEX IF NOT EXISTS idx_assessment_event_portions_structure_node
  ON assessment_event_curriculum_portions (curriculum_structure_id, curriculum_node_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'assessment_events'
       AND column_name IN ('syllabus_version_id', 'curriculum_version_id')
  ) THEN
    RAISE EXCEPTION 'Assessment event legacy columns remain after reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'assessment_event_curriculum_portions'
       AND column_name IN ('syllabus_version_id', 'curriculum_version_id', 'reference_dataset_id')
  ) THEN
    RAISE EXCEPTION 'Assessment portion legacy columns remain after reconciliation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'assessment_events'::regclass
       AND tgname = 'assessment_events_scope_validation'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Intended assessment_events_scope_validation trigger is missing';
  END IF;
END;
$$;

COMMIT;
