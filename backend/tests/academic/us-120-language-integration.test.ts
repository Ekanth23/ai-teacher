import { randomUUID } from "node:crypto";
import "dotenv/config";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";
import { MockLlmProvider } from "../../src/modules/ai/providers/mock.provider.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();
const created = {
  users: [] as string[],
  organizations: [] as string[],
  students: [] as string[],
  classes: [] as string[],
  subjects: [] as string[],
  enrollments: [] as string[],
  syllabi: [] as string[],
  conversations: [] as string[],
};

async function cleanup() {
  if (created.conversations.length) {
    for (const table of [
      "ai_usage_events",
      "ai_idempotency_keys",
      "ai_generation_attempts",
    ]) {
      await pool.query(
        `DELETE FROM ${table} WHERE conversation_id = ANY($1::uuid[])`,
        [created.conversations]
      );
    }
    await pool.query(`DELETE FROM ai_conversations WHERE id = ANY($1::uuid[])`, [
      created.conversations,
    ]);
  }
  if (created.syllabi.length) {
    await pool.query(
      `DELETE FROM curriculum_nodes
        WHERE curriculum_structure_id IN (
          SELECT cs.id FROM curriculum_structures cs
            JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
           WHERE sv.syllabus_id = ANY($1::uuid[])
        )`,
      [created.syllabi]
    );
    await pool.query(
      `DELETE FROM curriculum_structures
        WHERE syllabus_version_id IN (SELECT id FROM syllabus_versions WHERE syllabus_id = ANY($1::uuid[]))`,
      [created.syllabi]
    );
    await pool.query(`DELETE FROM syllabus_languages WHERE syllabus_id = ANY($1::uuid[])`, [
      created.syllabi,
    ]);
    await pool.query(`DELETE FROM syllabus_versions WHERE syllabus_id = ANY($1::uuid[])`, [
      created.syllabi,
    ]);
    await pool.query(`DELETE FROM syllabi WHERE id = ANY($1::uuid[])`, [created.syllabi]);
  }
  if (created.students.length) {
    await pool.query(
      `UPDATE students_v2 SET current_enrollment_id = NULL WHERE id = ANY($1::uuid[])`,
      [created.students]
    );
  }
  if (created.enrollments.length) {
    await pool.query(`DELETE FROM student_enrollments WHERE id = ANY($1::uuid[])`, [
      created.enrollments,
    ]);
  }
  if (created.subjects.length) {
    await pool.query(`DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])`, [
      created.classes,
    ]);
    await pool.query(`DELETE FROM subjects WHERE id = ANY($1::uuid[])`, [created.subjects]);
  }
  if (created.students.length) {
    await pool.query(`DELETE FROM students_v2 WHERE id = ANY($1::uuid[])`, [created.students]);
  }
  if (created.classes.length) {
    await pool.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [created.classes]);
  }
  if (created.organizations.length) {
    await pool.query(
      `DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])`,
      [created.organizations]
    );
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [
      created.organizations,
    ]);
  }
  if (created.users.length) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.users]);
  }
  Object.values(created).forEach((items) => (items.length = 0));
}

beforeEach(() => {
  process.env.AI_PROVIDER = "mock";
});

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

async function user(label: string) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${label}-${randomUUID()}@example.com`, label]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function organization(ownerId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [label, `${label}-${randomUUID()}`, ownerId]
  );
  created.organizations.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function member(userId: string, organizationId: string, role: string) {
  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     SELECT $1, $2, id, 'ACTIVE' FROM roles WHERE name = $3`,
    [userId, organizationId, role]
  );
}

