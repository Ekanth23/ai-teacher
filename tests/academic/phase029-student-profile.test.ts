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
const createdClassIds: string[] = [];

async function cleanup() {
  if (createdClassIds.length) {
    await pool.query(`DELETE FROM student_enrollments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [createdClassIds]);
    createdClassIds.length = 0;
  }

  if (createdStudentIds.length) {
    await pool.query(`DELETE FROM student_enrollments WHERE student_id = ANY($1::uuid[])`, [createdStudentIds]);
    await pool.query(`DELETE FROM students_v2 WHERE id = ANY($1::uuid[])`, [createdStudentIds]);
    createdStudentIds.length = 0;
  }

  if (createdOrganizationIds.length) {
    await pool.query(`DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])`, [createdOrganizationIds]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [createdOrganizationIds]);
    createdOrganizationIds.length = 0;
  }

  if (createdUserIds.length) {
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
  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [userId, organization.id, roleResult.rows[0].id]
  );

  return organization;
}

async function createOrganizationMember({ userId, organizationId, roleName }: { userId: string; organizationId: string; roleName: string; }) {
  const roleResult = await pool.query(`SELECT id FROM roles WHERE name = $1 LIMIT 1`, [roleName]);
  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [userId, organizationId, roleResult.rows[0].id]
  );
}

async function createAuthenticatedUser({ email, phone, password, fullName }: { email?: string | null; phone?: string | null; password: string; fullName?: string; }) {
  const user = await createActiveUser({ email, phone, password, fullName });
  const loginResponse = await request(app).post("/api/auth/login").send({ identifier: user.email ?? user.phone ?? "", password });
  return { user, accessToken: loginResponse.body.accessToken };
}

async function createStudent(accessToken: string, organizationId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/organizations/${organizationId}/students`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send(body);
  if (res.status === 201 && res.body?.student?.id) createdStudentIds.push(res.body.student.id);
  return res;
}

async function createClass(accessToken: string, organizationId: string, name: string) {
  const res = await request(app)
    .post(`/api/organizations/${organizationId}/classes`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name });
  if (res.status === 201 && res.body?.class?.id) createdClassIds.push(res.body.class.id);
  return res;
}

