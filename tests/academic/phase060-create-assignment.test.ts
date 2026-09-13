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
    [`${unique(`p060_${label}`)}@example.com`, `Phase 060 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 060 ${label}`, unique(`p060_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 060 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createSubject(organizationId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 060 subject ${label}`, unique(`p060subj_${label}`)]
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
    [classId, board.id, medium.id, `Phase 060 syllabus ${label}`, unique(`p060s_${label}`)]
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
    [version.rows[0].id, `Phase 060 structure ${label}`]
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

// Builds an org with a class, subject, and an authorized class teacher.
async function teacherFixture() {
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

describe("US-060 create homework / assignment", () => {
  it("allows an authorized class teacher to create an assignment and persists it", async () => {
    const f = await teacherFixture();

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: f.classId, subject_id: f.subjectId, title: "Chapter 1 homework", description: "Solve all exercises." });

    expect(res.status).toBe(201);
    expect(res.body.assignment).toBeDefined();
    expect(res.body.assignment.organization_id).toBe(f.organizationId);
    expect(res.body.assignment.teacher_id).toBe(f.teacherId);
    expect(res.body.assignment.class_id).toBe(f.classId);
    expect(res.body.assignment.subject_id).toBe(f.subjectId);
    expect(res.body.assignment.title).toBe("Chapter 1 homework");
    expect(res.body.assignment.description).toBe("Solve all exercises.");
    expect(res.body.assignment.status).toBe("DRAFT");

    created.assignments.push(res.body.assignment.id);

    const db = await pool.query("SELECT * FROM assignments WHERE id = $1", [res.body.assignment.id]);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].teacher_id).toBe(f.teacherId);
    expect(db.rows[0].status).toBe("DRAFT");
    expect(db.rows[0].title).toBe("Chapter 1 homework");
  });

  it("allows a subject teacher (not the class teacher) to create an assignment for their subject", async () => {
    const adminId = await createUser("admin");
    const subjectTeacherUserId = await createUser("subject-teacher");
    const organizationId = await createOrganization(adminId, "subject-org");
    await addMember(adminId, organizationId, "SCHOOL_ADMIN");
    await addMember(subjectTeacherUserId, organizationId, "TEACHER");

    const classId = await createClass(organizationId, adminId, "class");
    const subjectId = await createSubject(organizationId, "subject");
    await mapSubjectToClass(organizationId, classId, subjectId);

    const teacherId = await createTeacher(organizationId, subjectTeacherUserId);
    await assignSubjectTeacher(organizationId, classId, subjectId, teacherId);

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(createAccessToken(subjectTeacherUserId), organizationId))
      .send({ class_id: classId, subject_id: subjectId, title: "Subject homework" });

    expect(res.status).toBe(201);
    expect(res.body.assignment.teacher_id).toBe(teacherId);
    created.assignments.push(res.body.assignment.id);
  });

  it("persists an optional curriculum chapter reference and returns it", async () => {
    const f = await teacherFixture();
    const structureId = await createOrgScopedStructure(f.organizationId, f.classId, "chapter");
    const nodeId = await createChapterNode(structureId, "Chapter 1");

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: f.classId, subject_id: f.subjectId, curriculum_node_id: nodeId, title: "Chapter homework" });

    expect(res.status).toBe(201);
    expect(res.body.assignment.curriculum_node_id).toBe(nodeId);
    created.assignments.push(res.body.assignment.id);

    const db = await pool.query("SELECT curriculum_node_id FROM assignments WHERE id = $1", [res.body.assignment.id]);
    expect(db.rows[0].curriculum_node_id).toBe(nodeId);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/assignments").send({ class_id: "x", subject_id: "y", title: "t" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-teacher role", async () => {
    const f = await teacherFixture();
    const studentUserId = await createUser("student");
    await addMember(studentUserId, f.organizationId, "STUDENT");

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(createAccessToken(studentUserId), f.organizationId))
      .send({ class_id: f.classId, subject_id: f.subjectId, title: "t" });
    expect(res.status).toBe(403);
  });

  it("rejects a teacher who is not assigned to the class or subject", async () => {
    const f = await teacherFixture();
    const outsiderTeacherUserId = await createUser("outsider-teacher");
    await addMember(outsiderTeacherUserId, f.organizationId, "TEACHER");
    await createTeacher(f.organizationId, outsiderTeacherUserId);

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(createAccessToken(outsiderTeacherUserId), f.organizationId))
      .send({ class_id: f.classId, subject_id: f.subjectId, title: "t" });
    expect(res.status).toBe(403);
  });

  it("rejects a class that belongs to another organization", async () => {
    const f = await teacherFixture();
    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    const otherClassId = await createClass(otherOrgId, otherAdminId, "other-class");

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: otherClassId, subject_id: f.subjectId, title: "t" });
    expect(res.status).toBe(404);
  });

  it("rejects a subject from another organization", async () => {
    const f = await teacherFixture();
    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    const otherSubjectId = await createSubject(otherOrgId, "other-subject");

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: f.classId, subject_id: otherSubjectId, title: "t" });
    expect(res.status).toBe(400);
  });

  it("rejects a curriculum node from another organization", async () => {
    const f = await teacherFixture();
    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    const otherClassId = await createClass(otherOrgId, otherAdminId, "other-class");
    const otherStructureId = await createOrgScopedStructure(otherOrgId, otherClassId, "other-structure");
    const otherNodeId = await createChapterNode(otherStructureId, "Other chapter");

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: f.classId, subject_id: f.subjectId, curriculum_node_id: otherNodeId, title: "t" });
    expect(res.status).toBe(403);
  });

  it("rejects missing required fields", async () => {
    const f = await teacherFixture();
    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ subject_id: f.subjectId, title: "t" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid class id", async () => {
    const f = await teacherFixture();
    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: "not-a-uuid", subject_id: f.subjectId, title: "t" });
    expect(res.status).toBe(400);
  });

  it("rejects a subject that is not assigned to the class", async () => {
    const f = await teacherFixture();
    const unassignedSubjectId = await createSubject(f.organizationId, "unassigned");

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: f.classId, subject_id: unassignedSubjectId, title: "t" });
    expect(res.status).toBe(400);
  });

  it("ignores a client-supplied organization_id and scopes to the authenticated tenant", async () => {
    const f = await teacherFixture();
    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ organization_id: otherOrgId, class_id: f.classId, subject_id: f.subjectId, title: "tenant-safe" });

    expect(res.status).toBe(201);
    expect(res.body.assignment.organization_id).toBe(f.organizationId);
    created.assignments.push(res.body.assignment.id);

    const db = await pool.query("SELECT organization_id FROM assignments WHERE id = $1", [res.body.assignment.id]);
    expect(db.rows[0].organization_id).toBe(f.organizationId);
  });
});