async function student(organizationId: string, userId: string, name: string) {
  const result = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status)
     VALUES ($1, $2, $3, '8', 'ACTIVE') RETURNING id`,
    [userId, organizationId, name]
  );
  created.students.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function klass(organizationId: string, ownerId: string, name: string) {
  const result = await pool.query(
    `INSERT INTO classes (organization_id, name, created_by_user_id, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, name, ownerId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function subject(organizationId: string, classId: string, name: string) {
  const result = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, name, `US120-${randomUUID()}`]
  );
  created.subjects.push(result.rows[0].id);
  await pool.query(
    `INSERT INTO class_subjects (organization_id, class_id, subject_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [organizationId, classId, result.rows[0].id]
  );
  return result.rows[0].id as string;
}

async function enrollment(organizationId: string, studentId: string, classId: string) {
  const result = await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, studentId, classId]
  );
  created.enrollments.push(result.rows[0].id);
  return result.rows[0].id as string;
}

/**
 * Fixture with an authoritative syllabus whose language capability list is
 * exactly [English, Tamil], matching Decision #119 clause 4 conditions.
 */
async function fixture(label = "language") {
  const adminId = await user(`us120-${label}-admin`);
  const studentUserId = await user(`us120-${label}-student`);
  const organizationId = await organization(adminId, `US-120 ${label}`);
  await member(adminId, organizationId, "SCHOOL_ADMIN");
  await member(studentUserId, organizationId, "STUDENT");
  const studentId = await student(organizationId, studentUserId, "US-120 Student");
  const classId = await klass(organizationId, adminId, "US-120 Class 8");
  const enrollmentId = await enrollment(organizationId, studentId, classId);
  await pool.query(`UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`, [
    enrollmentId,
    studentId,
  ]);
  const subjectId = await subject(organizationId, classId, "Mathematics");
  const board = (
    await pool.query("SELECT id FROM boards WHERE code = 'CBSE' AND status = 'ACTIVE' LIMIT 1")
  ).rows[0];
  const medium = (
    await pool.query("SELECT id FROM mediums WHERE code = 'EN' AND status = 'ACTIVE' LIMIT 1")
  ).rows[0];
  const english = (
    await pool.query("SELECT id FROM languages WHERE code = 'EN' AND status = 'ACTIVE' LIMIT 1")
  ).rows[0];
  const tamil = (
    await pool.query("SELECT id FROM languages WHERE code = 'TA' AND status = 'ACTIVE' LIMIT 1")
  ).rows[0];
  const syllabus = await pool.query(
    `INSERT INTO syllabi
       (class_id, board_id, medium_id, name, code, status, is_authoritative)
     VALUES ($1, $2, $3, 'US-120 Class 8 CBSE', $4, 'ACTIVE', TRUE) RETURNING id`,
    [classId, board.id, medium.id, `US120-${randomUUID()}`]
  );
  created.syllabi.push(syllabus.rows[0].id);
  for (const language of [english, tamil]) {
    await pool.query(
      `INSERT INTO syllabus_languages (syllabus_id, language_id, language_role)
       VALUES ($1, $2, 'CONTENT')`,
      [syllabus.rows[0].id, language.id]
    );
  }
  const version = await pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, status)
     VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [syllabus.rows[0].id, `v-${randomUUID()}`]
  );
  const structure = await pool.query(
    `INSERT INTO curriculum_structures
       (syllabus_version_id, structure_kind, name, subject_id, status)
     VALUES ($1, 'SYLLABUS', 'US-120 authoritative structure', $2, 'ACTIVE') RETURNING id`,
    [version.rows[0].id, subjectId]
  );
  const chapterType = await pool.query(
    `SELECT id FROM curriculum_node_types WHERE code = 'CHAPTER' AND status = 'ACTIVE' LIMIT 1`
  );
  const topicType = await pool.query(
    `SELECT id FROM curriculum_node_types WHERE code = 'TOPIC' AND status = 'ACTIVE' LIMIT 1`
  );
  const chapter = await pool.query(
    `INSERT INTO curriculum_nodes
       (curriculum_structure_id, node_type_id, title, description, status)
     VALUES ($1, $2, 'Fractions', 'The authoritative chapter description.', 'ACTIVE') RETURNING id`,
    [structure.rows[0].id, chapterType.rows[0].id]
  );
  await pool.query(
    `INSERT INTO curriculum_nodes
       (curriculum_structure_id, parent_node_id, node_type_id, title, description, status)
     VALUES ($1, $2, $3, 'Equivalent Fractions', 'Equivalent fractions represent the same quantity.', 'ACTIVE') RETURNING id`,
    [structure.rows[0].id, chapter.rows[0].id, topicType.rows[0].id]
  );
  return {
    organizationId,
    studentId,
    classId,
    studentToken: createAccessToken(studentUserId),
  };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function createConversation(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await request(app)
    .post("/api/ai/conversations")
    .set(auth(f.studentToken, f.organizationId))
    .send({ subject: "Mathematics", chapter: "Fractions", topic: "Equivalent Fractions" });
  expect(response.status).toBe(201);
  created.conversations.push(response.body.conversation.id);
  return response.body.conversation as {
    id: string;
    scope_language: string | null;
  };
}

function capturePrompts() {
  const prompts: string[] = [];
  vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async (prompt) => {
    prompts.push(prompt);
    return {
      text: "AI Teacher response.",
      metadata: {
        provider: "mock",
        model: "mock-model",
        status: "SUCCESS" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: `us120-${prompts.length}`,
      },
    };
  });
  return prompts;
}

async function ask(f: Awaited<ReturnType<typeof fixture>>, conversationId: string, question: string) {
  const response = await request(app)
    .post(`/api/ai/conversations/${conversationId}/messages`)
    .set(auth(f.studentToken, f.organizationId))
    .send({ question });
  expect(response.status).toBe(201);
  return response;
}

async function scopeLanguage(conversationId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT scope_language FROM ai_conversations WHERE id = $1`,
    [conversationId]
  );
  return result.rows[0].scope_language as string | null;
}

