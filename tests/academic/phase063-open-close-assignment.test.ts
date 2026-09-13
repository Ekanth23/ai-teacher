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
  subjects: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
  structures: [] as string[],
  nodes: [] as string[],
  assignments: [] as string[],
};

async function cleanup() {
  if (created.assignments.length) await pool.query("DELETE FROM assignments WHERE id = ANY($1::uuid[])", [created.assignments]);
  if (created.nodes.length) await pool.query("DELETE FROM curriculum_nodes WHERE id = ANY($1::uuid[])", [created.nodes]);
  if (created.structures.length) await pool.query("DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])", [created.structures]);
  if (created.syllabusVersions.length) await pool.query("DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])", [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
  if (created.classes.length) {
    await pool.query("DELETE FROM class_subject_teachers WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  }
  if (created.subjects.length) {
    await pool.query("DELETE FROM class_subject_teachers WHERE subject_id = ANY($1::uuid[])", [created.subjects]);
    await pool.query("DELETE FROM class_subjects WHERE subject_id = ANY($1::uuid[])", [created.subjects]);
    await pool.query("DELETE FROM subjects WHERE id = ANY($1::uuid[])", [created.subjects]);
  }
  if (created.teachers.length) {
    await pool.query("DELETE FROM class_subject_teachers WHERE teacher_id = ANY($1::uuid[])", [created.teachers]);
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
    [`${unique(`p063_${label}`)}@example.com`, `Phase 063 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 063 ${label}`, unique(`p063_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 063 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createSubject(organizationId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 063 subject ${label}`, unique(`p063subj_${label}`)]
  );
  created.subjects.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function mapSubjectToClass(organizationId: string, classId: string, subjectId: string) {
  await pool.query(
    `INSERT INTO class_subjects (organization_id, class_id, subject_id)
     VALUES ($1, $2, $3)`,
    [organizationId, classId, subjectId]
  );
}

async function createTeacher(organizationId: string, userId: string) {
  const result = await pool.query(
    `INSERT INTO teachers (user_id, organization_id, status)
     VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [userId, organizationId]
  );
  created.teachers.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function assignClassTeacher(organizationId: string, classId: string, teacherId: string) {
  await pool.query(
    `INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id)
     VALUES ($1, $2, $3)`,
    [organizationId, classId, teacherId]
  );
}

async function assignSubjectTeacher(organizationId: string, classId: string, subjectId: string, teacherId: string) {
  await pool.query(
    `INSERT INTO class_subject_teachers (organization_id, class_id, subject_id, teacher_id, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE')`,
    [organizationId, classId, subjectId, teacherId]
  );
}

async function createOrgScopedStructure(organizationId: string, classId: string, label: string) {
  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const syllabus = await pool.query(
    `INSERT INTO syllabi (class_id, board_id, medium_id, name, code)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [classId, board.id, medium.id, `Phase 063 syllabus ${label}`, unique(`p063s_${label}`)]
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
    [version.rows[0].id, `Phase 063 structure ${label}`]
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

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

// Builds an org with a class, a mapped subject, and an authorized class teacher.
async function fixture() {
  const adminId = await createUser("admin");
  const teacherUserId = await createUser("teacher");
  const organizationId = await createOrganization(adminId, "org");
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  await addMember(teacherUserId, organizationId, "TEACHER");

  const classId = await createClass(organizationId, adminId, "class");
  const subjectId = await createSubject(organizationId, "subject");
  await mapSubjectToClass(organizationId, classId, subjectId);

  const teacherId = await createTeacher(organizationId, teacherUserId);
  await assignClassTeacher(organizationId, classId, teacherId);

  return {
    organizationId,
    classId,
    subjectId,
    teacherId,
    teacherToken: createAccessToken(teacherUserId),
    adminToken: createAccessToken(adminId),
  };
}

async function createDraft(token: string, organizationId: string, classId: string, subjectId: string, title = "Draft homework") {
  const res = await request(app)
    .post("/api/assignments")
    .set(auth(token, organizationId))
    .send({ class_id: classId, subject_id: subjectId, title, description: "initial" });
  expect(res.status).toBe(201);
  created.assignments.push(res.body.assignment.id);
  return res.body.assignment;
}

async function publish(token: string, organizationId: string, assignmentId: string) {
  const res = await request(app).post(`/api/assignments/${assignmentId}/publish`).set(auth(token, organizationId));
  expect(res.status).toBe(200);
  return res.body.assignment;
}

describe("US-063 open / close assignment", () => {
  it("opens a published assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await publish(f.teacherToken, f.organizationId, draft.id);

    const res = await request(app).post(`/api/assignments/${draft.id}/open`).set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.assignment.status).toBe("OPEN");

    const db = await pool.query("SELECT status FROM assignments WHERE id = $1", [draft.id]);
    expect(db.rows[0].status).toBe("OPEN");
  });

  it("closes an open assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await publish(f.teacherToken, f.organizationId, draft.id);
    await request(app).post(`/api/assignments/${draft.id}/open`).set(auth(f.teacherToken, f.organizationId));

    const res = await request(app).post(`/api/assignments/${draft.id}/close`).set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.assignment.status).toBe("CLOSED");

    const db = await pool.query("SELECT status FROM assignments WHERE id = $1", [draft.id]);
    expect(db.rows[0].status).toBe("CLOSED");
  });

  it("walks the full lifecycle DRAFT -> PUBLISHED -> OPEN -> CLOSED", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    expect(draft.status).toBe("DRAFT");

    const published = await publish(f.teacherToken, f.organizationId, draft.id);
    expect(published.status).toBe("PUBLISHED");

    const opened = await request(app).post(`/api/assignments/${draft.id}/open`).set(auth(f.teacherToken, f.organizationId));
    expect(opened.body.assignment.status).toBe("OPEN");

    const closed = await request(app).post(`/api/assignments/${draft.id}/close`).set(auth(f.teacherToken, f.organizationId));
    expect(closed.body.assignment.status).toBe("CLOSED");
  });

  it("rejects opening a draft assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app).post(`/api/assignments/${draft.id}/open`).set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects closing a draft assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app).post(`/api/assignments/${draft.id}/close`).set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("rejects closing a published (not yet open) assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await publish(f.teacherToken, f.organizationId, draft.id);

    const res = await request(app).post(`/api/assignments/${draft.id}/close`).set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(400);

    const db = await pool.query("SELECT status FROM assignments WHERE id = $1", [draft.id]);
    expect(db.rows[0].status).toBe("PUBLISHED");
  });

  it("rejects opening an already-open assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await publish(f.teacherToken, f.organizationId, draft.id);
    await request(app).post(`/api/assignments/${draft.id}/open`).set(auth(f.teacherToken, f.organizationId));

    const res = await request(app).post(`/api/assignments/${draft.id}/open`).set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("rejects opening a closed assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await publish(f.teacherToken, f.organizationId, draft.id);
    await request(app).post(`/api/assignments/${draft.id}/open`).set(auth(f.teacherToken, f.organizationId));
    await request(app).post(`/api/assignments/${draft.id}/close`).set(auth(f.teacherToken, f.organizationId));

    const res = await request(app).post(`/api/assignments/${draft.id}/open`).set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("rejects closing an already-closed assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await publish(f.teacherToken, f.organizationId, draft.id);
    await request(app).post(`/api/assignments/${draft.id}/open`).set(auth(f.teacherToken, f.organizationId));
    await request(app).post(`/api/assignments/${draft.id}/close`).set(auth(f.teacherToken, f.organizationId));

    const res = await request(app).post(`/api/assignments/${draft.id}/close`).set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    const open = await request(app).post("/api/assignments/00000000-0000-4000-8000-000000000000/open");
    const close = await request(app).post("/api/assignments/00000000-0000-4000-8000-000000000000/close");
    expect(open.status).toBe(401);
    expect(close.status).toBe(401);
  });

  it("rejects a non-teacher role", async () => {
    const f = await fixture();
    const studentUserId = await createUser("student");
    await addMember(studentUserId, f.organizationId, "STUDENT");
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await publish(f.teacherToken, f.organizationId, draft.id);

    const res = await request(app)
      .post(`/api/assignments/${draft.id}/open`)
      .set(auth(createAccessToken(studentUserId), f.organizationId));
    expect(res.status).toBe(403);
  });

  it("rejects a teacher who is not authorized for the assignment's class and subject", async () => {
    const f = await fixture();
    const outsiderUserId = await createUser("outsider-teacher");
    await addMember(outsiderUserId, f.organizationId, "TEACHER");
    await createTeacher(f.organizationId, outsiderUserId);
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await publish(f.teacherToken, f.organizationId, draft.id);

    const res = await request(app)
      .post(`/api/assignments/${draft.id}/open`)
      .set(auth(createAccessToken(outsiderUserId), f.organizationId));
    expect(res.status).toBe(403);
  });

  it("rejects an assignment id from another organization", async () => {
    const f = await fixture();

    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    await addMember(otherAdminId, otherOrgId, "SCHOOL_ADMIN");
    const otherTeacherUserId = await createUser("other-teacher");
    await addMember(otherTeacherUserId, otherOrgId, "TEACHER");
    const otherClassId = await createClass(otherOrgId, otherAdminId, "other-class");
    const otherSubjectId = await createSubject(otherOrgId, "other-subject");
    await mapSubjectToClass(otherOrgId, otherClassId, otherSubjectId);
    const otherTeacherId = await createTeacher(otherOrgId, otherTeacherUserId);
    await assignClassTeacher(otherOrgId, otherClassId, otherTeacherId);

    const otherDraft = await createDraft(createAccessToken(otherTeacherUserId), otherOrgId, otherClassId, otherSubjectId);
    await publish(createAccessToken(otherTeacherUserId), otherOrgId, otherDraft.id);

    const res = await request(app)
      .post(`/api/assignments/${otherDraft.id}/open`)
      .set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(404);
  });

  it("preserves academic context and content when opening and closing", async () => {
    const f = await fixture();
    const structureId = await createOrgScopedStructure(f.organizationId, f.classId, "chapter");
    const nodeId = await createChapterNode(structureId, "Chapter 1");

    const createdRes = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: f.classId, subject_id: f.subjectId, curriculum_node_id: nodeId, title: "Lifecycle homework", description: "Preserve me." });
    expect(createdRes.status).toBe(201);
    created.assignments.push(createdRes.body.assignment.id);

    await publish(f.teacherToken, f.organizationId, createdRes.body.assignment.id);
    await request(app).post(`/api/assignments/${createdRes.body.assignment.id}/open`).set(auth(f.teacherToken, f.organizationId));

    const db = await pool.query("SELECT * FROM assignments WHERE id = $1", [createdRes.body.assignment.id]);
    expect(db.rows[0].organization_id).toBe(f.organizationId);
    expect(db.rows[0].teacher_id).toBe(f.teacherId);
    expect(db.rows[0].class_id).toBe(f.classId);
    expect(db.rows[0].subject_id).toBe(f.subjectId);
    expect(db.rows[0].curriculum_node_id).toBe(nodeId);
    expect(db.rows[0].title).toBe("Lifecycle homework");
    expect(db.rows[0].description).toBe("Preserve me.");
    expect(db.rows[0].status).toBe("OPEN");
  });

  it("ignores client-supplied status, organization_id and teacher_id in the open body", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await publish(f.teacherToken, f.organizationId, draft.id);

    const res = await request(app)
      .post(`/api/assignments/${draft.id}/open`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ status: "CLOSED", organization_id: "00000000-0000-4000-8000-000000000000", teacher_id: "00000000-0000-4000-8000-000000000000" });

    expect(res.status).toBe(200);
    expect(res.body.assignment.status).toBe("OPEN");
    expect(res.body.assignment.organization_id).toBe(f.organizationId);
    expect(res.body.assignment.teacher_id).toBe(f.teacherId);
  });
});
