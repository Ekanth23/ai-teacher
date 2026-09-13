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
  learningResources: [] as string[],
  conversations: [] as string[],
};

async function cleanup() {
  if (created.conversations.length) await pool.query("DELETE FROM ai_conversations WHERE id = ANY($1::uuid[])", [created.conversations]);
  if (created.learningResources.length) await pool.query("DELETE FROM learning_resources WHERE id = ANY($1::uuid[])", [created.learningResources]);
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
    [`${unique(`p077_${label}`)}@example.com`, `Phase 077 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 077 ${label}`, unique(`p077_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 077 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createSubject(organizationId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 077 subject ${label}`, unique(`p077subj_${label}`)]
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

async function createStudent(organizationId: string, userId: string, classId: string, fullName = "Phase 077 Student", gradeLevel: string | null = null) {
  const student = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE') RETURNING id`,
    [userId, organizationId, fullName, gradeLevel]
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

async function createLearningResource(
  organizationId: string,
  createdByUserId: string,
  opts: { title?: string; status?: string; visibility?: string; classId?: string | null } = {}
) {
  const result = await pool.query(
    `INSERT INTO learning_resources (organization_id, created_by_user_id, resource_type, title, file_url, status, visibility, class_id)
     VALUES ($1, $2, 'WORKSHEET', $3, 'https://example.com/x.pdf', $4, $5, $6)
     RETURNING id`,
    [organizationId, createdByUserId, opts.title ?? unique("resource"), opts.status ?? "DRAFT", opts.visibility ?? "ORGANIZATION", opts.classId ?? null]
  );
  created.learningResources.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createConversation(organizationId: string, studentId: string, subject: string, topic: string) {
  const result = await pool.query(
    `INSERT INTO ai_conversations (organization_id, student_id, subject, topic)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [organizationId, studentId, subject, topic]
  );
  created.conversations.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function fixture() {
  const adminId = await createUser("admin");
  const teacherUserId = await createUser("teacher");
  const studentUserId = await createUser("student");
  const organizationId = await createOrganization(adminId, "org");
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  await addMember(teacherUserId, organizationId, "TEACHER");
  await addMember(studentUserId, organizationId, "STUDENT");

  const classId = await createClass(organizationId, adminId, "class");
  const subjectId = await createSubject(organizationId, "math");
  await mapSubjectToClass(organizationId, classId, subjectId);

  const teacherId = await createTeacher(organizationId, teacherUserId);
  await assignClassTeacher(organizationId, classId, teacherId);

  const studentId = await createStudent(organizationId, studentUserId, classId, "Alice Student", "9");

  return {
    organizationId,
    adminId,
    teacherUserId,
    classId,
    subjectId,
    studentId,
    studentUserId,
    studentToken: createAccessToken(studentUserId),
    teacherToken: createAccessToken(teacherUserId),
    adminToken: createAccessToken(adminId),
  };
}

function getClasses(token: string, organizationId: string) {
  return request(app).get("/api/student/classes").set(auth(token, organizationId));
}

function getSubjects(token: string, organizationId: string, classId: string) {
  return request(app).get(`/api/student/classes/${classId}/subjects`).set(auth(token, organizationId));
}

function getDashboard(token: string, organizationId: string) {
  return request(app).get("/api/student/dashboard").set(auth(token, organizationId));
}

describe("US-077 student dashboard", () => {
  it("returns a dashboard for an authenticated student", async () => {
    const f = await fixture();

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
  });

  it("contains the authenticated student's identity", async () => {
    const f = await fixture();

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    expect(res.body.student.id).toBe(f.studentId);
    expect(res.body.student.full_name).toBe("Alice Student");
    expect(res.body.student.grade_level).toBe("9");
  });

  it("shows only the student's own active classes", async () => {
    const f = await fixture();

    const student2UserId = await createUser("student-2");
    await addMember(student2UserId, f.organizationId, "STUDENT");
    const class2Id = await createClass(f.organizationId, f.adminId, "class-b");
    await createStudent(f.organizationId, student2UserId, class2Id, "Bob Student", "8");

    const res = await getClasses(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    const ids = res.body.classes.map((c: { id: string }) => c.id);
    expect(ids).toContain(f.classId);
    expect(ids).not.toContain(class2Id);
  });

  it("returns subjects for the student's authorized class", async () => {
    const f = await fixture();

    const res = await getSubjects(f.studentToken, f.organizationId, f.classId);
    expect(res.status).toBe(200);
    expect(res.body.subjects).toHaveLength(1);
    expect(res.body.subjects[0].id).toBe(f.subjectId);
  });

  it("prevents a student from reading another student's class subjects", async () => {
    const f = await fixture();

    const student2UserId = await createUser("student-2");
    await addMember(student2UserId, f.organizationId, "STUDENT");
    const class2Id = await createClass(f.organizationId, f.adminId, "class-b");
    await createStudent(f.organizationId, student2UserId, class2Id, "Bob Student", "8");

    const res = await getSubjects(f.studentToken, f.organizationId, class2Id);
    expect(res.status).toBe(403);
  });

  it("prevents cross-tenant access", async () => {
    const f = await fixture();

    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    await addMember(otherAdminId, otherOrgId, "SCHOOL_ADMIN");
    const otherClassId = await createClass(otherOrgId, otherAdminId, "other-class");

    const subjects = await getSubjects(f.studentToken, f.organizationId, otherClassId);
    expect(subjects.status).toBe(403);

    const classes = await getClasses(f.studentToken, otherOrgId);
    expect(classes.status).toBe(403);
  });

  it("returns published and visible learning resources in a safe projection", async () => {
    const f = await fixture();
    await createLearningResource(f.organizationId, f.adminId, { title: "Visible Worksheet", status: "PUBLISHED", visibility: "ORGANIZATION" });

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    const titles = res.body.learning_resources.map((r: { title: string }) => r.title);
    expect(titles).toContain("Visible Worksheet");

    const resource = res.body.learning_resources.find((r: { title: string }) => r.title === "Visible Worksheet");
    expect(resource.organization_id).toBeUndefined();
    expect(resource.created_by_user_id).toBeUndefined();
    expect(resource.metadata).toBeUndefined();
  });

  it("excludes unpublished, private, and inaccessible learning resources", async () => {
    const f = await fixture();

    const student2UserId = await createUser("student-2");
    await addMember(student2UserId, f.organizationId, "STUDENT");
    const class2Id = await createClass(f.organizationId, f.adminId, "class-b");
    await createStudent(f.organizationId, student2UserId, class2Id, "Bob Student", "8");

    await createLearningResource(f.organizationId, f.adminId, { title: "Visible", status: "PUBLISHED", visibility: "ORGANIZATION" });
    await createLearningResource(f.organizationId, f.adminId, { title: "Draft", status: "DRAFT", visibility: "ORGANIZATION" });
    await createLearningResource(f.organizationId, f.adminId, { title: "Private", status: "PUBLISHED", visibility: "PRIVATE" });
    await createLearningResource(f.organizationId, f.adminId, { title: "Other class", status: "PUBLISHED", visibility: "CLASS", classId: class2Id });

    const res = await getDashboard(f.studentToken, f.organizationId);
    const titles = res.body.learning_resources.map((r: { title: string }) => r.title);
    expect(titles).toContain("Visible");
    expect(titles).not.toContain("Draft");
    expect(titles).not.toContain("Private");
    expect(titles).not.toContain("Other class");
  });

  it("returns only the student's own recent activity", async () => {
    const f = await fixture();

    const student2UserId = await createUser("student-2");
    await addMember(student2UserId, f.organizationId, "STUDENT");
    const class2Id = await createClass(f.organizationId, f.adminId, "class-b");
    const student2Id = await createStudent(f.organizationId, student2UserId, class2Id, "Bob Student", "8");

    await createConversation(f.organizationId, f.studentId, "Mathematics", "Algebra");
    await createConversation(f.organizationId, student2Id, "Science", "Cells");

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    const topics = res.body.recent_activity.map((a: { topic: string | null }) => a.topic);
    expect(topics).toContain("Algebra");
    expect(topics).not.toContain("Cells");
  });

  it("handles empty recent activity", async () => {
    const f = await fixture();

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    expect(res.body.recent_activity).toEqual([]);
  });

  it("reports progress as null rather than fabricating values", async () => {
    const f = await fixture();

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    expect(res.body.progress).toBeNull();
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/student/dashboard")).status).toBe(401);
    expect((await request(app).get("/api/student/classes")).status).toBe(401);
    expect((await request(app).get("/api/student/classes/00000000-0000-4000-8000-000000000000/subjects")).status).toBe(401);
  });

  it("rejects a non-student role", async () => {
    const f = await fixture();

    const res = await getDashboard(f.teacherToken, f.organizationId);
    expect(res.status).toBe(403);
  });

  it("does not trust client-supplied student_id or organization_id", async () => {
    const f = await fixture();

    const student2UserId = await createUser("student-2");
    await addMember(student2UserId, f.organizationId, "STUDENT");
    const class2Id = await createClass(f.organizationId, f.adminId, "class-b");
    const student2Id = await createStudent(f.organizationId, student2UserId, class2Id, "Bob Student", "8");

    const res = await request(app)
      .get("/api/student/dashboard")
      .set(auth(f.studentToken, f.organizationId))
      .query({ student_id: student2Id, organization_id: "00000000-0000-4000-8000-000000000000" });

    expect(res.status).toBe(200);
    expect(res.body.student.id).toBe(f.studentId);
    expect(res.body.student.full_name).toBe("Alice Student");
  });

  it("does not expose Epic 7 assignment or submission data", async () => {
    const f = await fixture();

    const dashboard = await getDashboard(f.studentToken, f.organizationId);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.assignments).toBeUndefined();
    expect(dashboard.body.submissions).toBeUndefined();
    expect(dashboard.body.homework).toBeUndefined();
    expect(dashboard.body.feedback).toBeUndefined();
    expect(dashboard.body.decision).toBeUndefined();

    const classes = await getClasses(f.studentToken, f.organizationId);
    expect(classes.body.assignments).toBeUndefined();

    const subjects = await getSubjects(f.studentToken, f.organizationId, f.classId);
    expect(subjects.body.assignments).toBeUndefined();
  });
});



