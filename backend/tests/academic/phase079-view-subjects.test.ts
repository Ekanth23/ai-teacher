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
  students: [] as string[],
  enrollments: [] as string[],
};

async function cleanup() {
  if (created.enrollments.length) await pool.query("DELETE FROM student_enrollments WHERE id = ANY($1::uuid[])", [created.enrollments]);
  if (created.students.length) await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
  if (created.classes.length) {
    await pool.query("DELETE FROM class_subject_teachers WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  }
  if (created.subjects.length) {
    await pool.query("DELETE FROM class_subjects WHERE subject_id = ANY($1::uuid[])", [created.subjects]);
    await pool.query("DELETE FROM subjects WHERE id = ANY($1::uuid[])", [created.subjects]);
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
    [`${unique(`p079_${label}`)}@example.com`, `Phase 079 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 079 ${label}`, unique(`p079_org_${label}`), ownerUserId]
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

async function createClass(organizationId: string, ownerUserId: string, label: string, section: string | null = null) {
  const result = await pool.query(
    `INSERT INTO classes (organization_id, name, section, created_by_user_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [organizationId, `Phase 079 class ${label}`, section, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createSubject(organizationId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 079 subject ${label}`, unique(`p079subj_${label}`)]
  );
  created.subjects.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function mapSubjectToClass(organizationId: string, classId: string, subjectId: string) {
  await pool.query(
    `INSERT INTO class_subjects (organization_id, class_id, subject_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [organizationId, classId, subjectId]
  );
}

async function createStudent(organizationId: string, userId: string, classId: string, fullName = "Phase 079 Student") {
  const student = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [userId, organizationId, fullName]
  );
  created.students.push(student.rows[0].id);
  await enroll(organizationId, student.rows[0].id, classId);
  return student.rows[0].id as string;
}

async function enroll(organizationId: string, studentId: string, classId: string) {
  const enrollment = await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, studentId, classId]
  );
  created.enrollments.push(enrollment.rows[0].id);
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function fixture() {
  const adminId = await createUser("admin");
  const teacherUserId = await createUser("teacher");
  const studentUserId = await createUser("student");
  const organizationId = await createOrganization(adminId, "org");
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  await addMember(teacherUserId, organizationId, "TEACHER");
  await addMember(studentUserId, organizationId, "STUDENT");

  const classId = await createClass(organizationId, adminId, "class-a", "A");
  const subjectId = await createSubject(organizationId, "math");
  await mapSubjectToClass(organizationId, classId, subjectId);

  const studentId = await createStudent(organizationId, studentUserId, classId, "Alice Student");

  return {
    organizationId,
    adminId,
    classId,
    subjectId,
    studentId,
    studentUserId,
    studentToken: createAccessToken(studentUserId),
    teacherToken: createAccessToken(teacherUserId),
  };
}

function getSubjects(token: string, organizationId: string, classId: string) {
  return request(app).get(`/api/student/classes/${classId}/subjects`).set(auth(token, organizationId));
}

describe("US-079 view subjects", () => {
  it("returns subjects for the student's authorized class", async () => {
    const f = await fixture();

    const res = await getSubjects(f.studentToken, f.organizationId, f.classId);
    expect(res.status).toBe(200);
    expect(res.body.subjects).toHaveLength(1);
    expect(res.body.subjects[0].id).toBe(f.subjectId);
    expect(res.body.subjects[0].name).toBe("Phase 079 subject math");
    expect(res.body.total).toBe(1);
  });

  it("exposes only id, name, and code on each subject", async () => {
    const f = await fixture();

    const res = await getSubjects(f.studentToken, f.organizationId, f.classId);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.subjects[0]).sort()).toEqual(["code", "id", "name"]);
    expect(res.body.subjects[0].organization_id).toBeUndefined();
  });

  it("prevents a student from reading another class's subjects", async () => {
    const f = await fixture();

    const student2UserId = await createUser("student-2");
    await addMember(student2UserId, f.organizationId, "STUDENT");
    const class2Id = await createClass(f.organizationId, f.adminId, "class-b", "B");
    const subject2Id = await createSubject(f.organizationId, "science");
    await mapSubjectToClass(f.organizationId, class2Id, subject2Id);
    await createStudent(f.organizationId, student2UserId, class2Id, "Bob Student");

    const res = await getSubjects(f.studentToken, f.organizationId, class2Id);
    expect(res.status).toBe(403);
  });

  it("prevents cross-tenant access", async () => {
    const f = await fixture();

    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    await addMember(otherAdminId, otherOrgId, "SCHOOL_ADMIN");
    const otherClassId = await createClass(otherOrgId, otherAdminId, "other-class");

    const res = await getSubjects(f.studentToken, f.organizationId, otherClassId);
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/student/classes/00000000-0000-4000-8000-000000000000/subjects");
    expect(res.status).toBe(401);
  });

  it("rejects non-student roles", async () => {
    const f = await fixture();

    const res = await getSubjects(f.teacherToken, f.organizationId, f.classId);
    expect(res.status).toBe(403);
  });

  it("does not trust a client-supplied student_id", async () => {
    const f = await fixture();

    const student2UserId = await createUser("student-2");
    await addMember(student2UserId, f.organizationId, "STUDENT");
    const class2Id = await createClass(f.organizationId, f.adminId, "class-b", "B");
    const subject2Id = await createSubject(f.organizationId, "science");
    await mapSubjectToClass(f.organizationId, class2Id, subject2Id);
    const student2Id = await createStudent(f.organizationId, student2UserId, class2Id, "Bob Student");

    const res = await request(app)
      .get(`/api/student/classes/${f.classId}/subjects`)
      .set(auth(f.studentToken, f.organizationId))
      .query({ student_id: student2Id });

    expect(res.status).toBe(200);
    expect(res.body.subjects).toHaveLength(1);
    expect(res.body.subjects[0].id).toBe(f.subjectId);
  });

  it("does not trust a client-supplied organization_id", async () => {
    const f = await fixture();

    const res = await request(app)
      .get(`/api/student/classes/${f.classId}/subjects`)
      .set(auth(f.studentToken, f.organizationId))
      .query({ organization_id: "00000000-0000-4000-8000-000000000000" });

    expect(res.status).toBe(200);
    expect(res.body.subjects).toHaveLength(1);
    expect(res.body.subjects[0].id).toBe(f.subjectId);
  });

  it("handles an empty subject list", async () => {
    const f = await fixture();

    const emptyClassId = await createClass(f.organizationId, f.adminId, "class-empty", "E");
    await enroll(f.organizationId, f.studentId, emptyClassId);

    const res = await getSubjects(f.studentToken, f.organizationId, emptyClassId);
    expect(res.status).toBe(200);
    expect(res.body.subjects).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