describe("Phase 029 student academic profile management", () => {
  it("creates a student profile with valid information and an enrollment number", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Student Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Student Academy", slug: `student-academy-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-user")}@example.com`, password: "StrongPassword123!", fullName: "Arun Kumar" });

    const res = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Arun Kumar", grade_level: "5", enrollment_number: "STU-2026-00125" });

    expect(res.status).toBe(201);
    expect(res.body.student).toBeTruthy();
    expect(res.body.student.organization_id).toBe(org.id);
    expect(res.body.student.user_id).toBe(studentUser.id);
    expect(res.body.student.enrollment_number).toBe("STU-2026-00125");
    expect(res.body.student.status).toBe("ACTIVE");
  });

  it("rejects invalid or incomplete student profile data", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-inv-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Invalid Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Invalid Student Academy", slug: `invalid-student-${uniqueValue("slug")}` });

    const missing = await request(app)
      .post(`/api/organizations/${org.id}/students`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ full_name: "No User" });
    expect(missing.status).toBe(400);

    const invalidUuid = await createStudent(accessToken, org.id, { user_id: "not-a-uuid", full_name: "Bad" });
    expect(invalidUuid.status).toBe(400);

    const nonexistent = await createStudent(accessToken, org.id, { user_id: "00000000-0000-4000-8000-000000000000", full_name: "Ghost" });
    expect(nonexistent.status).toBe(404);
  });

  it("rejects duplicate student profiles for the same user in the same organization", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-dup-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dup Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Dup Student Academy", slug: `dup-student-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-dup-user")}@example.com`, password: "StrongPassword123!", fullName: "Dup Student" });

    const first = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Dup Student" });
    expect(first.status).toBe(201);

    const second = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Dup Student Again" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("DUPLICATE_STUDENT");
  });

  it("allows the same user to be a student in different organizations", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("s-orgA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Org A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Org A School", slug: `s-org-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("s-orgB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Org B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Org B Centre", slug: `s-org-b-${uniqueValue("slug")}` });

    const studentUser = await createActiveUser({ email: `${uniqueValue("s-shared")}@example.com`, password: "StrongPassword123!", fullName: "Shared Student" });

    const resA = await createStudent(tokenA, orgA.id, { user_id: studentUser.id, full_name: "Shared Student" });
    const resB = await createStudent(tokenB, orgB.id, { user_id: studentUser.id, full_name: "Shared Student" });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it("rejects duplicate enrollment numbers within the same organization", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-enroll-dup-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Enroll Dup Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Enroll Dup Academy", slug: `enroll-dup-${uniqueValue("slug")}` });

    const u1 = await createActiveUser({ email: `${uniqueValue("s-enroll-u1")}@example.com`, password: "StrongPassword123!", fullName: "Student One" });
    const u2 = await createActiveUser({ email: `${uniqueValue("s-enroll-u2")}@example.com`, password: "StrongPassword123!", fullName: "Student Two" });

    const first = await createStudent(accessToken, org.id, { user_id: u1.id, full_name: "Student One", enrollment_number: "STU-001" });
    expect(first.status).toBe(201);

    const dup = await createStudent(accessToken, org.id, { user_id: u2.id, full_name: "Student Two", enrollment_number: "STU-001" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_STUDENT");
  });

  it("allows the same enrollment number across different organizations", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("s-enroll-crossA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Cross A School", slug: `enroll-cross-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("s-enroll-crossB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Cross B Centre", slug: `enroll-cross-b-${uniqueValue("slug")}` });

    const u1 = await createActiveUser({ email: `${uniqueValue("s-enroll-c1")}@example.com`, password: "StrongPassword123!", fullName: "Student C1" });
    const u2 = await createActiveUser({ email: `${uniqueValue("s-enroll-c2")}@example.com`, password: "StrongPassword123!", fullName: "Student C2" });

    const resA = await createStudent(tokenA, orgA.id, { user_id: u1.id, full_name: "Student C1", enrollment_number: "STU-001" });
    const resB = await createStudent(tokenB, orgB.id, { user_id: u2.id, full_name: "Student C2", enrollment_number: "STU-001" });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it("retrieves a student profile", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-get-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Get Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Get Student Academy", slug: `get-student-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-get-user")}@example.com`, password: "StrongPassword123!", fullName: "Get Student" });

    const createRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Get Student" });
    const studentId = createRes.body.student.id;

    const getRes = await request(app).get(`/api/organizations/${org.id}/students/${studentId}`).set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.student.id).toBe(studentId);
    expect(getRes.body.student.organization_id).toBe(org.id);
    expect(getRes.body.student.full_name).toBe("Get Student");
  });

  it("searches for a student by institutional enrollment number", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-search-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Search Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Search Academy", slug: `search-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-search-user")}@example.com`, password: "StrongPassword123!", fullName: "Arun Kumar" });

    await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Arun Kumar", enrollment_number: "STU-2026-00125" });

    const searchRes = await request(app)
      .get(`/api/organizations/${org.id}/students?enrollment_number=STU-2026-00125`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.students).toHaveLength(1);
    expect(searchRes.body.students[0].full_name).toBe("Arun Kumar");
    expect(searchRes.body.students[0].enrollment_number).toBe("STU-2026-00125");
  });

  it("rejects cross-tenant student get and search", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("s-crossA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Cross A School", slug: `s-cross-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("s-crossB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Cross B Centre", slug: `s-cross-b-${uniqueValue("slug")}` });

    const studentUser = await createActiveUser({ email: `${uniqueValue("s-cross-user")}@example.com`, password: "StrongPassword123!", fullName: "Cross Student" });
    const createRes = await createStudent(tokenA, orgA.id, { user_id: studentUser.id, full_name: "Cross Student", enrollment_number: "STU-999" });
    const studentId = createRes.body.student.id;

    const getRes = await request(app).get(`/api/organizations/${orgA.id}/students/${studentId}`).set("Authorization", `Bearer ${tokenB}`);
    expect(getRes.status).toBe(403);
    expect(getRes.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");

    const searchRes = await request(app)
      .get(`/api/organizations/${orgA.id}/students?enrollment_number=STU-999`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(searchRes.status).toBe(403);
  });

  it("updates editable student profile information", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-upd-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Update Student Academy", slug: `upd-student-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-upd-user")}@example.com`, password: "StrongPassword123!", fullName: "Old Name" });

    const createRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Old Name", grade_level: "5" });
    const studentId = createRes.body.student.id;

    const updateRes = await request(app)
      .patch(`/api/organizations/${org.id}/students/${studentId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ full_name: "New Name", grade_level: "6", enrollment_number: "STU-777" });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.student.full_name).toBe("New Name");
    expect(updateRes.body.student.grade_level).toBe("6");
    expect(updateRes.body.student.enrollment_number).toBe("STU-777");
    expect(updateRes.body.student.organization_id).toBe(org.id);
    expect(updateRes.body.student.user_id).toBe(studentUser.id);
  });

  it("rejects student update by non-admin or cross-tenant users", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-upd-auth-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Auth Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Update Auth Academy", slug: `s-upd-auth-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-upd-auth-user")}@example.com`, password: "StrongPassword123!", fullName: "Update Auth Student" });
    const createRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Update Auth Student" });
    const studentId = createRes.body.student.id;

    const otherStudent = await createActiveUser({ email: `${uniqueValue("s-upd-auth-other")}@example.com`, password: "StrongPassword123!", fullName: "Other Student" });
    await createOrganizationMember({ userId: otherStudent.id, organizationId: org.id, roleName: "STUDENT" });
    const studentLogin = await request(app).post("/api/auth/login").send({ identifier: otherStudent.email, password: "StrongPassword123!" });

    const nonAdminRes = await request(app)
      .patch(`/api/organizations/${org.id}/students/${studentId}`)
      .set("Authorization", `Bearer ${studentLogin.body.accessToken}`)
      .send({ full_name: "Hacked" });
    expect(nonAdminRes.status).toBe(403);

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("s-upd-auth-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Auth B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Update Auth B Centre", slug: `s-upd-auth-b-${uniqueValue("slug")}` });

    const crossRes = await request(app)
      .patch(`/api/organizations/${org.id}/students/${studentId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ full_name: "Hacked" });
    expect(crossRes.status).toBe(403);
  });

  it("deactivates and reactivates a student without deleting the profile", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-status-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Status Student Academy", slug: `s-status-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-status-user")}@example.com`, password: "StrongPassword123!", fullName: "Status Student" });

    const createRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Status Student" });
    const studentId = createRes.body.student.id;

    const deactivateRes = await request(app)
      .post(`/api/organizations/${org.id}/students/${studentId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "INACTIVE" });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.student.status).toBe("INACTIVE");

    // Historical preservation: profile is not deleted.
    const getRes = await request(app).get(`/api/organizations/${org.id}/students/${studentId}`).set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.student.status).toBe("INACTIVE");

    const activateRes = await request(app)
      .post(`/api/organizations/${org.id}/students/${studentId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "ACTIVE" });
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.student.status).toBe("ACTIVE");
  });

  it("rejects invalid status values", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-status-inv-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Invalid Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Status Invalid Academy", slug: `s-status-inv-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-status-inv-user")}@example.com`, password: "StrongPassword123!", fullName: "Status Invalid Student" });

    const createRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Status Invalid Student" });
    const studentId = createRes.body.student.id;

    const badRes = await request(app)
      .post(`/api/organizations/${org.id}/students/${studentId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "BOGUS" });
    expect(badRes.status).toBe(400);
  });

  it("rejects status changes by non-admin or cross-tenant users", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-status-auth-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Auth Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Status Auth Academy", slug: `s-status-auth-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-status-auth-user")}@example.com`, password: "StrongPassword123!", fullName: "Status Auth Student" });
    const createRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Status Auth Student" });
    const studentId = createRes.body.student.id;

    const otherStudent = await createActiveUser({ email: `${uniqueValue("s-status-auth-other")}@example.com`, password: "StrongPassword123!", fullName: "Other Student" });
    await createOrganizationMember({ userId: otherStudent.id, organizationId: org.id, roleName: "STUDENT" });
    const studentLogin = await request(app).post("/api/auth/login").send({ identifier: otherStudent.email, password: "StrongPassword123!" });

    const nonAdminRes = await request(app)
      .post(`/api/organizations/${org.id}/students/${studentId}/status`)
      .set("Authorization", `Bearer ${studentLogin.body.accessToken}`)
      .send({ status: "INACTIVE" });
    expect(nonAdminRes.status).toBe(403);

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("s-status-auth-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Auth B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Status Auth B Centre", slug: `s-status-auth-b-${uniqueValue("slug")}` });

    const crossRes = await request(app)
      .post(`/api/organizations/${org.id}/students/${studentId}/status`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ status: "INACTIVE" });
    expect(crossRes.status).toBe(403);
  });

  it("does not restrict a student to a single class", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s-multi-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Multi Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Multi Student Academy", slug: `s-multi-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("s-multi-user")}@example.com`, password: "StrongPassword123!", fullName: "Multi Student" });

    const createRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Multi Student" });
    const studentId = createRes.body.student.id;

    const classA = await createClass(accessToken, org.id, "Class 6A");
    const classB = await createClass(accessToken, org.id, "Class 7A");

    const enrollA = await request(app)
      .post(`/api/classes/${classA.body.class.id}/students`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ student_id: studentId });
    expect(enrollA.status).toBe(201);

    const enrollB = await request(app)
      .post(`/api/classes/${classB.body.class.id}/students`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ student_id: studentId });
    expect(enrollB.status).toBe(201);
  });
});

