import request from "supertest";
import { describe, expect, it, afterEach } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";
import { classifyHomework } from "../../src/modules/progress/service.js";

// US-100: homework performance = completion + timeliness (ON_TIME / LATE /
// PENDING / OVERDUE). No numeric score. Query-only over Epic 7 data.

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();

const unique = (prefix: string) => `${prefix.slice(0, 20)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const created = {
  users: [] as string[],
  organizations: [] as string[],
  students: [] as string[],
  enrollments: [] as string[],
  classes: [] as string[],
  classSubjects: [] as string[],
  subjects: [] as string[],
  teachers: [] as string[],
  assignments: [] as string[],
  submissions: [] as string[],
};

async function cleanup() {
  if (created.submissions.length) await pool.query("DELETE FROM submissions WHERE id = ANY($1::uuid[])", [created.submissions]);
  if (created.assignments.length) await pool.query("DELETE FROM assignments WHERE id = ANY($1::uuid[])", [created.assignments]);
  if (created.teachers.length) await pool.query("DELETE FROM teachers WHERE id = ANY($1::uuid[])", [created.teachers]);
  if (created.classSubjects.length) await pool.query("DELETE FROM class_subjects WHERE id = ANY($1::uuid[])", [created.classSubjects]);
  if (created.subjects.length) await pool.query("DELETE FROM subjects WHERE id = ANY($1::uuid[])", [created.subjects]);
  if (created.enrollments.length) await pool.query("DELETE FROM student_enrollments WHERE id = ANY($1::uuid[])", [created.enrollments]);
  if (created.classes.length) await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  if (created.students.length) await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  Object.values(created).forEach((ids) => { ids.length = 0; });
}

afterEach(cleanup);

async function createUser(label: string) {
  const r = await pool.query(`INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`, [`${unique(`ep100_${label}`)}@example.com`, `Epic 100 ${label}`]);
  created.users.push(r.rows[0].id);
  return r.rows[0].id as string;
}

type Fixture = {
  organizationId: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  adminToken: string;
  teacherToken: string;
  studentToken: string;
  studentId: string;
};

async function buildFixture(label: string, opts: { assignTeacher?: boolean } = {}): Promise<Fixture> {
  const adminId = await createUser(`${label}-admin`);
  const orgRes = await pool.query(`INSERT INTO organizations (name, slug, type, status, created_by_user_id) VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`, [`Epic 100 ${label}`, unique(`ep100_org_${label}`), adminId]);
  created.organizations.push(orgRes.rows[0].id);
  const organizationId = orgRes.rows[0].id as string;
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  const teacherUserId = await createUser(`${label}-teacher`);
  await addMember(teacherUserId, organizationId, "TEACHER");
  const classRes = await pool.query(`INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, `Epic 100 class ${label}`, adminId]);
  created.classes.push(classRes.rows[0].id);
  const classId = classRes.rows[0].id as string;
  const teacherRes = await pool.query(`INSERT INTO teachers (organization_id, user_id) VALUES ($1, $2) RETURNING id`, [organizationId, teacherUserId]);
  created.teachers.push(teacherRes.rows[0].id);
  const teacherId = teacherRes.rows[0].id as string;
  if (opts.assignTeacher !== false) {
    await pool.query(`INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id) VALUES ($1, $2, $3)`, [organizationId, classId, teacherId]);
  }
  const subjectRes = await pool.query(`INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, `Epic 100 Subject ${label}`, unique(`ep100_s_${label}`)]);
  created.subjects.push(subjectRes.rows[0].id);
  const subjectId = subjectRes.rows[0].id as string;
  const csRes = await pool.query(`INSERT INTO class_subjects (organization_id, class_id, subject_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, classId, subjectId]);
  created.classSubjects.push(csRes.rows[0].id);
  const studentUserId = await createUser(`${label}-student`);
  await addMember(studentUserId, organizationId, "STUDENT");
  const stRes = await pool.query(`INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status) VALUES ($1, $2, $3, '8', 'ACTIVE') RETURNING id`, [studentUserId, organizationId, `${label} Student`]);
  created.students.push(stRes.rows[0].id);
  const studentId = stRes.rows[0].id as string;
  const eRes = await pool.query(`INSERT INTO student_enrollments (organization_id, student_id, class_id, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, studentId, classId]);
  created.enrollments.push(eRes.rows[0].id);
  return { organizationId, classId, subjectId, teacherId, adminToken: createAccessToken(adminId), teacherToken: createAccessToken(teacherUserId), studentToken: createAccessToken(studentUserId), studentId };
}

async function addMember(userId: string, organizationId: string, roleName: string) {
  const role = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [roleName]);
  await pool.query(`INSERT INTO organization_members (user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [userId, organizationId, role.rows[0].id]);
}

