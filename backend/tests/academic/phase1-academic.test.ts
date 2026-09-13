import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createApp } from "../../src/server.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS ??= "7";

const app = createApp();
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];
const createdStudentIds: string[] = [];
const createdTeacherIds: string[] = [];
const createdClassIds: string[] = [];

async function cleanup() {
  if (createdClassIds.length > 0) {
    await pool.query(`DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM student_enrollments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [createdClassIds]);
    createdClassIds.length = 0;
  }

  if (createdTeacherIds.length > 0) {
    await pool.query(`DELETE FROM class_teacher_assignments WHERE teacher_id = ANY($1::uuid[])`, [createdTeacherIds]);
    await pool.query(`DELETE FROM teachers WHERE id = ANY($1::uuid[])`, [createdTeacherIds]);
    createdTeacherIds.length = 0;
  }

  if (createdStudentIds.length > 0) {
    await pool.query(`DELETE FROM student_enrollments WHERE student_id = ANY($1::uuid[])`, [createdStudentIds]);
    await pool.query(`DELETE FROM students_v2 WHERE id = ANY($1::uuid[])`, [createdStudentIds]);
    createdStudentIds.length = 0;
  }

  if (createdOrganizationIds.length > 0) {
    await pool.query(`DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])`, [createdOrganizationIds]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [createdOrganizationIds]);
    createdOrganizationIds.length = 0;
  }

  if (createdUserIds.length > 0) {
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    createdUserIds.length = 0;
  }
}

afterEach(async () => {
  await cleanup();
});

function uniqueValue(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createActiveUser({ email, phone, password, fullName = "User" }: { email?: string | null; phone?: string | null; password: string; fullName?: string; }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, phone, password_hash, full_name, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE')
     RETURNING id, full_name, email, phone, status, created_at`,
    [email ?? null, phone ?? null, passwordHash, fullName]
  );

  const user = result.rows[0];
  createdUserIds.push(user.id);
  return user;
}

async function createOrganizationForUser({ userId, type, name, slug }: { userId: string; type: "SCHOOL" | "COACHING_CENTRE"; name: string; slug: string; }) {
  const orgResult = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, $3, 'ACTIVE', $4)
     RETURNING *`,
    [name, slug, type, userId]
  );

  const organization = orgResult.rows[0];
  createdOrganizationIds.push(organization.id);

  const roleName = type === "SCHOOL" ? "SCHOOL_ADMIN" : "COACHING_ADMIN";
  const roleResult = await pool.query(`SELECT id FROM roles WHERE name = $1 LIMIT 1`, [roleName]);
  await pool.query(`INSERT INTO organization_members (user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [userId, organization.id, roleResult.rows[0].id]);

  return organization;
}

async function createAuthenticatedUser({ email, phone, password, fullName }: { email?: string | null; phone?: string | null; password: string; fullName?: string; }) {
  const user = await createActiveUser({ email, phone, password, fullName });
  const loginResponse = await request(app).post("/api/auth/login").send({ identifier: user.email ?? user.phone ?? "", password });
  return { user, accessToken: loginResponse.body.accessToken };
}

describe("Phase 1 academic foundation", () => {
  it("creates teacher, class, assigns teacher and enrolls student within the same organization", async () => {
    const { user: adminUser, accessToken: adminToken } = await createAuthenticatedUser({ email: `${uniqueValue("admin")}@example.com`, password: "StrongPassword123!", fullName: "Admin" });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Test School", slug: `test-school-${uniqueValue("slug")}` });

    // create teacher user
    const teacher = await createActiveUser({ email: `${uniqueValue("teacher")}@example.com`, password: "StrongPassword123!", fullName: "Teacher" });

    // create teacher profile via API
    const createTeacherRes = await request(app)
      .post(`/api/organizations/${org.id}/teachers`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_id: teacher.id, designation: "Math Teacher", qualification: "B.Ed" });

    expect(createTeacherRes.status).toBe(201);
    expect(createTeacherRes.body.teacher).toBeTruthy();
    const teacherProfile = createTeacherRes.body.teacher;
    createdTeacherIds.push(teacherProfile.id);

    // create class
    const createClassRes = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Class 5A", section: "A" });

    expect(createClassRes.status).toBe(201);
    const classRow = createClassRes.body.class;
    createdClassIds.push(classRow.id);

    // assign teacher to class
    const assignRes = await request(app)
      .post(`/api/classes/${classRow.id}/teachers`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ teacher_id: teacherProfile.id });

    expect(assignRes.status).toBe(201);

    // create student
    const studentUser = await createActiveUser({ email: `${uniqueValue("student")}@example.com`, password: "StrongPassword123!", fullName: "Student One" });
    const createStudentProfileRes = await request(app)
      .post(`/api/organizations/${org.id}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ user_id: studentUser.id, full_name: "Student One", grade_level: "5" });

    expect(createStudentProfileRes.status).toBe(201);
    const studentProfile = createStudentProfileRes.body.student;
    createdStudentIds.push(studentProfile.id);

    // enroll student in class
    const enrollRes = await request(app)
      .post(`/api/classes/${classRow.id}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ student_id: studentProfile.id });

    expect(enrollRes.status).toBe(201);

    // get class students
    const rosterRes = await request(app)
      .get(`/api/classes/${classRow.id}/students`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(rosterRes.status).toBe(200);
    expect(Array.isArray(rosterRes.body.students)).toBe(true);
    const found = rosterRes.body.students.find((s: any) => s.id === studentProfile.id);
    expect(found).toBeTruthy();
  });

  it("rejects cross-organization teacher assignment", async () => {
    // admin A and B
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({ email: `${uniqueValue("adminA")}@example.com`, password: "StrongPassword123!", fullName: "Admin A" });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "School A", slug: `school-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({ email: `${uniqueValue("adminB")}@example.com`, password: "StrongPassword123!", fullName: "Admin B" });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "SCHOOL", name: "School B", slug: `school-b-${uniqueValue("slug")}` });

    // create teacher in orgA
    const teacher = await createActiveUser({ email: `${uniqueValue("teacherA")}@example.com`, password: "StrongPassword123!", fullName: "Teacher A" });
    // create teacher profile in orgA
    const createTeacherRes = await request(app)
      .post(`/api/organizations/${orgA.id}/teachers`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ user_id: teacher.id });

    expect(createTeacherRes.status).toBe(201);
    const teacherProfile = createTeacherRes.body.teacher;
    createdTeacherIds.push(teacherProfile.id);

    // create class in orgA
    const classRes = await request(app)
      .post(`/api/organizations/${orgA.id}/classes`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Cross Test Class" });
    expect(classRes.status).toBe(201);
    const classRow = classRes.body.class;
    createdClassIds.push(classRow.id);

    // Attempt to assign teacher to class while authenticated as adminB (orgB) -> should be forbidden
    const assignRes = await request(app)
      .post(`/api/classes/${classRow.id}/teachers`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ teacher_id: teacherProfile.id });

    expect(assignRes.status).toBe(403);
  });
});
