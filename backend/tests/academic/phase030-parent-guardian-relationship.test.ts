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
const createdParentProfileIds: string[] = [];
const createdRelationshipIds: string[] = [];

async function cleanup() {
  if (createdRelationshipIds.length) {
    await pool.query(`DELETE FROM parent_student_relationships WHERE id = ANY($1::uuid[])`, [createdRelationshipIds]);
    createdRelationshipIds.length = 0;
  }

  if (createdParentProfileIds.length) {
    await pool.query(`DELETE FROM parent_profiles WHERE id = ANY($1::uuid[])`, [createdParentProfileIds]);
    createdParentProfileIds.length = 0;
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

async function createParent(accessToken: string, organizationId: string, userId: string) {
  const res = await request(app)
    .post(`/api/organizations/${organizationId}/parents`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ user_id: userId });
  if (res.status === 201 && res.body?.parent?.id) createdParentProfileIds.push(res.body.parent.id);
  return res;
}

async function createRelationship(accessToken: string, parentId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/parents/${parentId}/students`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send(body);
  if (res.status === 201 && res.body?.relationship?.id) createdRelationshipIds.push(res.body.relationship.id);
  return res;
}

describe("Phase 030 parent/guardian profile and relationship management", () => {
  it("creates a parent profile under the administrator's organization", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Parent Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Parent Academy", slug: `parent-academy-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-user")}@example.com`, password: "StrongPassword123!", fullName: "Kumar Parent" });

    const res = await createParent(accessToken, org.id, parentUser.id);

    expect(res.status).toBe(201);
    expect(res.body.parent).toBeTruthy();
    expect(res.body.parent.organization_id).toBe(org.id);
    expect(res.body.parent.user_id).toBe(parentUser.id);
    expect(res.body.parent.status).toBe("ACTIVE");
  });

  it("rejects invalid or incomplete parent profile data", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-inv-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Invalid Parent Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Invalid Parent Academy", slug: `invalid-parent-${uniqueValue("slug")}` });

    const missing = await request(app)
      .post(`/api/organizations/${org.id}/parents`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(missing.status).toBe(400);

    const invalidUuid = await createParent(accessToken, org.id, "not-a-uuid");
    expect(invalidUuid.status).toBe(400);

    const nonexistent = await createParent(accessToken, org.id, "00000000-0000-4000-8000-000000000000");
    expect(nonexistent.status).toBe(404);
  });

  it("prevents duplicate parent profiles within an organization but allows the same person across organizations", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("p-dup-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dup A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Dup A School", slug: `dup-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("p-dup-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dup B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Dup B Centre", slug: `dup-b-${uniqueValue("slug")}` });

    const sharedUser = await createActiveUser({ email: `${uniqueValue("p-shared")}@example.com`, password: "StrongPassword123!", fullName: "Shared Parent" });

    const first = await createParent(tokenA, orgA.id, sharedUser.id);
    expect(first.status).toBe(201);

    const dup = await createParent(tokenA, orgA.id, sharedUser.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_PARENT");

    const otherOrg = await createParent(tokenB, orgB.id, sharedUser.id);
    expect(otherOrg.status).toBe(201);
  });

  it("retrieves a parent profile and enforces tenant isolation", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("p-get-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Get A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Get A School", slug: `get-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("p-get-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Get B Admin",
    });
    await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Get B Centre", slug: `get-b-${uniqueValue("slug")}` });

    const parentUser = await createActiveUser({ email: `${uniqueValue("p-get-user")}@example.com`, password: "StrongPassword123!", fullName: "Get Parent" });
    const createRes = await createParent(tokenA, orgA.id, parentUser.id);
    const parentId = createRes.body.parent.id;

    const getRes = await request(app).get(`/api/parents/${parentId}`).set("Authorization", `Bearer ${tokenA}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.parent.id).toBe(parentId);
    expect(getRes.body.parent.full_name).toBe("Get Parent");

    const crossRes = await request(app).get(`/api/parents/${parentId}`).set("Authorization", `Bearer ${tokenB}`);
    expect(crossRes.status).toBe(403);
  });

  it("updates a parent profile without changing organization ownership or identity", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-upd-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Parent Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Update Parent Academy", slug: `update-parent-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-upd-user")}@example.com`, password: "StrongPassword123!", fullName: "Update Parent" });

    const createRes = await createParent(accessToken, org.id, parentUser.id);
    const parentId = createRes.body.parent.id;

    const updateRes = await request(app)
      .patch(`/api/parents/${parentId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "INACTIVE" });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.parent.status).toBe("INACTIVE");
    expect(updateRes.body.parent.organization_id).toBe(org.id);
    expect(updateRes.body.parent.user_id).toBe(parentUser.id);
  });

  it("rejects parent updates by non-admin or cross-tenant users", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-upd-auth-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Auth Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Update Auth Academy", slug: `upd-auth-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-upd-auth-user")}@example.com`, password: "StrongPassword123!", fullName: "Update Auth Parent" });
    const createRes = await createParent(accessToken, org.id, parentUser.id);
    const parentId = createRes.body.parent.id;

    const otherUser = await createActiveUser({ email: `${uniqueValue("p-upd-auth-other")}@example.com`, password: "StrongPassword123!", fullName: "Other Member" });
    await createOrganizationMember({ userId: otherUser.id, organizationId: org.id, roleName: "STUDENT" });
    const otherLogin = await request(app).post("/api/auth/login").send({ identifier: otherUser.email, password: "StrongPassword123!" });

    const nonAdminRes = await request(app)
      .patch(`/api/parents/${parentId}`)
      .set("Authorization", `Bearer ${otherLogin.body.accessToken}`)
      .send({ status: "INACTIVE" });
    expect(nonAdminRes.status).toBe(403);

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("p-upd-auth-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Auth B Admin",
    });
    await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Update Auth B Centre", slug: `upd-auth-b-${uniqueValue("slug")}` });

    const crossRes = await request(app)
      .patch(`/api/parents/${parentId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ status: "INACTIVE" });
    expect(crossRes.status).toBe(403);
  });

  it("activates and deactivates a parent without deleting the profile", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-status-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Status Academy", slug: `p-status-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-status-user")}@example.com`, password: "StrongPassword123!", fullName: "Status Parent" });
    const createRes = await createParent(accessToken, org.id, parentUser.id);
    const parentId = createRes.body.parent.id;

    const deactivateRes = await request(app)
      .post(`/api/parents/${parentId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "INACTIVE" });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.parent.status).toBe("INACTIVE");

    const getRes = await request(app).get(`/api/parents/${parentId}`).set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.parent.status).toBe("INACTIVE");

    const activateRes = await request(app)
      .post(`/api/parents/${parentId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "ACTIVE" });
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.parent.status).toBe("ACTIVE");

    const badRes = await request(app)
      .post(`/api/parents/${parentId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "BOGUS" });
    expect(badRes.status).toBe(400);
  });

  it("links a parent to a student with a relationship type and primary flag", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-rel-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Relationship Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Relationship Academy", slug: `rel-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-rel-parent")}@example.com`, password: "StrongPassword123!", fullName: "Rel Parent" });
    const studentUser = await createActiveUser({ email: `${uniqueValue("p-rel-student")}@example.com`, password: "StrongPassword123!", fullName: "Arun Kumar" });

    const parentRes = await createParent(accessToken, org.id, parentUser.id);
    const studentRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Arun Kumar" });

    const relRes = await createRelationship(accessToken, parentRes.body.parent.id, {
      student_id: studentRes.body.student.id,
      relationship_type: "GUARDIAN",
      is_primary: true,
    });

    expect(relRes.status).toBe(201);
    expect(relRes.body.relationship.organization_id).toBe(org.id);
    expect(relRes.body.relationship.parent_profile_id).toBe(parentRes.body.parent.id);
    expect(relRes.body.relationship.student_id).toBe(studentRes.body.student.id);
    expect(relRes.body.relationship.relationship_type).toBe("GUARDIAN");
    expect(relRes.body.relationship.is_primary).toBe(true);
    expect(relRes.body.relationship.status).toBe("ACTIVE");
  });

  it("supports a parent with multiple students", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-multi-kids-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Multi Kids Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Multi Kids School", slug: `multi-kids-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-multi-kids-parent")}@example.com`, password: "StrongPassword123!", fullName: "Kumar" });
    const childA = await createActiveUser({ email: `${uniqueValue("p-multi-kids-a")}@example.com`, password: "StrongPassword123!", fullName: "Arun" });
    const childB = await createActiveUser({ email: `${uniqueValue("p-multi-kids-b")}@example.com`, password: "StrongPassword123!", fullName: "Priya" });

    const parentRes = await createParent(accessToken, org.id, parentUser.id);
    const studentA = await createStudent(accessToken, org.id, { user_id: childA.id, full_name: "Arun" });
    const studentB = await createStudent(accessToken, org.id, { user_id: childB.id, full_name: "Priya" });

    await createRelationship(accessToken, parentRes.body.parent.id, { student_id: studentA.body.student.id });
    await createRelationship(accessToken, parentRes.body.parent.id, { student_id: studentB.body.student.id });

    const listRes = await request(app)
      .get(`/api/parents/${parentRes.body.parent.id}/students`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.students).toHaveLength(2);
  });

  it("supports a student with multiple parents/guardians", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-multi-parent-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Multi Parent Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Multi Parent School", slug: `multi-parent-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("p-multi-parent-student")}@example.com`, password: "StrongPassword123!", fullName: "Arun" });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-multi-parent-a")}@example.com`, password: "StrongPassword123!", fullName: "Parent A" });
    const guardianUser = await createActiveUser({ email: `${uniqueValue("p-multi-parent-b")}@example.com`, password: "StrongPassword123!", fullName: "Guardian B" });

    const studentRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Arun" });
    const parentRes = await createParent(accessToken, org.id, parentUser.id);
    const guardianRes = await createParent(accessToken, org.id, guardianUser.id);

    await createRelationship(accessToken, parentRes.body.parent.id, { student_id: studentRes.body.student.id, relationship_type: "PARENT" });
    await createRelationship(accessToken, guardianRes.body.parent.id, { student_id: studentRes.body.student.id, relationship_type: "GUARDIAN" });

    const listRes = await request(app)
      .get(`/api/organizations/${org.id}/students/${studentRes.body.student.id}/parents`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.parents).toHaveLength(2);
  });

  it("rejects duplicate parent-student relationships", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-dup-rel-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dup Rel Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Dup Rel School", slug: `dup-rel-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-dup-rel-parent")}@example.com`, password: "StrongPassword123!", fullName: "Dup Rel Parent" });
    const studentUser = await createActiveUser({ email: `${uniqueValue("p-dup-rel-student")}@example.com`, password: "StrongPassword123!", fullName: "Dup Rel Student" });

    const parentRes = await createParent(accessToken, org.id, parentUser.id);
    const studentRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Dup Rel Student" });

    const first = await createRelationship(accessToken, parentRes.body.parent.id, { student_id: studentRes.body.student.id });
    expect(first.status).toBe(201);

    const dup = await createRelationship(accessToken, parentRes.body.parent.id, { student_id: studentRes.body.student.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_RELATIONSHIP");
  });

  it("rejects cross-tenant relationships and relationships to nonexistent students", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("p-cross-rel-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross Rel A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Cross Rel A School", slug: `cross-rel-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("p-cross-rel-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross Rel B Admin",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Cross Rel B Centre", slug: `cross-rel-b-${uniqueValue("slug")}` });

    const parentUser = await createActiveUser({ email: `${uniqueValue("p-cross-rel-parent")}@example.com`, password: "StrongPassword123!", fullName: "Cross Rel Parent" });
    const studentUser = await createActiveUser({ email: `${uniqueValue("p-cross-rel-student")}@example.com`, password: "StrongPassword123!", fullName: "Cross Rel Student" });

    const parentRes = await createParent(tokenA, orgA.id, parentUser.id);
    const studentRes = await createStudent(tokenB, orgB.id, { user_id: studentUser.id, full_name: "Cross Rel Student" });

    const crossRes = await request(app)
      .post(`/api/parents/${parentRes.body.parent.id}/students`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ student_id: studentRes.body.student.id });
    expect(crossRes.status).toBe(403);
    expect(crossRes.body.error.code).toBe("ORGANIZATION_MISMATCH");

    const nonexistent = await request(app)
      .post(`/api/parents/${parentRes.body.parent.id}/students`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ student_id: "00000000-0000-4000-8000-000000000000" });
    expect(nonexistent.status).toBe(404);
  });

  it("allows a parent to access only their authorized students", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-access-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Access Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Access School", slug: `access-${uniqueValue("slug")}` });

    const parentUser = await createActiveUser({ email: `${uniqueValue("p-access-parent")}@example.com`, password: "StrongPassword123!", fullName: "Kumar" });
    await createOrganizationMember({ userId: parentUser.id, organizationId: org.id, roleName: "PARENT" });

    const arun = await createActiveUser({ email: `${uniqueValue("p-access-arun")}@example.com`, password: "StrongPassword123!", fullName: "Arun" });
    const rahul = await createActiveUser({ email: `${uniqueValue("p-access-rahul")}@example.com`, password: "StrongPassword123!", fullName: "Rahul" });

    const parentRes = await createParent(accessToken, org.id, parentUser.id);
    const arunRes = await createStudent(accessToken, org.id, { user_id: arun.id, full_name: "Arun" });
    const rahulRes = await createStudent(accessToken, org.id, { user_id: rahul.id, full_name: "Rahul" });

    await createRelationship(accessToken, parentRes.body.parent.id, { student_id: arunRes.body.student.id });

    const parentLogin = await request(app).post("/api/auth/login").send({ identifier: parentUser.email, password: "StrongPassword123!" });

    const listRes = await request(app)
      .get(`/api/parents/${parentRes.body.parent.id}/students`)
      .set("Authorization", `Bearer ${parentLogin.body.accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.students).toHaveLength(1);
    expect(listRes.body.students[0].student_id).toBe(arunRes.body.student.id);
    expect(listRes.body.students[0].student_id).not.toBe(rahulRes.body.student.id);
  });

  it("preserves relationships when a parent is deactivated or a relationship is ended", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-hist-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "History Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "History School", slug: `hist-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-hist-parent")}@example.com`, password: "StrongPassword123!", fullName: "Hist Parent" });
    const studentUser = await createActiveUser({ email: `${uniqueValue("p-hist-student")}@example.com`, password: "StrongPassword123!", fullName: "Hist Student" });

    const parentRes = await createParent(accessToken, org.id, parentUser.id);
    const studentRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Hist Student" });
    const relRes = await createRelationship(accessToken, parentRes.body.parent.id, { student_id: studentRes.body.student.id });
    const relationshipId = relRes.body.relationship.id;

    const endRes = await request(app)
      .post(`/api/parent-student-relationships/${relationshipId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "INACTIVE" });
    expect(endRes.status).toBe(200);
    expect(endRes.body.relationship.status).toBe("INACTIVE");

    const history = await pool.query(`SELECT id FROM parent_student_relationships WHERE id = $1`, [relationshipId]);
    expect(history.rows).toHaveLength(1);

    await request(app).post(`/api/parents/${parentRes.body.parent.id}/status`).set("Authorization", `Bearer ${accessToken}`).send({ status: "INACTIVE" });
    const afterParentDeactivation = await pool.query(`SELECT id FROM parent_student_relationships WHERE id = $1`, [relationshipId]);
    expect(afterParentDeactivation.rows).toHaveLength(1);
  });

  it("allows a coaching-center student to exist without any parent", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-coaching-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Coaching Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "COACHING_CENTRE", name: "Coaching Centre", slug: `coaching-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("p-coaching-student")}@example.com`, password: "StrongPassword123!", fullName: "Arun" });

    const studentRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Arun" });
    expect(studentRes.status).toBe(201);

    const parentsRes = await request(app)
      .get(`/api/organizations/${org.id}/students/${studentRes.body.student.id}/parents`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(parentsRes.status).toBe(200);
    expect(parentsRes.body.parents).toHaveLength(0);
  });

  it("supports the SCHOOL parent-primary model via a primary relationship", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-school-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "School Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "School Primary", slug: `school-primary-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-school-parent")}@example.com`, password: "StrongPassword123!", fullName: "School Parent" });
    const studentUser = await createActiveUser({ email: `${uniqueValue("p-school-student")}@example.com`, password: "StrongPassword123!", fullName: "School Student" });

    const parentRes = await createParent(accessToken, org.id, parentUser.id);
    const studentRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "School Student" });

    const relRes = await createRelationship(accessToken, parentRes.body.parent.id, {
      student_id: studentRes.body.student.id,
      relationship_type: "PARENT",
      is_primary: true,
    });
    expect(relRes.status).toBe(201);
    expect(relRes.body.relationship.is_primary).toBe(true);
    expect(relRes.body.relationship.relationship_type).toBe("PARENT");
  });

  it("rejects invalid status and relationship_type values", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-invrel-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Invalid Rel Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Invalid Rel School", slug: `invrel-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-invrel-parent")}@example.com`, password: "StrongPassword123!", fullName: "Invalid Rel Parent" });
    const studentUser = await createActiveUser({ email: `${uniqueValue("p-invrel-student")}@example.com`, password: "StrongPassword123!", fullName: "Invalid Rel Student" });

    const parentRes = await createParent(accessToken, org.id, parentUser.id);
    const studentRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Invalid Rel Student" });

    const badType = await request(app)
      .post(`/api/parents/${parentRes.body.parent.id}/students`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ student_id: studentRes.body.student.id, relationship_type: "SIBLING" });
    expect(badType.status).toBe(400);

    const relRes = await createRelationship(accessToken, parentRes.body.parent.id, { student_id: studentRes.body.student.id });
    const relationshipId = relRes.body.relationship.id;

    const badStatus = await request(app)
      .post(`/api/parent-student-relationships/${relationshipId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "BOGUS" });
    expect(badStatus.status).toBe(400);
  });

  it("rejects parent creation by non-admin users", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("p-auth-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Auth Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Auth School", slug: `auth-school-${uniqueValue("slug")}` });
    const parentUser = await createActiveUser({ email: `${uniqueValue("p-auth-parent")}@example.com`, password: "StrongPassword123!", fullName: "Auth Parent" });

    const otherUser = await createActiveUser({ email: `${uniqueValue("p-auth-other")}@example.com`, password: "StrongPassword123!", fullName: "Other" });
    await createOrganizationMember({ userId: otherUser.id, organizationId: org.id, roleName: "STUDENT" });
    const otherLogin = await request(app).post("/api/auth/login").send({ identifier: otherUser.email, password: "StrongPassword123!" });

    const createParentRes = await request(app)
      .post(`/api/organizations/${org.id}/parents`)
      .set("Authorization", `Bearer ${otherLogin.body.accessToken}`)
      .send({ user_id: parentUser.id });
    expect(createParentRes.status).toBe(403);
  });
});
