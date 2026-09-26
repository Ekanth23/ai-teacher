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
    [organizationId, name, `US122-${randomUUID()}`]
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
 * Tenant-scoped fixture whose authoritative curriculum contains two topics under
 * one chapter, so an explicit request can be proven to resolve to a different
 * authoritative topic than the conversation scope already holds.
 */
async function fixture(label: string) {
  const className = `US-122 ${label} Class 8`;
  const adminId = await user(`us122-${label}-admin`);
  const studentUserId = await user(`us122-${label}-student`);
  const organizationId = await organization(adminId, `US-122 ${label}`);
  await member(adminId, organizationId, "SCHOOL_ADMIN");
  await member(studentUserId, organizationId, "STUDENT");
  const studentId = await student(organizationId, studentUserId, "US-122 Student");
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
     VALUES ($1, $2, $3, 'US-122 Class 8 CBSE', $4, 'ACTIVE', TRUE) RETURNING id`,
    [classId, board.id, medium.id, `US122-${randomUUID()}`]
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
     VALUES ($1, 'SYLLABUS', 'US-122 authoritative structure', $2, 'ACTIVE') RETURNING id`,
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
        requestId: `us122-${prompts.length}`,
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

const RESOLVED_RULE =
  "- The student explicitly asked about the subject/chapter/topic shown in the student scope data.";
const UNRESOLVED_RULE =
  "- The student explicitly asked about a subject, chapter, or topic that is not resolved against the authoritative curriculum. Answer as a general educational explanation.";
const AMBIGUOUS_RULE =
  "- The student explicitly asked about a subject, chapter, or topic that matches more than one authoritative candidate.";

describe("US-122 subject/topic-aware response pipeline", () => {
  it("resolves an explicit topic to the authoritative curriculum for this response", async () => {
    const f = await fixture("resolved");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain photosynthesis");

    // The explicit request becomes the authoritative scope for this response and
    // the evidence block follows the resolved hierarchy.
    expect(prompts[0]).toContain(RESOLVED_RULE);
    expect(prompts[0]).toContain("Topic: Photosynthesis");
    expect(prompts[0]).toContain("Plants convert light energy into chemical energy.");
    expect(prompts[0]).toContain("Subject: Mathematics");
    expect(prompts[0]).toContain("Chapter: Fractions");
    // Board, class, and medium are untouched by a subject/topic request.
    expect(prompts[0]).toContain("Board: CBSE");
    expect(prompts[0]).toContain(`Class/grade scope: ${f.className}`);
  });

  it("answers generally and claims no curriculum membership when unresolved", async () => {
    const f = await fixture("unresolved");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain the water cycle");

    expect(prompts[0]).toContain(UNRESOLVED_RULE);
    expect(prompts[0]).toContain(
      "Never claim that the requested subject/chapter/topic is part of this student's curriculum, and never invent a curriculum relationship or requirement."
    );
    // The existing authoritative scope is preserved, not replaced.
    expect(prompts[0]).toContain("Topic: Equivalent Fractions");
    expect(prompts[0]).toContain("Equivalent fractions represent the same quantity.");
  });

  it("never guesses between two explicit targets", async () => {
    const f = await fixture("ambiguous");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain photosynthesis, then tell me about respiration");

    expect(prompts[0]).toContain(AMBIGUOUS_RULE);
    expect(prompts[0]).toContain("Topic: Equivalent Fractions");
  });

  it("keeps conversation continuity and never persists the explicit request", async () => {
    const f = await fixture("continuity");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    const before = await scopeRow(conversation.id);

    await ask(f, conversation.id, "Explain photosynthesis");
    await ask(f, conversation.id, "Now explain it again");
    const after = await scopeRow(conversation.id);

    // The request-scoped selection is not written back to conversation scope and
    // no subject/topic persistence field is introduced.
    expect(after).toEqual(before);
    expect(after.scope_class).toBeNull();
    expect(after.scope_language).toBeNull();
    const columns = await pool.query(
      `SELECT DISTINCT column_name FROM information_schema.columns
        WHERE table_name = 'ai_conversations' AND column_name LIKE 'scope_%'`
    );
    const names = columns.rows.map((row) => String(row.column_name)).sort();
    expect(names).toEqual([
      "scope_board",
      "scope_chapter",
      "scope_class",
      "scope_language",
      "scope_medium",
    ]);
    expect(names).not.toContain("scope_subject");
    expect(names).not.toContain("scope_topic");
    // The follow-up turn still receives history and re-resolves from authoritative data.
    expect(prompts[1]).toContain("conversation_history_data");
    expect(prompts[1]).toContain("Explain photosynthesis");
    expect(prompts[1]).toContain("Topic: Equivalent Fractions");
  });

  it("preserves the US-120 language precedence alongside a subject/topic request", async () => {
    const f = await fixture("language");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions in Tamil");

    expect(prompts[0]).toContain(
      "- Respond in Tamil. The student explicitly requested this language for this response."
    );
    expect(prompts[0]).toContain("Language: Tamil");
    expect(prompts[0]).toContain("Medium: English");
    // Explicit topic and explicit language resolve independently.
    expect(prompts[0]).toContain(RESOLVED_RULE);
    expect(prompts[0]).toContain("Topic: Equivalent Fractions");
  });

  it("keeps each tenant's curriculum inside its own organization", async () => {
    const first = await fixture("tenanta");
    const second = await fixture("tenantb");
    const prompts = capturePrompts();

    const firstConversation = await createConversation(first);
    await ask(first, firstConversation.id, "Explain photosynthesis");
    const secondConversation = await createConversation(second);
    await ask(second, secondConversation.id, "Explain photosynthesis");

    // A subject/topic request in one organization never surfaces another
    // organization's class or curriculum labels.
    expect(prompts[0]).toContain(`Class/grade scope: ${first.className}`);
    expect(prompts[0]).not.toContain(second.className);
    expect(prompts[1]).toContain(`Class/grade scope: ${second.className}`);
    expect(prompts[1]).not.toContain(first.className);
  });

  it("never leaks internal identifiers or source metadata", async () => {
    const f = await fixture("privacy");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain photosynthesis");

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
