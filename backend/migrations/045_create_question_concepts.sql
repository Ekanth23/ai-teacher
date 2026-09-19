-- Migration 045: Backend Epic 10 US-105 — question-to-concept mapping
--
-- Authoritative question -> concept relationship shared by Practice and
-- Formal Assessment questions (PO Decisions #19, #20, #25). Each question
-- has exactly one primary concept (the US-105 detection target) and zero
-- or more secondary concepts (supporting context only).
--
-- Concepts come from knowledge_items(kind = 'CONCEPT'). The kind cannot be
-- enforced by a plain foreign key, so it is enforced in the
-- service/application layer with test coverage. No existing table is
-- altered; Epic 8/9 question tables are untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS question_concepts (
  question_scope VARCHAR(20) NOT NULL,
  question_id UUID NOT NULL,
  knowledge_item_id UUID NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT question_concepts_scope_check CHECK (question_scope IN ('PRACTICE', 'FORMAL')),
  CONSTRAINT question_concepts_item_fk FOREIGN KEY (knowledge_item_id)
    REFERENCES knowledge_items (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_question_concepts_scope_question_item
  ON question_concepts (question_scope, question_id, knowledge_item_id);

-- Exactly one primary concept per question: a second primary for the same
-- (scope, question) is rejected by this partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS ux_question_concepts_single_primary
  ON question_concepts (question_scope, question_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_question_concepts_knowledge_item
  ON question_concepts (knowledge_item_id);

CREATE INDEX IF NOT EXISTS idx_question_concepts_scope_question
  ON question_concepts (question_scope, question_id);

COMMIT;