describe("US-120 medium/language-aware response pipeline", () => {
  it("resolves an explicit language request through the full message pipeline", async () => {
    const f = await fixture("explicit");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain this in Tamil");

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Respond in Tamil");
    expect(prompts[0]).toContain("Language: Tamil");
  });

  it("leaves conversation scope language unchanged for an explicit request", async () => {
    const f = await fixture("nopersist");
    capturePrompts();
    const conversation = await createConversation(f);
    const before = await scopeLanguage(conversation.id);
    await ask(f, conversation.id, "From now on explain in Tamil");
    const after = await scopeLanguage(conversation.id);
    expect(after).toBe(before);
    expect(after).toBeNull();
  });

  it("does not let a follow-up inherit the previous request-scoped language", async () => {
    const f = await fixture("followup");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain this in Tamil");
    await ask(f, conversation.id, "Now explain it again");

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Respond in Tamil");
    // The second turn re-resolves from scratch and inherits nothing.
    expect(prompts[1]).not.toContain("Respond in Tamil");
    expect(await scopeLanguage(conversation.id)).toBeNull();
  });

  it("keeps an unavailable requested language as a general educational response", async () => {
    const f = await fixture("unavailable");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain this in French.");

    expect(prompts[0]).toContain("Respond in French");
    expect(prompts[0]).toContain("French is NOT in the authoritative syllabus language capability list");
    expect(prompts[0]).toContain("Answer as general education only.");
    // Board and curriculum scope are untouched.
    expect(prompts[0]).toContain("Board: CBSE");
    expect(await scopeLanguage(conversation.id)).toBeNull();
  });

  it("honors an unavailable non-Latin requested language end to end", async () => {
    // The fixture syllabus offers English and Tamil only, so Japanese is an
    // unavailable explicit request that must still be honored (#117).
    const f = await fixture("unavailable-script");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain this in 日本語");

    expect(prompts[0]).toContain("Respond in 日本語");
    expect(prompts[0]).toContain(
      "日本語 is NOT in the authoritative syllabus language capability list"
    );
    expect(prompts[0]).toContain("Answer as general education only.");
    expect(prompts[0]).toContain("Board: CBSE");
    expect(await scopeLanguage(conversation.id)).toBeNull();
  });

  it("honors a lowercase unavailable request end to end", async () => {
    // A lowercase request is honored for this response only. The server asserts
    // no language name, so the pipeline must still instruct the model to answer
    // in the requested language as general education (#117 + #118).
    const f = await fixture("unavailable-lowercase");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "explain this in french");

    expect(prompts[0]).toContain(
      "The student may have explicitly requested a response language. If they did, respond in that language for this response only."
    );
    expect(prompts[0]).toContain(
      "Any explicitly requested language is NOT in the authoritative syllabus language capability list. Answer as general education only."
    );
    expect(prompts[0]).toContain("Board: CBSE");
    expect(prompts[0]).toContain("Subject: Mathematics");
    expect(await scopeLanguage(conversation.id)).toBeNull();
  });

  it("does not treat an ordinary style qualifier as a language request", async () => {
    const f = await fixture("qualifier");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions in two parts in short terms");

    // No explicit request, so no unavailable-language instruction is emitted and
    // the configured/authoritative language behavior is untouched.
    expect(prompts[0]).not.toContain("Respond in");
    expect(prompts[0]).not.toContain("explicitly requested a response language");
    expect(prompts[0]).toContain("Language: not provided");
  });

  it("leaves the response language unresolved when tiers 1 and 3 cannot resolve", async () => {
    const f = await fixture("unresolved");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions.");

    // The authoritative syllabus offers English and Tamil with no applicable
    // scope language, so the server asserts no response language.
    expect(prompts[0]).toContain("Language: not provided");
    expect(prompts[0]).toContain(
      "If the student's question language is not determinable, ask the minimum necessary language clarification."
    );
    expect(prompts[0]).toContain("The authoritative syllabus language capability list is:");
  });

  it("uses an applicable configured language for the response", async () => {
    const f = await fixture("configured");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await pool.query(`UPDATE ai_conversations SET scope_language = 'Tamil' WHERE id = $1`, [
      conversation.id,
    ]);
    await ask(f, conversation.id, "Explain equivalent fractions.");

    expect(prompts[0]).toContain("the configured language for this conversation");
    expect(prompts[0]).toContain("Language: Tamil");
  });

  it("is idempotent across retry and regeneration", async () => {
    const f = await fixture("retry");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    const sent = await ask(f, conversation.id, "Explain this in French.");

    await request(app)
      .post(`/api/ai/conversations/${conversation.id}/retry`)
      .set(auth(f.studentToken, f.organizationId))
      .send({});

    const regenerated = await request(app)
      .post(`/api/ai/conversations/${conversation.id}/regenerate`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ message_id: sent.body.student_message.id });

    expect(regenerated.status).toBe(201);
    for (const prompt of prompts.slice(1)) {
      expect(prompt).toContain("Respond in French");
    }
    expect(await scopeLanguage(conversation.id)).toBeNull();
  });

  it("issues exactly one provider call per student request", async () => {
    const f = await fixture("calls");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain this in Tamil");
    expect(prompts).toHaveLength(1);
  });

  it("keeps medium as terminology and style context only", async () => {
    const f = await fixture("medium");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions.");

    expect(prompts[0]).toContain("The educational medium is English");
    expect(prompts[0]).toContain("shape terminology, register, and presentation style only");
    expect(prompts[0]).toContain("never determines the response language");
  });
});
