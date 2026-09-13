-- Migration 032: US-032 — Subject lifecycle & class-subject mapping integrity
--
-- 1. Subject status lifecycle constraint (ACTIVE / INACTIVE).
-- 2. class_subjects lifecycle: add status + updated_at so a mapping can be
--    deactivated (soft) rather than physically deleted. The mapping row is
--    preserved (a single (org, class, subject) row whose status flips between
--    ACTIVE / INACTIVE), which keeps the composite FK from assessment_events
--    (`assessment_events_subject_class_fk`) intact and preserves history.
--
-- The existing unique index ux_class_subjects_org_class_subject is RETAINED
-- (it backs the assessment_events FK and prevents duplicate mapping rows).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Subject status lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE subjects
  DROP CONSTRAINT IF EXISTS subjects_status_check;
ALTER TABLE subjects
  ADD CONSTRAINT subjects_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'));

-- ---------------------------------------------------------------------------
-- 2. class_subjects lifecycle (soft-delete via status flip)
-- ---------------------------------------------------------------------------
ALTER TABLE class_subjects
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE class_subjects
  DROP CONSTRAINT IF EXISTS class_subjects_status_check;
ALTER TABLE class_subjects
  ADD CONSTRAINT class_subjects_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'));

COMMIT;
