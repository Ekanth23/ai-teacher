import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();

const unique = (prefix: string) => `${prefix.slice(0, 20)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const created = {
  users: [] as string[],
  organizations: [] as string[],
  teachers: [] as string[],
  classes: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
  structures: [] as string[],
  nodes: [] as string[],
  practices: [] as string[],
};

async function cleanup() {
  if (created.practices.length) await pool.query("DELETE FROM practices WHERE id = ANY($1::uuid[])", [created.practices]);
  if (created.nodes.length) await pool.query("DELETE FROM curriculum_nodes WHERE id = ANY($1::uuid[])", [created.nodes]);
  if (created.structures.length) await pool.query("DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])", [created.structures]);
  if (created.syllabusVersions.length) await pool.query("DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])", [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
  if (created.classes.length) {
    await pool.query("DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  }
  if (created.teachers.length) {
    await pool.query("DELETE FROM class_teacher_assignments WHERE teacher_id = ANY($1::uuid[])", [created.teachers]);
    await pool.query("DELETE FROM teachers WHERE id = ANY($1::uuid[])", [created.teachers]);
  }
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  Object.values(created).forEach((ids) => { ids.length = 0; });
}

afterEach(cleanup);

async function createUser(label: string) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${unique(`p039_${label}`)}@example.com`, `Phase 039 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 039 ${label}`, unique(`p039_org_${label}`), ownerUserId]
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

