-- Migration 030: principal/administrator custom report definitions
--
-- A reusable, organization-scoped report definition. The Principal/administrator
-- customizes a report (scope, filters, metrics, grouping, sorting, date range)
-- and the configuration is stored as JSONB so it can evolve without schema churn.
-- The definition holds NO aggregated academic data: metrics are always derived
-- at read time from the canonical domain tables.

CREATE TABLE IF NOT EXISTS report_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_definitions_name_check CHECK (length(trim(name)) > 0),
  CONSTRAINT report_definitions_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- A report name is unique within its organization (not globally).
CREATE UNIQUE INDEX IF NOT EXISTS ux_report_definitions_org_name
  ON report_definitions (organization_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_report_definitions_organization_id
  ON report_definitions (organization_id);
CREATE INDEX IF NOT EXISTS idx_report_definitions_created_by
  ON report_definitions (created_by_user_id);
