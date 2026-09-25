-- Migration 046: Student AI Teacher conversation foundation.
--
-- This migration is additive. Migration 024 remains the source of the
-- original conversation/message tables and migration 025 remains the source
-- of the existing usage-event semantics. The additions below provide the
-- lifecycle, branch, attempt, and feedback relationships required by US-117.
-- They do not create an AI learning profile or change academic data.

-- Composite keys let the new relationships prove that the student belongs to
-- the same organization as the conversation. Migration 035 already creates
-- the students_v2(id, organization_id) key used by the composite FK below.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_conversations_id_organization_student
  ON ai_conversations (id, organization_id, student_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_students_v2_id_user_organization
  ON students_v2 (id, user_id, organization_id);

ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
  ADD COLUMN IF NOT EXISTS title_source VARCHAR(20) NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS active_branch_id UUID,
  ADD COLUMN IF NOT EXISTS scope_board VARCHAR(255),
  ADD COLUMN IF NOT EXISTS scope_class VARCHAR(255),
  ADD COLUMN IF NOT EXISTS scope_chapter VARCHAR(255),
  ADD COLUMN IF NOT EXISTS scope_language VARCHAR(100),
  ADD COLUMN IF NOT EXISTS scope_medium VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversations_title_source_check'
  ) THEN
    ALTER TABLE ai_conversations
      ADD CONSTRAINT ai_conversations_title_source_check
      CHECK (title_source IN ('DEFAULT', 'GENERATED', 'RENAMED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversations_student_organization_fk'
  ) THEN
    ALTER TABLE ai_conversations
      ADD CONSTRAINT ai_conversations_student_organization_fk
      FOREIGN KEY (student_id, organization_id)
      REFERENCES students_v2 (id, organization_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

END $$;

CREATE INDEX IF NOT EXISTS idx_ai_conversations_active_student_updated
  ON ai_conversations (organization_id, student_id, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_active_branch
  ON ai_conversations (active_branch_id)
  WHERE active_branch_id IS NOT NULL;

-- Message columns are nullable while legacy rows are backfilled. New writes
-- always provide branch, sequence, status, and request relationships.
ALTER TABLE ai_messages
  ADD COLUMN IF NOT EXISTS status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS parent_message_id UUID,
  ADD COLUMN IF NOT EXISTS original_message_id UUID,
  ADD COLUMN IF NOT EXISTS request_message_id UUID,
  ADD COLUMN IF NOT EXISTS sequence_number BIGINT,
  ADD COLUMN IF NOT EXISTS variant_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS generation_attempt_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_messages_id_conversation
  ON ai_messages (id, conversation_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_status_check'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_status_check
      CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_sequence_positive_check'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_sequence_positive_check
      CHECK (sequence_number IS NULL OR sequence_number > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_variant_positive_check'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_variant_positive_check
      CHECK (variant_number > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_parent_fk'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_parent_fk
      FOREIGN KEY (parent_message_id) REFERENCES ai_messages (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_original_fk'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_original_fk
      FOREIGN KEY (original_message_id) REFERENCES ai_messages (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_request_fk'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_request_fk
      FOREIGN KEY (request_message_id) REFERENCES ai_messages (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_parent_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_parent_same_conversation_fk
      FOREIGN KEY (parent_message_id, conversation_id)
      REFERENCES ai_messages (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_original_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_original_same_conversation_fk
      FOREIGN KEY (original_message_id, conversation_id)
      REFERENCES ai_messages (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_request_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_request_same_conversation_fk
      FOREIGN KEY (request_message_id, conversation_id)
      REFERENCES ai_messages (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_branch_sequence
  ON ai_messages (conversation_id, branch_id, sequence_number, variant_number, created_at, id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_request_message
  ON ai_messages (request_message_id, sequence_number, variant_number)
  WHERE request_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_messages_assistant_request_variant
  ON ai_messages (request_message_id, variant_number)
  WHERE role = 'assistant' AND request_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_messages_parent_message
  ON ai_messages (parent_message_id)
  WHERE parent_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_messages_branch_id
  ON ai_messages (branch_id)
  WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_messages_original_message
  ON ai_messages (original_message_id)
  WHERE original_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_messages_generation_attempt
  ON ai_messages (generation_attempt_id)
  WHERE generation_attempt_id IS NOT NULL;

-- A branch is a path through one private conversation, not a second
-- conversation/list entry.
CREATE TABLE IF NOT EXISTS ai_conversation_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  parent_branch_id UUID,
  branch_point_message_id UUID,
  name VARCHAR(255),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_conversation_branches_conversation_fk
    FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_conversation_branches_parent_fk
    FOREIGN KEY (parent_branch_id) REFERENCES ai_conversation_branches (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_conversation_branches_branch_point_fk
    FOREIGN KEY (branch_point_message_id) REFERENCES ai_messages (id)
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_conversation_branches_id_conversation
  ON ai_conversation_branches (id, conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_conversation_branches_primary
  ON ai_conversation_branches (conversation_id)
  WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_ai_conversation_branches_conversation
  ON ai_conversation_branches (conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_ai_conversation_branches_parent
  ON ai_conversation_branches (parent_branch_id)
  WHERE parent_branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_conversation_branches_point
  ON ai_conversation_branches (branch_point_message_id)
  WHERE branch_point_message_id IS NOT NULL;

-- Every pre-046 conversation receives one primary branch. Existing messages
-- are assigned to it and receive a stable per-conversation logical order.
INSERT INTO ai_conversation_branches (conversation_id, is_primary, name)
SELECT c.id, TRUE, 'Primary'
FROM ai_conversations c
WHERE NOT EXISTS (
  SELECT 1 FROM ai_conversation_branches b WHERE b.conversation_id = c.id
);

UPDATE ai_messages m
SET branch_id = b.id
FROM ai_conversation_branches b
WHERE m.branch_id IS NULL
  AND b.conversation_id = m.conversation_id
  AND b.is_primary;

WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY conversation_id
           ORDER BY created_at ASC, id ASC
         ) AS logical_sequence
  FROM ai_messages
)
UPDATE ai_messages m
SET sequence_number = numbered.logical_sequence
FROM numbered
WHERE m.id = numbered.id
  AND m.sequence_number IS NULL;

UPDATE ai_conversations c
SET active_branch_id = b.id
FROM ai_conversation_branches b
WHERE c.active_branch_id IS NULL
  AND b.conversation_id = c.id
  AND b.is_primary;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_branch_fk'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_branch_fk
      FOREIGN KEY (branch_id) REFERENCES ai_conversation_branches (id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_branch_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_branch_same_conversation_fk
      FOREIGN KEY (branch_id, conversation_id)
      REFERENCES ai_conversation_branches (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversations_active_branch_fk'
  ) THEN
    ALTER TABLE ai_conversations
      ADD CONSTRAINT ai_conversations_active_branch_fk
      FOREIGN KEY (active_branch_id) REFERENCES ai_conversation_branches (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversations_active_branch_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_conversations
      ADD CONSTRAINT ai_conversations_active_branch_same_conversation_fk
      FOREIGN KEY (active_branch_id, id)
      REFERENCES ai_conversation_branches (id, conversation_id)
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversation_branches_parent_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_conversation_branches
      ADD CONSTRAINT ai_conversation_branches_parent_same_conversation_fk
      FOREIGN KEY (parent_branch_id, conversation_id)
      REFERENCES ai_conversation_branches (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversation_branches_point_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_conversation_branches
      ADD CONSTRAINT ai_conversation_branches_point_same_conversation_fk
      FOREIGN KEY (branch_point_message_id, conversation_id)
      REFERENCES ai_messages (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Attempts are the durable boundary around each provider generation. The
-- request message remains immutable; retry/regeneration attempts point to it.
CREATE TABLE IF NOT EXISTS ai_generation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  student_id UUID NOT NULL,
  user_id UUID,
  branch_id UUID NOT NULL,
  request_message_id UUID NOT NULL,
  response_message_id UUID,
  attempt_type VARCHAR(20) NOT NULL,
  attempt_number INTEGER NOT NULL,
  retry_of_attempt_id UUID,
  parent_attempt_id UUID,
  status VARCHAR(20) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(255) NOT NULL,
  request_id VARCHAR(255),
  error_category VARCHAR(100),
  usage_event_id UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_generation_attempts_conversation_owner_fk
    FOREIGN KEY (conversation_id, organization_id, student_id)
    REFERENCES ai_conversations (id, organization_id, student_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_generation_attempts_branch_fk
    FOREIGN KEY (branch_id) REFERENCES ai_conversation_branches (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_generation_attempts_request_message_fk
    FOREIGN KEY (request_message_id) REFERENCES ai_messages (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_generation_attempts_response_message_fk
    FOREIGN KEY (response_message_id) REFERENCES ai_messages (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ai_generation_attempts_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT ai_generation_attempts_type_check
    CHECK (attempt_type IN ('ORIGINAL', 'RETRY', 'REGENERATION')),
  CONSTRAINT ai_generation_attempts_status_check
    CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  CONSTRAINT ai_generation_attempts_number_check
    CHECK (attempt_number > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_generation_attempts_id_conversation
  ON ai_generation_attempts (id, conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_generation_attempts_id_owner
  ON ai_generation_attempts (id, organization_id, student_id, conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_generation_attempts_request_number
  ON ai_generation_attempts (request_message_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_ai_generation_attempts_conversation_status
  ON ai_generation_attempts (conversation_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_ai_generation_attempts_request
  ON ai_generation_attempts (request_message_id, attempt_number, created_at, id);
CREATE INDEX IF NOT EXISTS idx_ai_generation_attempts_branch
  ON ai_generation_attempts (branch_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_ai_generation_attempts_response
  ON ai_generation_attempts (response_message_id)
  WHERE response_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_generation_attempts_retry
  ON ai_generation_attempts (retry_of_attempt_id)
  WHERE retry_of_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_generation_attempts_parent
  ON ai_generation_attempts (parent_attempt_id)
  WHERE parent_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_generation_attempts_usage
  ON ai_generation_attempts (usage_event_id)
  WHERE usage_event_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_attempts_retry_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_generation_attempts
      ADD CONSTRAINT ai_generation_attempts_retry_same_conversation_fk
      FOREIGN KEY (retry_of_attempt_id, conversation_id)
      REFERENCES ai_generation_attempts (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_attempts_parent_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_generation_attempts
      ADD CONSTRAINT ai_generation_attempts_parent_same_conversation_fk
      FOREIGN KEY (parent_attempt_id, conversation_id)
      REFERENCES ai_generation_attempts (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_attempts_branch_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_generation_attempts
      ADD CONSTRAINT ai_generation_attempts_branch_same_conversation_fk
      FOREIGN KEY (branch_id, conversation_id)
      REFERENCES ai_conversation_branches (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_attempts_request_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_generation_attempts
      ADD CONSTRAINT ai_generation_attempts_request_same_conversation_fk
      FOREIGN KEY (request_message_id, conversation_id)
      REFERENCES ai_messages (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_attempts_response_same_conversation_fk'
  ) THEN
    ALTER TABLE ai_generation_attempts
      ADD CONSTRAINT ai_generation_attempts_response_same_conversation_fk
      FOREIGN KEY (response_message_id, conversation_id)
      REFERENCES ai_messages (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_attempts_student_user_owner_fk'
  ) THEN
    ALTER TABLE ai_generation_attempts
      ADD CONSTRAINT ai_generation_attempts_student_user_owner_fk
      FOREIGN KEY (student_id, user_id, organization_id)
      REFERENCES students_v2 (id, user_id, organization_id)
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Link attempts to the existing usage architecture without changing its
-- provider, token, latency, cost, or status semantics.
ALTER TABLE ai_usage_events
  ADD COLUMN IF NOT EXISTS generation_attempt_id UUID;

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_generation_attempt
  ON ai_usage_events (generation_attempt_id)
  WHERE generation_attempt_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_events_generation_attempt_fk'
  ) THEN
    ALTER TABLE ai_usage_events
      ADD CONSTRAINT ai_usage_events_generation_attempt_fk
      FOREIGN KEY (generation_attempt_id) REFERENCES ai_generation_attempts (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_attempts_usage_event_fk'
  ) THEN
    ALTER TABLE ai_generation_attempts
      ADD CONSTRAINT ai_generation_attempts_usage_event_fk
      FOREIGN KEY (usage_event_id) REFERENCES ai_usage_events (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_generation_attempt_fk'
  ) THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT ai_messages_generation_attempt_fk
      FOREIGN KEY (generation_attempt_id) REFERENCES ai_generation_attempts (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_ai_usage_attempt_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.generation_attempt_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM ai_generation_attempts a
        WHERE a.id = NEW.generation_attempt_id
          AND (NEW.organization_id IS NULL OR a.organization_id = NEW.organization_id)
          AND (NEW.student_id IS NULL OR a.student_id = NEW.student_id)
          AND (NEW.conversation_id IS NULL OR a.conversation_id = NEW.conversation_id)
     ) THEN
    RAISE EXCEPTION 'AI usage attribution does not match its generation attempt';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_usage_events_attempt_attribution ON ai_usage_events;
CREATE TRIGGER ai_usage_events_attempt_attribution
  BEFORE INSERT OR UPDATE OF generation_attempt_id, organization_id, student_id, conversation_id
  ON ai_usage_events
  FOR EACH ROW
  EXECUTE FUNCTION validate_ai_usage_attempt_attribution();

-- One student may submit one feedback record for a particular AI response.
-- Reasons are the locked predefined set; this is not an academic record.
CREATE TABLE IF NOT EXISTS ai_message_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  response_message_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  student_id UUID NOT NULL,
  sentiment VARCHAR(20) NOT NULL,
  reason VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_message_feedback_conversation_owner_fk
    FOREIGN KEY (conversation_id, organization_id, student_id)
    REFERENCES ai_conversations (id, organization_id, student_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_message_feedback_response_fk
    FOREIGN KEY (response_message_id) REFERENCES ai_messages (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_message_feedback_response_same_conversation_fk
    FOREIGN KEY (response_message_id, conversation_id)
    REFERENCES ai_messages (id, conversation_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_message_feedback_sentiment_check
    CHECK (sentiment IN ('HELPFUL', 'NOT_HELPFUL')),
  CONSTRAINT ai_message_feedback_reason_check
    CHECK (
      reason IS NULL OR reason IN (
        'too difficult',
        'too easy',
        'not clear',
        'incorrect',
        'need more examples',
        'need simpler explanation'
      )
    ),
  CONSTRAINT ai_message_feedback_one_per_student_response
    UNIQUE (response_message_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_message_feedback_student
  ON ai_message_feedback (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_message_feedback_conversation
  ON ai_message_feedback (conversation_id, response_message_id);
