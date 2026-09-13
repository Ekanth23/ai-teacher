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
const createdSubjectIds: string[] = [];
const createdClassSubjectIds: string[] = [];

async function cleanup() {
  if (createdClassSubjectIds.length > 0) {
    await pool.query(`DELETE FROM class_subjects WHERE id = ANY($1::uuid[])`, [createdClassSubjectIds]);
    createdClassSubjectIds.length = 0;
  }

  if (createdSubjectIds.length > 0) {
    await pool.query(`DELETE FROM subjects WHERE id = ANY($1::uuid[])`, [createdSubjectIds]);
    createdSubjectIds.length = 0;
  }

  if (createdClassIds.length > 0) {
    await pool.query(`DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM student_enrollments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
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

describe("Phase 2 subject catalog and class subject mapping", () => {
  it("allows an authenticated organization member to create a subject", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Alpha School",
      slug: `alpha-school-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Mathematics", code: "MATH" });

    expect(response.status).toBe(201);
    expect(response.body.subject).toBeTruthy();
    expect(response.body.subject.name).toBe("Mathematics");
    expect(response.body.subject.code).toBe("MATH");
    createdSubjectIds.push(response.body.subject.id);
  });

  it("lists subjects for the organization", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-list-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "List Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Beta School",
      slug: `beta-school-${uniqueValue("slug")}`,
    });

    const createResponse = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Science", code: "SCI" });
    createdSubjectIds.push(createResponse.body.subject.id);

    const listResponse = await request(app)
      .get(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.subjects)).toBe(true);
    expect(listResponse.body.subjects.some((subject: any) => subject.id === createResponse.body.subject.id)).toBe(true);
  });

  it("rejects duplicate subject codes or names within the same organization", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("subject-dup-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dup Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Gamma School",
      slug: `gamma-school-${uniqueValue("slug")}`,
    });

    const firstResponse = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "English", code: "ENG" });
    createdSubjectIds.push(firstResponse.body.subject.id);

    const duplicateCodeResponse = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Literature", code: "ENG" });

    expect(duplicateCodeResponse.status).toBe(409);

    const duplicateNameResponse = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "English", code: "LIT" });

    expect(duplicateNameResponse.status).toBe(409);
  });

  it("rejects another organization from accessing a subject list", async () => {
    const { user: orgAdminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("orgA-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Org A Admin",
    });
    const orgA = await createOrganizationForUser({
      userId: orgAdminA.id,
      type: "SCHOOL",
      name: "Org A",
      slug: `org-a-${uniqueValue("slug")}`,
    });

    const { user: orgAdminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("orgB-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Org B Admin",
    });
    const orgB = await createOrganizationForUser({
      userId: orgAdminB.id,
      type: "COACHING_CENTRE",
      name: "Org B",
      slug: `org-b-${uniqueValue("slug")}`,
    });

    const subjectResponse = await request(app)
      .post(`/api/organizations/${orgA.id}/subjects`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "History", code: "HIS" });
    createdSubjectIds.push(subjectResponse.body.subject.id);

    const forbiddenResponse = await request(app)
      .get(`/api/organizations/${orgA.id}/subjects`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");

    const classResponse = await request(app)
      .post(`/api/organizations/${orgB.id}/classes`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Class 10B" });
    createdClassIds.push(classResponse.body.class.id);
  });

  it("allows mapping a valid class and subject and lists those assignments", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("map-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Mapping Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Map School",
      slug: `map-school-${uniqueValue("slug")}`,
    });

    const classResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 6A", section: "A" });
    createdClassIds.push(classResponse.body.class.id);

    const subjectResponse = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Biology", code: "BIO" });
    createdSubjectIds.push(subjectResponse.body.subject.id);

    const mappingResponse = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/subjects/${subjectResponse.body.subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(mappingResponse.status).toBe(201);
    expect(mappingResponse.body.class_subject).toBeTruthy();
    createdClassSubjectIds.push(mappingResponse.body.class_subject.id);

    const listResponse = await request(app)
      .get(`/api/classes/${classResponse.body.class.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.subjects)).toBe(true);
    expect(listResponse.body.subjects.some((subject: any) => subject.subject_id === subjectResponse.body.subject.id)).toBe(true);
  });

  it("rejects duplicate mapping and cross-organization mapping attempts", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("dup-map-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Duplicate Map Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Duplicate Map School",
      slug: `dup-map-school-${uniqueValue("slug")}`,
    });

    const classResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 8C" });
    createdClassIds.push(classResponse.body.class.id);

    const subjectResponse = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Physics", code: "PHY" });
    createdSubjectIds.push(subjectResponse.body.subject.id);

    const firstMapping = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/subjects/${subjectResponse.body.subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(firstMapping.status).toBe(201);
    createdClassSubjectIds.push(firstMapping.body.class_subject.id);

    const duplicateMapping = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/subjects/${subjectResponse.body.subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(duplicateMapping.status).toBe(409);

    const { user: otherAdmin, accessToken: otherToken } = await createAuthenticatedUser({
      email: `${uniqueValue("other-map-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Other Admin",
    });
    const otherOrg = await createOrganizationForUser({
      userId: otherAdmin.id,
      type: "COACHING_CENTRE",
      name: "Other Org",
      slug: `other-org-${uniqueValue("slug")}`,
    });

    const foreignSubject = await request(app)
      .post(`/api/organizations/${otherOrg.id}/subjects`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: "Chemistry", code: "CHE" });
    createdSubjectIds.push(foreignSubject.body.subject.id);

    const crossOrgMapping = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/subjects/${foreignSubject.body.subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(crossOrgMapping.status).toBe(403);
  });

  it("requires admin role for create and delete class subject mappings", async () => {
    const { user: adminUser, accessToken: adminToken } = await createAuthenticatedUser({
      email: `${uniqueValue("admin-role")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Admin Role",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Role School",
      slug: `role-school-${uniqueValue("slug")}`,
    });

    const teacherUser = await createActiveUser({
      email: `${uniqueValue("teacher-role")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Teacher Role",
    });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const classResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Class 9A" });
    createdClassIds.push(classResponse.body.class.id);

    const subjectResponse = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Geography", code: "GEO" });
    createdSubjectIds.push(subjectResponse.body.subject.id);

    const createDenied = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/subjects/${subjectResponse.body.subject.id}`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`);

    expect(createDenied.status).toBe(403);

    const mappingResponse = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/subjects/${subjectResponse.body.subject.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(mappingResponse.status).toBe(201);
    createdClassSubjectIds.push(mappingResponse.body.class_subject.id);

    const deleteDenied = await request(app)
      .delete(`/api/classes/${classResponse.body.class.id}/subjects/${subjectResponse.body.subject.id}`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`);

    expect(deleteDenied.status).toBe(403);
  });

  it("removes only the class-subject mapping and leaves the subject intact", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("delete-map-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Delete Map Admin",
    });
    const org = await createOrganizationForUser({
      userId: adminUser.id,
      type: "SCHOOL",
      name: "Delete Map School",
      slug: `delete-map-school-${uniqueValue("slug")}`,
    });

    const classResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 7D" });
    createdClassIds.push(classResponse.body.class.id);

    const subjectResponse = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Computer Science", code: "CS" });
    createdSubjectIds.push(subjectResponse.body.subject.id);

    const mappingResponse = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/subjects/${subjectResponse.body.subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(mappingResponse.status).toBe(201);
    createdClassSubjectIds.push(mappingResponse.body.class_subject.id);

    const deleteResponse = await request(app)
      .delete(`/api/classes/${classResponse.body.class.id}/subjects/${subjectResponse.body.subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.success).toBe(true);

    const listResponse = await request(app)
      .get(`/api/classes/${classResponse.body.class.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.subjects).toHaveLength(0);

    const subjectListResponse = await request(app)
      .get(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(subjectListResponse.status).toBe(200);
    expect(subjectListResponse.body.subjects.some((subject: any) => subject.id === subjectResponse.body.subject.id)).toBe(true);
  });
});
