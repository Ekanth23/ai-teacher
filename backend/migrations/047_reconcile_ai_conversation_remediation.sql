-- Migration 047: additive US-117 lifecycle reconciliation.
--
-- Migration 046 is already recorded and must not be edited. This migration
-- only adds the durable request-recovery identity and performs the one-time,
-- conservative legacy-title reconciliation required by the US-117 review.

-- Composite ownership is a deployment prerequisite. The migration runner also
-- executes this check before applying 046 on a fresh upgrade. Keep this check
-- here as a defense for environments that apply 047 directly.
DO $$
DECLARE
  ownership_mismatches BIGINT;
BEGIN
  SELECT COUNT(*) INTO ownership_mismatches
  FROM ai_conversations c
  LEFT JOIN students_v2 s ON s.id = c.student_id
  WHERE s.id IS NULL
     OR c.organization_id IS DISTINCT FROM s.organization_id;

  IF ownership_mismatches > 0 THEN
    RAISE EXCEPTION
      'AI conversation ownership preflight failed: % row(s) require remediation before deployment. Reconcile ai_conversations.organization_id with the owning students_v2.organization_id; do not delete or reassign rows automatically.',
      ownership_mismatches;
  END IF;
END $$;

-- 046 is immutable, but its name-only guard can be confused by a same-named
-- constraint in another schema. Ensure the target relation has the composite
-- ownership constraint before adding the new relationships.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'ai_conversations'::regclass
       AND conname = 'ai_conversations_student_organization_fk'
  ) THEN
    ALTER TABLE ai_conversations
      ADD CONSTRAINT ai_conversations_student_organization_fk
      FOREIGN KEY (student_id, organization_id)
      REFERENCES students_v2 (id, organization_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The request key stores only owner, operation, request fingerprint, and links
-- to the already-persisted conversation/request/attempt. It never stores a
-- second copy of student content.
CREATE TABLE IF NOT EXISTS ai_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_id UUID NOT NULL,
  user_id UUID NOT NULL,
  operation VARCHAR(40) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  conversation_id UUID,
  request_message_id UUID,
  attempt_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_idempotency_keys_operation_check
    CHECK (operation IN ('CREATE_CONVERSATION', 'SEND_MESSAGE')),
  CONSTRAINT ai_idempotency_keys_owner_fk
    FOREIGN KEY (student_id, user_id, organization_id)
    REFERENCES students_v2 (id, user_id, organization_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_idempotency_keys_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_idempotency_keys_conversation_owner_fk
    FOREIGN KEY (conversation_id, organization_id, student_id)
    REFERENCES ai_conversations (id, organization_id, student_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_idempotency_keys_request_owner_fk
    FOREIGN KEY (request_message_id, conversation_id)
    REFERENCES ai_messages (id, conversation_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_idempotency_keys_attempt_owner_fk
    FOREIGN KEY (attempt_id, conversation_id)
    REFERENCES ai_generation_attempts (id, conversation_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_idempotency_keys_owner_operation_key
    UNIQUE (organization_id, student_id, user_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_idempotency_keys_conversation
  ON ai_idempotency_keys (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_idempotency_keys_request
  ON ai_idempotency_keys (request_message_id)
  WHERE request_message_id IS NOT NULL;

-- Make a partially-created table safe to repair/rerun without weakening any
-- existing ownership constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_idempotency_keys_owner_fk'
  ) THEN
    ALTER TABLE ai_idempotency_keys
      ADD CONSTRAINT ai_idempotency_keys_owner_fk
      FOREIGN KEY (student_id, user_id, organization_id)
      REFERENCES students_v2 (id, user_id, organization_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_idempotency_keys_conversation_owner_fk'
  ) THEN
    ALTER TABLE ai_idempotency_keys
      ADD CONSTRAINT ai_idempotency_keys_conversation_owner_fk
      FOREIGN KEY (conversation_id, organization_id, student_id)
      REFERENCES ai_conversations (id, organization_id, student_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_idempotency_keys_request_owner_fk'
  ) THEN
    ALTER TABLE ai_idempotency_keys
      ADD CONSTRAINT ai_idempotency_keys_request_owner_fk
      FOREIGN KEY (request_message_id, conversation_id)
      REFERENCES ai_messages (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_idempotency_keys_attempt_owner_fk'
  ) THEN
    ALTER TABLE ai_idempotency_keys
      ADD CONSTRAINT ai_idempotency_keys_attempt_owner_fk
      FOREIGN KEY (attempt_id, conversation_id)
      REFERENCES ai_generation_attempts (id, conversation_id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Reconcile only untouched default titles. A generated or renamed title is
-- meaningful and is never overwritten. The first student message is selected
-- by the logical sequence established by 046, with timestamp/id only as a
-- deterministic fallback for any remaining legacy row.
WITH first_question AS (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id,
    BTRIM(REGEXP_REPLACE(m.content, '[[:space:]]+', ' ', 'g')) AS content
  FROM ai_messages m
  WHERE m.role = 'user'
    AND BTRIM(m.content) <> ''
  ORDER BY
    m.conversation_id,
    COALESCE(m.sequence_number, 9223372036854775807) ASC,
    m.created_at ASC,
    m.id ASC
)
UPDATE ai_conversations c
   SET title = CASE
         WHEN LENGTH(q.content) <= 80 THEN q.content
         ELSE LEFT(q.content, 77) || '...'
       END,
       title_source = 'GENERATED'
  FROM first_question q
 WHERE c.id = q.conversation_id
   AND c.title_source = 'DEFAULT'
   AND BTRIM(c.title) = 'New Conversation';

-- Keep the preflight executable outside the migration transaction as well.
CREATE OR REPLACE FUNCTION assert_ai_conversation_ownership_preflight()
RETURNS TABLE (
  id UUID,
  conversation_organization_id UUID,
  student_id UUID,
  student_organization_id UUID
)
LANGUAGE sql
AS $$
  SELECT
    c.id,
    c.organization_id AS conversation_organization_id,
    c.student_id,
    s.organization_id AS student_organization_id
  FROM ai_conversations c
  LEFT JOIN students_v2 s ON s.id = c.student_id
  WHERE s.id IS NULL
     OR c.organization_id IS DISTINCT FROM s.organization_id;
$$;
