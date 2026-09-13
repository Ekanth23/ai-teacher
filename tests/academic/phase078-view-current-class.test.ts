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
    [`${unique(`p078_${label}`)}@example.com`, `Phase 078 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 078 ${label}`, unique(`p078_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 078 class ${label}`, section, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createStudent(organizationId: string, userId: string, classId: string, fullName = "Phase 078 Student") {
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

async function fixture() {
  const adminId = await createUser("admin");
  const teacherUserId = await createUser("teacher");
  const studentUserId = await createUser("student");
  const organizationId = await createOrganization(adminId, "org");
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  await addMember(teacherUserId, organizationId, "TEACHER");
  await addMember(studentUserId, organizationId, "STUDENT");

  const classId = await createClass(organizationId, adminId, "class-a", "A");
  const studentId = await createStudent(organizationId, studentUserId, classId, "Alice Student");

  return {
    organizationId,
    adminId,
    classId,
    studentId,
    studentUserId,
    studentToken: createAccessToken(studentUserId),
    teacherToken: createAccessToken(teacherUserId),
  };
}

function getDashboard(token: string, organizationId: string) {
  return request(app).get("/api/student/dashboard").set(auth(token, organizationId));
}

function getClasses(token: string, organizationId: string) {
  return request(app).get("/api/student/classes").set(auth(token, organizationId));
}

describe("US-078 view current class", () => {
  it("returns the student's enrolled class as current_class", async () => {
    const f = await fixture();

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    expect(res.body.current_class.id).toBe(f.classId);
    expect(res.body.current_class.name).toBe("Phase 078 class class-a");
    expect(res.body.current_class.section).toBe("A");
  });

  it("exposes only id, name, and section on current_class", async () => {
    const f = await fixture();

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.current_class).sort()).toEqual(["id", "name", "section"]);
  });

  it("returns the same enrolled class in the classes list", async () => {
    const f = await fixture();

    const res = await getClasses(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    expect(res.body.classes).toHaveLength(1);
    expect(res.body.classes[0].id).toBe(f.classId);
    expect(res.body.classes[0].name).toBe("Phase 078 class class-a");
    expect(res.body.classes[0].section).toBe("A");
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/student/dashboard")).status).toBe(401);
    expect((await request(app).get("/api/student/classes")).status).toBe(401);
  });

  it("rejects non-student roles", async () => {
    const f = await fixture();

    const res = await getDashboard(f.teacherToken, f.organizationId);
    expect(res.status).toBe(403);
  });

  it("does not trust client-supplied student_id or organization_id", async () => {
    const f = await fixture();

    const res = await request(app)
      .get("/api/student/dashboard")
      .set(auth(f.studentToken, f.organizationId))
      .query({ student_id: "00000000-0000-4000-8000-000000000001", organization_id: "00000000-0000-4000-8000-000000000000" });

    expect(res.status).toBe(200);
    expect(res.body.student.id).toBe(f.studentId);
    expect(res.body.current_class.id).toBe(f.classId);
  });

  it("isolates students and tenants", async () => {
    const f = await fixture();

    const student2UserId = await createUser("student-2");
    await addMember(student2UserId, f.organizationId, "STUDENT");
    const class2Id = await createClass(f.organizationId, f.adminId, "class-b", "B");
    await createStudent(f.organizationId, student2UserId, class2Id, "Bob Student");

    const res = await getDashboard(f.studentToken, f.organizationId);
    expect(res.status).toBe(200);
    expect(res.body.current_class.id).toBe(f.classId);
    const ids = res.body.classes.map((c: { id: string }) => c.id);
    expect(ids).toContain(f.classId);
    expect(ids).not.toContain(class2Id);

    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    await addMember(otherAdminId, otherOrgId, "SCHOOL_ADMIN");

    expect((await getDashboard(f.studentToken, otherOrgId)).status).toBe(403);
    expect((await getClasses(f.studentToken, otherOrgId)).status).toBe(403);
  });
});
