import bcrypt from "bcryptjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { PostgresUsageTracker } from "../../src/modules/ai/usage/postgres.usage.tracker.js";
import type { LlmUsageEvent } from "../../src/modules/ai/usage/usage.types.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS ??= "7";

const created = {
  usageEventIds: [] as string[],
  conversationIds: [] as string[],
  studentIds: [] as string[],
  organizationIds: [] as string[],
  userIds: [] as string[],
};

async function cleanup() {
  if (created.usageEventIds.length > 0) {
    await pool.query(`DELETE FROM ai_usage_events WHERE id = ANY($1::uuid[])`, [created.usageEventIds]);
    created.usageEventIds.length = 0;
  }

  if (created.conversationIds.length > 0) {
    await pool.query(`DELETE FROM ai_conversations WHERE id = ANY($1::uuid[])`, [created.conversationIds]);
    created.conversationIds.length = 0;
  }

  if (created.studentIds.length > 0) {
    await pool.query(`DELETE FROM students_v2 WHERE id = ANY($1::uuid[])`, [created.studentIds]);
    created.studentIds.length = 0;
  }

  if (created.organizationIds.length > 0) {
    await pool.query(`DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])`, [created.organizationIds]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [created.organizationIds]);
    created.organizationIds.length = 0;
  }

  if (created.userIds.length > 0) {
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [created.userIds]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.userIds]);
    created.userIds.length = 0;
  }
}

afterEach(async () => {
  await cleanup();
});

function uniqueValue(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser() {
  const passwordHash = await bcrypt.hash("StrongPassword123!", 10);
  const result = await pool.query(
    `INSERT INTO users (email, phone, password_hash, full_name, status)
     VALUES ($1, NULL, $2, 'Usage Test User', 'ACTIVE')
     RETURNING id`,
    [`${uniqueValue("usage-user")}@example.com`, passwordHash]
  );
  created.userIds.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(userId: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3)
     RETURNING id`,
    ["Usage Org", `usage-org-${uniqueValue("slug")}`, userId]
  );
  created.organizationIds.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createStudent(userId: string, organizationId: string) {
  const result = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name)
     VALUES ($1, $2, 'Usage Student')
     RETURNING id`,
    [userId, organizationId]
  );
  created.studentIds.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createConversation(organizationId: string, studentId: string) {
  const result = await pool.query(
    `INSERT INTO ai_conversations (organization_id, student_id, subject, topic)
     VALUES ($1, $2, 'Math', 'Algebra')
     RETURNING id`,
    [organizationId, studentId]
  );
  created.conversationIds.push(result.rows[0].id);
  return result.rows[0].id as string;
}

describe("PostgresUsageTracker", () => {
  it("tracks migration 025 using the project migration runner", async () => {
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    execFileSync("node", ["scripts/run-migrations.js"], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const migrationCheck = await pool.query(
      `SELECT COUNT(*)::int AS row_count FROM schema_migrations WHERE version = '025_create_ai_usage_events'`
    );
    expect(migrationCheck.rows[0].row_count).toBeGreaterThan(0);
  });

  it("persists a full success event with tenant, token, latency, and cost fields", async () => {
    const userId = await createUser();
    const organizationId = await createOrganization(userId);
    const studentId = await createStudent(userId, organizationId);
    const conversationId = await createConversation(organizationId, studentId);

    const event: LlmUsageEvent = {
      provider: "mock",
      model: "mock-model",
      requestId: "req-123",
      feature: "tutor-reply",
      organizationId,
      studentId,
      userId,
      conversationId,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      latencyMs: 12.6,
      estimatedCost: 0.00035,
      status: "SUCCESS",
      timestamp: new Date().toISOString(),
    };

    await new PostgresUsageTracker().recordUsage(event);

    const result = await pool.query(
      `SELECT id, organization_id, student_id, user_id, conversation_id,
              feature, provider, model, request_id,
              input_tokens, output_tokens, total_tokens,
              latency_ms, estimated_cost, status, error_category
       FROM ai_usage_events
       WHERE organization_id = $1 AND conversation_id = $2`,
      [organizationId, conversationId]
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    created.usageEventIds.push(row.id);

    expect(row.organization_id).toBe(organizationId);
    expect(row.student_id).toBe(studentId);
    expect(row.user_id).toBe(userId);
    expect(row.conversation_id).toBe(conversationId);
    expect(row.feature).toBe("tutor-reply");
    expect(row.provider).toBe("mock");
    expect(row.model).toBe("mock-model");
    expect(row.request_id).toBe("req-123");
    expect(row.input_tokens).toBe(10);
    expect(row.output_tokens).toBe(20);
    expect(row.total_tokens).toBe(30);
    expect(row.latency_ms).toBe(13);
    expect(Number(row.estimated_cost)).toBeCloseTo(0.00035, 5);
    expect(row.status).toBe("SUCCESS");
    expect(row.error_category).toBeNull();
  });

  it("persists a failure event with error_category and null tokens", async () => {
    const event: LlmUsageEvent = {
      provider: "deepseek",
      model: "unknown",
      feature: "tutor-reply",
      status: "FAILURE",
      errorCategory: "rate_limit",
      timestamp: new Date().toISOString(),
    };

    await new PostgresUsageTracker().recordUsage(event);

    const result = await pool.query(
      `SELECT id, feature, provider, model, status, error_category, input_tokens, total_tokens
       FROM ai_usage_events
       WHERE status = 'FAILURE' AND provider = 'deepseek'
       ORDER BY created_at DESC
       LIMIT 1`
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    created.usageEventIds.push(row.id);

    expect(row.feature).toBe("tutor-reply");
    expect(row.provider).toBe("deepseek");
    expect(row.model).toBe("unknown");
    expect(row.status).toBe("FAILURE");
    expect(row.error_category).toBe("rate_limit");
    expect(row.input_tokens).toBeNull();
    expect(row.total_tokens).toBeNull();
  });

  it("never throws when persistence fails (best-effort tracking)", async () => {
    const failingDb = {
      query: async () => {
        throw new Error("db unavailable");
      },
    };

    await expect(
      new PostgresUsageTracker(failingDb).recordUsage({
        provider: "mock",
        model: "mock-model",
        feature: "tutor-reply",
        status: "SUCCESS",
        timestamp: new Date().toISOString(),
      })
    ).resolves.toBeUndefined();
  });
});

