import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { MockLlmProvider } from "../../src/modules/ai/providers/mock.provider.js";
import { createApp } from "../../src/server.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();

// Pin the mock LLM provider for deterministic, fast replies. The developer
// .env may point AI_PROVIDER at a real provider (e.g. ollama); reply
// contract tests must not depend on external inference latency.
beforeEach(() => {
  process.env.AI_PROVIDER = "mock";
});

const unique = (prefix: string) =>
  `${prefix.slice(0, 20)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const created = {
  users: [] as string[],
  organizations: [] as string[],
  students: [] as string[],
  conversations: [] as string[],
};

async function cleanup() {
  if (created.conversations.length) {
    await pool.query("DELETE FROM ai_messages WHERE conversation_id = ANY($1::uuid[])", [created.conversations]);
    await pool.query("DELETE FROM ai_conversations WHERE id = ANY($1::uuid[])", [created.conversations]);
  }
  if (created.students.length) await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  Object.values(created).forEach((ids) => {
    ids.length = 0;
  });
}

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

async function createUser(label: string) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${unique(`ai_${label}`)}@example.com`, `AI ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`AI ${label}`, unique(`ai_org_${label}`), ownerUserId]
  );
  created.organizations.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function addMember(userId: string, organizationId: string, roleName: string) {
  const role = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [roleName]);
  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [userId, organizationId, role.rows[0].id]
  );
}

async function createStudent(organizationId: string, userId: string, fullName: string) {
  const result = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status)
     VALUES ($1, $2, $3, '8', 'ACTIVE') RETURNING id`,
    [userId, organizationId, fullName]
  );
  created.students.push(result.rows[0].id);
  return result.rows[0].id as string;
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

