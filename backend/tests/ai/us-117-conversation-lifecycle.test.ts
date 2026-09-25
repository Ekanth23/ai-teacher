import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { MockLlmProvider } from "../../src/modules/ai/providers/mock.provider.js";
import { PostgresUsageTracker } from "../../src/modules/ai/usage/postgres.usage.tracker.js";
import { createApp } from "../../src/server.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();
const created = {
  users: [] as string[],
  organizations: [] as string[],
  students: [] as string[],
  conversations: [] as string[],
};

const unique = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function cleanup() {
  if (created.conversations.length) {
    await pool.query("DELETE FROM ai_usage_events WHERE conversation_id = ANY($1::uuid[])", [created.conversations]);
    await pool.query("DELETE FROM ai_idempotency_keys WHERE conversation_id = ANY($1::uuid[])", [created.conversations]);
    await pool.query("DELETE FROM ai_generation_attempts WHERE conversation_id = ANY($1::uuid[])", [created.conversations]);
    await pool.query("DELETE FROM ai_conversations WHERE id = ANY($1::uuid[])", [created.conversations]);
  }
  if (created.students.length) await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  Object.values(created).forEach((ids) => (ids.length = 0));
}

beforeEach(() => {
  process.env.AI_PROVIDER = "mock";
});

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

