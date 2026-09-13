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
  classes: [] as string[],
  subjects: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
  structures: [] as string[],
  nodes: [] as string[],
};

async function cleanup() {
  if (created.nodes.length) await pool.query("DELETE FROM curriculum_nodes WHERE id = ANY($1::uuid[])", [created.nodes]);
  if (created.structures.length) await pool.query("DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])", [created.structures]);
  if (created.syllabusVersions.length) await pool.query("DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])", [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
  if (created.classes.length) {
    await pool.query("DELETE FROM student_enrollments WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  }
  if (created.subjects.length) await pool.query("DELETE FROM subjects WHERE id = ANY($1::uuid[])", [created.subjects]);
  if (created.organizations.length) {
    await pool.query("DELETE FROM teachers WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM students_v2 WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
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
    [`${unique(`p080_${label}`)}@example.com`, `Phase 080 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 080 ${label}`, unique(`p080_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 080 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function enrollStudent(organizationId: string, classId: string, userId: string) {
  const student = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, status) VALUES ($1, $2, 'Student', 'ACTIVE') RETURNING id`,
    [userId, organizationId]
  );
  await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status) VALUES ($1, $2, $3, 'ACTIVE')`,
    [organizationId, student.rows[0].id, classId]
  );
}

async function createSubjectForClass(organizationId: string, classId: string, label: string) {
  const subject = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 080 subject ${label}`, unique(`p080subj_${label}`)]
  );
  created.subjects.push(subject.rows[0].id);
  await pool.query(
    `INSERT INTO class_subjects (organization_id, class_id, subject_id) VALUES ($1, $2, $3)`,
    [organizationId, classId, subject.rows[0].id]
  );
  return subject.rows[0].id as string;
}

async function createOrgScopedStructure(organizationId: string, classId: string, label: string, subjectId: string | null = null) {
  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const syllabus = await pool.query(
    `INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [classId, board.id, medium.id, `Phase 080 syllabus ${label}`, unique(`p080s_${label}`)]
  );
  created.syllabi.push(syllabus.rows[0].id);
  const version = await pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`,
    [syllabus.rows[0].id]
  );
  created.syllabusVersions.push(version.rows[0].id);
  const structure = await pool.query(
    `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`,
    [version.rows[0].id, `Phase 080 structure ${label}`, subjectId]
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

async function fixture() {
  const adminId = await createUser("admin");
  const studentId = await createUser("student");
  const organizationId = await createOrganization(adminId, "org");
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  await addMember(studentId, organizationId, "STUDENT");

  const classId = await createClass(organizationId, adminId, "a");
  await enrollStudent(organizationId, classId, studentId);

  const subjectId = await createSubjectForClass(organizationId, classId, "math");
  const structureId = await createOrgScopedStructure(organizationId, classId, "a", subjectId);
  const chapterId = await createChapterNode(structureId, "Chapter 1: Number Systems");

  return {
    organizationId,
    adminId,
    classId,
    subjectId,
    structureId,
    chapterId,
    studentToken: createAccessToken(studentId),
  };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

function getDashboard(token: string, organizationId: string) {
  return request(app).get("/api/student/dashboard").set(auth(token, organizationId));
}

function getChapters(token: string, organizationId: string, structureId: string) {
  return request(app).get(`/api/curriculum/structures/${structureId}/chapters`).set(auth(token, organizationId));
}

describe("US-080 view chapters", () => {
  it("exposes the student's class curriculum structures in the dashboard", async () => {
    const f = await fixture();

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    expect(res.body.curriculum_structures).toHaveLength(1);
    expect(res.body.curriculum_structures[0].id).toBe(f.structureId);
    expect(res.body.curriculum_structures[0].class_id).toBe(f.classId);
    expect(res.body.curriculum_structures[0].subject_id).toBe(f.subjectId);
  });

  it("returns chapters for the student's authorized structure", async () => {
    const f = await fixture();

    const res = await getChapters(f.studentToken, f.organizationId, f.structureId);
    expect(res.status).toBe(200);
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.chapters[0].id).toBe(f.chapterId);
    expect(res.body.chapters[0].title).toBe("Chapter 1: Number Systems");
  });

  it("prevents access to another class's chapters", async () => {
    const f = await fixture();

    const class2Id = await createClass(f.organizationId, f.adminId, "b");
    const subject2Id = await createSubjectForClass(f.organizationId, class2Id, "science");
    const structure2Id = await createOrgScopedStructure(f.organizationId, class2Id, "b", subject2Id);
    await createChapterNode(structure2Id, "Other class chapter");

    const res = await getChapters(f.studentToken, f.organizationId, structure2Id);
    expect(res.status).toBe(403);
  });

  it("prevents cross-tenant access to chapters", async () => {
    const f = await fixture();

    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    await addMember(otherAdminId, otherOrgId, "SCHOOL_ADMIN");
    const otherClassId = await createClass(otherOrgId, otherAdminId, "x");
    const otherSubjectId = await createSubjectForClass(otherOrgId, otherClassId, "geo");
    const otherStructureId = await createOrgScopedStructure(otherOrgId, otherClassId, "x", otherSubjectId);
    await createChapterNode(otherStructureId, "Other org chapter");

    const res = await getChapters(f.studentToken, f.organizationId, otherStructureId);
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/curriculum/structures/00000000-0000-4000-8000-000000000000/chapters");
    expect(res.status).toBe(401);
  });

  it("does not trust client-supplied identity fields", async () => {
    const f = await fixture();

    const dash = await request(app)
      .get("/api/student/dashboard")
      .set(auth(f.studentToken, f.organizationId))
      .query({ student_id: "00000000-0000-4000-8000-000000000001", organization_id: "00000000-0000-4000-8000-000000000000" });

    expect(dash.status).toBe(200);
    expect(dash.body.curriculum_structures[0].id).toBe(f.structureId);
    expect(dash.body.curriculum_structures[0].class_id).toBe(f.classId);

    const chapters = await getChapters(f.studentToken, f.organizationId, f.structureId);
    expect(chapters.status).toBe(200);
    expect(chapters.body.chapters[0].id).toBe(f.chapterId);
  });

  it("handles an empty chapter list", async () => {
    const f = await fixture();

    const emptyStructureId = await createOrgScopedStructure(f.organizationId, f.classId, "empty", f.subjectId);

    const res = await getChapters(f.studentToken, f.organizationId, emptyStructureId);
    expect(res.status).toBe(200);
    expect(res.body.chapters).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("does not introduce a student-specific chapter endpoint", async () => {
    const f = await fixture();

    const res = await request(app).get("/api/student/chapters").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(404);
  });
});

