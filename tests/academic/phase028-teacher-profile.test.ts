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
const createdTeacherIds: string[] = [];
const createdClassIds: string[] = [];

async function cleanup() {
  if (createdClassIds.length) {
    await pool.query(`DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM student_enrollments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [createdClassIds]);
    createdClassIds.length = 0;
  }

  if (createdTeacherIds.length) {
    await pool.query(`DELETE FROM class_teacher_assignments WHERE teacher_id = ANY($1::uuid[])`, [createdTeacherIds]);
    await pool.query(`DELETE FROM teachers WHERE id = ANY($1::uuid[])`, [createdTeacherIds]);
    createdTeacherIds.length = 0;
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

async function createTeacher(accessToken: string, organizationId: string, userId: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/organizations/${organizationId}/teachers`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ user_id: userId, ...body });
  if (res.status === 201 && res.body?.teacher?.id) createdTeacherIds.push(res.body.teacher.id);
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

describe("Phase 028 teacher profile management", () => {
  it("creates a teacher profile with valid required information", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Teacher Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Teacher Academy", slug: `teacher-academy-${uniqueValue("slug")}` });
    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-user")}@example.com`, password: "StrongPassword123!", fullName: "Teacher User" });

    const res = await createTeacher(accessToken, org.id, teacherUser.id, { designation: "Mathematics Teacher", qualification: "M.Sc" });

    expect(res.status).toBe(201);
    expect(res.body.teacher).toBeTruthy();
    expect(res.body.teacher.organization_id).toBe(org.id);
    expect(res.body.teacher.user_id).toBe(teacherUser.id);
    expect(res.body.teacher.status).toBe("ACTIVE");
    expect(res.body.teacher.designation).toBe("Mathematics Teacher");
  });

  it("rejects invalid or incomplete teacher profile data", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-invalid-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Invalid Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Invalid Academy", slug: `invalid-academy-${uniqueValue("slug")}` });

    const missing = await request(app)
      .post(`/api/organizations/${org.id}/teachers`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ designation: "X" });
    expect(missing.status).toBe(400);

    const invalidUuid = await createTeacher(accessToken, org.id, "not-a-uuid");
    expect(invalidUuid.status).toBe(400);

    const nonexistent = await createTeacher(accessToken, org.id, "00000000-0000-4000-8000-000000000000");
    expect(nonexistent.status).toBe(404);
  });

  it("rejects duplicate teacher profiles for the same user in the same organization", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-dup-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dup Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Dup Academy", slug: `dup-academy-${uniqueValue("slug")}` });
    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-dup-user")}@example.com`, password: "StrongPassword123!", fullName: "Dup Teacher" });

    const first = await createTeacher(accessToken, org.id, teacherUser.id);
    expect(first.status).toBe(201);

    const second = await createTeacher(accessToken, org.id, teacherUser.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("DUPLICATE_TEACHER");
  });

  it("allows the same user to be a teacher in different organizations", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("t-orgA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Org A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Org A School", slug: `org-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("t-orgB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Org B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Org B Centre", slug: `org-b-${uniqueValue("slug")}` });

    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-shared")}@example.com`, password: "StrongPassword123!", fullName: "Shared Teacher" });

    const resA = await createTeacher(tokenA, orgA.id, teacherUser.id);
    const resB = await createTeacher(tokenB, orgB.id, teacherUser.id);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it("retrieves a teacher profile", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-get-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Get Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Get Academy", slug: `get-academy-${uniqueValue("slug")}` });
    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-get-user")}@example.com`, password: "StrongPassword123!", fullName: "Get Teacher" });

    const createRes = await createTeacher(accessToken, org.id, teacherUser.id);
    const teacherId = createRes.body.teacher.id;

    const getRes = await request(app)
      .get(`/api/teachers/${teacherId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.teacher.id).toBe(teacherId);
    expect(getRes.body.teacher.organization_id).toBe(org.id);
    expect(getRes.body.teacher.full_name).toBe("Get Teacher");
  });

  it("rejects cross-tenant teacher access", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("t-crossA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Cross A Academy", slug: `cross-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("t-crossB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Cross B Centre", slug: `cross-b-${uniqueValue("slug")}` });

    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-cross-user")}@example.com`, password: "StrongPassword123!", fullName: "Cross Teacher" });
    const createRes = await createTeacher(tokenA, orgA.id, teacherUser.id);
    const teacherId = createRes.body.teacher.id;

    const getRes = await request(app).get(`/api/teachers/${teacherId}`).set("Authorization", `Bearer ${tokenB}`);
    expect(getRes.status).toBe(403);
    expect(getRes.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");

    const listRes = await request(app).get(`/api/organizations/${orgA.id}/teachers`).set("Authorization", `Bearer ${tokenB}`);
    expect(listRes.status).toBe(403);
  });

  it("updates editable teacher profile information", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-update-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Update Academy", slug: `update-academy-${uniqueValue("slug")}` });
    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-update-user")}@example.com`, password: "StrongPassword123!", fullName: "Update Teacher" });

    const createRes = await createTeacher(accessToken, org.id, teacherUser.id, { designation: "Math", qualification: "B.Ed" });
    const teacherId = createRes.body.teacher.id;

    const updateRes = await request(app)
      .patch(`/api/teachers/${teacherId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ designation: "Senior Math Teacher", qualification: "M.Ed" });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.teacher.designation).toBe("Senior Math Teacher");
    expect(updateRes.body.teacher.qualification).toBe("M.Ed");
    expect(updateRes.body.teacher.organization_id).toBe(org.id);
    expect(updateRes.body.teacher.user_id).toBe(teacherUser.id);
  });

  it("rejects teacher update by non-admin or cross-tenant users", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-upd-auth-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Auth Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Update Auth Academy", slug: `upd-auth-${uniqueValue("slug")}` });
    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-upd-auth-user")}@example.com`, password: "StrongPassword123!", fullName: "Update Auth Teacher" });
    const createRes = await createTeacher(accessToken, org.id, teacherUser.id);
    const teacherId = createRes.body.teacher.id;

    const otherTeacher = await createActiveUser({ email: `${uniqueValue("t-upd-auth-other")}@example.com`, password: "StrongPassword123!", fullName: "Other Teacher" });
    await createOrganizationMember({ userId: otherTeacher.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: otherTeacher.email, password: "StrongPassword123!" });

    const nonAdminRes = await request(app)
      .patch(`/api/teachers/${teacherId}`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ designation: "Hacked" });
    expect(nonAdminRes.status).toBe(403);

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("t-upd-auth-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Auth B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Update Auth B Centre", slug: `upd-auth-b-${uniqueValue("slug")}` });

    const crossRes = await request(app)
      .patch(`/api/teachers/${teacherId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ designation: "Hacked" });
    expect(crossRes.status).toBe(403);
  });

  it("deactivates and reactivates a teacher without deleting the profile", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-status-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Status Academy", slug: `status-academy-${uniqueValue("slug")}` });
    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-status-user")}@example.com`, password: "StrongPassword123!", fullName: "Status Teacher" });

    const createRes = await createTeacher(accessToken, org.id, teacherUser.id);
    const teacherId = createRes.body.teacher.id;

    const deactivateRes = await request(app)
      .post(`/api/teachers/${teacherId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "INACTIVE" });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.teacher.status).toBe("INACTIVE");

    const getRes = await request(app).get(`/api/teachers/${teacherId}`).set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.teacher.status).toBe("INACTIVE");

    const activateRes = await request(app)
      .post(`/api/teachers/${teacherId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "ACTIVE" });
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.teacher.status).toBe("ACTIVE");
  });

  it("rejects invalid status values", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-status-inv-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Invalid Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Status Invalid Academy", slug: `status-inv-${uniqueValue("slug")}` });
    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-status-inv-user")}@example.com`, password: "StrongPassword123!", fullName: "Status Invalid Teacher" });

    const createRes = await createTeacher(accessToken, org.id, teacherUser.id);
    const teacherId = createRes.body.teacher.id;

    const badRes = await request(app)
      .post(`/api/teachers/${teacherId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "BOGUS" });
    expect(badRes.status).toBe(400);
  });

  it("rejects status changes by non-admin or cross-tenant users", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-status-auth-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Auth Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Status Auth Academy", slug: `status-auth-${uniqueValue("slug")}` });
    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-status-auth-user")}@example.com`, password: "StrongPassword123!", fullName: "Status Auth Teacher" });
    const createRes = await createTeacher(accessToken, org.id, teacherUser.id);
    const teacherId = createRes.body.teacher.id;

    const otherTeacher = await createActiveUser({ email: `${uniqueValue("t-status-auth-other")}@example.com`, password: "StrongPassword123!", fullName: "Other Teacher" });
    await createOrganizationMember({ userId: otherTeacher.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: otherTeacher.email, password: "StrongPassword123!" });

    const nonAdminRes = await request(app)
      .post(`/api/teachers/${teacherId}/status`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ status: "INACTIVE" });
    expect(nonAdminRes.status).toBe(403);

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("t-status-auth-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Auth B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Status Auth B Centre", slug: `status-auth-b-${uniqueValue("slug")}` });

    const crossRes = await request(app)
      .post(`/api/teachers/${teacherId}/status`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ status: "INACTIVE" });
    expect(crossRes.status).toBe(403);
  });

  it("does not restrict a teacher to a single class", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("t-multi-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Multi Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Multi Academy", slug: `multi-academy-${uniqueValue("slug")}` });
    const teacherUser = await createActiveUser({ email: `${uniqueValue("t-multi-user")}@example.com`, password: "StrongPassword123!", fullName: "Multi Teacher" });

    const createRes = await createTeacher(accessToken, org.id, teacherUser.id);
    const teacherId = createRes.body.teacher.id;

    const classA = await createClass(accessToken, org.id, "Class 6A");
    const classB = await createClass(accessToken, org.id, "Class 7A");

    const assignA = await request(app)
      .post(`/api/classes/${classA.body.class.id}/teachers`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ teacher_id: teacherId });
    expect(assignA.status).toBe(201);

    const assignB = await request(app)
      .post(`/api/classes/${classB.body.class.id}/teachers`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ teacher_id: teacherId });
    expect(assignB.status).toBe(201);
  });
});

