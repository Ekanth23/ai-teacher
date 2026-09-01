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
const createdStudentIds: string[] = [];
const createdClassIds: string[] = [];
const createdInvitationIds: string[] = [];

async function cleanup() {
  if (createdInvitationIds.length > 0) {
    await pool.query(`DELETE FROM class_invitations WHERE id = ANY($1::uuid[])`, [createdInvitationIds]);
    createdInvitationIds.length = 0;
  }

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

async function createTeacherProfile({ userId, organizationId, designation = "Math Teacher" }) {
  const teacherResult = await pool.query(
    `INSERT INTO teachers (organization_id, user_id, designation, qualification)
     VALUES ($1, $2, $3, $4)
     RETURNING id, organization_id, user_id, designation, qualification`,
    [organizationId, userId, designation, "B.Ed"]
  );

  const teacher = teacherResult.rows[0];
  createdTeacherIds.push(teacher.id);
  return teacher;
}

async function assignTeacherToClass({ organizationId, classId, teacherId }: { organizationId: string; classId: string; teacherId: string; }) {
  await pool.query(
    `INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id)
     VALUES ($1, $2, $3)`,
    [organizationId, classId, teacherId]
  );
}

async function createStudentRecordForUser({ userId, organizationId, fullName = "Student" }: { userId: string; organizationId: string; fullName?: string; }) {
  const profileResult = await pool.query(
    `INSERT INTO students_v2 (organization_id, user_id, full_name, grade_level)
     VALUES ($1, $2, $3, $4)
     RETURNING id, organization_id, user_id, full_name, grade_level`,
    [organizationId, userId, fullName, "6"]
  );

  const student = profileResult.rows[0];
  createdStudentIds.push(student.id);
  return student;
}

describe("Phase 2 class invitation and join flow", () => {
  it("allows assigned teachers and admins to create invitations, and blocks unauthorized teachers", async () => {
    const { user: adminUser, accessToken: adminToken } = await createAuthenticatedUser({
      email: `${uniqueValue("inv-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Inv Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Invitation School", slug: `inv-school-${uniqueValue("slug")}` });

    const classResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Class 6-A", section: "A" });
    createdClassIds.push(classResponse.body.class.id);

    const teacherUser = await createActiveUser({ email: `${uniqueValue("inv-teacher")}@example.com`, password: "StrongPassword123!", fullName: "Inv Teacher" });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherProfile = await createTeacherProfile({ userId: teacherUser.id, organizationId: org.id });
    await assignTeacherToClass({ organizationId: org.id, classId: classResponse.body.class.id, teacherId: teacherProfile.id });

    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const unauthorizedTeacher = await createActiveUser({ email: `${uniqueValue("other-teacher")}@example.com`, password: "StrongPassword123!", fullName: "Other Teacher" });
    await createOrganizationMember({ userId: unauthorizedTeacher.id, organizationId: org.id, roleName: "TEACHER" });
    const unauthorizedTeacherLogin = await request(app).post("/api/auth/login").send({ identifier: unauthorizedTeacher.email, password: "StrongPassword123!" });

    const forbidden = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${unauthorizedTeacherLogin.body.accessToken}`)
      .send({ max_uses: 5 });
    expect(forbidden.status).toBe(403);

    const teacherInvitation = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ max_uses: 5 });
    expect(teacherInvitation.status).toBe(201);
    expect(teacherInvitation.body.invitation.token).toBeTruthy();
    expect(teacherInvitation.body.invitation.join_url).toContain("/api/invitations/");
    createdInvitationIds.push(teacherInvitation.body.invitation.id);

    const adminInvitation = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ max_uses: 2 });
    expect(adminInvitation.status).toBe(201);
    createdInvitationIds.push(adminInvitation.body.invitation.id);
  });

  it("returns safe invitation information and rejects invalid, revoked, expired, and usage-limited tokens", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("lookup-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Lookup Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Lookup School", slug: `lookup-school-${uniqueValue("slug")}` });

    const classResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 7-B", section: "B" });
    createdClassIds.push(classResponse.body.class.id);

    const invitationResponse = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ max_uses: 1 });
    expect(invitationResponse.status).toBe(201);
    createdInvitationIds.push(invitationResponse.body.invitation.id);

    const lookupResponse = await request(app).get(`/api/invitations/${invitationResponse.body.invitation.token}`);
    expect(lookupResponse.status).toBe(200);
    expect(lookupResponse.body.invitation.class.name).toBe("Class 7-B");
    expect(lookupResponse.body.invitation.token).toBeUndefined();

    const invalidTokenResponse = await request(app).get("/api/invitations/invalid-token-123456");
    expect(invalidTokenResponse.status).toBe(404);

    const revokeResponse = await request(app)
      .delete(`/api/classes/${classResponse.body.class.id}/invitations/${invitationResponse.body.invitation.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(revokeResponse.status).toBe(200);

    const revokedLookup = await request(app).get(`/api/invitations/${invitationResponse.body.invitation.token}`);
    expect(revokedLookup.status).toBe(410);

    const secondInvitation = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ max_uses: 1 });
    expect(secondInvitation.status).toBe(201);
    createdInvitationIds.push(secondInvitation.body.invitation.id);

    await pool.query(
      `UPDATE class_invitations
       SET expires_at = NOW() - INTERVAL '1 minute', updated_at = NOW()
       WHERE id = $1`,
      [secondInvitation.body.invitation.id]
    );

    const expiredLookup = await request(app).get(`/api/invitations/${secondInvitation.body.invitation.token}`);
    expect(expiredLookup.status).toBe(410);

    const limitedInvitation = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ max_uses: 1 });
    expect(limitedInvitation.status).toBe(201);
    createdInvitationIds.push(limitedInvitation.body.invitation.id);

    await pool.query(
      `UPDATE class_invitations
       SET use_count = max_uses,
           updated_at = NOW()
       WHERE id = $1`,
      [limitedInvitation.body.invitation.id]
    );

    const limitReachedResponse = await request(app).get(`/api/invitations/${limitedInvitation.body.invitation.token}`);
    expect(limitReachedResponse.status).toBe(410);
  });

  it("lets an authenticated student join a valid invitation and rejects duplicate enrollment", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("join-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Join Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Join School", slug: `join-school-${uniqueValue("slug")}` });

    const classResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 8-A", section: "A" });
    createdClassIds.push(classResponse.body.class.id);

    const teacherUser = await createActiveUser({ email: `${uniqueValue("join-teacher")}@example.com`, password: "StrongPassword123!", fullName: "Join Teacher" });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherProfile = await createTeacherProfile({ userId: teacherUser.id, organizationId: org.id });
    await assignTeacherToClass({ organizationId: org.id, classId: classResponse.body.class.id, teacherId: teacherProfile.id });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const invitationResponse = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ max_uses: 5 });
    expect(invitationResponse.status).toBe(201);
    createdInvitationIds.push(invitationResponse.body.invitation.id);

    const studentUser = await createActiveUser({ email: `${uniqueValue("join-student")}@example.com`, password: "StrongPassword123!", fullName: "Join Student" });
    await createOrganizationMember({ userId: studentUser.id, organizationId: org.id, roleName: "STUDENT" });
    await createStudentRecordForUser({ userId: studentUser.id, organizationId: org.id, fullName: "Join Student" });
    const studentLogin = await request(app).post("/api/auth/login").send({ identifier: studentUser.email, password: "StrongPassword123!" });

    const joinResponse = await request(app)
      .post(`/api/invitations/${invitationResponse.body.invitation.token}/join`)
      .set("Authorization", `Bearer ${studentLogin.body.accessToken}`);

    expect(joinResponse.status).toBe(201);
    expect(joinResponse.body.enrollment.class_id).toBe(classResponse.body.class.id);

    const secondJoin = await request(app)
      .post(`/api/invitations/${invitationResponse.body.invitation.token}/join`)
      .set("Authorization", `Bearer ${studentLogin.body.accessToken}`);
    expect(secondJoin.status).toBe(409);

    const otherOrgAdmin = await createAuthenticatedUser({ email: `${uniqueValue("other-join-admin")}@example.com`, password: "StrongPassword123!", fullName: "Other Join Admin" });
    const otherOrg = await createOrganizationForUser({ userId: otherOrgAdmin.user.id, type: "COACHING_CENTRE", name: "Other Join Org", slug: `other-join-org-${uniqueValue("slug")}` });
    const otherStudentUser = await createActiveUser({ email: `${uniqueValue("other-join-student")}@example.com`, password: "StrongPassword123!", fullName: "Other Join Student" });
    await createOrganizationMember({ userId: otherStudentUser.id, organizationId: otherOrg.id, roleName: "STUDENT" });
    await createStudentRecordForUser({ userId: otherStudentUser.id, organizationId: otherOrg.id, fullName: "Other Join Student" });
    const otherStudentLogin = await request(app).post("/api/auth/login").send({ identifier: otherStudentUser.email, password: "StrongPassword123!" });

    const crossOrgJoin = await request(app)
      .post(`/api/invitations/${invitationResponse.body.invitation.token}/join`)
      .set("Authorization", `Bearer ${otherStudentLogin.body.accessToken}`);
    expect(crossOrgJoin.status).toBe(403);

    const teacherJoinAttempt = await request(app)
      .post(`/api/invitations/${invitationResponse.body.invitation.token}/join`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`);
    expect(teacherJoinAttempt.status).toBe(403);
  });

  it("allows authorized users to list and revoke invitations, and blocks unauthorized access", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("list-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "List Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "COACHING_CENTRE", name: "List Coaching", slug: `list-coaching-${uniqueValue("slug")}` });

    const classResponse = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 10-A", section: "A" });
    createdClassIds.push(classResponse.body.class.id);

    const teacherUser = await createActiveUser({ email: `${uniqueValue("list-teacher")}@example.com`, password: "StrongPassword123!", fullName: "List Teacher" });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherProfile = await createTeacherProfile({ userId: teacherUser.id, organizationId: org.id });
    await assignTeacherToClass({ organizationId: org.id, classId: classResponse.body.class.id, teacherId: teacherProfile.id });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const firstInvitation = await request(app)
      .post(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ max_uses: 3 });
    createdInvitationIds.push(firstInvitation.body.invitation.id);

    const listResponse = await request(app)
      .get(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`);
    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.invitations)).toBe(true);

    const unauthorizedUser = await createActiveUser({ email: `${uniqueValue("unauth-list")}@example.com`, password: "StrongPassword123!", fullName: "Unauthorized User" });
    await createOrganizationMember({ userId: unauthorizedUser.id, organizationId: org.id, roleName: "TEACHER" });
    const unauthorizedLogin = await request(app).post("/api/auth/login").send({ identifier: unauthorizedUser.email, password: "StrongPassword123!" });

    const unauthorizedList = await request(app)
      .get(`/api/classes/${classResponse.body.class.id}/invitations`)
      .set("Authorization", `Bearer ${unauthorizedLogin.body.accessToken}`);
    expect(unauthorizedList.status).toBe(403);

    const revokeResponse = await request(app)
      .delete(`/api/classes/${classResponse.body.class.id}/invitations/${firstInvitation.body.invitation.id}`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`);
    expect(revokeResponse.status).toBe(200);

    const unauthorizedRevoke = await request(app)
      .delete(`/api/classes/${classResponse.body.class.id}/invitations/${firstInvitation.body.invitation.id}`)
      .set("Authorization", `Bearer ${unauthorizedLogin.body.accessToken}`);
    expect(unauthorizedRevoke.status).toBe(403);
  });
});
