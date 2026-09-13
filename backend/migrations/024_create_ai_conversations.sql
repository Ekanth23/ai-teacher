-- Migration 024: Canonical AI conversation/message structures.
--
-- The AI Teacher route originally referenced legacy `conversations`/`messages`/
-- `students` tables. Those legacy integer-keyed tables exist out-of-band in some
-- development databases but are NOT part of the versioned migration history.
--
-- The canonical student table is `students_v2` (UUID, tenant-safe). Because the
-- legacy `conversations.student_id` is an integer column that cannot reference
-- `students_v2.id` (UUID), and because existing tables must not be dropped or
-- renamed, this migration creates NEW, additive, tenant-safe tables keyed to the
-- canonical student/organization schema.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_id UUID NOT NULL,
  subject VARCHAR(255),
  topic VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_conversations_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT ai_conversations_student_fk FOREIGN KEY (student_id)
    REFERENCES students_v2 (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_organization_id ON ai_conversations (organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_student_id ON ai_conversations (student_id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_messages_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES ai_conversations (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id_created_at ON ai_messages (conversation_id, created_at);