async function createClass(organizationId: string, ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO classes (organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, `Phase 039 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createTeacher(organizationId: string, userId: string) {
  const result = await pool.query(
    `INSERT INTO teachers (user_id, organization_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [userId, organizationId]
  );
  created.teachers.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function assignClassTeacher(organizationId: string, classId: string, teacherId: string) {
  await pool.query(
    `INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id) VALUES ($1, $2, $3)`,
    [organizationId, classId, teacherId]
  );
}

async function createOrgScopedStructure(organizationId: string, classId: string, label: string) {
  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const syllabus = await pool.query(
    `INSERT INTO syllabi (class_id, board_id, medium_id, name, code)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [classId, board.id, medium.id, `Phase 039 syllabus ${label}`, unique(`p039s_${label}`)]
  );
  created.syllabi.push(syllabus.rows[0].id);
  const version = await pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`,
    [syllabus.rows[0].id]
  );
  created.syllabusVersions.push(version.rows[0].id);
  const structure = await pool.query(
    `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name)
     VALUES ($1, 'SYLLABUS', $2) RETURNING id`,
    [version.rows[0].id, `Phase 039 structure ${label}`]
  );
  created.structures.push(structure.rows[0].id);
  return structure.rows[0].id as string;
}

async function createChapterNode(structureId: string, title: string) {
  const type = await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'chapter' LIMIT 1");
  const node = await pool.query(
    `INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title)
     VALUES ($1, NULL, $2, $3) RETURNING id`,
    [structureId, type.rows[0].id, title]
  );
  created.nodes.push(node.rows[0].id);
  return node.rows[0].id as string;
}

async function createTopicNode(structureId: string, chapterId: string, title: string) {
  const type = await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' LIMIT 1");
  const node = await pool.query(
    `INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [structureId, chapterId, type.rows[0].id, title]
  );
  created.nodes.push(node.rows[0].id);
  return node.rows[0].id as string;
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function adminFixture(label: string) {
  const adminId = await createUser(`${label}-admin`);
  const organizationId = await createOrganization(adminId, `${label}-org`);
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  const classId = await createClass(organizationId, adminId, label);
  const structureId = await createOrgScopedStructure(organizationId, classId, label);
  const chapterId = await createChapterNode(structureId, `${label} chapter`);
  const topicId = await createTopicNode(structureId, chapterId, `${label} topic`);
  return {
    organizationId,
    classId,
    structureId,
    chapterId,
    topicId,
    adminId,
    adminToken: createAccessToken(adminId),
  };
}

async function teacherFixture(label: string) {
  const base = await adminFixture(label);
  const teacherUserId = await createUser(`${label}-teacher`);
  await addMember(teacherUserId, base.organizationId, "TEACHER");
  const teacherId = await createTeacher(base.organizationId, teacherUserId);
  await assignClassTeacher(base.organizationId, base.classId, teacherId);
  return { ...base, teacherId, teacherToken: createAccessToken(teacherUserId) };
}

function validQuestion(overrides: Record<string, unknown> = {}) {
  return {
    question_text: "5 x 5 = ?",
    options: [
      { key: "A", text: "10" },
      { key: "B", text: "20" },
      { key: "C", text: "25" },
      { key: "D", text: "30" },
    ],
    correct_option_key: "C",
    ...overrides,
  };
}

async function createDraftPractice(token: string, organizationId: string, topicId: string) {
  const res = await request(app)
    .post("/api/practices")
    .set(auth(token, organizationId))
    .send({ curriculum_node_id: topicId, practice_type: "PRACTICE", title: "Mixed fractions" });
  expect(res.status).toBe(201);
  created.practices.push(res.body.practice.id);
  return res.body.practice as { id: string };
}

describe("Practice authoring - auth and authorization", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await request(app).post("/api/practices")).status).toBe(401);
    expect((await request(app).get("/api/practices/00000000-0000-4000-8000-000000000000")).status).toBe(401);
  });

  it("rejects a non-authoring (student) role", async () => {
    const f = await adminFixture("student-role");
    const studentUserId = await createUser("student");
    await addMember(studentUserId, f.organizationId, "STUDENT");
    const res = await request(app).post("/api/practices")
      .set(auth(createAccessToken(studentUserId), f.organizationId))
      .send({ curriculum_node_id: f.topicId, practice_type: "PRACTICE", title: "t" });
    expect(res.status).toBe(403);
  });

  it("allows school admin to create a practice", async () => {
    const f = await adminFixture("admin");
    const res = await request(app).post("/api/practices")
      .set(auth(f.adminToken, f.organizationId))
      .send({ curriculum_node_id: f.topicId, practice_type: "QUIZ", title: "My quiz" });
    expect(res.status).toBe(201);
    created.practices.push(res.body.practice.id);
    expect(res.body.practice.status).toBe("DRAFT");
  });

  it("allows an assigned teacher to create a practice", async () => {
    const f = await teacherFixture("teacher");
    const res = await request(app).post("/api/practices")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ curriculum_node_id: f.topicId, practice_type: "PRACTICE", title: "t" });
    expect(res.status).toBe(201);
    created.practices.push(res.body.practice.id);
  });

  it("rejects a teacher not assigned to the topic's class", async () => {
    const f = await adminFixture("unassigned-teacher");
    const teacherUserId = await createUser("teacher-unassigned");
    await addMember(teacherUserId, f.organizationId, "TEACHER");
    await createTeacher(f.organizationId, teacherUserId);
    const res = await request(app).post("/api/practices")
      .set(auth(createAccessToken(teacherUserId), f.organizationId))
      .send({ curriculum_node_id: f.topicId, practice_type: "PRACTICE", title: "t" });
    expect(res.status).toBe(403);
  });
});

describe("Practice - topic association", () => {
  it("rejects a non-topic (chapter) node", async () => {
    const f = await adminFixture("chapter");
    const res = await request(app).post("/api/practices")
      .set(auth(f.adminToken, f.organizationId))
      .send({ curriculum_node_id: f.chapterId, practice_type: "PRACTICE", title: "t" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-existent curriculum node", async () => {
    const f = await adminFixture("missing-node");
    const res = await request(app).post("/api/practices")
      .set(auth(f.adminToken, f.organizationId))
      .send({ curriculum_node_id: "00000000-0000-4000-8000-000000000000", practice_type: "PRACTICE", title: "t" });
    expect(res.status).toBe(404);
  });

  it("rejects a topic from another organization", async () => {
    const a = await adminFixture("org-a");
    const b = await adminFixture("org-b");
    const res = await request(app).post("/api/practices")
      .set(auth(a.adminToken, a.organizationId))
      .send({ curriculum_node_id: b.topicId, practice_type: "PRACTICE", title: "t" });
    expect(res.status).toBe(403);
  });
});

describe("Practice - validation and lifecycle", () => {
  it("requires a title", async () => {
    const f = await adminFixture("no-title");
    const res = await request(app).post("/api/practices")
      .set(auth(f.adminToken, f.organizationId))
      .send({ curriculum_node_id: f.topicId, practice_type: "PRACTICE" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid practice_type", async () => {
    const f = await adminFixture("bad-type");
    const res = await request(app).post("/api/practices")
      .set(auth(f.adminToken, f.organizationId))
      .send({ curriculum_node_id: f.topicId, practice_type: "ESSAY", title: "t" });
    expect(res.status).toBe(400);
  });

  it("updates a draft practice", async () => {
    const f = await adminFixture("draft-update");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const res = await request(app).patch(`/api/practices/${p.id}`)
      .set(auth(f.adminToken, f.organizationId))
      .send({ title: "Renamed", description: "desc", practice_type: "SELF_ASSESSMENT" });
    expect(res.status).toBe(200);
    expect(res.body.practice.title).toBe("Renamed");
    expect(res.body.practice.practice_type).toBe("SELF_ASSESSMENT");

    const db = await pool.query("SELECT title, practice_type FROM practices WHERE id = $1", [p.id]);
    expect(db.rows[0].title).toBe("Renamed");
    expect(db.rows[0].practice_type).toBe("SELF_ASSESSMENT");
  });

  it("does not allow the update endpoint to change status", async () => {
    const f = await adminFixture("status-guard");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const res = await request(app).patch(`/api/practices/${p.id}`)
      .set(auth(f.adminToken, f.organizationId))
      .send({ status: "PUBLISHED" });
    expect(res.status).toBe(200);
    expect(res.body.practice.status).toBe("DRAFT");
  });

  it("publishes a draft practice", async () => {
    const f = await adminFixture("publish");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const res = await request(app).post(`/api/practices/${p.id}/publish`).set(auth(f.adminToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.practice.status).toBe("PUBLISHED");
  });

  it("archives a practice", async () => {
    const f = await adminFixture("archive");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const res = await request(app).post(`/api/practices/${p.id}/archive`).set(auth(f.adminToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.practice.status).toBe("ARCHIVED");
  });

  it("cannot modify a published practice", async () => {
    const f = await adminFixture("published-immutable");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    await request(app).post(`/api/practices/${p.id}/publish`).set(auth(f.adminToken, f.organizationId));

    const res = await request(app).patch(`/api/practices/${p.id}`)
      .set(auth(f.adminToken, f.organizationId))
      .send({ title: "Changed" });
    expect(res.status).toBe(400);

    const db = await pool.query("SELECT status, title FROM practices WHERE id = $1", [p.id]);
    expect(db.rows[0].status).toBe("PUBLISHED");
    expect(db.rows[0].title).toBe("Mixed fractions");
  });

  it("cannot re-publish an already-published practice", async () => {
    const f = await adminFixture("republish");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    await request(app).post(`/api/practices/${p.id}/publish`).set(auth(f.adminToken, f.organizationId));
    const res = await request(app).post(`/api/practices/${p.id}/publish`).set(auth(f.adminToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("ignores client-supplied organization_id", async () => {
    const f = await adminFixture("tenant");
    const other = await adminFixture("other-tenant");
    const res = await request(app).post("/api/practices")
      .set(auth(f.adminToken, f.organizationId))
      .send({ organization_id: other.organizationId, curriculum_node_id: f.topicId, practice_type: "PRACTICE", title: "tenant-safe" });
    expect(res.status).toBe(201);
    created.practices.push(res.body.practice.id);
    expect(res.body.practice.organization_id).toBe(f.organizationId);
  });
});

describe("Practice - cross-tenant IDOR", () => {
  it("cannot read another organization's practice", async () => {
    const a = await adminFixture("a");
    const b = await adminFixture("b");
    const p = await createDraftPractice(a.adminToken, a.organizationId, a.topicId);

    const res = await request(app).get(`/api/practices/${p.id}`).set(auth(b.adminToken, b.organizationId));
    expect(res.status).toBe(403);
  });

  it("cannot mutate another organization's practice", async () => {
    const a = await adminFixture("a2");
    const b = await adminFixture("b2");
    const p = await createDraftPractice(a.adminToken, a.organizationId, a.topicId);

    const res = await request(app).patch(`/api/practices/${p.id}`)
      .set(auth(b.adminToken, b.organizationId))
      .send({ title: "Hijacked" });
    expect(res.status).toBe(403);
  });
});

describe("Practice questions - validation and immutability", () => {
  it("adds a valid multiple-choice question", async () => {
    const f = await adminFixture("q-valid");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const res = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion());
    expect(res.status).toBe(201);
    expect(res.body.question.correct_option_key).toBe("C");
    expect((res.body.question.options as unknown[]).length).toBe(4);

    const list = await request(app).get(`/api/practices/${p.id}/questions`).set(auth(f.adminToken, f.organizationId));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
  });

  it("rejects an invalid question type", async () => {
    const f = await adminFixture("q-type");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const res = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion({ question_type: "ESSAY" }));
    expect(res.status).toBe(400);
  });

  it("rejects malformed options", async () => {
    const f = await adminFixture("q-options");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);

    const emptyText = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion({ options: [{ key: "A", text: "" }] }));
    expect(emptyText.status).toBe(400);

    const notArray = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion({ options: "not-an-array" }));
    expect(notArray.status).toBe(400);
  });

  it("rejects a duplicate option key", async () => {
    const f = await adminFixture("q-dupkey");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const res = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion({
        options: [{ key: "A", text: "1" }, { key: "A", text: "2" }],
        correct_option_key: "A",
      }));
    expect(res.status).toBe(400);
  });

  it("rejects a correct_option_key that does not match any option", async () => {
    const f = await adminFixture("q-badkey");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const res = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion({ correct_option_key: "Z" }));
    expect(res.status).toBe(400);
  });

  it("rejects negative marks", async () => {
    const f = await adminFixture("q-marks");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const res = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion({ marks: -1 }));
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate sequence number", async () => {
    const f = await adminFixture("q-seq");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion({ sequence_number: 0 }));
    const res = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion({ sequence_number: 0, question_text: "another question" }));
    expect(res.status).toBe(409);
  });

  it("blocks question modifications after publication", async () => {
    const f = await adminFixture("q-pub");
    const p = await createDraftPractice(f.adminToken, f.organizationId, f.topicId);
    const createdQ = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion());
    const questionId = createdQ.body.question.id;
    await request(app).post(`/api/practices/${p.id}/publish`).set(auth(f.adminToken, f.organizationId));

    const add = await request(app).post(`/api/practices/${p.id}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send(validQuestion({ sequence_number: 1 }));
    expect(add.status).toBe(400);

    const patch = await request(app).patch(`/api/practices/${p.id}/questions/${questionId}`)
      .set(auth(f.adminToken, f.organizationId))
      .send({ question_text: "changed" });
    expect(patch.status).toBe(400);

    const del = await request(app).delete(`/api/practices/${p.id}/questions/${questionId}`)
      .set(auth(f.adminToken, f.organizationId));
    expect(del.status).toBe(400);
  });
});





