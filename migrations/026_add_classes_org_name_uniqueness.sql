-- Migration 026: enforce organization-level class/grade name uniqueness
-- Mirrors the subject catalog rule (ux_subjects_org_name) so that a class/grade
-- name is unique within its organization, case-insensitively.

CREATE UNIQUE INDEX IF NOT EXISTS ux_classes_org_name ON classes (organization_id, lower(name));