// Real browser path: the frontend sends only the Authorization bearer token
// and never x-organization-id, so organization resolution relies on
// autoResolveSingle. This helper reproduces that path.
function authHeaderless(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function studentFixture(label: string) {
  const adminId = await createUser(`${label}-admin`);
  const organizationId = await createOrganization(adminId, `${label}-org`);
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  const studentUserId = await createUser(`${label}-student`);
  await addMember(studentUserId, organizationId, "STUDENT");
  const studentId = await createStudent(organizationId, studentUserId, `${label} Student`);
  return {
    organizationId,
    adminId,
    adminToken: createAccessToken(adminId),
    studentUserId,
    studentId,
    studentToken: createAccessToken(studentUserId),
  };
}

async function createConversation(
  f: { studentToken: string; organizationId: string },
  body: Record<string, unknown> = {}
) {
  const res = await request(app)
    .post("/api/ai/conversations")
    .set(auth(f.studentToken, f.organizationId))
    .send(body);
  expect(res.status).toBe(201);
  created.conversations.push(res.body.conversation.id);
  return res.body.conversation.id as string;
}

describe("AI conversation authentication", () => {
  it("rejects unauthenticated conversation access", async () => {
    expect((await request(app).post("/api/ai/conversations").send({})).status).toBe(401);
    expect((await request(app).get("/api/ai/conversations")).status).toBe(401);
    expect(
      (await request(app).get("/api/ai/conversations/00000000-0000-4000-8000-000000000000/messages")).status
    ).toBe(401);
    expect(
      (await request(app).post("/api/ai/reply").send({ conversation_id: "x", question: "y" })).status
    ).toBe(401);
  });

  it("rejects a non-student role on student conversation endpoints", async () => {
    const f = await studentFixture("role");
    for (const res of [
      await request(app).post("/api/ai/conversations").set(auth(f.adminToken, f.organizationId)).send({}),
      await request(app).get("/api/ai/conversations").set(auth(f.adminToken, f.organizationId)),
      await request(app)
        .get("/api/ai/conversations/00000000-0000-4000-8000-000000000000/messages")
        .set(auth(f.adminToken, f.organizationId)),
    ]) {
      expect(res.status).toBe(403);
    }
  });
});

describe("POST /api/ai/conversations", () => {
  it("creates a conversation bound to the authenticated student and organization", async () => {
    const f = await studentFixture("create");
    const res = await request(app)
      .post("/api/ai/conversations")
      .set(auth(f.studentToken, f.organizationId))
      .send({ subject: "  Maths  ", topic: "Fractions" });
    expect(res.status).toBe(201);
    created.conversations.push(res.body.conversation.id);
    expect(res.body.conversation.subject).toBe("Maths");
    expect(res.body.conversation.topic).toBe("Fractions");

    const db = await pool.query("SELECT organization_id, student_id, subject FROM ai_conversations WHERE id = $1", [
      res.body.conversation.id,
    ]);
    expect(db.rows[0].organization_id).toBe(f.organizationId);
    expect(db.rows[0].student_id).toBe(f.studentId);
    expect(db.rows[0].subject).toBe("Maths");
  });

  it("ignores client-supplied identity and defaults empty context to null", async () => {
    const f = await studentFixture("identity");
    const otherUser = await createUser("identity-other");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudentId = await createStudent(f.organizationId, otherUser, "Other");
    void otherStudentId;

    const res = await request(app)
      .post("/api/ai/conversations")
      .set(auth(f.studentToken, f.organizationId))
      .send({ student_id: otherStudentId, organization_id: "00000000-0000-4000-8000-000000000000", subject: "  ", topic: "" });
    expect(res.status).toBe(201);
    created.conversations.push(res.body.conversation.id);
    expect(res.body.conversation.subject).toBeNull();
    expect(res.body.conversation.topic).toBeNull();

    const db = await pool.query("SELECT organization_id, student_id FROM ai_conversations WHERE id = $1", [
      res.body.conversation.id,
    ]);
    expect(db.rows[0].student_id).toBe(f.studentId);
  });

  it("rejects invalid subject input", async () => {
    const f = await studentFixture("invalid");
    const tooLong = "s".repeat(256);
    for (const body of [{ subject: 42 }, { subject: tooLong }, { topic: ["x"] }]) {
      const res = await request(app)
        .post("/api/ai/conversations")
        .set(auth(f.studentToken, f.organizationId))
        .send(body);
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/ai/conversations/:id/messages", () => {
  it("returns an empty list for a fresh conversation", async () => {
    const f = await studentFixture("empty");
    const conversationId = await createConversation(f);
    const res = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("rejects an invalid conversation id", async () => {
    const f = await studentFixture("bad-id");
    const res = await request(app)
      .get("/api/ai/conversations/not-a-uuid/messages")
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("loads an owned conversation without x-organization-id (browser regression)", async () => {
    // Reproduces the real browser flow: no x-organization-id header, so the
    // route must not mistake the conversation UUID for an organization id.
    const f = await studentFixture("headerless");
    const conversationId = await createConversation(f, { subject: "Maths" });

    await request(app)
      .post("/api/ai/reply")
      .set(authHeaderless(f.studentToken))
      .send({ conversation_id: conversationId, question: "What is 2 + 2?" });

    const res = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages`)
      .set(authHeaderless(f.studentToken));
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(res.body.messages[0].content).toBe("What is 2 + 2?");
    expect(res.body.total).toBe(2);
  });

  it("rejects another student's conversation (IDOR)", async () => {
    const f = await studentFixture("idor");
    const conversationId = await createConversation(f);

    const otherUser = await createUser("idor-intruder");
    await addMember(otherUser, f.organizationId, "STUDENT");
    await createStudent(f.organizationId, otherUser, "Intruder");

    const res = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(createAccessToken(otherUser), f.organizationId));
    expect(res.status).toBe(404);
  });

  it("rejects a cross-tenant conversation", async () => {
    const a = await studentFixture("tenant-a");
    const b = await studentFixture("tenant-b");
    const conversationId = await createConversation(a);

    const res = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(b.studentToken, b.organizationId));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/ai/conversations", () => {
  it("lists only the student's own conversations newest-first", async () => {
    const f = await studentFixture("list");
    const first = await createConversation(f, { subject: "Maths" });
    const second = await createConversation(f, { subject: "Science" });

    const otherUser = await createUser("list-other");
    await addMember(otherUser, f.organizationId, "STUDENT");
    await createStudent(f.organizationId, otherUser, "Other");
    const otherConversation = await pool.query(
      `INSERT INTO ai_conversations (organization_id, student_id, subject)
       VALUES ($1, (SELECT id FROM students_v2 WHERE user_id = $2 AND organization_id = $1), 'Other')
       RETURNING id`,
      [f.organizationId, otherUser]
    );
    created.conversations.push(otherConversation.rows[0].id);

    const res = await request(app)
      .get("/api/ai/conversations")
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    const ids = res.body.conversations.map((c: { id: string }) => c.id);
    expect(ids).toEqual([second, first]);
    expect(res.body.total).toBe(2);
  });

  it("returns an empty list when the student has no conversations", async () => {
    const f = await studentFixture("list-empty");
    const res = await request(app)
      .get("/api/ai/conversations")
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.conversations).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("isolates conversation lists by tenant", async () => {
    const a = await studentFixture("list-tenant-a");
    const b = await studentFixture("list-tenant-b");
    await createConversation(a);

    const res = await request(app)
      .get("/api/ai/conversations")
      .set(auth(b.studentToken, b.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.conversations).toEqual([]);
  });
});

describe("POST /api/ai/reply security containment", () => {
  it("rejects unauthenticated replies without persisting or generating", async () => {
    const f = await studentFixture("reply-unauthenticated");
    const conversationId = await createConversation(f);
    const providerSpy = vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata");

    const res = await request(app)
      .post("/api/ai/reply")
      .send({ conversation_id: conversationId, question: "Can you help me?" });

    expect(res.status).toBe(401);
    const messages = await pool.query("SELECT id FROM ai_messages WHERE conversation_id = $1", [conversationId]);
    expect(messages.rows).toHaveLength(0);
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it("rejects teacher, parent, and administrator roles without persisting or generating", async () => {
    const f = await studentFixture("reply-roles");
    const conversationId = await createConversation(f);
    const roleMembers: Array<{ label: string; token: string }> = [];

    for (const [label, roleName] of [
      ["teacher", "TEACHER"],
      ["parent", "PARENT"],
    ] as const) {
      const userId = await createUser(`reply-${label}`);
      await addMember(userId, f.organizationId, roleName);
      roleMembers.push({ label, token: createAccessToken(userId) });
    }
    roleMembers.push({ label: "admin", token: f.adminToken });

    const providerSpy = vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata");
    const responses = [];
    for (const member of roleMembers) {
      responses.push(
        await request(app)
          .post("/api/ai/reply")
          .set(auth(member.token, f.organizationId))
          .send({ conversation_id: conversationId, question: `Can ${member.label} use this?` })
      );
    }
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);

    const messages = await pool.query("SELECT id FROM ai_messages WHERE conversation_id = $1", [conversationId]);
    expect(messages.rows).toHaveLength(0);
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for another student's conversation in the same organization", async () => {
    const f = await studentFixture("reply-idor");
    const conversationId = await createConversation(f);
    const otherUserId = await createUser("reply-idor-intruder");
    await addMember(otherUserId, f.organizationId, "STUDENT");
    await createStudent(f.organizationId, otherUserId, "Reply Intruder");
    const providerSpy = vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata");

    const res = await request(app)
      .post("/api/ai/reply")
      .set(auth(createAccessToken(otherUserId), f.organizationId))
      .send({ conversation_id: conversationId, question: "Can I read this?" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ status: "error", message: "Conversation not found" });
    const messages = await pool.query("SELECT id FROM ai_messages WHERE conversation_id = $1", [conversationId]);
    expect(messages.rows).toHaveLength(0);
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for a conversation owned by another organization", async () => {
    const owner = await studentFixture("reply-tenant-owner");
    const otherTenant = await studentFixture("reply-tenant-other");
    const conversationId = await createConversation(owner);
    const providerSpy = vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata");

    const res = await request(app)
      .post("/api/ai/reply")
      .set(auth(otherTenant.studentToken, otherTenant.organizationId))
      .send({ conversation_id: conversationId, question: "Can I read this?" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ status: "error", message: "Conversation not found" });
    const messages = await pool.query("SELECT id FROM ai_messages WHERE conversation_id = $1", [conversationId]);
    expect(messages.rows).toHaveLength(0);
    expect(providerSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/reply message persistence", () => {
  it("persists the student question and assistant reply in chronological order", async () => {
    const f = await studentFixture("reply");
    const conversationId = await createConversation(f, { subject: "Maths", topic: "Fractions" });

    const res = await request(app)
      .post("/api/ai/reply")
      .set(auth(f.studentToken, f.organizationId))
      .send({ conversation_id: conversationId, question: "What is 1/2 + 1/4?" });

    // Existing contract is unchanged.
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.data.role).toBe("assistant");
    expect(typeof res.body.data.content).toBe("string");

    const history = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(history.status).toBe(200);
    expect(history.body.total).toBe(2);
    expect(history.body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(history.body.messages[0].content).toBe("What is 1/2 + 1/4?");
    expect(history.body.messages[1].content).toBe(res.body.data.content);
    expect(
      new Date(history.body.messages[0].created_at).getTime()
    ).toBeLessThanOrEqual(new Date(history.body.messages[1].created_at).getTime());
  });

  it("bumps the conversation to the top of the newest-first list after a reply", async () => {
    const f = await studentFixture("bump");
    const first = await createConversation(f, { subject: "Maths" });
    const second = await createConversation(f, { subject: "Science" });

    await request(app)
      .post("/api/ai/reply")
      .set(auth(f.studentToken, f.organizationId))
      .send({ conversation_id: first, question: "Hello?" });

    const res = await request(app)
      .get("/api/ai/conversations")
      .set(auth(f.studentToken, f.organizationId));
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([first, second]);
  });
});
