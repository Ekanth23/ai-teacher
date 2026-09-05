import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Test 9 — AI route database schema reconciliation.
 *
 * Verifies the AI route's SQL literals target the canonical schema:
 *   students_v2 (tenant-safe student table), ai_conversations, ai_messages.
 * It must NOT reference the legacy unmigrated `students`/`conversations`/`messages`
 * tables or the non-tenant `student_profiles` table.
 */

describe("ai.routes database schema reconciliation", () => {
  async function loadRouteSource(): Promise<string> {
    return readFile(
      new URL("../../src/modules/ai/ai.routes.ts", import.meta.url),
      "utf-8"
    );
  }

  it("uses the canonical students_v2 table for student lookup", async () => {
    const source = await loadRouteSource();
    expect(source).toContain("FROM students_v2");
    expect(source).not.toContain("FROM students\n");
    expect(source).not.toContain("FROM students ");
    expect(source).not.toContain("FROM student_profiles");
  });

  it("maps student name/grade fields to students_v2 columns", async () => {
    const source = await loadRouteSource();
    expect(source).toContain("full_name AS name");
    expect(source).toContain("grade_level AS grade");
  });

  it("uses the canonical ai_conversations table with id/organization_id/student_id/subject/topic", async () => {
    const source = await loadRouteSource();
    expect(source).toContain("FROM ai_conversations");
    expect(source).toContain("SELECT id, organization_id, student_id, subject, topic");
    expect(source).not.toContain("FROM conversations ");
    expect(source).not.toContain("FROM conversations\n");
  });

  it("uses the canonical ai_messages table for history and reply persistence", async () => {
    const source = await loadRouteSource();
    expect(source).toContain("FROM ai_messages");
    expect(source).toContain("INSERT INTO ai_messages (conversation_id, role, content)");
    expect(source).toContain("WHERE conversation_id = $1");
    expect(source).not.toContain("FROM messages ");
    expect(source).not.toContain("INSERT INTO messages ");
  });

  it("preserves the public route contract surface", async () => {
    const source = await loadRouteSource();
    expect(source).toContain('router.post("/reply"');
    expect(source).toContain('res.status(201)');
    expect(source).toContain('res.status(400)');
    expect(source).toContain('res.status(404)');
    expect(source).toContain('res.status(500)');
    expect(source).toContain("generateTutorReply");
  });
});

describe("ai.routes authentication and tenant scoping", () => {
  async function loadRouteSource(): Promise<string> {
    return readFile(
      new URL("../../src/modules/ai/ai.routes.ts", import.meta.url),
      "utf-8"
    );
  }

  it("requires authentication via requireAuth middleware", async () => {
    const source = await loadRouteSource();
    expect(source).toContain('router.post("/reply", requireAuth');
    expect(source).toContain("requireAuth");
  });

  it("derives organization scope from the conversation record", async () => {
    const source = await loadRouteSource();
    expect(source).toContain("resolveOrganizationContext(req, user, conversation.organization_id)");
  });

  it("scopes the student lookup to the conversation's organization", async () => {
    const source = await loadRouteSource();
    expect(source).toContain("FROM students_v2");
    expect(source).toContain("WHERE id = $1 AND organization_id = $2");
  });

  it("passes userId and organizationId into the LLM request context", async () => {
    const source = await loadRouteSource();
    expect(source).toContain("userId: user.id");
    expect(source).toContain("organizationId: conversation.organization_id");
  });

  it("maps AuthorizationError to a 403 response", async () => {
    const source = await loadRouteSource();
    expect(source).toContain("error instanceof AuthorizationError");
    expect(source).toContain('error.code === "INVALID_TOKEN" ? 401 : 403');
  });
});
