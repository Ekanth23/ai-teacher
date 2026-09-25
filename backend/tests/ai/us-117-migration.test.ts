import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../migrations/046_create_ai_conversation_foundation.sql", import.meta.url);
const remediationMigrationUrl = new URL("../../migrations/047_reconcile_ai_conversation_remediation.sql", import.meta.url);
const preflightUrl = new URL("../../scripts/ai-conversation-ownership-preflight.sql", import.meta.url);

async function source() {
  return readFile(migrationUrl, "utf-8");
}

async function remediationSource() {
  return readFile(remediationMigrationUrl, "utf-8");
}

describe("US-117 migration 046", () => {
  it("adds the lifecycle tables and attempt/usage linkage without changing migrations 024/025", async () => {
    const sql = await source();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_conversation_branches");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_generation_attempts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_message_feedback");
    expect(sql).toContain("generation_attempt_id UUID");
    expect(sql).toContain("ai_usage_events_generation_attempt_fk");
    expect(sql).toContain("ai_generation_attempts_usage_event_fk");
    expect(sql).toContain("CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED'))");
  });

  it("persists conversation-only scope labels and does not introduce curriculum mappings or a learning profile", async () => {
    const sql = await source();
    expect(sql).toContain("scope_board");
    expect(sql).toContain("scope_class");
    expect(sql).toContain("scope_chapter");
    expect(sql).toContain("scope_language");
    expect(sql).toContain("scope_medium");
    expect(sql).not.toMatch(/CREATE TABLE[^;]*(learning[_ ]profile|learning_snapshot)/i);
    expect(sql).not.toMatch(/REFERENCES curriculum_|current_enrollment_id|syllabus_id/i);
  });

  it("constrains feedback to the locked sentiment and predefined reason set", async () => {
    const sql = await source();
    for (const reason of [
      "too difficult",
      "too easy",
      "not clear",
      "incorrect",
      "need more examples",
      "need simpler explanation",
    ]) {
      expect(sql).toContain(`'${reason}'`);
    }
    expect(sql).toContain("UNIQUE (response_message_id, student_id)");
  });
});

describe("US-117 migration 047 remediation", () => {
  it("backfills only untouched default titles and adds durable request identity", async () => {
    const sql = await remediationSource();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_idempotency_keys");
    expect(sql).toContain("title_source = 'DEFAULT'");
    expect(sql).toContain("BTRIM(c.title) = 'New Conversation'");
    expect(sql).toContain("DISTINCT ON (m.conversation_id)");
    expect(sql).toContain("ai_idempotency_keys_owner_operation_key");
    expect(sql).toContain("conrelid = 'ai_conversations'::regclass");
  });

  it("keeps the required cross-tenant ownership preflight executable and non-destructive", async () => {
    const [migration, preflight] = await Promise.all([remediationSource(), readFile(preflightUrl, "utf-8")]);
    for (const sql of [migration, preflight]) {
      expect(sql).toContain("c.organization_id AS conversation_organization_id");
      expect(sql).toContain("c.organization_id IS DISTINCT FROM s.organization_id");
    }
    expect(migration).toContain("ownership preflight failed");
    expect(preflight).toContain("Do not delete or reassign rows automatically");
  });
});
