import { randomUUID } from "node:crypto";
import "dotenv/config";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";
import { MockLlmProvider } from "../../src/modules/ai/providers/mock.provider.js";

/**
 * US-123 end-to-end behaviour over the existing US-117 conversation foundation.
 *
 * These tests prove what the story must NOT do as much as what it does: one
 * conversation is reused across an explanation, a step-by-step follow-up, and an
 * example-only follow-up; no explanation mode, step state, or learning metric is
 * persisted; no schema changes; and the completed US-119/US-120/US-121/US-122
 * contracts are unchanged.
 */

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
    for (const table of ["ai_usage_events", "ai_idempotency_keys", "ai_generation_attempts"]) {
      await pool.query(`DELETE FROM ${table} WHERE conversation_id = ANY($1::uuid[])`, [
        created.conversations,
      ]);
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
    await pool.query(`DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])`, [
      created.organizations,
    ]);
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
    [organizationId, name, `US123-${randomUUID()}`]
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
  await pool.query(`UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`, [
    result.rows[0].id,
    studentId,
  ]);
  return result.rows[0].id as string;
}

/**
 * Tenant-scoped fixture with an authoritative chapter, a general topic, and a
 * topic that exists in the authoritative curriculum but is not the conversation's
 * scope, so a resolved explicit request and a follow-up can be told apart.
 */
