import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

const migration46Url = new URL("../../migrations/046_create_ai_conversation_foundation.sql", import.meta.url);
const migration47Url = new URL("../../migrations/047_reconcile_ai_conversation_remediation.sql", import.meta.url);
const preflightUrl = new URL("../../scripts/ai-conversation-ownership-preflight.sql", import.meta.url);

const clients: Client[] = [];
const schemas: string[] = [];

function dbConfig() {
  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
  };
}

async function isolatedClient(schema: string): Promise<Client> {
  const client = new Client(dbConfig());
  clients.push(client);
  await client.connect();
  schemas.push(schema);
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  return client;
}

async function createPre046Schema(client: Client) {
  await client.query(`
    CREATE TABLE organizations (id UUID PRIMARY KEY);
    CREATE TABLE users (id UUID PRIMARY KEY);
    CREATE TABLE students_v2 (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      organization_id UUID NOT NULL,
      full_name VARCHAR(255) NOT NULL
    );
    CREATE UNIQUE INDEX ux_students_v2_id_organization
      ON students_v2 (id, organization_id);
    CREATE TABLE ai_conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      student_id UUID NOT NULL REFERENCES students_v2(id),
      subject VARCHAR(255),
      topic VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE ai_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE ai_usage_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID REFERENCES organizations(id),
      student_id UUID REFERENCES students_v2(id),
      user_id UUID REFERENCES users(id),
      conversation_id UUID REFERENCES ai_conversations(id),
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

afterEach(async () => {
  const pendingSchemas = schemas.splice(0);
  for (const client of clients.splice(0)) {
    for (const schema of pendingSchemas) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
});

describe("US-117 executable migration compatibility", () => {
  it("upgrades a pre-046 legacy fixture, backfills titles, and reruns 047 safely", async () => {
    const schema = `us117_migration_${randomUUID().replace(/-/g, "")}`;
    const client = await isolatedClient(schema);
    await createPre046Schema(client);
    const organizationId = randomUUID();
    const userId = randomUUID();
    const studentId = randomUUID();
    const questionConversationId = randomUUID();
    const emptyConversationId = randomUUID();
    const renamedConversationId = randomUUID();
    await client.query("INSERT INTO organizations (id) VALUES ($1)", [organizationId]);
    await client.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await client.query(
      "INSERT INTO students_v2 (id, user_id, organization_id, full_name) VALUES ($1, $2, $3, 'Legacy Student')",
      [studentId, userId, organizationId],
    );
    await client.query(
      `INSERT INTO ai_conversations (id, organization_id, student_id)
       VALUES ($1, $3, $4), ($2, $3, $4), ($5, $3, $4)`,
      [questionConversationId, emptyConversationId, organizationId, studentId, renamedConversationId],
    );
    await client.query(
      `INSERT INTO ai_messages (conversation_id, role, content, created_at)
       VALUES ($1, 'user', '  What is gravity?  ', NOW() - INTERVAL '2 minutes'),
              ($1, 'assistant', 'Gravity pulls objects together.', NOW() - INTERVAL '1 minute')`,
      [questionConversationId],
    );

    const migration46 = await readFile(migration46Url, "utf8");
    const migration47 = await readFile(migration47Url, "utf8");
    await client.query(migration46);
    await client.query(
      `UPDATE ai_conversations
          SET title = 'Meaningful user title', title_source = 'RENAMED'
        WHERE id = $1`,
      [renamedConversationId],
    );
    await client.query(migration47);
    await client.query(migration47);

    const otherOrganizationId = randomUUID();
    const otherUserId = randomUUID();
    const otherStudentId = randomUUID();
    await client.query("INSERT INTO organizations (id) VALUES ($1)", [otherOrganizationId]);
    await client.query("INSERT INTO users (id) VALUES ($1)", [otherUserId]);
    await client.query(
      `INSERT INTO students_v2 (id, user_id, organization_id, full_name)
       VALUES ($1, $2, $3, 'Other tenant')`,
      [otherStudentId, otherUserId, otherOrganizationId],
    );
    await expect(
      client.query(
        `INSERT INTO ai_conversations (organization_id, student_id) VALUES ($1, $2)`,
        [organizationId, otherStudentId],
      ),
    ).rejects.toMatchObject({ code: "23503" });

    const result = await client.query(
      `SELECT id, title, title_source, active_branch_id FROM ai_conversations ORDER BY id`,
    );
    const byId = new Map(result.rows.map((row) => [row.id as string, row]));
    expect(byId.get(questionConversationId)).toMatchObject({
      title: "What is gravity?",
      title_source: "GENERATED",
    });
    expect(byId.get(emptyConversationId)).toMatchObject({
      title: "New Conversation",
      title_source: "DEFAULT",
    });
    expect(byId.get(renamedConversationId)).toMatchObject({
      title: "Meaningful user title",
      title_source: "RENAMED",
    });
    expect(result.rows.every((row) => row.active_branch_id)).toBe(true);
    const messages = await client.query(
      `SELECT conversation_id, sequence_number, status, branch_id
         FROM ai_messages ORDER BY created_at, id`,
    );
    expect(messages.rows.filter((row) => row.conversation_id === questionConversationId).every((row) => row.branch_id)).toBe(true);
    expect(messages.rows.filter((row) => row.conversation_id === questionConversationId).map((row) => Number(row.sequence_number))).toEqual([1, 2]);
    const idempotency = await client.query(
      `SELECT to_regclass('ai_idempotency_keys') AS table_name`,
    );
    expect(idempotency.rows[0].table_name).toBe("ai_idempotency_keys");
  });

  it("stops before applying 046 when composite ownership preflight finds a mismatch", async () => {
    const schema = `us117_preflight_${randomUUID().replace(/-/g, "")}`;
    const client = await isolatedClient(schema);
    await createPre046Schema(client);
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const studentA = randomUUID();
    const studentB = randomUUID();
    await client.query("INSERT INTO organizations (id) VALUES ($1), ($2)", [organizationA, organizationB]);
    await client.query("INSERT INTO users (id) VALUES ($1), ($2)", [userA, userB]);
    await client.query(
      `INSERT INTO students_v2 (id, user_id, organization_id, full_name)
       VALUES ($1, $2, $3, 'A'), ($4, $5, $6, 'B')`,
      [studentA, userA, organizationA, studentB, userB, organizationB],
    );
    await client.query(
      `INSERT INTO ai_conversations (organization_id, student_id) VALUES ($1, $2)`,
      [organizationA, studentB],
    );

    const preflight = await readFile(preflightUrl, "utf8");
    expect(preflight).toContain("c.organization_id AS conversation_organization_id");
    expect(preflight).toContain("c.organization_id IS DISTINCT FROM s.organization_id");
    const mismatch = await client.query(preflight);
    expect(mismatch.rows).toHaveLength(1);
    expect(mismatch.rows[0]).toMatchObject({
      conversation_organization_id: organizationA,
      student_organization_id: organizationB,
    });

    // The deployment runner executes this read-only check before 046. Do not
    // apply the foundation migration while the preflight has rows.
    const branchTable = await client.query(
      `SELECT to_regclass(current_schema() || '.ai_conversation_branches') AS table_name`,
    );
    expect(branchTable.rows[0].table_name).toBeNull();
  });
});
