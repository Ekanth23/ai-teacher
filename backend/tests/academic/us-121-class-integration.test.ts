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
    [organizationId, name, `US121-${randomUUID()}`]
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
 * Tenant-scoped fixture. With an authoritative syllabus the existing US-119/US-118
 * chain resolves board, medium, class, and curriculum evidence; without one the
 * class level must stay unresolved and no class-specific requirement may be
 * claimed.
 */
async function fixture(label: string, options: { withSyllabus?: boolean } = {}) {
  const withSyllabus = options.withSyllabus !== false;
  const className = `US-121 ${label} Class 8`;
  const adminId = await user(`us121-${label}-admin`);
  const studentUserId = await user(`us121-${label}-student`);
  const organizationId = await organization(adminId, `US-121 ${label}`);
  await member(adminId, organizationId, "SCHOOL_ADMIN");
  await member(studentUserId, organizationId, "STUDENT");
  const studentId = await student(organizationId, studentUserId, "US-121 Student");
  const classId = await klass(organizationId, adminId, className);
  await enrollment(organizationId, studentId, classId);
  const subjectId = await subject(organizationId, classId, "Mathematics");

  if (!withSyllabus) {
    return { organizationId, studentId, classId, className, studentToken: createAccessToken(studentUserId) };
  }

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
     VALUES ($1, $2, $3, 'US-121 Class 8 CBSE', $4, 'ACTIVE', TRUE) RETURNING id`,
    [classId, board.id, medium.id, `US121-${randomUUID()}`]
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
     VALUES ($1, 'SYLLABUS', 'US-121 authoritative structure', $2, 'ACTIVE') RETURNING id`,
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
  return { organizationId, studentId, classId, className, studentToken: createAccessToken(studentUserId) };
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
        requestId: `us121-${prompts.length}`,
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

const LEVEL_RULE =
  "- The resolved class/grade shown in the student scope data above sets the expected educational level.";
const UNRESOLVED_RULE =
  "- No class level is resolved for this student. Do not assume a grade, level, or class-specific requirement.";
const NO_CURRICULUM_RULE =
  "- No authoritative curriculum is available for this class.";

describe("US-121 class-aware explanation through the message pipeline", () => {
  it("adapts presentation to the resolved class when curriculum is available", async () => {
    const f = await fixture("curriculum");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions.");

    expect(prompts).toHaveLength(1);
    // The class level comes from the authoritative enrollment and syllabus.
    expect(prompts[0]).toContain(`Class/grade scope: ${f.className}`);
    expect(prompts[0]).toContain(LEVEL_RULE);
    expect(prompts[0]).toContain(
      "Match vocabulary, depth, assumed prerequisites, scaffolding, and example complexity to that level."
    );
    // Class never changes the authoritative curriculum scope.
    expect(prompts[0]).toContain("Board: CBSE");
    expect(prompts[0]).toContain("Subject: Mathematics");
    expect(prompts[0]).toContain("Topic: Equivalent Fractions");
    expect(prompts[0]).toContain(
      "- Class sets the educational level only. It never changes the authoritative board, subject, chapter, or topic, and never adds curriculum the evidence block does not contain."
    );
    expect(prompts[0]).not.toContain(NO_CURRICULUM_RULE);
    // A resolved level is asserted, never a forbidden assumption.
    expect(prompts[0]).not.toContain(UNRESOLVED_RULE);
  });

  it("invents no class-specific requirement when curriculum is unavailable", async () => {
    const f = await fixture("nocurriculum", { withSyllabus: false });
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions.");

    // No authoritative syllabus means the board-scoped class is honestly absent,
    // and the authoritative grade still supplies an educational level.
    expect(prompts[0]).toContain("Class/grade scope: not provided");
    expect(prompts[0]).toContain("Grade: 8");
    expect(prompts[0]).toContain(LEVEL_RULE);
    // Because no authoritative curriculum exists, the level is used for
    // presentation only and no curriculum claim is permitted.
    expect(prompts[0]).toContain(NO_CURRICULUM_RULE);
    expect(prompts[0]).toContain(
      "never claim syllabus, textbook, or assessment alignment"
    );
    expect(prompts[0]).toContain(
      "Do not state or imply that a concept is required, assessed, or examinable for this class unless the authoritative curriculum evidence says so."
    );
    expect(prompts[0]).toContain("Board response mode: GENERAL_EDUCATIONAL");
    expect(prompts[0]).toContain("No authoritative source was provided");
  });

  it("keeps the US-120 response-language precedence intact", async () => {
    const f = await fixture("language");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain this in Tamil");

    // Decision #5 precedence is unchanged, and class awareness is additive.
    expect(prompts[0]).toContain(
      "- Respond in Tamil. The student explicitly requested this language for this response."
    );
    expect(prompts[0]).toContain("Language: Tamil");
    expect(prompts[0]).toContain(LEVEL_RULE);
    expect(prompts[0]).toContain("Medium: English");
  });

  it("keeps conversation history available on a follow-up turn", async () => {
    const f = await fixture("history");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions.");
    await ask(f, conversation.id, "Now explain it again");

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("conversation_history_data");
    expect(prompts[1]).toContain("Explain equivalent fractions.");
    // The class level is re-resolved per request and never inherited as state.
    expect(prompts[1]).toContain(LEVEL_RULE);
  });

  it("persists no class-aware adaptation", async () => {
    const f = await fixture("persistence");
    capturePrompts();
    const conversation = await createConversation(f);
    const before = await scopeRow(conversation.id);
    await ask(f, conversation.id, "Explain equivalent fractions.");
    await ask(f, conversation.id, "Explain this in Tamil");
    const after = await scopeRow(conversation.id);

    expect(after).toEqual(before);
    expect(after.scope_class).toBeNull();
    expect(after.scope_language).toBeNull();
    expect(after.scope_board).toBeNull();
  });

  it("keeps each tenant's class inside its own organization", async () => {
    const first = await fixture("tenanta");
    const second = await fixture("tenantb");
    const prompts = capturePrompts();

    const firstConversation = await createConversation(first);
    await ask(first, firstConversation.id, "Explain equivalent fractions.");
    const firstPrompt = prompts[0];

    const secondConversation = await createConversation(second);
    await ask(second, secondConversation.id, "Explain equivalent fractions.");
    const secondPrompt = prompts[1];

    expect(firstPrompt).toContain(`Class/grade scope: ${first.className}`);
    expect(firstPrompt).not.toContain(second.className);
    expect(secondPrompt).toContain(`Class/grade scope: ${second.className}`);
    expect(secondPrompt).not.toContain(first.className);
  });

  it("never leaks internal identifiers or source metadata into the prompt", async () => {
    const f = await fixture("privacy");
    const prompts = capturePrompts();
    const conversation = await createConversation(f);
    await ask(f, conversation.id, "Explain equivalent fractions.");

    expect(prompts[0]).not.toContain(f.studentId);
    expect(prompts[0]).not.toContain(f.classId);
    expect(prompts[0]).not.toContain(f.organizationId);
    expect(prompts[0]).not.toMatch(/00000000-0000-4000-8000-[0-9a-f]{12}/i);
    expect(prompts[0]).not.toMatch(
      /\b(?:organization|student|syllabus|resource|node|provider|class|enrollment)(?:[_ -]?id)\b/i
    );
    expect(prompts[0]).not.toMatch(/https?:\/\//i);
    // Only the safe source label is offered, never an internal reference.
    expect(prompts[0]).toContain("Fractions");
  });
});
