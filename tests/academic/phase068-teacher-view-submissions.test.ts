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
  submissions: [] as string[],
};

async function cleanup() {
  if (created.submissions.length) await pool.query("DELETE FROM submissions WHERE id = ANY($1::uuid[])", [created.submissions]);
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
    [`${unique(`p068_${label}`)}@example.com`, `Phase 068 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 068 ${label}`, unique(`p068_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 068 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createSubject(organizationId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 068 subject ${label}`, unique(`p068subj_${label}`)]
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

async function createStudent(organizationId: string, userId: string, classId: string, fullName = "Phase 068 Student") {
  const student = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [userId, organizationId, fullName]
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

// Builds an org with a class, subject, an authorized class teacher, and an enrolled student.
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

  const studentId = await createStudent(organizationId, studentUserId, classId, "Alice Student");

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

async function createDraft(token: string, organizationId: string, classId: string, subjectId: string, title = "Homework") {
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

async function submit(token: string, organizationId: string, assignmentId: string, content: string) {
  return request(app)
    .post(`/api/student/assignments/${assignmentId}/submissions`)
    .set(auth(token, organizationId))
    .send({ content });
}

function listSubmissions(token: string, organizationId: string, assignmentId: string) {
  return request(app).get(`/api/assignments/${assignmentId}/submissions`).set(auth(token, organizationId));
}

describe("US-068 teacher views student submissions", () => {
  it("allows a class teacher to view submissions with correct student identity", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Algebra");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const sub = await submit(f.studentToken, f.organizationId, draft.id, "Answer: x = 5");
    expect(sub.status).toBe(201);
    created.submissions.push(sub.body.submission.id);

    const res = await listSubmissions(f.teacherToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.submissions).toHaveLength(1);
    expect(res.body.submissions[0].assignment_id).toBe(draft.id);
    expect(res.body.submissions[0].student_id).toBe(f.studentId);
    expect(res.body.submissions[0].student_name).toBe("Alice Student");
    expect(res.body.submissions[0].content).toBe("Answer: x = 5");
    expect(res.body.submissions[0].submitted_at).toBeTruthy();
    expect(res.body.submissions[0].organization_id).toBeUndefined();
  });

  it("allows a subject teacher to view submissions", async () => {
    const f = await fixture();
    const subjectTeacherUserId = await createUser("subject-teacher");
    await addMember(subjectTeacherUserId, f.organizationId, "TEACHER");
    const subjectTeacherId = await createTeacher(f.organizationId, subjectTeacherUserId);
    await assignSubjectTeacher(f.organizationId, f.classId, f.subjectId, subjectTeacherId);

    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Subject view");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const sub = await submit(f.studentToken, f.organizationId, draft.id, "work");
    expect(sub.status).toBe(201);
    created.submissions.push(sub.body.submission.id);

    const res = await listSubmissions(createAccessToken(subjectTeacherUserId), f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("returns multiple submissions for an assignment", async () => {
    const f = await fixture();
    const student2UserId = await createUser("student-2");
    await addMember(student2UserId, f.organizationId, "STUDENT");
    await createStudent(f.organizationId, student2UserId, f.classId, "Bob Student");

    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Multiple");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const s1 = await submit(f.studentToken, f.organizationId, draft.id, "A's work");
    const s2 = await submit(createAccessToken(student2UserId), f.organizationId, draft.id, "B's work");
    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);
    created.submissions.push(s1.body.submission.id, s2.body.submission.id);

    const res = await listSubmissions(f.teacherToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const names = res.body.submissions.map((x: { student_name: string }) => x.student_name).sort();
    expect(names).toEqual(["Alice Student", "Bob Student"]);
  });

  it("returns an empty collection when no student has submitted", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Empty");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const res = await listSubmissions(f.teacherToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.submissions).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/assignments/00000000-0000-4000-8000-000000000000/submissions");
    expect(res.status).toBe(401);
  });

  it("rejects a student role", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Student tries");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const res = await listSubmissions(f.studentToken, f.organizationId, draft.id);
    expect(res.status).toBe(403);
  });

  it("rejects a TEACHER-role user without a teacher profile", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "No profile");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const noProfileUserId = await createUser("no-profile-teacher");
    await addMember(noProfileUserId, f.organizationId, "TEACHER");

    const res = await listSubmissions(createAccessToken(noProfileUserId), f.organizationId, draft.id);
    expect(res.status).toBe(403);
  });

  it("rejects a teacher not authorized for the assignment's class and subject", async () => {
    const f = await fixture();
    const outsiderUserId = await createUser("outsider-teacher");
    await addMember(outsiderUserId, f.organizationId, "TEACHER");
    await createTeacher(f.organizationId, outsiderUserId);

    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Outsider");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const res = await listSubmissions(createAccessToken(outsiderUserId), f.organizationId, draft.id);
    expect(res.status).toBe(403);
  });

  it("rejects a teacher authorized for a different subject in the same class", async () => {
    const f = await fixture();
    const otherSubjectId = await createSubject(f.organizationId, "other-subject");
    await mapSubjectToClass(f.organizationId, f.classId, otherSubjectId);

    const otherTeacherUserId = await createUser("other-subject-teacher");
    await addMember(otherTeacherUserId, f.organizationId, "TEACHER");
    const otherTeacherId = await createTeacher(f.organizationId, otherTeacherUserId);
    await assignSubjectTeacher(f.organizationId, f.classId, otherSubjectId, otherTeacherId);

    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Math");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const res = await listSubmissions(createAccessToken(otherTeacherUserId), f.organizationId, draft.id);
    expect(res.status).toBe(403);
  });

  it("rejects an assignment from another organization", async () => {
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

    const res = await listSubmissions(f.teacherToken, f.organizationId, otherDraft.id);
    expect(res.status).toBe(404);
  });

  it("returns only submissions for the requested assignment", async () => {
    const f = await fixture();
    const a1 = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "One");
    const a2 = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Two");
    await publish(f.teacherToken, f.organizationId, a1.id);
    await open(f.teacherToken, f.organizationId, a1.id);
    await publish(f.teacherToken, f.organizationId, a2.id);
    await open(f.teacherToken, f.organizationId, a2.id);

    const s1 = await submit(f.studentToken, f.organizationId, a1.id, "A1 work");
    const s2 = await submit(f.studentToken, f.organizationId, a2.id, "A2 work");
    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);
    created.submissions.push(s1.body.submission.id, s2.body.submission.id);

    const res = await listSubmissions(f.teacherToken, f.organizationId, a1.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.submissions[0].assignment_id).toBe(a1.id);
    expect(res.body.submissions[0].content).toBe("A1 work");
  });

  it("allows a teacher to view submissions after the assignment is closed", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Historical");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const sub = await submit(f.studentToken, f.organizationId, draft.id, "submitted while open");
    expect(sub.status).toBe(201);
    created.submissions.push(sub.body.submission.id);

    await close(f.teacherToken, f.organizationId, draft.id);

    const res = await listSubmissions(f.teacherToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("does not modify assignment or submission state when viewed", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Read only");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const sub = await submit(f.studentToken, f.organizationId, draft.id, "keep me");
    expect(sub.status).toBe(201);
    created.submissions.push(sub.body.submission.id);

    const res = await listSubmissions(f.teacherToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);

    const a = await pool.query("SELECT status FROM assignments WHERE id = $1", [draft.id]);
    expect(a.rows[0].status).toBe("OPEN");
    const s = await pool.query("SELECT content FROM submissions WHERE assignment_id = $1", [draft.id]);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].content).toBe("keep me");
  });

  it("rejects an invalid assignment id", async () => {
    const f = await fixture();
    const res = await listSubmissions(f.teacherToken, f.organizationId, "not-a-uuid");
    expect(res.status).toBe(400);
  });
});
