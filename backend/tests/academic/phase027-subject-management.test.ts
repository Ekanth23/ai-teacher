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
const createdSubjectIds: string[] = [];

async function cleanup() {
  if (createdSubjectIds.length > 0) {
    await pool.query(`DELETE FROM class_subjects WHERE subject_id = ANY($1::uuid[])`, [createdSubjectIds]);
    await pool.query(`DELETE FROM subjects WHERE id = ANY($1::uuid[])`, [createdSubjectIds]);
    createdSubjectIds.length = 0;
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

async function createSubject(accessToken: string, organizationId: string, name: string, code?: string) {
  const response = await request(app)
    .post(`/api/organizations/${organizationId}/subjects`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send(code ? { name, code } : { name });
  createdSubjectIds.push(response.body.subject.id);
  return response.body.subject;
}

describe("Phase 027 subject management", () => {
  it("allows an admin to view a single subject", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-get-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Get Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Subject Get Academy",
      slug: `subject-get-${uniqueValue("slug")}`,
    });

    const subject = await createSubject(accessToken, org.id, "Mathematics", "MATH");

    const getResponse = await request(app)
      .get(`/api/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.subject.id).toBe(subject.id);
    expect(getResponse.body.subject.organization_id).toBe(org.id);
    expect(getResponse.body.subject.name).toBe("Mathematics");
  });

  it("rejects a user from another organization from viewing a subject", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-get-crossA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Cross A Admin",
    });
    const orgA = await createOrganizationForUser({
      userId: adminA.id,
      type: "SCHOOL",
      name: "Subject Cross A Academy",
      slug: `subject-cross-a-${uniqueValue("slug")}`,
    });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-get-crossB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Cross B Admin",
    });
    const orgB = await createOrganizationForUser({
      userId: adminB.id,
      type: "COACHING_CENTRE",
      name: "Subject Cross B Centre",
      slug: `subject-cross-b-${uniqueValue("slug")}`,
    });

    const subject = await createSubject(tokenA, orgA.id, "Science", "SCI");

    const getResponse = await request(app)
      .get(`/api/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(getResponse.status).toBe(403);
    expect(getResponse.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("allows an admin to update permitted subject information", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-update-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Update Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Subject Update Academy",
      slug: `subject-update-${uniqueValue("slug")}`,
    });

    const subject = await createSubject(accessToken, org.id, "English", "ENG");

    const updateResponse = await request(app)
      .patch(`/api/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "English Literature", code: "ENGL" });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.subject.name).toBe("English Literature");
    expect(updateResponse.body.subject.code).toBe("ENGL");
  });

  it("rejects updating a subject with an empty name", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-update-validate-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Update Validate Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Subject Validate Academy",
      slug: `subject-validate-${uniqueValue("slug")}`,
    });

    const subject = await createSubject(accessToken, org.id, "Physics", "PHY");

    const updateResponse = await request(app)
      .patch(`/api/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "   " });

    expect(updateResponse.status).toBe(400);
    expect(updateResponse.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects updating a subject to a duplicate name", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-update-dup-name-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Update Dup Name Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Subject Dup Name Academy",
      slug: `subject-dup-name-${uniqueValue("slug")}`,
    });

    await createSubject(accessToken, org.id, "Chemistry", "CHE");
    const subject = await createSubject(accessToken, org.id, "Biology", "BIO");

    const updateResponse = await request(app)
      .patch(`/api/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "chemistry" });

    expect(updateResponse.status).toBe(409);
    expect(updateResponse.body.error.code).toBe("DUPLICATE_SUBJECT");
  });

  it("rejects updating a subject to a duplicate code", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-update-dup-code-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Update Dup Code Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Subject Dup Code Academy",
      slug: `subject-dup-code-${uniqueValue("slug")}`,
    });

    await createSubject(accessToken, org.id, "History", "HIS");
    const subject = await createSubject(accessToken, org.id, "Geography", "GEO");

    const updateResponse = await request(app)
      .patch(`/api/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "HIS" });

    expect(updateResponse.status).toBe(409);
    expect(updateResponse.body.error.code).toBe("DUPLICATE_SUBJECT");
  });

  it("rejects a non-admin member from updating a subject", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-update-role-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Update Role Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Subject Role Academy",
      slug: `subject-role-${uniqueValue("slug")}`,
    });

    const subject = await createSubject(accessToken, org.id, "Civics", "CIV");

    const teacherUser = await createActiveUser({
      email: `${uniqueValue("subject-update-teacher")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Update Teacher",
    });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const updateResponse = await request(app)
      .patch(`/api/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ name: "Civics Renamed" });

    expect(updateResponse.status).toBe(403);
  });

  it("rejects a user from another organization from updating a subject", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-update-crossA")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Update Cross A Admin",
    });
    const orgA = await createOrganizationForUser({
      userId: adminA.id,
      type: "SCHOOL",
      name: "Subject Update Cross A Academy",
      slug: `subject-update-cross-a-${uniqueValue("slug")}`,
    });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-update-crossB")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Update Cross B Admin",
    });
    const orgB = await createOrganizationForUser({
      userId: adminB.id,
      type: "COACHING_CENTRE",
      name: "Subject Update Cross B Centre",
      slug: `subject-update-cross-b-${uniqueValue("slug")}`,
    });

    const subject = await createSubject(tokenA, orgA.id, "Economics", "ECO");

    const updateResponse = await request(app)
      .patch(`/api/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Economics Hacked" });

    expect(updateResponse.status).toBe(403);
    expect(updateResponse.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });
});