async function createUser(label: string) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${unique(`us117_${label}`)}@example.com`, `US117 ${label}`]
  );
  created.users.push(result.rows[0].id);
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

async function createStudent(organizationId: string, userId: string, name: string) {
  const result = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status)
     VALUES ($1, $2, $3, '8', 'ACTIVE') RETURNING id`,
    [userId, organizationId, name]
  );
  created.students.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function fixture(label: string) {
  const adminId = await createUser(`${label}-admin`);
  const organizationId = (
    await pool.query(
      `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
       VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
      [`US117 ${label}`, unique(`us117_org_${label}`), adminId]
    )
  ).rows[0].id;
  created.organizations.push(organizationId);
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  const studentUserId = await createUser(`${label}-student`);
  await addMember(studentUserId, organizationId, "STUDENT");
  const studentId = await createStudent(organizationId, studentUserId, `${label} Student`);
  return {
    organizationId,
    studentId,
    studentUserId,
    studentToken: createAccessToken(studentUserId),
    adminToken: createAccessToken(adminId),
  };
}

async function createConversation(
  f: ReturnType<typeof fixture>,
  body: Record<string, unknown> = {},
  expectedStatus = 201
) {
  const response = await request(app)
    .post("/api/ai/conversations")
    .set(auth(f.studentToken, f.organizationId))
    .send(body);
  expect(response.status).toBe(expectedStatus);
  created.conversations.push(response.body.conversation.id);
  return response;
}

describe("US-117 conversation lifecycle", () => {
  it("creates a titled request, attempt, response, and usage linkage", async () => {
    const f = await fixture("create-question");
    const response = await createConversation(f, { question: "What is a fraction?" });

    expect(response.body.conversation.title).toBe("What is a fraction?");
    expect(response.body.student_message.status).toBe("COMPLETED");
    expect(response.body.response_message.role).toBe("assistant");
    expect(response.body.attempt.status).toBe("COMPLETED");

    const messages = await pool.query(
      `SELECT role, status, sequence_number FROM ai_messages
        WHERE conversation_id = $1
        ORDER BY sequence_number, CASE role WHEN 'user' THEN 0 ELSE 1 END`,
      [response.body.conversation.id]
    );
    expect(messages.rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(messages.rows.every((row) => row.status === "COMPLETED")).toBe(true);

    const usage = await pool.query(
      `SELECT generation_attempt_id, status FROM ai_usage_events
        WHERE conversation_id = $1`,
      [response.body.conversation.id]
    );
    expect(usage.rows).toHaveLength(1);
    expect(usage.rows[0].generation_attempt_id).toBe(response.body.attempt.id);
  });

  it("keeps a configuration failure inside the durable request lifecycle", async () => {
    const f = await fixture("configuration-failure");
    process.env.AI_PROVIDER = "unsupported-provider";
    const response = await createConversation(f, { question: "Keep this request" }, 502);

    expect(response.status).toBe(502);
    expect(response.body.attempt.status).toBe("FAILED");
    expect(response.body.attempt.provider).toBe("unknown");
    expect(response.body.student_message.status).toBe("FAILED");
    expect(response.body.response_message).toBeNull();

    const messages = await pool.query(
      `SELECT role, status FROM ai_messages WHERE conversation_id = $1 ORDER BY role`,
      [response.body.conversation.id]
    );
    expect(messages.rows).toEqual([{ role: "user", status: "FAILED" }]);
  });

  it("keeps a failed student request, marks the attempt failed, and retries without a duplicate message", async () => {
    const f = await fixture("failure-retry");
    const failure = vi
      .spyOn(MockLlmProvider.prototype, "generateWithMetadata")
      .mockRejectedValueOnce(new Error("DeepSeek request failed with status 429 rate limit"));
    const response = await createConversation(f, { question: "Explain gravity" }, 502);
    expect(response.status).toBe(502);
    expect(failure).toHaveBeenCalledTimes(1);
    const conversationId = response.body.conversation.id;
    const attemptId = response.body.attempt.id;

    const failed = await pool.query(
      `SELECT status FROM ai_generation_attempts WHERE id = $1`,
      [attemptId]
    );
    expect(failed.rows[0].status).toBe("FAILED");
    const failedMessages = await pool.query(
      `SELECT role, status FROM ai_messages WHERE conversation_id = $1 ORDER BY role`,
      [conversationId]
    );
    expect(failedMessages.rows).toEqual([{ role: "user", status: "FAILED" }]);

    const retry = await request(app)
      .post(`/api/ai/conversations/${conversationId}/retry`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ attempt_id: attemptId });
    expect(retry.status).toBe(201);
    expect(retry.body.attempt.retry_of_attempt_id).toBe(attemptId);
    expect(retry.body.student_message.id).toBe(response.body.student_message.id);

    const attempts = await pool.query(
      `SELECT attempt_type, status, retry_of_attempt_id, response_message_id
         FROM ai_generation_attempts WHERE conversation_id = $1 ORDER BY attempt_number`,
      [conversationId]
    );
    expect(attempts.rows).toHaveLength(2);
    expect(attempts.rows[0].status).toBe("FAILED");
    expect(attempts.rows[1].attempt_type).toBe("RETRY");
    expect(attempts.rows[1].status).toBe("COMPLETED");
    expect(attempts.rows[1].retry_of_attempt_id).toBe(attemptId);
    expect(attempts.rows[1].response_message_id).toBeTruthy();
    const usage = await pool.query(
      `SELECT generation_attempt_id, status FROM ai_usage_events
        WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    expect(usage.rows).toHaveLength(2);
    expect(usage.rows.map((row) => row.status)).toEqual(["FAILURE", "SUCCESS"]);
  });

  it("keeps the failed request paired with its successful retry in later history", async () => {
    const f = await fixture("retry-history");
    const prompts: string[] = [];
    vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        throw new Error("rate limit");
      }
      return {
        text: "A safe answer.",
        metadata: {
          provider: "mock",
          model: "mock-model",
          status: "SUCCESS",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: `request-${prompts.length}`,
        },
      };
    });
    const createdResponse = await createConversation(f, { question: "What is gravity?" }, 502);
    const conversationId = createdResponse.body.conversation.id;
    const attemptId = createdResponse.body.attempt.id;

    const retry = await request(app)
      .post(`/api/ai/conversations/${conversationId}/retry`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ attempt_id: attemptId });
    expect(retry.status).toBe(201);
    expect(prompts[1]).toContain("STUDENT: What is gravity?");

    await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Tell me more." });
    expect(prompts[2]).toContain("STUDENT: What is gravity?");
    expect(prompts[2]).toContain("ASSISTANT: A safe answer.");
  });

  it("regenerates a response without creating a new student message", async () => {
    const f = await fixture("regenerate");
    const createdResponse = await createConversation(f, { question: "What is 2 + 2?" });
    const conversationId = createdResponse.body.conversation.id;
    const responseId = createdResponse.body.response_message.id;

    const regenerated = await request(app)
      .post(`/api/ai/conversations/${conversationId}/regenerate`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ response_message_id: responseId });
    expect(regenerated.status).toBe(201);
    expect(regenerated.body.attempt.parent_attempt_id).toBe(createdResponse.body.attempt.id);
    expect(regenerated.body.student_message.id).toBe(createdResponse.body.student_message.id);

    const messages = await pool.query(
      `SELECT id, role, request_message_id, variant_number, generation_attempt_id, content
         FROM ai_messages
        WHERE conversation_id = $1
        ORDER BY sequence_number, CASE role WHEN 'user' THEN 0 ELSE 1 END, variant_number`,
      [conversationId]
    );
    const userMessages = messages.rows.filter((row) => row.role === "user");
    const assistantMessages = messages.rows.filter((row) => row.role === "assistant");
    expect(userMessages).toHaveLength(1);
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages.map((row) => row.request_message_id)).toEqual([
      userMessages[0].id,
      userMessages[0].id,
    ]);
    expect(assistantMessages.map((row) => row.variant_number)).toEqual([1, 2]);
    expect(new Set(assistantMessages.map((row) => row.generation_attempt_id)).size).toBe(2);
    expect(assistantMessages[0].content).toBe("MOCK_LLM_RESPONSE");
    const usage = await pool.query(
      `SELECT generation_attempt_id FROM ai_usage_events WHERE conversation_id = $1`,
      [conversationId]
    );
    expect(usage.rows).toHaveLength(2);
  });

  it("edits a student message into a branch while preserving the original", async () => {
    const f = await fixture("branch");
    const createdResponse = await createConversation(f, { question: "What is photosynthesis?" });
    const conversationId = createdResponse.body.conversation.id;
    const originalMessageId = createdResponse.body.student_message.id;

    const parentFollowup = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "A follow-up on the original branch" });
    expect(parentFollowup.status).toBe(201);
    await pool.query(
      `UPDATE ai_messages SET content = 'PARENT FOLLOWUP RESPONSE'
        WHERE id = $1`,
      [parentFollowup.body.response_message.id]
    );

    const edited = await request(app)
      .patch(`/api/ai/conversations/${conversationId}/messages/${originalMessageId}`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ content: "What is photosynthesis in simple words?" });
    expect(edited.status).toBe(201);
    expect(edited.body.student_message.parent_message_id).toBe(originalMessageId);
    expect(edited.body.student_message.original_message_id).toBe(originalMessageId);

    const branches = await request(app)
      .get(`/api/ai/conversations/${conversationId}/branches`)
      .set(auth(f.studentToken, f.organizationId));
    expect(branches.status).toBe(200);
    expect(branches.body.branches).toHaveLength(2);
    expect(branches.body.branches.filter((branch: { is_primary: boolean }) => branch.is_primary)).toHaveLength(1);

    const original = await pool.query("SELECT content FROM ai_messages WHERE id = $1", [originalMessageId]);
    expect(original.rows[0].content).toBe("What is photosynthesis?");

    const activeHistory = await request(app)
      .get(`/api/ai/conversations/${conversationId}`)
      .set(auth(f.studentToken, f.organizationId));
    expect(activeHistory.body.messages.map((message: { content: string }) => message.content)).toEqual([
      "What is photosynthesis in simple words?",
      "MOCK_LLM_RESPONSE",
    ]);

    const listed = await request(app)
      .get("/api/ai/conversations")
      .set(auth(f.studentToken, f.organizationId));
    expect(listed.status).toBe(200);
    expect(listed.body.conversations[0].latest_message_preview).toBe("MOCK_LLM_RESPONSE");

    const primaryBranch = branches.body.branches.find((branch: { is_primary: boolean }) => branch.is_primary);
    const primaryHistory = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages?branch_id=${primaryBranch.id}`)
      .set(auth(f.studentToken, f.organizationId));
    expect(primaryHistory.body.messages.map((message: { content: string }) => message.content)).toEqual([
      "What is photosynthesis?",
      "MOCK_LLM_RESPONSE",
      "A follow-up on the original branch",
      "PARENT FOLLOWUP RESPONSE",
    ]);
  });

  it("accepts one predefined feedback record and rejects duplicates and foreign students", async () => {
    const f = await fixture("feedback");
    const createdResponse = await createConversation(f, { question: "Explain gravity" });
    const conversationId = createdResponse.body.conversation.id;
    const responseId = createdResponse.body.response_message.id;

    const first = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages/${responseId}/feedback`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ sentiment: "not helpful", reason: "not clear" });
    expect(first.status).toBe(201);
    expect(first.body.feedback.reason).toBe("not clear");

    const duplicate = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages/${responseId}/feedback`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ sentiment: "helpful" });
    expect(duplicate.status).toBe(409);

    const hydrated = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(hydrated.status).toBe(200);
    expect(hydrated.body.messages.find((message: { id: string }) => message.id === responseId).feedback).toMatchObject({
      response_message_id: responseId,
      sentiment: "NOT_HELPFUL",
      reason: "not clear",
    });

    const otherUser = await createUser("feedback-other");
    await addMember(otherUser, f.organizationId, "STUDENT");
    await createStudent(f.organizationId, otherUser, "Other Student");
    const foreign = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages/${responseId}/feedback`)
      .set(auth(createAccessToken(otherUser), f.organizationId))
      .send({ sentiment: "helpful" });
    expect(foreign.status).toBe(404);
  });

  it("excludes deleted conversations and fails closed on subsequent access", async () => {
    const f = await fixture("delete");
    const createdResponse = await createConversation(f, { question: "Delete me" });
    const conversationId = createdResponse.body.conversation.id;

    const deleted = await request(app)
      .delete(`/api/ai/conversations/${conversationId}`)
      .set(auth(f.studentToken, f.organizationId));
    expect(deleted.status).toBe(200);

    const read = await request(app)
      .get(`/api/ai/conversations/${conversationId}`)
      .set(auth(f.studentToken, f.organizationId));
    expect(read.status).toBe(404);
    const list = await request(app)
      .get("/api/ai/conversations")
      .set(auth(f.studentToken, f.organizationId));
    expect(list.body.conversations).toEqual([]);
  });

  it("uses the fallback title, supports rename, and persists safe scope labels", async () => {
    const f = await fixture("title-scope");
    const createdResponse = await createConversation(f, {
      scope: {
        board: "CBSE",
        class: "Class 8",
        chapter: "Fractions",
        language: "English",
        medium: "English",
      },
    });
    expect(createdResponse.body.conversation.title).toBe("New Conversation");
    expect(createdResponse.body.conversation.scope).toMatchObject({
      board: "CBSE",
      class: "Class 8",
      chapter: "Fractions",
      language: "English",
      medium: "English",
    });

    const renamed = await request(app)
      .patch(`/api/ai/conversations/${createdResponse.body.conversation.id}`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ title: "My study notes" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.conversation.title).toBe("My study notes");
  });

  it("bounds conversation-list previews without truncating owner history", async () => {
    const f = await fixture("preview-bound");
    const createdResponse = await createConversation(f, { question: "Preview question" });
    const longContent = "x".repeat(500);
    await pool.query(`UPDATE ai_messages SET content = $1 WHERE id = $2`, [
      longContent,
      createdResponse.body.response_message.id,
    ]);
    const listed = await request(app)
      .get("/api/ai/conversations")
      .set(auth(f.studentToken, f.organizationId));
    expect(listed.body.conversations[0].latest_message_preview.length).toBeLessThanOrEqual(200);
    const history = await request(app)
      .get(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(history.body.messages.find((message: { id: string }) => message.id === createdResponse.body.response_message.id).content).toBe(longContent);
  });

  it("persists PROCESSING before provider completion and then completes atomically", async () => {
    const f = await fixture("processing");
    const createdResponse = await createConversation(f);
    let releaseProvider!: (value: {
      text: string;
      metadata: {
        provider: "mock";
        model: string;
        status: "SUCCESS";
        usage: { inputTokens: number; outputTokens: number; totalTokens: number };
        requestId: string;
      };
    }) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async () => {
      markStarted();
      return new Promise((resolve) => {
        releaseProvider = resolve;
      });
    });

    const pending = request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Explain fractions" })
      .then((response) => response);
    await started;

    const processing = await pool.query(
      `SELECT m.status AS message_status, a.status AS attempt_status
         FROM ai_messages m
         JOIN ai_generation_attempts a ON a.request_message_id = m.id
        WHERE m.conversation_id = $1
        ORDER BY a.created_at DESC LIMIT 1`,
      [createdResponse.body.conversation.id]
    );
    expect(processing.rows[0]).toMatchObject({ message_status: "PROCESSING", attempt_status: "PROCESSING" });

    releaseProvider({
      text: "A fraction represents part of a whole.",
      metadata: {
        provider: "mock",
        model: "mock-model",
        status: "SUCCESS",
        usage: { inputTokens: 4, outputTokens: 8, totalTokens: 12 },
        requestId: "processing-request",
      },
    });
    const completed = await pending;
    expect(completed.status).toBe(201);
    const finalState = await pool.query(
      `SELECT m.status AS message_status, a.status AS attempt_status
         FROM ai_messages m
         JOIN ai_generation_attempts a ON a.request_message_id = m.id
        WHERE m.conversation_id = $1
        ORDER BY a.created_at DESC LIMIT 1`,
      [createdResponse.body.conversation.id]
    );
    expect(finalState.rows[0]).toMatchObject({ message_status: "COMPLETED", attempt_status: "COMPLETED" });
  });

  it("does not expose provider details on controlled failure", async () => {
    const f = await fixture("failure-redaction");
    const secret = "provider-secret-value";
    vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockRejectedValueOnce(
      new Error(`DeepSeek request failed: ${secret}`)
    );
    const response = await createConversation(f, { question: "Safe question" }, 502);
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(response.body.message).not.toContain("DeepSeek");
  });

  it("rejects a teacher and a same-organization foreign student on new lifecycle routes", async () => {
    const owner = await fixture("new-routes-owner");
    const createdResponse = await createConversation(owner, { question: "Private question" });
    const conversationId = createdResponse.body.conversation.id;

    const teacherId = await createUser("new-routes-teacher");
    await addMember(teacherId, owner.organizationId, "TEACHER");
    const teacherResponse = await request(app)
      .get(`/api/ai/conversations/${conversationId}`)
      .set(auth(createAccessToken(teacherId), owner.organizationId));
    expect(teacherResponse.status).toBe(403);

    const otherUser = await createUser("new-routes-other");
    await addMember(otherUser, owner.organizationId, "STUDENT");
    await createStudent(owner.organizationId, otherUser, "Other");
    const foreignResponse = await request(app)
      .patch(`/api/ai/conversations/${conversationId}`)
      .set(auth(createAccessToken(otherUser), owner.organizationId))
      .send({ title: "Should not work" });
    expect(foreignResponse.status).toBe(404);
  });

  it("rejects non-object conversation request bodies", async () => {
    const f = await fixture("body-validation");
    const response = await request(app)
      .post("/api/ai/conversations")
      .set(auth(f.studentToken, f.organizationId))
      .send([]);
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("object");
  });

  it("rejects invalid feedback reasons and keeps logical ordering independent of timestamps", async () => {
    const f = await fixture("ordering-validation");
    const createdResponse = await createConversation(f, { question: "First question" });
    const conversationId = createdResponse.body.conversation.id;
    const second = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Second question" });
    expect(second.status).toBe(201);

    await pool.query(
      `UPDATE ai_messages SET created_at = NOW() + INTERVAL '1 day' WHERE conversation_id = $1 AND role = 'user'`,
      [conversationId]
    );
    const history = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(history.body.messages.filter((message: { role: string }) => message.role === "user").map((message: { content: string }) => message.content)).toEqual([
      "First question",
      "Second question",
    ]);

    const invalid = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages/${createdResponse.body.response_message.id}/feedback`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ sentiment: "not helpful", reason: "because I said so" });
    expect(invalid.status).toBe(400);
  });
});

describe("US-117 remediation lifecycle", () => {
  it("exposes a processing attempt after reload and resumes the lifecycle", async () => {
    const f = await fixture("processing-reload");
    const empty = await createConversation(f);
    let releaseProvider!: (value: {
      text: string;
      metadata: {
        provider: "mock";
        model: string;
        status: "SUCCESS";
        usage: { inputTokens: number; outputTokens: number; totalTokens: number };
        requestId: string;
      };
    }) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async () => {
      markStarted();
      return new Promise((resolve) => {
        releaseProvider = resolve;
      });
    });

    const pending = request(app)
      .post(`/api/ai/conversations/${empty.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Explain this after reload" })
      .then((response) => response);
    await started;

    const processing = await request(app)
      .get(`/api/ai/conversations/${empty.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(processing.status).toBe(200);
    expect(processing.body.active_attempt.status).toBe("PROCESSING");
    expect(processing.body.processing_attempt.id).toBe(processing.body.active_attempt.id);
    expect(processing.body.messages.some((message: { status?: string }) => message.status === "PROCESSING")).toBe(true);

    releaseProvider({
      text: "Completed after reload.",
      metadata: {
        provider: "mock",
        model: "mock-model",
        status: "SUCCESS",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: "reload-request",
      },
    });
    const completed = await pending;
    expect(completed.status).toBe(201);

    const terminal = await request(app)
      .get(`/api/ai/conversations/${empty.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(terminal.body.active_attempt).toBeNull();
    expect(terminal.body.attempts[0].status).toBe("COMPLETED");
  });

  it("recovers a lost create response without creating a second conversation", async () => {
    const f = await fixture("idempotent-create");
    const key = unique("create-key");
    const headers = { ...auth(f.studentToken, f.organizationId), "Idempotency-Key": key };
    const first = await request(app)
      .post("/api/ai/conversations")
      .set(headers)
      .send({ question: "Only one conversation" });
    expect(first.status).toBe(201);
    created.conversations.push(first.body.conversation.id);

    const replay = await request(app)
      .post("/api/ai/conversations")
      .set(headers)
      .send({ question: "Only one conversation" });
    expect(replay.status).toBe(201);
    expect(replay.body.conversation.id).toBe(first.body.conversation.id);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ai_conversations
        WHERE organization_id = $1 AND student_id = $2`,
      [f.organizationId, f.studentId]
    );
    expect(count.rows[0].count).toBe(1);
  });

  it("recovers a lost message response without duplicating the student request", async () => {
    const f = await fixture("idempotent-message");
    const createdResponse = await createConversation(f);
    const key = unique("message-key");
    const headers = { ...auth(f.studentToken, f.organizationId), "Idempotency-Key": key };
    const first = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(headers)
      .send({ question: "One logical question" });
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(headers)
      .send({ question: "One logical question" });
    expect(replay.status).toBe(201);
    expect(replay.body.student_message.id).toBe(first.body.student_message.id);
    expect(replay.body.attempt.id).toBe(first.body.attempt.id);

    const messages = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ai_messages
        WHERE conversation_id = $1 AND role = 'user'`,
      [createdResponse.body.conversation.id]
    );
    const attempts = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ai_generation_attempts
        WHERE conversation_id = $1`,
      [createdResponse.body.conversation.id]
    );
    expect(messages.rows[0].count).toBe(1);
    expect(attempts.rows[0].count).toBe(1);
  });

  it("updates scope for subsequent generations without rewriting history", async () => {
    const f = await fixture("scope-lifecycle");
    const prompts: string[] = [];
    vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async (prompt) => {
      prompts.push(prompt);
      return {
        text: "Scoped answer",
        metadata: {
          provider: "mock",
          model: "mock-model",
          status: "SUCCESS",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: `scope-${prompts.length}`,
        },
      };
    });
    const createdResponse = await createConversation(f, {
      question: "Explain the original scope",
      scope: { board: "CBSE", class: "Class 8", subject: "Maths", chapter: "Fractions" },
    });
    const conversationId = createdResponse.body.conversation.id;

    const followUp = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Inherit the scope" });
    expect(followUp.status).toBe(201);
    expect(prompts[1]).toContain("Board: CBSE");
    expect(prompts[1]).toContain("Chapter: Fractions");

    const changed = await request(app)
      .patch(`/api/ai/conversations/${conversationId}/scope`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ scope: { board: null, subject: "Science", chapter: "Plants" } });
    expect(changed.status).toBe(200);
    expect(changed.body.conversation.scope.board).toBeNull();
    expect(changed.body.conversation.scope.subject).toBe("Science");

    const afterChange = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Use the new scope" });
    expect(afterChange.status).toBe(201);
    expect(prompts[2]).toContain("Subject: Science");
    expect(prompts[2]).toContain("Chapter: Plants");
    expect(prompts[2]).toContain("Board: not provided");

    const history = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(history.body.messages[0].content).toBe("Explain the original scope");
    expect(history.body.messages[1].content).toBe("Scoped answer");
  });

  it("retries usage persistence in the same attempt before completing", async () => {
    const f = await fixture("usage-retry");
    let persistenceCalls = 0;
    const originalRecordUsage = PostgresUsageTracker.prototype.recordUsage;
    vi.spyOn(PostgresUsageTracker.prototype, "recordUsage").mockImplementation(async function (event) {
      persistenceCalls += 1;
      if (persistenceCalls === 1) return undefined;
      return originalRecordUsage.call(this, event);
    });
    const response = await createConversation(f, { question: "Retry usage linkage" });
    expect(response.status).toBe(201);
    expect(response.body.attempt.status).toBe("COMPLETED");
    expect(response.body.attempt.usage_event_id).toBeTruthy();
    expect(persistenceCalls).toBeGreaterThanOrEqual(2);
  });

  it("does not complete a provider success when usage persistence is unrecoverable", async () => {
    const f = await fixture("usage-required");
    vi.spyOn(PostgresUsageTracker.prototype, "recordUsage").mockResolvedValue(undefined);
    const response = await createConversation(f, { question: "Usage must be durable" }, 502);
    expect(response.body.attempt.status).toBe("FAILED");
    expect(response.body.response_message).toBeNull();
    const rows = await pool.query(
      `SELECT a.status, a.usage_event_id, m.status AS message_status
         FROM ai_generation_attempts a
         JOIN ai_messages m ON m.id = a.request_message_id
        WHERE a.conversation_id = $1`,
      [response.body.conversation.id]
    );
    expect(rows.rows[0]).toMatchObject({ status: "FAILED", usage_event_id: null, message_status: "FAILED" });
  });

  it("finalizes a deferred generation as FAILED when its conversation is deleted", async () => {
    const f = await fixture("delete-during-generation");
    const empty = await createConversation(f);
    let releaseProvider!: (value: {
      text: string;
      metadata: {
        provider: "mock";
        model: string;
        status: "SUCCESS";
        usage: { inputTokens: number; outputTokens: number; totalTokens: number };
        requestId: string;
      };
    }) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async () => {
      markStarted();
      return new Promise((resolve) => {
        releaseProvider = resolve;
      });
    });

    const pending = request(app)
      .post(`/api/ai/conversations/${empty.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Delete while thinking" })
      .then((response) => response);
    await started;
    const deleted = await request(app)
      .delete(`/api/ai/conversations/${empty.body.conversation.id}`)
      .set(auth(f.studentToken, f.organizationId));
    expect(deleted.status).toBe(200);

    releaseProvider({
      text: "This must not become visible",
      metadata: {
        provider: "mock",
        model: "mock-model",
        status: "SUCCESS",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: "deleted-request",
      },
    });
    await pending;
    const attempt = await pool.query(
      `SELECT status FROM ai_generation_attempts WHERE conversation_id = $1`,
      [empty.body.conversation.id]
    );
    expect(attempt.rows[0].status).toBe("FAILED");
    const visible = await request(app)
      .get(`/api/ai/conversations/${empty.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(visible.status).toBe(404);
  });

  it("allows only authoritative legacy request linkage for regeneration", async () => {
    const f = await fixture("legacy-regeneration");
    const createdResponse = await createConversation(f, { question: "Legacy regeneration" });
    const conversationId = createdResponse.body.conversation.id;
    const responseId = createdResponse.body.response_message.id as string;
    await pool.query(`DELETE FROM ai_usage_events WHERE conversation_id = $1`, [conversationId]);
    await pool.query(`DELETE FROM ai_generation_attempts WHERE conversation_id = $1`, [conversationId]);

    const linked = await request(app)
      .post(`/api/ai/conversations/${conversationId}/regenerate`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ response_message_id: responseId });
    expect(linked.status).toBe(201);

    const unlinked = await pool.query(
      `INSERT INTO ai_messages
         (conversation_id, role, content, status, branch_id, sequence_number, variant_number)
       SELECT conversation_id, 'assistant', 'Unlinked legacy response', 'COMPLETED',
              branch_id, sequence_number, 3
         FROM ai_messages WHERE id = $1
       RETURNING id`,
      [responseId]
    );
    const unavailable = await request(app)
      .post(`/api/ai/conversations/${conversationId}/regenerate`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ response_message_id: unlinked.rows[0].id });
    expect(unavailable.status).toBe(409);
  });

  it("exposes a retry attempt as PROCESSING after a reload", async () => {
    const f = await fixture("retry-processing-reload");
    let releaseProvider!: (value: {
      text: string;
      metadata: {
        provider: "mock";
        model: string;
        status: "SUCCESS";
        usage: { inputTokens: number; outputTokens: number; totalTokens: number };
        requestId: string;
      };
    }) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let calls = 0;
    vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("rate limit");
      markStarted();
      return new Promise((resolve) => {
        releaseProvider = resolve;
      });
    });
    const failed = await createConversation(f, { question: "Retry after reload" }, 502);
    const pending = request(app)
      .post(`/api/ai/conversations/${failed.body.conversation.id}/retry`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ attempt_id: failed.body.attempt.id })
      .then((response) => response);
    await started;
    const processing = await request(app)
      .get(`/api/ai/conversations/${failed.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(processing.body.active_attempt.attempt_type).toBe("RETRY");
    expect(processing.body.active_attempt.status).toBe("PROCESSING");
    expect(processing.body.messages[0].status).toBe("FAILED");

    releaseProvider({
      text: "Retry completed.",
      metadata: {
        provider: "mock",
        model: "mock-model",
        status: "SUCCESS",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: "retry-reload-request",
      },
    });
    expect((await pending).status).toBe(201);
    const terminal = await request(app)
      .get(`/api/ai/conversations/${failed.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(terminal.body.active_attempt).toBeNull();
    expect(terminal.body.attempts.at(-1).status).toBe("COMPLETED");
  });

  it("exposes a regeneration attempt as PROCESSING after a reload", async () => {
    const f = await fixture("regeneration-processing-reload");
    const createdResponse = await createConversation(f, { question: "Regenerate after reload" });
    let releaseProvider!: (value: {
      text: string;
      metadata: {
        provider: "mock";
        model: string;
        status: "SUCCESS";
        usage: { inputTokens: number; outputTokens: number; totalTokens: number };
        requestId: string;
      };
    }) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async () => {
      markStarted();
      return new Promise((resolve) => {
        releaseProvider = resolve;
      });
    });
    const pending = request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/regenerate`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ response_message_id: createdResponse.body.response_message.id })
      .then((response) => response);
    await started;
    const processing = await request(app)
      .get(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(processing.body.active_attempt.attempt_type).toBe("REGENERATION");
    expect(processing.body.active_attempt.status).toBe("PROCESSING");

    releaseProvider({
      text: "Regenerated completed.",
      metadata: {
        provider: "mock",
        model: "mock-model",
        status: "SUCCESS",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: "regeneration-reload-request",
      },
    });
    expect((await pending).status).toBe(201);
    const terminal = await request(app)
      .get(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId));
    expect(terminal.body.active_attempt).toBeNull();
    expect(terminal.body.attempts.at(-1).status).toBe("COMPLETED");
  });

  it("keeps branch previews read-only and requires explicit branch selection for writes", async () => {
    const f = await fixture("branch-read-write");
    const createdResponse = await createConversation(f, { question: "Branch semantics" });
    const conversationId = createdResponse.body.conversation.id;
    const originalMessageId = createdResponse.body.student_message.id;
    const edited = await request(app)
      .patch(`/api/ai/conversations/${conversationId}/messages/${originalMessageId}`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ content: "An edited branch" });
    expect(edited.status).toBe(201);

    const branches = await request(app)
      .get(`/api/ai/conversations/${conversationId}/branches`)
      .set(auth(f.studentToken, f.organizationId));
    const primary = branches.body.branches.find((branch: { is_primary: boolean }) => branch.is_primary);
    const preview = await request(app)
      .get(`/api/ai/conversations/${conversationId}/messages?branch_id=${primary.id}`)
      .set(auth(f.studentToken, f.organizationId));
    expect(preview.status).toBe(200);
    expect(preview.body.conversation.active_branch_id).not.toBe(primary.id);
    expect(preview.body.conversation.selected_branch_id).toBe(primary.id);

    const primaryWrite = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ branch_id: primary.id, question: "Written to the selected branch" });
    expect(primaryWrite.status).toBe(201);
    const afterWrite = await request(app)
      .get(`/api/ai/conversations/${conversationId}`)
      .set(auth(f.studentToken, f.organizationId));
    expect(afterWrite.body.conversation.active_branch_id).toBe(primary.id);
    expect(afterWrite.body.messages.some((message: { content: string }) => message.content === "Written to the selected branch")).toBe(true);
  });

  it("returns validation errors for explicit null retry and regeneration identifiers", async () => {
    const f = await fixture("null-identifiers");
    const createdResponse = await createConversation(f, { question: "Validation question" });
    const retry = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/retry`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ attempt_id: null });
    expect(retry.status).toBe(400);
    const regenerate = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/regenerate`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ response_message_id: null });
    expect(regenerate.status).toBe(400);
  });

  it("rejects unauthorized lifecycle mutations without invoking the provider", async () => {
    const owner = await fixture("security-matrix-owner");
    const createdResponse = await createConversation(owner, { question: "Private lifecycle" });
    const conversationId = createdResponse.body.conversation.id;
    const messageId = createdResponse.body.student_message.id;
    const responseId = createdResponse.body.response_message.id;
    const attemptId = createdResponse.body.attempt.id;
    const branchResponse = await request(app)
      .get(`/api/ai/conversations/${conversationId}/branches`)
      .set(auth(owner.studentToken, owner.organizationId));
    const branchId = branchResponse.body.branches[0].id;

    const teacherId = await createUser("security-matrix-teacher");
    await addMember(teacherId, owner.organizationId, "TEACHER");
    const foreignUserId = await createUser("security-matrix-foreign");
    await addMember(foreignUserId, owner.organizationId, "STUDENT");
    await createStudent(owner.organizationId, foreignUserId, "Foreign student");
    const otherTenant = await fixture("security-matrix-other-tenant");
    const providerSpy = vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata");
    const actors = [
      { token: createAccessToken(teacherId), organizationId: owner.organizationId, status: 403 },
      {
        token: createAccessToken(foreignUserId),
        organizationId: owner.organizationId,
        status: 404,
      },
      {
        token: otherTenant.studentToken,
        organizationId: otherTenant.organizationId,
        status: 404,
      },
    ];
    const mutations = [
      () => request(app).post(`/api/ai/conversations/${conversationId}/messages`).send({ question: "blocked" }),
      () => request(app).patch(`/api/ai/conversations/${conversationId}/messages/${messageId}`).send({ content: "blocked" }),
      () => request(app).post(`/api/ai/conversations/${conversationId}/retry`).send({ attempt_id: attemptId }),
      () => request(app).post(`/api/ai/conversations/${conversationId}/regenerate`).send({ response_message_id: responseId }),
      () => request(app).post(`/api/ai/conversations/${conversationId}/messages/${responseId}/feedback`).send({ sentiment: "helpful" }),
      () => request(app).patch(`/api/ai/conversations/${conversationId}`).send({ title: "blocked" }),
      () => request(app).delete(`/api/ai/conversations/${conversationId}`),
      () => request(app).post(`/api/ai/conversations/${conversationId}/branches/${branchId}/activate`),
      () => request(app).patch(`/api/ai/conversations/${conversationId}/scope`).send({ scope: { subject: "blocked" } }),
    ];

    for (const actor of actors) {
      for (const mutation of mutations) {
        const response = await mutation().set({
          Authorization: `Bearer ${actor.token}`,
          "x-organization-id": actor.organizationId,
        });
        expect(response.status).toBe(actor.status);
      }
    }
    expect(providerSpy).not.toHaveBeenCalled();
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM ai_messages WHERE conversation_id = $1) AS messages,
         (SELECT COUNT(*)::int FROM ai_generation_attempts WHERE conversation_id = $1) AS attempts`,
      [conversationId],
    );
    expect(counts.rows[0]).toMatchObject({ messages: 2, attempts: 1 });
  });
});