async function mkAssignment(f: Fixture, status: string, dueAt: string | null, tag: string, classId?: string) {
  const r = await pool.query(
    `INSERT INTO assignments (organization_id, teacher_id, class_id, subject_id, title, due_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [f.organizationId, f.teacherId, classId ?? f.classId, f.subjectId, `Epic 100 ${tag}`, dueAt, status]
  );
  created.assignments.push(r.rows[0].id);
  return r.rows[0].id as string;
}

async function submitAs(f: Fixture, assignmentId: string, expected = 201) {
  const res = await request(app).post(`/api/student/assignments/${assignmentId}/submissions`)
    .set({ Authorization: `Bearer ${f.studentToken}`, "x-organization-id": f.organizationId })
    .send({ content: "my homework answer" });
  expect(res.status).toBe(expected);
  if (expected === 201) created.submissions.push(res.body.submission.id);
  return res;
}

const PAST = new Date(Date.now() - 86400_000).toISOString();
const FUTURE = new Date(Date.now() + 86400_000).toISOString();

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

describe("US-100 four-state classification", () => {
  it("classifies on-time, late, pending, and overdue through the API", async () => {
    const f = await buildFixture("states");
    const onTime = await mkAssignment(f, "OPEN", FUTURE, "ontime");
    const late = await mkAssignment(f, "OPEN", PAST, "late");
    await mkAssignment(f, "OPEN", FUTURE, "pending");
    await mkAssignment(f, "OPEN", PAST, "overdue");
    await submitAs(f, onTime);
    await submitAs(f, late);

    const res = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ on_time: 1, late: 1, pending: 1, overdue: 1, total: 4 });
  });

  it("counts CLOSED assignments and preserves eligibility", async () => {
    const f = await buildFixture("closed");
    const closed = await mkAssignment(f, "CLOSED", PAST, "closed");
    await submitAs(f, closed, 404); // submissions require OPEN; direct row below simulates a pre-close submission
    await pool.query(`INSERT INTO submissions (organization_id, assignment_id, student_id, content, submitted_at) VALUES ($1, $2, $3, 'late work', $4) RETURNING id`, [f.organizationId, closed, f.studentId, new Date().toISOString()]).then((r) => created.submissions.push(r.rows[0].id));
    const res = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toMatchObject({ late: 1, total: 1 });
  });

  it("excludes DRAFT assignments and other-class assignments", async () => {
    const f = await buildFixture("excluded");
    await mkAssignment(f, "DRAFT", PAST, "draft");
    await mkAssignment(f, "PUBLISHED", PAST, "published");
    const otherClass = await pool.query(`INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`, [f.organizationId, "Other class", null]);
    created.classes.push(otherClass.rows[0].id);
    const otherCs = await pool.query(`INSERT INTO class_subjects (organization_id, class_id, subject_id) VALUES ($1, $2, $3) RETURNING id`, [f.organizationId, otherClass.rows[0].id, f.subjectId]);
    created.classSubjects.push(otherCs.rows[0].id);
    await mkAssignment(f, "OPEN", PAST, "other-class", otherClass.rows[0].id);
    const res = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toMatchObject({ on_time: 0, late: 0, pending: 0, overdue: 0, total: 0 });
  });

  it("treats NULL due_at as never overdue", async () => {
    const f = await buildFixture("nodue");
    const noDue = await mkAssignment(f, "OPEN", null, "nodue-submitted");
    await mkAssignment(f, "OPEN", null, "nodue-pending");
    await submitAs(f, noDue);
    const res = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toMatchObject({ on_time: 1, pending: 1, overdue: 0, total: 2 });
  });

  it("ignores decision and feedback when classifying", async () => {
    const f = await buildFixture("decision");
    const a = await mkAssignment(f, "OPEN", FUTURE, "reviewed");
    await submitAs(f, a);
    const subId = created.submissions[created.submissions.length - 1];
    await request(app).patch(`/api/assignments/${a}/submissions/${subId}/review`).set(auth(f.teacherToken, f.organizationId)).send({ decision: "ACCEPTED" });
    await request(app).patch(`/api/assignments/${a}/submissions/${subId}/feedback`).set(auth(f.teacherToken, f.organizationId)).send({ feedback: "Good work" });
    const res = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toMatchObject({ on_time: 1, total: 1 });
  });

  it("exposes no numeric score, percentage, or grade", async () => {
    const f = await buildFixture("shape");
    await submitAs(f, await mkAssignment(f, "OPEN", FUTURE, "shaped"));
    const res = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    for (const key of ["score", "percentage", "average", "grade", "marks", "points"]) {
      expect(res.body).not.toHaveProperty(key);
    }
    expect(Object.keys(res.body).sort()).toEqual(["late", "on_time", "overdue", "pending", "total"]);
  });

  it("classifies exact boundaries in the pure classifier", () => {
    const at = "2026-06-01T10:00:00.000Z";
    const now = new Date(at).valueOf();
    // submitted_at == due_at is ON_TIME.
    expect(classifyHomework([{ assignment_id: "a", due_at: at, submitted_at: at }], now)).toMatchObject({ on_time: 1, total: 1 });
    // No submission with due_at == now has not passed: PENDING.
    expect(classifyHomework([{ assignment_id: "a", due_at: at, submitted_at: null }], now)).toMatchObject({ pending: 1 });
    // One millisecond past due with no submission: OVERDUE.
    expect(classifyHomework([{ assignment_id: "a", due_at: at, submitted_at: null }], now + 1)).toMatchObject({ overdue: 1 });
    // Submitted with NULL due_at: ON_TIME, never late.
    expect(classifyHomework([{ assignment_id: "a", due_at: null, submitted_at: at }], now)).toMatchObject({ on_time: 1 });
  });
});

describe("US-100 authorization and tenancy", () => {
  it("rejects unauthenticated reads", async () => {
    expect((await request(app).get("/api/student/homework-performance")).status).toBe(401);
    expect((await request(app).get("/api/organizations/00000000-0000-4000-8000-000000000000/students/00000000-0000-4000-8000-000000000000/homework-performance")).status).toBe(401);
  });

  it("restricts students to their own data", async () => {
    const f = await buildFixture("selfonly");
    await submitAs(f, await mkAssignment(f, "OPEN", FUTURE, "mine"));
    // STUDENT role cannot use the staff endpoint, even for self.
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/homework-performance`).set(auth(f.studentToken, f.organizationId))).status).toBe(403);
    const self = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    expect(self.body).toMatchObject({ on_time: 1, total: 1 });
  });

  it("serves assigned teachers and organization admins", async () => {
    const f = await buildFixture("staff");
    await submitAs(f, await mkAssignment(f, "OPEN", FUTURE, "hw"));
    await mkAssignment(f, "OPEN", PAST, "overdue-hw");
    const teacher = await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/homework-performance`).set(auth(f.teacherToken, f.organizationId));
    expect(teacher.status).toBe(200);
    expect(teacher.body).toMatchObject({ on_time: 1, overdue: 1, total: 2 });
    expect(teacher.body.student.id).toBe(f.studentId);
    const admin = await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/homework-performance`).set(auth(f.adminToken, f.organizationId));
    expect(admin.status).toBe(200);
    expect(admin.body).toMatchObject({ on_time: 1, overdue: 1, total: 2 });
  });

  it("rejects unassigned teachers and isolates tenants", async () => {
    const f = await buildFixture("unassigned", { assignTeacher: false });
    await mkAssignment(f, "OPEN", PAST, "hw");
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/homework-performance`).set(auth(f.teacherToken, f.organizationId))).status).toBe(403);
    const other = await buildFixture("other-org");
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/homework-performance`).set(auth(other.adminToken, other.organizationId))).status).toBe(403);
    const self = await request(app).get("/api/student/homework-performance").set(auth(other.studentToken, other.organizationId));
    expect(self.body).toMatchObject({ total: 0 });
    expect(JSON.stringify(self.body)).not.toContain(f.organizationId);
  });

  it("handles invalid identifiers, unknown students, and empty sets", async () => {
    const f = await buildFixture("edge");
    expect((await request(app).get(`/api/organizations/nope/students/${f.studentId}/homework-performance`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/nope/homework-performance`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/00000000-0000-4000-8000-000000000000/homework-performance`).set(auth(f.adminToken, f.organizationId))).status).toBe(404);
    const empty = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    expect(empty.body).toMatchObject({ on_time: 0, late: 0, pending: 0, overdue: 0, total: 0 });
  });

  it("returns deterministic repeated results", async () => {
    const f = await buildFixture("deterministic");
    await submitAs(f, await mkAssignment(f, "OPEN", FUTURE, "hw"));
    await mkAssignment(f, "OPEN", PAST, "overdue-hw");
    const first = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    const second = await request(app).get("/api/student/homework-performance").set(auth(f.studentToken, f.organizationId));
    expect(second.body).toEqual(first.body);
  });
});
