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
const createdClassIds: string[] = [];

async function cleanup() {
  if (createdClassIds.length > 0) {
    await pool.query(`DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM student_enrollments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [createdClassIds]);
    createdClassIds.length = 0;
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

describe("Phase 026 class/grade management", () => {
  it("allows an authorized organization administrator to create a class/grade", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("class-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Class Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Alpha Academy",
      slug: `alpha-academy-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 5", section: "A" });

    expect(response.status).toBe(201);
    expect(response.body.class).toBeTruthy();
    expect(response.body.class.organization_id).toBe(org.id);
    expect(response.body.class.name).toBe("Grade 5");
    expect(response.body.class.section).toBe("A");
    expect(response.body.class.status).toBe("ACTIVE");
    createdClassIds.push(response.body.class.id);
  });

  it("rejects creating a class/grade without a name", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("class-validate-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Validate Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Beta Academy",
      slug: `beta-academy-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "   " });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate class/grade names within the same organization (case-insensitive)", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("class-dup-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dup Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Gamma Academy",
      slug: `gamma-academy-${uniqueValue("slug")}`,
    });

    const first = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 6" });
    createdClassIds.push(first.body.class.id);

    const duplicate = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "grade 6" });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("DUPLICATE_CLASS");
  });

  it("allows the same class name in different organizations", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("class-orgA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Org A Admin",
    });
    const orgA = await createOrganizationForUser({
      userId: adminA.id,
      type: "SCHOOL",
      name: "Delta Academy",
      slug: `delta-academy-${uniqueValue("slug")}`,
    });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("class-orgB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Org B Admin",
    });
    const orgB = await createOrganizationForUser({
      userId: adminB.id,
      type: "COACHING_CENTRE",
      name: "Epsilon Centre",
      slug: `epsilon-centre-${uniqueValue("slug")}`,
    });

    const first = await request(app)
      .post(`/api/organizations/${orgA.id}/classes`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Grade 7" });
    createdClassIds.push(first.body.class.id);

    const second = await request(app)
      .post(`/api/organizations/${orgB.id}/classes`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Grade 7" });
    createdClassIds.push(second.body.class.id);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("rejects a non-admin member from creating a class/grade", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("class-role-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Role Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Zeta Academy",
      slug: `zeta-academy-${uniqueValue("slug")}`,
    });

    const teacherUser = await createActiveUser({
      email: `${uniqueValue("class-teacher")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Class Teacher",
    });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const response = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ name: "Grade 8" });

    expect(response.status).toBe(403);
  });

  it("lists classes/grades belonging to the organization", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("class-list-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "List Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Eta Academy",
      slug: `eta-academy-${uniqueValue("slug")}`,
    });

    const createResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 9" });
    createdClassIds.push(createResponse.body.class.id);

    const listResponse = await request(app)
      .get(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.classes)).toBe(true);
    expect(listResponse.body.classes.some((klass: any) => klass.id === createResponse.body.class.id)).toBe(true);
  });

  it("rejects a user from another organization from listing or viewing classes", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("class-crossA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross A Admin",
    });
    const orgA = await createOrganizationForUser({
      userId: adminA.id,
      type: "SCHOOL",
      name: "Theta Academy",
      slug: `theta-academy-${uniqueValue("slug")}`,
    });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("class-crossB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross B Admin",
    });
    const orgB = await createOrganizationForUser({
      userId: adminB.id,
      type: "COACHING_CENTRE",
      name: "Iota Centre",
      slug: `iota-centre-${uniqueValue("slug")}`,
    });

    const createResponse = await request(app)
      .post(`/api/organizations/${orgA.id}/classes`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Grade 10" });
    createdClassIds.push(createResponse.body.class.id);

    const forbiddenList = await request(app)
      .get(`/api/organizations/${orgA.id}/classes`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(forbiddenList.status).toBe(403);
    expect(forbiddenList.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");

    const forbiddenGet = await request(app)
      .get(`/api/classes/${createResponse.body.class.id}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(forbiddenGet.status).toBe(403);
    expect(forbiddenGet.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("allows an admin to view a single class/grade", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("class-get-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Get Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Kappa Academy",
      slug: `kappa-academy-${uniqueValue("slug")}`,
    });

    const createResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 11" });
    createdClassIds.push(createResponse.body.class.id);

    const getResponse = await request(app)
      .get(`/api/classes/${createResponse.body.class.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.class.id).toBe(createResponse.body.class.id);
    expect(getResponse.body.class.organization_id).toBe(org.id);
  });

  it("allows an admin to update permitted class/grade information", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("class-update-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Lambda Academy",
      slug: `lambda-academy-${uniqueValue("slug")}`,
    });

    const createResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 12" });
    createdClassIds.push(createResponse.body.class.id);

    const updateResponse = await request(app)
      .patch(`/api/classes/${createResponse.body.class.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 12 Advanced", section: "B" });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.class.name).toBe("Grade 12 Advanced");
    expect(updateResponse.body.class.section).toBe("B");
  });

  it("rejects updating a class/grade to a duplicate name", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("class-update-dup-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Dup Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Mu Academy",
      slug: `mu-academy-${uniqueValue("slug")}`,
    });

    const first = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 3" });
    createdClassIds.push(first.body.class.id);

    const second = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 4" });
    createdClassIds.push(second.body.class.id);

    const updateResponse = await request(app)
      .patch(`/api/classes/${second.body.class.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "grade 3" });

    expect(updateResponse.status).toBe(409);
    expect(updateResponse.body.error.code).toBe("DUPLICATE_CLASS");
  });

  it("rejects a non-admin member from updating a class/grade", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("class-update-role-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Role Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Nu Academy",
      slug: `nu-academy-${uniqueValue("slug")}`,
    });

    const createResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 2" });
    createdClassIds.push(createResponse.body.class.id);

    const teacherUser = await createActiveUser({
      email: `${uniqueValue("class-update-teacher")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Teacher",
    });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const updateResponse = await request(app)
      .patch(`/api/classes/${createResponse.body.class.id}`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ name: "Grade 2 Renamed" });

    expect(updateResponse.status).toBe(403);
  });

  it("rejects a user from another organization from updating a class/grade", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("class-update-crossA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Cross A Admin",
    });
    const orgA = await createOrganizationForUser({
      userId: adminA.id,
      type: "SCHOOL",
      name: "Xi Academy",
      slug: `xi-academy-${uniqueValue("slug")}`,
    });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("class-update-crossB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Cross B Admin",
    });
    const orgB = await createOrganizationForUser({
      userId: adminB.id,
      type: "COACHING_CENTRE",
      name: "Omicron Centre",
      slug: `omicron-centre-${uniqueValue("slug")}`,
    });

    const createResponse = await request(app)
      .post(`/api/organizations/${orgA.id}/classes`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Grade 1" });
    createdClassIds.push(createResponse.body.class.id);

    const updateResponse = await request(app)
      .patch(`/api/classes/${createResponse.body.class.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Grade 1 Hacked" });

    expect(updateResponse.status).toBe(403);
    expect(updateResponse.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });
});
