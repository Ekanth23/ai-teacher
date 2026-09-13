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
    [`${unique(`p081_${label}`)}@example.com`, `Phase 081 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 081 ${label}`, unique(`p081_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 081 class ${label}`, ownerUserId]
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
    [organizationId, `Phase 081 subject ${label}`, unique(`p081subj_${label}`)]
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
    [classId, board.id, medium.id, `Phase 081 syllabus ${label}`, unique(`p081s_${label}`)]
  );
  created.syllabi.push(syllabus.rows[0].id);
  const version = await pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`,
    [syllabus.rows[0].id]
  );
  created.syllabusVersions.push(version.rows[0].id);
  const structure = await pool.query(
    `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`,
    [version.rows[0].id, `Phase 081 structure ${label}`, subjectId]
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

async function createTopicNode(chapterId: string, title: string) {
  const type = await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' LIMIT 1");
  const chapter = await pool.query("SELECT curriculum_structure_id FROM curriculum_nodes WHERE id = $1", [chapterId]);
  const node = await pool.query(
    `INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [chapter.rows[0].curriculum_structure_id, chapterId, type.rows[0].id, title]
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
  const topicId = await createTopicNode(chapterId, "Topic 1.1: Integers");

  return {
    organizationId,
    adminId,
    classId,
    subjectId,
    structureId,
    chapterId,
    topicId,
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

function getTopics(token: string, organizationId: string, chapterId: string) {
  return request(app).get(`/api/curriculum/chapters/${chapterId}/topics`).set(auth(token, organizationId));
}

describe("US-081 view topics", () => {
  it("exposes the student's curriculum structure in the dashboard", async () => {
    const f = await fixture();

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    expect(res.body.curriculum_structures).toHaveLength(1);
    expect(res.body.curriculum_structures[0].id).toBe(f.structureId);
    expect(res.body.curriculum_structures[0].class_id).toBe(f.classId);
    expect(res.body.curriculum_structures[0].subject_id).toBe(f.subjectId);
  });

  it("returns topics for an authorized chapter through the full navigation chain", async () => {
    const f = await fixture();

    const dash = await getDashboard(f.studentToken, f.organizationId);
    expect(dash.status).toBe(200);
    const structureId = dash.body.curriculum_structures[0].id;

    const chapters = await getChapters(f.studentToken, f.organizationId, structureId);
    expect(chapters.status).toBe(200);
    const chapterId = chapters.body.chapters[0].id;

    const topics = await getTopics(f.studentToken, f.organizationId, chapterId);
    expect(topics.status).toBe(200);
    expect(topics.body.topics).toHaveLength(1);
    expect(topics.body.topics[0].id).toBe(f.topicId);
    expect(topics.body.topics[0].title).toBe("Topic 1.1: Integers");
  });

  it("returns only topics belonging to the requested chapter", async () => {
    const f = await fixture();

    const chapter2Id = await createChapterNode(f.structureId, "Chapter 2: Algebra");
    const topic2Id = await createTopicNode(chapter2Id, "Topic 2.1: Equations");

    const res = await getTopics(f.studentToken, f.organizationId, f.chapterId);
    expect(res.status).toBe(200);
    const ids = res.body.topics.map((t: { id: string }) => t.id);
    expect(ids).toContain(f.topicId);
    expect(ids).not.toContain(topic2Id);
    expect(res.body.topics[0].title).toBe("Topic 1.1: Integers");
  });

  it("prevents access to another class's chapter topics", async () => {
    const f = await fixture();

    const class2Id = await createClass(f.organizationId, f.adminId, "b");
    const subject2Id = await createSubjectForClass(f.organizationId, class2Id, "science");
    const structure2Id = await createOrgScopedStructure(f.organizationId, class2Id, "b", subject2Id);
    const chapter2Id = await createChapterNode(structure2Id, "Other class chapter");
    await createTopicNode(chapter2Id, "Other class topic");

    const res = await getTopics(f.studentToken, f.organizationId, chapter2Id);
    expect(res.status).toBe(403);
  });

  it("prevents cross-tenant access to chapter topics", async () => {
    const f = await fixture();

    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    await addMember(otherAdminId, otherOrgId, "SCHOOL_ADMIN");
    const otherClassId = await createClass(otherOrgId, otherAdminId, "x");
    const otherSubjectId = await createSubjectForClass(otherOrgId, otherClassId, "geo");
    const otherStructureId = await createOrgScopedStructure(otherOrgId, otherClassId, "x", otherSubjectId);
    const otherChapterId = await createChapterNode(otherStructureId, "Other org chapter");
    await createTopicNode(otherChapterId, "Other org topic");

    const res = await getTopics(f.studentToken, f.organizationId, otherChapterId);
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/curriculum/chapters/00000000-0000-4000-8000-000000000000/topics");
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

    const topics = await getTopics(f.studentToken, f.organizationId, f.chapterId);
    expect(topics.status).toBe(200);
    expect(topics.body.topics[0].id).toBe(f.topicId);
  });

  it("handles an empty topic list", async () => {
    const f = await fixture();

    const emptyChapterId = await createChapterNode(f.structureId, "Chapter 3: Empty");

    const res = await getTopics(f.studentToken, f.organizationId, emptyChapterId);
    expect(res.status).toBe(200);
    expect(res.body.topics).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("does not introduce a student-specific topic endpoint", async () => {
    const f = await fixture();

    const res = await request(app).get("/api/student/topics").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(404);
  });
});

