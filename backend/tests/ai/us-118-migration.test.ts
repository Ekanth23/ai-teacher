import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration48Url = new URL("../../migrations/048_add_current_enrollment_selection.sql", import.meta.url);
const migration49Url = new URL("../../migrations/049_add_authoritative_syllabus_designation.sql", import.meta.url);

async function source(url: URL) {
  return readFile(url, "utf8");
}

describe("US-118 migrations 048 and 049", () => {
  it("adds explicit current enrollment ownership without a board field or inferred selection", async () => {
    const sql = await source(migration48Url);
    expect(sql).toContain("current_enrollment_id UUID");
    expect(sql).toContain("students_v2_current_enrollment_owner_fk_048");
    expect(sql).toContain("enroll_student_organization_fk_048");
    expect(sql).toContain("enroll_class_organization_fk_048");
    expect(sql).toContain("se.status = 'ACTIVE'");
    expect(sql).toContain("c.status = 'ACTIVE'");
    expect(sql).toMatch(/current_enrollment_id\s+IS NULL|NULL means/i);
    expect(sql).not.toMatch(/board_id\s+UUID|ADD COLUMN[^;]*board_id/i);
    expect(sql).not.toMatch(/ORDER BY[^;]*(class|enrollment)/i);
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(sql).not.toMatch(/^\s*COMMIT\s*;/im);
    expect(sql).not.toMatch(/CREATE TABLE[^;]*(ai|learning)[^;]*(profile|snapshot)/i);
  });

  it("adds a non-promoting authoritative syllabus flag and one-per-class guard", async () => {
    const sql = await source(migration49Url);
    expect(sql).toContain("is_authoritative BOOLEAN");
    expect(sql).toContain("SET DEFAULT FALSE");
    expect(sql).toContain("SET NOT NULL");
    expect(sql).toContain("ux_syllabi_one_authoritative_per_class_049");
    expect(sql).toContain("WHERE is_authoritative = TRUE");
    expect(sql).toMatch(/UPDATE\s+syllabi[\s\S]*is_authoritative\s*=\s*FALSE/i);
    expect(sql).not.toMatch(/board_id\s+UUID/i);
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(sql).not.toMatch(/^\s*COMMIT\s*;/im);
  });
});
