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
    [`${unique(`p067_${label}`)}@example.com`, `Phase 067 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 067 ${label}`, unique(`p067_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 067 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createSubject(organizationId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 067 subject ${label}`, unique(`p067subj_${label}`)]
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
     VALUES ($1, $2, 'Phase 067 Student', 'ACTIVE') RETURNING id`,
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

async function submit(token: string, organizationId: string, assignmentId: string, content: string) {
  return request(app)
    .post(`/api/student/assignments/${assignmentId}/submissions`)
    .set(auth(token, organizationId))
    .send({ content });
}

function getOverdue(token: string, organizationId: string, assignmentId: string) {
  return request(app).get(`/api/student/assignments/${assignmentId}/overdue`).set(auth(token, organizationId));
}

function setPastDue(assignmentId: string) {
  return pool.query("UPDATE assignments SET due_at = now() - interval '1 hour' WHERE id = $1", [assignmentId]);
}

function setFutureDue(assignmentId: string) {
  return pool.query("UPDATE assignments SET due_at = now() + interval '1 day' WHERE id = $1", [assignmentId]);
}

describe("US-067 assignment overdue tracking", () => {
  it("reports not overdue before the deadline with no submission", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Future");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);
    await setFutureDue(draft.id);

    const res = await getOverdue(f.studentToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.overdue.overdue).toBe(false);
    expect(res.body.overdue.due_at).toBeTruthy();
  });

  it("reports overdue after the deadline with no submission", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Past");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);
    await setPastDue(draft.id);

    const res = await getOverdue(f.studentToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.overdue.overdue).toBe(true);
  });

  it("reports not overdue when there is no due date", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "No deadline");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const res = await getOverdue(f.studentToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.overdue.overdue).toBe(false);
    expect(res.body.overdue.due_at).toBeNull();
  });

  it("reports not overdue when the student has submitted before the deadline", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Submitted on time");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);
    await setFutureDue(draft.id);

    const sub = await submit(f.studentToken, f.organizationId, draft.id, "on time");
    expect(sub.status).toBe(201);
    created.submissions.push(sub.body.submission.id);

    const res = await getOverdue(f.studentToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.overdue.overdue).toBe(false);
  });

  it("reports not overdue when the student submits after the deadline (submission makes it completed)", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Late submit");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);
    await setPastDue(draft.id);

    const sub = await submit(f.studentToken, f.organizationId, draft.id, "late");
    expect(sub.status).toBe(201);
    created.submissions.push(sub.body.submission.id);

    const res = await getOverdue(f.studentToken, f.organizationId, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.overdue.overdue).toBe(false);
  });

  it("does not inherit another student's overdue state", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Shared deadline");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);
    await setPastDue(draft.id);

    const sub = await submit(f.studentToken, f.organizationId, draft.id, "done by A");
    expect(sub.status).toBe(201);
    created.submissions.push(sub.body.submission.id);

    const studentBUserId = await createUser("student-b");
    await addMember(studentBUserId, f.organizationId, "STUDENT");
    await createStudent(f.organizationId, studentBUserId, f.classId);

    const a = await getOverdue(f.studentToken, f.organizationId, draft.id);
    expect(a.body.overdue.overdue).toBe(false);

    const b = await getOverdue(createAccessToken(studentBUserId), f.organizationId, draft.id);
    expect(b.body.overdue.overdue).toBe(true);
  });

  it("scopes overdue to the specific assignment", async () => {
    const f = await fixture();
    const a1 = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "One");
    const a2 = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Two");
    await publish(f.teacherToken, f.organizationId, a1.id);
    await open(f.teacherToken, f.organizationId, a1.id);
    await publish(f.teacherToken, f.organizationId, a2.id);
    await open(f.teacherToken, f.organizationId, a2.id);
    await setPastDue(a1.id);
    await setPastDue(a2.id);

    const sub = await submit(f.studentToken, f.organizationId, a1.id, "done one");
    expect(sub.status).toBe(201);
    created.submissions.push(sub.body.submission.id);

    const one = await getOverdue(f.studentToken, f.organizationId, a1.id);
    expect(one.body.overdue.overdue).toBe(false);

    const two = await getOverdue(f.studentToken, f.organizationId, a2.id);
    expect(two.body.overdue.overdue).toBe(true);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/student/assignments/00000000-0000-4000-8000-000000000000/overdue");
    expect(res.status).toBe(401);
  });

  it("rejects a non-student role", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Teacher");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const res = await getOverdue(f.teacherToken, f.organizationId, draft.id);
    expect(res.status).toBe(403);
  });

  it("rejects a STUDENT-role user without a student profile", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "No profile");
    await publish(f.teacherToken, f.organizationId, draft.id);
    await open(f.teacherToken, f.organizationId, draft.id);

    const noProfileUserId = await createUser("no-profile");
    await addMember(noProfileUserId, f.organizationId, "STUDENT");

    const res = await getOverdue(createAccessToken(noProfileUserId), f.organizationId, draft.id);
    expect(res.status).toBe(403);
  });

  it("rejects overdue lookup for a class the student is not enrolled in", async () => {
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

    const res = await getOverdue(f.studentToken, f.organizationId, draft.id);
    expect(res.status).toBe(404);
  });

  it("rejects overdue lookup for an assignment from another organization", async () => {
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

    const res = await getOverdue(f.studentToken, f.organizationId, otherDraft.id);
    expect(res.status).toBe(404);
  });

  it("rejects an invalid assignment id", async () => {
    const f = await fixture();
    const res = await getOverdue(f.studentToken, f.organizationId, "not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("does not expose overdue for a DRAFT assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Draft");
    const res = await getOverdue(f.studentToken, f.organizationId, draft.id);
    expect(res.status).toBe(404);
  });

  it("does not expose overdue for a PUBLISHED (not open) assignment", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Published");
    await publish(f.teacherToken, f.organizationId, draft.id);
    const res = await getOverdue(f.studentToken, f.organizationId, draft.id);
    expect(res.status).toBe(404);
  });

  it("allows a teacher to set a due date when creating an assignment", async () => {
    const f = await fixture();
    const due = new Date(Date.now() + 86_400_000).toISOString();

    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: f.classId, subject_id: f.subjectId, title: "With deadline", due_at: due });
    expect(res.status).toBe(201);
    expect(res.body.assignment.due_at).toBeTruthy();
    created.assignments.push(res.body.assignment.id);

    const db = await pool.query("SELECT due_at FROM assignments WHERE id = $1", [res.body.assignment.id]);
    expect(db.rows[0].due_at).toBeTruthy();
  });

  it("allows a teacher to update a draft's due date", async () => {
    const f = await fixture();
    const draft = await createDraft(f.teacherToken, f.organizationId, f.classId, f.subjectId, "Set later");
    const due = new Date(Date.now() + 172_800_000).toISOString();

    const res = await request(app)
      .patch(`/api/assignments/${draft.id}`)
      .set(auth(f.teacherToken, f.organizationId))
      .send({ due_at: due });
    expect(res.status).toBe(200);
    expect(res.body.assignment.due_at).toBeTruthy();

    const db = await pool.query("SELECT due_at FROM assignments WHERE id = $1", [draft.id]);
    expect(db.rows[0].due_at).toBeTruthy();
  });

  it("rejects an invalid due date", async () => {
    const f = await fixture();
    const res = await request(app)
      .post("/api/assignments")
      .set(auth(f.teacherToken, f.organizationId))
      .send({ class_id: f.classId, subject_id: f.subjectId, title: "Bad due", due_at: "not-a-date" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
