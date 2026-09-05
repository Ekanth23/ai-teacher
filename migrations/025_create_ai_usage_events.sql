-- Migration 025: Persistent AI usage events.
--
-- Records every AI generation (success or failure) with tenant, student,
-- user, feature, provider/model, token usage, latency, and estimated cost.
-- This is the measurement foundation for future plan allowances, credits,
-- institution limits, and profitability controls.

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  student_id UUID,
  user_id UUID,
  conversation_id UUID,
  feature VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(255) NOT NULL,
  request_id VARCHAR(255),
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  estimated_cost NUMERIC(18, 8),
  status VARCHAR(20) NOT NULL,
  error_category VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_usage_events_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE SET NULL,
  CONSTRAINT ai_usage_events_student_fk FOREIGN KEY (student_id)
    REFERENCES students_v2 (id)
    ON DELETE SET NULL,
  CONSTRAINT ai_usage_events_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE SET NULL,
  CONSTRAINT ai_usage_events_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES ai_conversations (id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_organization_id ON ai_usage_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_student_id ON ai_usage_events (student_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_feature ON ai_usage_events (feature);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_provider_model ON ai_usage_events (provider, model);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at ON ai_usage_events (created_at);
