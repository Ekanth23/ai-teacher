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
  assignments: [] as string[],
};

async function cleanup() {
  if (created.assignments.length) await pool.query("DELETE FROM assignments WHERE id = ANY($1::uuid[])", [created.assignments]);
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
    [`${unique(`p061_${label}`)}@example.com`, `Phase 061 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 061 ${label}`, unique(`p061_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 061 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createSubject(organizationId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 061 subject ${label}`, unique(`p061subj_${label}`)]
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

describe("US-061 save assignment as draft", () => {
  it("allows an authorized teacher to update a draft and keeps it DRAFT", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ title: "Updated homework", description: "Updated instructions." });

    expect(res.status).toBe(200);
    expect(res.body.assignment.title).toBe("Updated homework");
    expect(res.body.assignment.description).toBe("Updated instructions.");
    expect(res.body.assignment.status).toBe("DRAFT");

    const db = await pool.query("SELECT title, description, status FROM assignments WHERE id = $1", [draft.id]);
    expect(db.rows[0].title).toBe("Updated homework");
    expect(db.rows[0].description).toBe("Updated instructions.");
    expect(db.rows[0].status).toBe("DRAFT");
  });

  it("ignores a client-supplied status and keeps the assignment DRAFT", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ title: "Trying to publish", status: "PUBLISHED" });

    expect(res.status).toBe(200);
    expect(res.body.assignment.status).toBe("DRAFT");

    const db = await pool.query("SELECT status FROM assignments WHERE id = $1", [draft.id]);
    expect(db.rows[0].status).toBe("DRAFT");
  });

  it("cannot be used to close a draft", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ title: "Trying to close", status: "CLOSED" });

    expect(res.status).toBe(200);
    expect(res.body.assignment.status).toBe("DRAFT");
  });

  it("re-authenticates and revalidates when the subject is changed to another mapped subject", async () => {
    const f = await fixture();
    const secondSubjectId = await createSubject(f.organizationId, "subject-2");
    await mapSubjectToClass(f.organizationId, f.classId, secondSubjectId);
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ subject_id: secondSubjectId });

    expect(res.status).toBe(200);
    expect(res.body.assignment.subject_id).toBe(secondSubjectId);
    expect(res.body.assignment.status).toBe("DRAFT");

    const db = await pool.query("SELECT subject_id, status FROM assignments WHERE id = $1", [draft.id]);
    expect(db.rows[0].subject_id).toBe(secondSubjectId);
    expect(db.rows[0].status).toBe("DRAFT");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).patch("/api/assignments/00000000-0000-4000-8000-000000000000").send({ title: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-teacher role", async () => {
    const f = await fixture();
    const studentUserId = await createUser("student");
    await addMember(studentUserId, f.organizationId, "STUDENT");
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(createAccessToken(studentUserId), f.organizationId))
      .send({ title: "t" });
    expect(res.status).toBe(403);
  });

  it("rejects a teacher who is not authorized for the assignment's class and subject", async () => {
    const f = await fixture();
    const outsiderUserId = await createUser("outsider-teacher");
    await addMember(outsiderUserId, f.organizationId, "TEACHER");
    await createTeacher(f.organizationId, outsiderUserId);
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(createAccessToken(outsiderUserId), f.organizationId))
      .send({ title: "t" });
    expect(res.status).toBe(403);
  });

  it("rejects a teacher who is only a subject teacher for a different subject", async () => {
    const f = await fixture();
    const otherSubjectId = await createSubject(f.organizationId, "other-subject");
    await mapSubjectToClass(f.organizationId, f.classId, otherSubjectId);

    const otherTeacherUserId = await createUser("other-subject-teacher");
    await addMember(otherTeacherUserId, f.organizationId, "TEACHER");
    const otherTeacherId = await createTeacher(f.organizationId, otherTeacherUserId);
    await assignSubjectTeacher(f.organizationId, f.classId, otherSubjectId, otherTeacherId);

    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(createAccessToken(otherTeacherUserId), f.organizationId))
      .send({ title: "t" });
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

    const res = await request(app)
      .patch(`/api/assignments/${otherDraft.id}`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ title: "cross-tenant" });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid assignment id", async () => {
    const f = await fixture();
    const res = await request(app)
      .patch("/api/assignments/not-a-uuid")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ title: "t" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty title", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ title: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects changing to a subject that is not mapped to the class", async () => {
    const f = await fixture();
    const unmappedSubjectId = await createSubject(f.organizationId, "unmapped");
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ subject_id: unmappedSubjectId });
    expect(res.status).toBe(400);
  });

  it("rejects updating a non-draft assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId);
    await pool.query("UPDATE assignments SET status = 'PUBLISHED' WHERE id = $1", [draft.id]);

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ title: "t" });
    expect(res.status).toBe(400);

    const db = await pool.query("SELECT status FROM assignments WHERE id = $1", [draft.id]);
    expect(db.rows[0].status).toBe("PUBLISHED");
  });
});