async function fixture(label: string) {
  const className = `US-123 ${label} Class 8`;
  const adminId = await user(`us123-${label}-admin`);
  const studentUserId = await user(`us123-${label}-student`);
  const organizationId = await organization(adminId, `US-123 ${label}`);
  await member(adminId, organizationId, "SCHOOL_ADMIN");
  await member(studentUserId, organizationId, "STUDENT");
  const studentId = await student(organizationId, studentUserId, "US-123 Student");
  const classId = await klass(organizationId, adminId, className);
  await enrollment(organizationId, studentId, classId);
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
     VALUES ($1, $2, $3, 'US-123 Class 8 CBSE', $4, 'ACTIVE', TRUE) RETURNING id`,
    [classId, board.id, medium.id, `US123-${randomUUID()}`]
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
     VALUES ($1, 'SYLLABUS', 'US-123 authoritative structure', $2, 'ACTIVE') RETURNING id`,
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
  for (const [title, description] of [
    ["Equivalent Fractions", "Equivalent fractions represent the same quantity."],
    ["Photosynthesis", "Plants convert light energy into chemical energy."],
  ]) {
    await pool.query(
      `INSERT INTO curriculum_nodes
         (curriculum_structure_id, parent_node_id, node_type_id, title, description, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
      [structure.rows[0].id, chapter.rows[0].id, topicType.rows[0].id, title, description]
    );
  }
  return {
    organizationId,
    studentId,
    classId,
    className,
    studentToken: createAccessToken(studentUserId),
  };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function createConversation(f: { studentToken: string; organizationId: string }) {
  const response = await request(app)
    .post("/api/ai/conversations")
    .set(auth(f.studentToken, f.organizationId))
    .send({ subject: "Mathematics", chapter: "Fractions", topic: "Equivalent Fractions" });
  expect(response.status).toBe(201);
  created.conversations.push(response.body.conversation.id);
  return response.body.conversation as { id: string };
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
        requestId: `us123-${prompts.length}`,
      },
    };
  });
  return prompts;
}

async function ask(
  f: { studentToken: string; organizationId: string },
  conversationId: string,
  question: string
) {
  const response = await request(app)
    .post(`/api/ai/conversations/${conversationId}/messages`)
    .set(auth(f.studentToken, f.organizationId))
    .send({ question });
  expect(response.status).toBe(201);
  return response;
}

async function scopeRow(conversationId: string) {
  const result = await pool.query(
    `SELECT scope_board, scope_class, scope_chapter, scope_language, scope_medium
       FROM ai_conversations WHERE id = $1`,
    [conversationId]
  );
  return result.rows[0] as Record<string, string | null>;
}

const SEQUENTIAL_RULE =
  "- When you explain a concept, work through it as a short ordered sequence of steps, one idea per step, in the order a learner needs them.";
const EXAMPLE_RULE = "- While explaining, give at least one concrete example.";
const LEVEL_EXAMPLE_RULE =
  "- Match the example's difficulty, vocabulary, and setting to the educational level already resolved for this response.";
const EVIDENCE_EXAMPLE_RULE =
  "- Prefer the authoritative curriculum evidence above as the source for the explanation's terminology, ordering, and framing, and choose examples that fit it.";
const NO_OFFICIAL_EXAMPLE_RULE =
  "- Never present an example you generated as official curriculum material. If an example goes beyond that evidence, label it as additional general teaching.";
const SCOPE_EXAMPLE_RULE =
  "- Keep every step and every example on the subject, chapter, and topic shown in the student scope data, and never widen the scope to a concept that data does not name.";
const MEDIUM_EXAMPLE_RULE =
  "- Use the resolved medium and response language to choose the words and the worked examples, without letting either change the curriculum scope.";
const CONTINUITY_RULE =
  "- Continue the same concept from the conversation history, so a follow-up that asks for it step by step, or for an example, answers the explanation already in progress. History never overrides the student scope data or the authoritative curriculum evidence above.";
const RESOLVED_TOPIC_RULE =
  "- The student explicitly asked about the subject/chapter/topic shown in the student scope data.";

describe("US-123 step-by-step explanation pipeline", () => {
  it("explains sequentially with a curriculum-aware example on the first turn", async () => {
    const f = await fixture("first-turn");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions");

    for (const rule of [
      SEQUENTIAL_RULE,
      EXAMPLE_RULE,
      LEVEL_EXAMPLE_RULE,
      EVIDENCE_EXAMPLE_RULE,
      NO_OFFICIAL_EXAMPLE_RULE,
      SCOPE_EXAMPLE_RULE,
      MEDIUM_EXAMPLE_RULE,
    ]) {
      expect(prompts[0], rule).toContain(rule);
    }
    // A first turn has no history, so no continuity clause is emitted.
    expect(prompts[0]).not.toContain(CONTINUITY_RULE);
    // The explanation is grounded in the authoritative hierarchy already in force.
    expect(prompts[0]).toContain("Subject: Mathematics");
    expect(prompts[0]).toContain("Chapter: Fractions");
    expect(prompts[0]).toContain("Topic: Equivalent Fractions");
    expect(prompts[0]).toContain("Equivalent fractions represent the same quantity.");
    expect(prompts[0]).toContain("Board: CBSE");
    expect(prompts[0]).toContain(`Class/grade scope: ${f.className}`);
  });

  it("continues a step-by-step follow-up in the same conversation", async () => {
    const f = await fixture("step-by-step");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);

    await ask(f, conversation.id, "Explain photosynthesis");
    await ask(f, conversation.id, "Explain it step by step");

    expect(prompts[1]).toContain(SEQUENTIAL_RULE);
    expect(prompts[1]).toContain(EXAMPLE_RULE);
    expect(prompts[1]).toContain(CONTINUITY_RULE);
    expect(prompts[1]).toContain("conversation_history_data");
    expect(prompts[1]).toContain("STUDENT: Explain photosynthesis");
    // "Explain it step by step" names no curriculum level, so US-122 stays
    // silent and the authoritative scope of the conversation is reused.
    expect(prompts[1]).not.toContain(RESOLVED_TOPIC_RULE);
    expect(prompts[1]).toContain("Subject: Mathematics");
    expect(prompts[1]).toContain("Chapter: Fractions");
  });

  it("answers an example-only follow-up with continuity and no new scope", async () => {
    const f = await fixture("example-only");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);

    await ask(f, conversation.id, "Explain equivalent fractions");
    await ask(f, conversation.id, "Give me an example");
    await ask(f, conversation.id, "Explain it step by step");

    for (const index of [1, 2]) {
      expect(prompts[index], `turn ${index}`).toContain(EXAMPLE_RULE);
      expect(prompts[index], `turn ${index}`).toContain(CONTINUITY_RULE);
      expect(prompts[index], `turn ${index}`).not.toContain(RESOLVED_TOPIC_RULE);
      expect(prompts[index], `turn ${index}`).toContain("Topic: Equivalent Fractions");
    }
    // The step-by-step ask is answered sequentially on a later follow-up too.
    expect(prompts[2]).toContain(SEQUENTIAL_RULE);
  });

  it("persists no explanation mode and creates no second conversation", async () => {
    const f = await fixture("no-persistence");
    capturePrompts();
    const conversation = await createConversation(f);
    const before = await scopeRow(conversation.id);

    await ask(f, conversation.id, "Explain equivalent fractions");
    await ask(f, conversation.id, "Explain it step by step");
    await ask(f, conversation.id, "Give me an example");
    const after = await scopeRow(conversation.id);

    // Decision #15: nothing about the explanation is written to conversation scope.
    expect(after).toEqual(before);
    expect(after.scope_class).toBeNull();
    expect(after.scope_language).toBeNull();
    expect(after.scope_medium).toBeNull();

    // Decision #98/#99: the follow-ups reuse the same conversation.
    const conversations = await pool.query(
      `SELECT count(*)::int AS total FROM ai_conversations
        WHERE student_id = $1 AND deleted_at IS NULL`,
      [f.studentId]
    );
    expect(conversations.rows[0].total).toBe(1);

    const messages = await pool.query(
      `SELECT count(*)::int AS total FROM ai_messages WHERE conversation_id = $1`,
      [conversation.id]
    );
    expect(messages.rows[0].total).toBe(6);
  });

  it("adds no schema, table, or column for a step state or learning metric", async () => {
    const f = await fixture("no-schema");
    capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions");
    await ask(f, conversation.id, "Explain it step by step");

    const columns = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name IN (
          'ai_conversations', 'ai_conversation_branches', 'ai_messages',
          'ai_generation_attempts', 'ai_usage_events', 'ai_message_feedback',
          'ai_idempotency_keys'
        )
          AND (
            column_name LIKE '%step%' OR column_name LIKE '%explanation%'
            OR column_name LIKE '%teaching%' OR column_name LIKE '%mastery%'
            OR column_name LIKE '%understanding%' OR column_name LIKE '%score%'
          )`
    );
    expect(columns.rows).toEqual([]);

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND (
            table_name LIKE '%step%' OR table_name LIKE '%explanation%'
            OR table_name LIKE '%teaching%' OR table_name LIKE '%mastery%'
            OR table_name LIKE '%understanding%'
          )`
    );
    expect(tables.rows).toEqual([]);

    // The AI conversation scope contract is still exactly the US-117 columns.
    const scope = await pool.query(
      `SELECT DISTINCT column_name FROM information_schema.columns
        WHERE table_name = 'ai_conversations' AND column_name LIKE 'scope_%'`
    );
    expect(scope.rows.map((row) => String(row.column_name)).sort()).toEqual([
      "scope_board",
      "scope_chapter",
      "scope_class",
      "scope_language",
      "scope_medium",
    ]);
  });

  it("preserves the US-120 language precedence alongside the step-by-step block", async () => {
    const f = await fixture("language");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions in Tamil step by step");

    expect(prompts[0]).toContain(
      "- Respond in Tamil. The student explicitly requested this language for this response."
    );
    expect(prompts[0]).toContain("Language: Tamil");
    expect(prompts[0]).toContain("Medium: English");
    expect(prompts[0]).toContain(SEQUENTIAL_RULE);
    expect(prompts[0]).toContain(MEDIUM_EXAMPLE_RULE);
    // The request-scoped language is not persisted to conversation scope.
    const scope = await scopeRow(conversation.id);
    expect(scope.scope_language).toBeNull();
  });

  it("keeps an explicitly resolved topic as the explanation's scope", async () => {
    const f = await fixture("resolved-topic");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    const before = await scopeRow(conversation.id);
    await ask(f, conversation.id, "Explain photosynthesis");
    const after = await scopeRow(conversation.id);

    expect(prompts[0]).toContain(RESOLVED_TOPIC_RULE);
    expect(prompts[0]).toContain(SCOPE_EXAMPLE_RULE);
    expect(prompts[0]).toContain("Topic: Photosynthesis");
    expect(prompts[0]).toContain("Plants convert light energy into chemical energy.");
    // Decision #120: the request-scoped resolution is used for this response and
    // is never written back to conversation scope.
    expect(after).toEqual(before);
    expect(after.scope_chapter).toBe("Fractions");

    const topicColumn = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'ai_conversations' AND column_name = 'scope_topic'`
    );
    expect(topicColumn.rows).toEqual([]);
  });

  it("keeps each tenant's curriculum inside its own organization", async () => {
    const first = await fixture("tenanta");
    const second = await fixture("tenantb");
    const prompts = capturePrompts();

    const firstConversation = await createConversation(first);
    await ask(first, firstConversation.id, "Explain equivalent fractions");
    const secondConversation = await createConversation(second);
    await ask(second, secondConversation.id, "Explain equivalent fractions");

    expect(prompts[0]).toContain(`Class/grade scope: ${first.className}`);
    expect(prompts[0]).not.toContain(second.className);
    expect(prompts[1]).toContain(`Class/grade scope: ${second.className}`);
    expect(prompts[1]).not.toContain(first.className);
  });

  it("never leaks internal identifiers or source metadata", async () => {
    const f = await fixture("privacy");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions");

    expect(prompts[0]).not.toContain(f.studentId);
    expect(prompts[0]).not.toContain(f.classId);
    expect(prompts[0]).not.toContain(f.organizationId);
    expect(prompts[0]).not.toMatch(/00000000-0000-4000-8000-[0-9a-f]{12}/i);
    expect(prompts[0]).not.toMatch(
      /\b(?:organization|student|syllabus|resource|node|provider|class|enrollment|subject|topic)(?:[_ -]?id)\b/i
    );
    expect(prompts[0]).not.toMatch(/https?:\/\//i);
  });
});
