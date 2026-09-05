import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Test 11 — Persistent AI usage tracking (schema reconciliation).
 *
 * Verifies the ai_usage_events migration declares the measurement surface
 * required for future plan allowances, credits, institution limits, and
 * profitability controls: tenant/student/user, feature, provider/model,
 * token usage, latency, estimated cost, success/failure status, and the
 * requestId seam.
 */

describe("ai_usage_events migration schema", () => {
  async function loadMigrationSource(): Promise<string> {
    return readFile(
      new URL("../../migrations/025_create_ai_usage_events.sql", import.meta.url),
      "utf-8"
    );
  }

  it("creates the ai_usage_events table", async () => {
    const source = await loadMigrationSource();
    expect(source).toContain("CREATE TABLE IF NOT EXISTS ai_usage_events");
  });

  it("declares tenant, student, user, feature, provider, and model columns", async () => {
    const source = await loadMigrationSource();
    expect(source).toContain("organization_id");
    expect(source).toContain("student_id");
    expect(source).toContain("user_id");
    expect(source).toContain("feature");
    expect(source).toContain("provider");
    expect(source).toContain("model");
  });

  it("declares token usage, latency, and estimated cost columns", async () => {
    const source = await loadMigrationSource();
    expect(source).toContain("input_tokens");
    expect(source).toContain("output_tokens");
    expect(source).toContain("total_tokens");
    expect(source).toContain("latency_ms");
    expect(source).toContain("estimated_cost");
  });

  it("declares status, error_category, and the requestId seam", async () => {
    const source = await loadMigrationSource();
    expect(source).toContain("status");
    expect(source).toContain("error_category");
    expect(source).toContain("request_id");
  });

  it("declares tenant foreign keys and indexes", async () => {
    const source = await loadMigrationSource();
    expect(source).toContain("REFERENCES organizations");
    expect(source).toContain("REFERENCES students_v2");
    expect(source).toContain("REFERENCES users");
    expect(source).toContain("REFERENCES ai_conversations");
    expect(source).toContain("idx_ai_usage_events_organization_id");
    expect(source).toContain("idx_ai_usage_events_provider_model");
  });
});
