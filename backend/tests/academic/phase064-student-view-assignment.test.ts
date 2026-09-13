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
  students: [] as string[],
  enrollments: [] as string[],
  assignments: [] as string[],
};

async function cleanup() {
  if (created.assignments.length) await pool.query("DELETE FROM assignments WHERE id = ANY($1::uuid[])", [created.assignments]);
  if (created.enrollments.length) await pool.query("DELETE FROM student_enrollments WHERE id = ANY($1::uuid[])", [created.enrollments]);
  if (created.students.length) await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
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
    [`${unique(`p064_${label}`)}@example.com`, `Phase 064 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 064 ${label}`, unique(`p064_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 064 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createSubject(organizationId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 064 subject ${label}`, unique(`p064subj_${label}`)]
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

async function createStudent(organizationId: string, userId: string, classId: string) {
  const student = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, status)
     VALUES ($1, $2, 'Phase 064 Student', 'ACTIVE') RETURNING id`,
    [userId, organizationId]
  );
  created.students.push(student.rows[0].id);
  const enrollment = await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, student.rows[0].id, classId]
  );
  created.enrollments.push(enrollment.rows[0].id);
  return student.rows[0].id as string;
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

// Builds an org with a class, subject, an authorized teacher, and an enrolled student.
async function fixture() {
  const adminId = await createUser("admin");
  const teacherUserId = await createUser("teacher");
  const studentUserId = await createUser("student");
  const organizationId = await createOrganization(adminId, "org");
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  await addMember(teacherUserId, organizationId, "TEACHER");
  await addMember(studentUserId, organizationId, "STUDENT");

  const classId = await createClass(organizationId, adminId, "class");
  const subjectId = await createSubject(organizationId, "subject");
  await mapSubjectToClass(organizationId, classId, subjectId);

  const teacherId = await createTeacher(organizationId, teacherUserId);
  await assignClassTeacher(organizationId, classId, teacherId);

  const studentId = await createStudent(organizationId, studentUserId, classId);

  return {
    organizationId,
    classId,
    subjectId,
    teacherId,
    studentId,
    teacherToken: createAccessToken(teacherUserId),
    studentToken: createAccessToken(studentUserId),
    adminToken: createAccessToken(adminId),
  };
}

async function createDraft(token: string, organizationId: string, classId: string, subjectId: string, title = "Draft homework") {
  const res = await request(app)
    .post("/api/assignments")
    .set(auth(token, organizationId))
    .send({ class_id: classId, subject_id: subjectId, title, description: "description" });
  expect(res.status).toBe(201);
  created.assignments.push(res.body.assignment.id);
  return res.body.assignment;
}

async function publish(token: string, organizationId: string, assignmentId: string) {
  const res = await request(app).post(`/api/assignments/${assignmentId}/publish`).set(auth(token, organizationId));
  expect(res.status).toBe(200);
  return res.body.assignment;
}

async function open(token: string, organizationId: string, assignmentId: string) {
  const res = await request(app).post(`/api/assignments/${assignmentId}/open`).set(auth(token, organizationId));
  expect(res.status).toBe(200);
  return res.body.assignment;
}

async function close(token: string, organizationId: string, assignmentId: string) {
  const res = await request(app).post(`/api/assignments/${assignmentId}/close`).set(auth(token, organizationId));
  expect(res.status).toBe(200);
  return res.body.assignment;
}

describe("US-064 student views assignment", () => {
  it("allows an enrolled student to view an OPEN assignment for their class", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Algebra Exercise 1");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const res = await request(app).get(`/api/student/assignments/${draft.id}`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.assignment.id).toBe(draft.id);
    expect(res.body.assignment.class_id).toBe(f.classId);
    expect(res.body.assignment.subject_id).toBe(f.subjectId);
    expect(res.body.assignment.title).toBe("Algebra Exercise 1");
    expect(res.body.assignment.status).toBe("OPEN");
    expect(res.body.assignment.organization_id).toBeUndefined();
    expect(res.body.assignment.teacher_id).toBeUndefined();
  });

  it("lists only OPEN assignments for the student's enrolled class", async () => {
    const f = await fixture();
    const a = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "One");
    const b = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Two");
    await publish(f.teacherToken, f.organizationId, a.id);
    await open(f.teacherToken, f.organizationId, a.id);
    await publish(f.teacherToken, f.organizationId, b.id);
    await open(f.teacherToken, f.organizationId, b.id);

    const res = await request(app).get("/api/student/assignments").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.assignments.every((x: { status: string }) => x.status === "OPEN")).toBe(true);
    expect(res.body.assignments.map((x: { title: string }) => x.title).sort()).toEqual(["One", "Two"]);
  });

  it("does not expose a DRAFT assignment to a student", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Draft secret");

    const detail = await request(app).get(`/api/student/assignments/${draft.id}`).set(auth(f.studentToken, f.organizationId));
    expect(detail.status).toBe(404);

    const list = await request(app).get("/api/student/assignments").set(auth(f.studentToken, f.organizationId));
    expect(list.body.assignments).toHaveLength(0);
  });

  it("does not expose a PUBLISHED (not open) assignment to a student", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Published only");
    await publish(f.teacherToken, f.organizationId, draft.id);

    const detail = await request(app).get(`/api/student/assignments/${draft.id}`).set(auth(f.studentToken, f.organizationId));
    expect(detail.status).toBe(404);
  });

  it("does not expose a CLOSED assignment to a student", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Closed");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);
    await close(f.teacherToken, f.organizationId, draft.id);

    const detail = await request(app).get(`/api/student/assignments/${draft.id}`).set(auth(f.studentToken, f.organizationId));
    expect(detail.status).toBe(404);
  });

  it("does not expose an assignment from a class the student is not enrolled in", async () => {
    const f = await fixture();
    const adminId = await createUser("admin-2");
    await addMember(adminId, f.organizationId, "SCHOOL_ADMIN");
    const otherClassId = await createClass(f.organizationId, adminId, "other-class");
    const otherSubjectId = await createSubject(f.organizationId, "other-subject");
    await mapSubjectToClass(f.organizationId, otherClassId, otherSubjectId);
    await assignClassTeacher(f.organizationId, otherClassId, f.teacherId);

    const draft = await createDraft(f.teacherToken, f.organizationId, otherClassId, otherSubjectId, "Other class");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const detail = await request(app).get(`/api/student/assignments/${draft.id}`).set(auth(f.studentToken, f.organizationId));
    expect(detail.status).toBe(404);

    const list = await request(app).get("/api/student/assignments").set(auth(f.studentToken, f.organizationId));
    expect(list.body.assignments).toHaveLength(0);
  });

  it("rejects viewing an assignment from another organization", async () => {
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

    const otherDraft = await createDraft(createAccessToken(otherTeacherUserId), otherOrgId, otherClassId, otherSubjectId, "Other org");
    await publish(createAccessToken(otherTeacherUserId), otherOrgId, otherDraft.id);
    await open(createAccessToken(otherTeacherUserId), otherOrgId, otherDraft.id);

    const res = await request(app).get(`/api/student/assignments/${otherDraft.id}`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(404);
  });

  it("rejects a non-student role", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Teacher view");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const res = await request(app).get(`/api/student/assignments/${draft.id}`).set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const list = await request(app).get("/api/student/assignments");
    const detail = await request(app).get("/api/student/assignments/00000000-0000-4000-8000-000000000000");
    expect(list.status).toBe(401);
    expect(detail.status).toBe(401);
  });

  it("rejects a STUDENT-role user without a student profile", async () => {
    const f = await fixture();
    const noProfileUserId = await createUser("no-profile");
    await addMember(noProfileUserId, f.organizationId, "STUDENT");

    const res = await request(app).get("/api/student/assignments").set(auth(createAccessToken(noProfileUserId), f.organizationId));
    expect(res.status).toBe(403);
  });

  it("does not modify assignment state when viewed by a student", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Read only");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const res = await request(app).get(`/api/student/assignments/${draft.id}`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);

    const db = await pool.query("SELECT * FROM assignments WHERE id = $1", [draft.id]);
    expect(db.rows[0].status).toBe("OPEN");
    expect(db.rows[0].title).toBe("Read only");
    expect(db.rows[0].description).toBe("description");
    expect(db.rows[0].organization_id).toBe(f.organizationId);
    expect(db.rows[0].class_id).toBe(f.classId);
    expect(db.rows[0].subject_id).toBe(f.subjectId);
  });
});
