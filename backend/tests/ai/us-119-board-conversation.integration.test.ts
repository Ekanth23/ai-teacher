import { randomUUID } from "node:crypto";
import "dotenv/config";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";
import { BoardEvidenceRepository } from "../../src/modules/ai/board-evidence.repository.js";
import { ConversationRepository } from "../../src/modules/ai/conversation.repository.js";
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
    await pool.query("DELETE FROM ai_usage_events WHERE conversation_id = ANY($1::uuid[])", [
      created.conversations,
    ]);
    await pool.query("DELETE FROM ai_idempotency_keys WHERE conversation_id = ANY($1::uuid[])", [
      created.conversations,
    ]);
    await pool.query("DELETE FROM ai_generation_attempts WHERE conversation_id = ANY($1::uuid[])", [
      created.conversations,
    ]);
    await pool.query("DELETE FROM ai_conversations WHERE id = ANY($1::uuid[])", [
      created.conversations,
    ]);
  }
  if (created.syllabi.length) {
    await pool.query(
      `DELETE FROM curriculum_nodes
        WHERE curriculum_structure_id IN (
          SELECT cs.id
            FROM curriculum_structures cs
            JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
           WHERE sv.syllabus_id = ANY($1::uuid[])
        )`,
      [created.syllabi]
    );
    await pool.query(
      `DELETE FROM curriculum_structures
        WHERE syllabus_version_id IN (
          SELECT id FROM syllabus_versions WHERE syllabus_id = ANY($1::uuid[])
        )`,
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
  if (created.classes.length) {
    await pool.query(`DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])`, [
      created.classes,
    ]);
  }
  if (created.subjects.length) {
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
    [organizationId, name, `US119-${randomUUID()}`]
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

async function fixture(label = "board") {
  const adminId = await user(`us119-${label}-admin`);
  const studentUserId = await user(`us119-${label}-student`);
  const organizationId = await organization(adminId, `US-119 ${label}`);
  await member(adminId, organizationId, "SCHOOL_ADMIN");
  await member(studentUserId, organizationId, "STUDENT");
  const studentId = await student(organizationId, studentUserId, "US-119 Student");
  const classId = await klass(organizationId, adminId, "US-119 Class 8");
  const enrollmentId = await enrollment(organizationId, studentId, classId);
  await pool.query(`UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`, [
    enrollmentId,
    studentId,
  ]);
  const subjectId = await subject(organizationId, classId, "Mathematics");
  const board = (await pool.query("SELECT id FROM boards WHERE code = 'CBSE' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE code = 'EN' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  const language = (await pool.query("SELECT id FROM languages WHERE code = 'EN' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  const syllabus = await pool.query(
    `INSERT INTO syllabi
       (class_id, board_id, medium_id, name, code, status, is_authoritative)
     VALUES ($1, $2, $3, 'US-119 Class 8 CBSE', $4, 'ACTIVE', TRUE) RETURNING id`,
    [classId, board.id, medium.id, `US119-${randomUUID()}`]
  );
  created.syllabi.push(syllabus.rows[0].id);
  await pool.query(
    `INSERT INTO syllabus_languages (syllabus_id, language_id, language_role)
     VALUES ($1, $2, 'CONTENT')`,
    [syllabus.rows[0].id, language.id]
  );
  const version = await pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, status)
     VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [syllabus.rows[0].id, `v-${randomUUID()}`]
  );
  const structure = await pool.query(
    `INSERT INTO curriculum_structures
       (syllabus_version_id, structure_kind, name, subject_id, status)
     VALUES ($1, 'SYLLABUS', 'US-119 authoritative structure', $2, 'ACTIVE') RETURNING id`,
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
    adminId,
    organizationId,
    studentId,
    studentUserId,
    classId,
    subjectId,
    boardId: board.id as string,
    studentToken: createAccessToken(studentUserId),
    adminToken: createAccessToken(adminId),
  };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function createConversation(
  f: Awaited<ReturnType<typeof fixture>>,
  body: Record<string, unknown> = {}
) {
  const response = await request(app)
    .post("/api/ai/conversations")
    .set(auth(f.studentToken, f.organizationId))
    .send(body);
  expect(response.status).toBe(201);
  created.conversations.push(response.body.conversation.id);
  return response;
}

function capturePrompts() {
  const prompts: string[] = [];
  vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async (prompt) => {
    prompts.push(prompt);
    return {
      text: "Board-aware answer",
      metadata: {
        provider: "mock",
        model: "mock-model",
        status: "SUCCESS" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        requestId: `us119-${prompts.length}`,
      },
    };
  });
  return prompts;
}

describe("US-119 board-aware conversation integration", () => {
  it("grounds a normal response in the authoritative US-118 board and evidence", async () => {
    const f = await fixture("normal");
    const prompts = capturePrompts();
    await createConversation(f, {
      question: "Explain equivalent fractions.",
      scope: {
        subject: "Mathematics",
        chapter: "Fractions",
        topic: "Equivalent Fractions",
        language: "English",
        medium: "English",
      },
    });

    expect(prompts[0]).toContain("Board: CBSE");
    expect(prompts[0]).toContain("Board response mode: CURRICULUM_GROUNDED");
    expect(prompts[0]).toContain("authoritative_curriculum_evidence_data");
    expect(prompts[0]).toContain("Equivalent fractions represent the same quantity");
  });

  it("uses an explicit current-response board without mutating conversation scope", async () => {
    const f = await fixture("current");
    const prompts = capturePrompts();
    const createdResponse = await createConversation(f);
    const followUp = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({
        question: "Explain this topic using CBSE.",
        board_id: randomUUID(),
        class_id: randomUUID(),
        syllabus_id: randomUUID(),
        student_id: randomUUID(),
        organization_id: randomUUID(),
        resource_id: randomUUID(),
      });

    expect(followUp.status).toBe(201);
    expect(prompts[0]).toContain("Board: CBSE");
    expect(followUp.body.conversation.scope.board).toBeNull();
    const stored = await pool.query(
      `SELECT scope_board FROM ai_conversations WHERE id = $1`,
      [createdResponse.body.conversation.id]
    );
    expect(stored.rows[0].scope_board).toBeNull();

    const later = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Tell me more." });
    expect(later.status).toBe(201);
    expect(prompts.at(-1)).toContain("Board: CBSE");
    expect(later.body.conversation.scope.board).toBeNull();
  });

  it("persists a validated canonical board for conversation-level requests", async () => {
    const f = await fixture("persistent");
    const createdResponse = await createConversation(f);
    const changed = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "From now on, explain using CBSE." });

    expect(changed.status).toBe(201);
    expect(changed.body.conversation.scope.board).toBe("CBSE");
    const stored = await pool.query(
      `SELECT scope_board FROM ai_conversations WHERE id = $1`,
      [createdResponse.body.conversation.id]
    );
    expect(stored.rows[0].scope_board).toBe("CBSE");
  });

  it("restores the authoritative normal board and clears an invalid override", async () => {
    const f = await fixture("restore");
    const createdResponse = await createConversation(f, {
      question: "Start with a temporary label.",
      scope: { board: "ICSE" },
    });
    expect(createdResponse.body.conversation.scope.board).toBe("ICSE");

    const restored = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Switch back to my normal board." });

    expect(restored.status).toBe(201);
    expect(restored.body.conversation.scope.board).toBeNull();
  });

  it("does not mutate scope for another-board or unknown-board clarification", async () => {
    const f = await fixture("clarify");
    const prompts = capturePrompts();
    const createdResponse = await createConversation(f, {
      scope: { board: "CBSE" },
    });
    const conversationId = createdResponse.body.conversation.id;

    const another = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Use another board." });
    expect(another.status).toBe(201);
    expect(another.body.conversation.scope.board).toBe("CBSE");
    expect(prompts.at(-1)).toContain("TARGETED_CLARIFICATION");

    const unknown = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Explain this according to Future Board." });
    expect(unknown.status).toBe(201);
    expect(unknown.body.conversation.scope.board).toBe("CBSE");
    expect(prompts.at(-1)).toContain("Board: not provided");
    expect(prompts.at(-1)).not.toContain("Board: CBSE");
  });

  it("does not infer an active but non-authoritative alternate board from TN or CBSE equivalence", async () => {
    const f = await fixture("alternate-unresolved");
    const prompts = capturePrompts();
    const createdResponse = await createConversation(f, { scope: { board: "CBSE" } });
    const response = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Switch this conversation to ICSE." });

    expect(response.status).toBe(201);
    expect(response.body.conversation.scope.board).toBe("CBSE");
    expect(prompts.at(-1)).toContain("Board: not provided");
    expect(prompts.at(-1)).toContain("TARGETED_CLARIFICATION");
  });

  it("resolves one exact active enrolled alternate-board context and persists it only when requested", async () => {
    const f = await fixture("alternate-resolved");
    const alternateClassId = await klass(
      f.organizationId,
      f.adminId,
      "US-119 Alternate Class 8"
    );
    await subject(f.organizationId, alternateClassId, "Alternate Mathematics");
    await enrollment(f.organizationId, f.studentId, alternateClassId);
    const icse = (await pool.query("SELECT id FROM boards WHERE code = 'ICSE' AND status = 'ACTIVE' LIMIT 1")).rows[0];
    const medium = (await pool.query("SELECT id FROM mediums WHERE code = 'EN' AND status = 'ACTIVE' LIMIT 1")).rows[0];
    const alternateSubject = (
      await pool.query(`SELECT id FROM subjects WHERE organization_id = $1 AND name = 'Alternate Mathematics'`, [
        f.organizationId,
      ])
    ).rows[0];
    const alternateSyllabus = await pool.query(
      `INSERT INTO syllabi
         (class_id, board_id, medium_id, name, code, status, is_authoritative)
       VALUES ($1, $2, $3, 'US-119 Class 8 ICSE', $4, 'ACTIVE', TRUE) RETURNING id`,
      [alternateClassId, icse.id, medium.id, `US119-${randomUUID()}`]
    );
    created.syllabi.push(alternateSyllabus.rows[0].id);
    const alternateVersion = await pool.query(
      `INSERT INTO syllabus_versions (syllabus_id, version, status)
       VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [alternateSyllabus.rows[0].id, `v-${randomUUID()}`]
    );
    const alternateStructure = await pool.query(
      `INSERT INTO curriculum_structures
         (syllabus_version_id, structure_kind, name, subject_id, status)
       VALUES ($1, 'SYLLABUS', 'US-119 alternate structure', $2, 'ACTIVE') RETURNING id`,
      [alternateVersion.rows[0].id, alternateSubject.id]
    );
    const alternateNodeType = await pool.query(
      `SELECT id FROM curriculum_node_types WHERE code = 'CHAPTER' AND status = 'ACTIVE' LIMIT 1`
    );
    await pool.query(
      `INSERT INTO curriculum_nodes
         (curriculum_structure_id, node_type_id, title, description, status)
       VALUES ($1, $2, 'Fractions', 'Alternate authoritative ICSE chapter.', 'ACTIVE')`,
      [alternateStructure.rows[0].id, alternateNodeType.rows[0].id]
    );
    const prompts = capturePrompts();
    const createdResponse = await createConversation(f, {
      scope: { subject: "Alternate Mathematics", chapter: "Fractions" },
    });
    const conversationId = createdResponse.body.conversation.id;

    const current = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "Explain this using ICSE." });
    expect(current.status).toBe(201);
    expect(prompts.at(-1)).toContain("Board: ICSE");
    expect(current.body.conversation.scope.board).toBeNull();

    const persistent = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "From now on, explain using ICSE." });
    expect(persistent.status).toBe(201);
    expect(persistent.body.conversation.scope).toMatchObject({
      board: "ICSE",
      class: "US-119 Alternate Class 8",
      subject: "Alternate Mathematics",
      chapter: "Fractions",
    });

    const restored = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "My normal board" });
    expect(restored.status).toBe(201);
    expect(restored.body.conversation.scope).toMatchObject({
      board: null,
      class: "US-119 Class 8",
      subject: null,
      chapter: null,
      topic: null,
    });
    expect(prompts.at(-1)).toContain("Board: CBSE");
  });

  it("clears downstream values that are invalid under the resolved board context", async () => {
    const f = await fixture("downstream");
    const createdResponse = await createConversation(f, {
      scope: {
        subject: "Science",
        chapter: "Plants",
        topic: "Photosynthesis",
      },
    });
    const changed = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "From now on, explain using CBSE." });

    expect(changed.status).toBe(201);
    expect(changed.body.conversation.scope).toMatchObject({
      board: "CBSE",
      subject: null,
      chapter: null,
      topic: null,
    });
  });

  it("preserves a valid durable switch and does not repeat it on retry", async () => {
    const f = await fixture("retry");
    const updateSpy = vi.spyOn(ConversationRepository.prototype, "updateConversationScope");
    let calls = 0;
    vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("rate limit");
      return {
        text: "Retry succeeded",
        metadata: {
          provider: "mock",
          model: "mock-model",
          status: "SUCCESS",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          requestId: "retry-success",
        },
      };
    });
    const createdResponse = await createConversation(f);
    const conversationId = createdResponse.body.conversation.id;
    const failed = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "From now on, explain using CBSE." });
    expect(failed.status).toBe(502);
    expect(failed.body.conversation.scope.board).toBe("CBSE");

    const retried = await request(app)
      .post(`/api/ai/conversations/${conversationId}/retry`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ attempt_id: failed.body.attempt.id });
    expect(retried.status).toBe(201);
    expect(retried.body.conversation.scope.board).toBe("CBSE");
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("regenerates with the original board meaning without repeating durable scope mutation", async () => {
    const f = await fixture("regenerate");
    const prompts = capturePrompts();
    const original = await createConversation(f);
    const conversationId = original.body.conversation.id;
    const persistent = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ question: "From now on, explain using CBSE." });
    expect(persistent.status).toBe(201);
    const changed = await request(app)
      .patch(`/api/ai/conversations/${conversationId}/scope`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ scope: { board: "ICSE" } });
    expect(changed.status).toBe(200);

    const regenerated = await request(app)
      .post(`/api/ai/conversations/${conversationId}/regenerate`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ response_message_id: persistent.body.response_message.id });
    expect(regenerated.status).toBe(201);
    expect(prompts.at(-1)).toContain("Board: CBSE");
    expect(regenerated.body.conversation.scope.board).toBe("ICSE");
  });

  it("keeps sibling branch history isolated while board scope remains conversation-wide", async () => {
    const f = await fixture("branches");
    const prompts = capturePrompts();
    const original = await createConversation(f, { question: "Original branch question." });
    const conversationId = original.body.conversation.id;
    const edited = await request(app)
      .patch(`/api/ai/conversations/${conversationId}/messages/${original.body.student_message.id}`)
      .set(auth(f.studentToken, f.organizationId))
      .send({
        content: "From now on, explain using CBSE. Edited sibling question.",
      });
    expect(edited.status).toBe(201);
    expect(edited.body.conversation.scope.board).toBe("CBSE");
    expect(prompts.at(-1)).not.toContain("Original branch question.");

    const branches = await request(app)
      .get(`/api/ai/conversations/${conversationId}/branches`)
      .set(auth(f.studentToken, f.organizationId));
    const primary = branches.body.branches.find((branch: { is_primary: boolean }) => branch.is_primary);
    const primaryWrite = await request(app)
      .post(`/api/ai/conversations/${conversationId}/messages`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ branch_id: primary.id, question: "Primary branch follow-up." });
    expect(primaryWrite.status).toBe(201);
    expect(prompts.at(-1)).toContain("Board: CBSE");
    expect(prompts.at(-1)).not.toContain("Edited sibling question.");
  });

  it("preserves the legacy reply endpoint without persisting a current-response board", async () => {
    const f = await fixture("legacy");
    const createdResponse = await createConversation(f);
    const response = await request(app)
      .post("/api/ai/reply")
      .set(auth(f.studentToken, f.organizationId))
      .send({
        conversation_id: createdResponse.body.conversation.id,
        question: "Explain this using CBSE.",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.role).toBe("assistant");
    const stored = await pool.query(
      `SELECT scope_board FROM ai_conversations WHERE id = $1`,
      [createdResponse.body.conversation.id]
    );
    expect(stored.rows[0].scope_board).toBeNull();
  });

  it("performs no evidence lookup or provider call after authorization failure", async () => {
    const owner = await fixture("security-owner");
    const createdResponse = await createConversation(owner);
    const teacherId = await user("us119-security-teacher");
    await member(teacherId, owner.organizationId, "TEACHER");
    const otherUserId = await user("us119-security-other-student");
    await member(otherUserId, owner.organizationId, "STUDENT");
    await student(owner.organizationId, otherUserId, "Other student");
    const evidenceSpy = vi.spyOn(BoardEvidenceRepository.prototype, "getEvidence");
    const providerSpy = vi.spyOn(MockLlmProvider.prototype, "generateWithMetadata");

    const teacher = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(createAccessToken(teacherId), owner.organizationId))
      .send({ question: "Explain this using CBSE." });
    const otherStudent = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(createAccessToken(otherUserId), owner.organizationId))
      .send({ question: "Explain this using CBSE." });
    const otherTenant = await fixture("security-other-tenant");
    const crossTenant = await request(app)
      .post(`/api/ai/conversations/${createdResponse.body.conversation.id}/messages`)
      .set(auth(otherTenant.studentToken, otherTenant.organizationId))
      .send({ question: "Explain this using CBSE." });

    expect(teacher.status).toBe(403);
    expect(otherStudent.status).toBe(404);
    expect(crossTenant.status).toBe(404);
    expect(evidenceSpy).not.toHaveBeenCalled();
    expect(providerSpy).not.toHaveBeenCalled();
  });
});
