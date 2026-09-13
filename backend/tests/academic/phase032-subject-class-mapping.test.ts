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
const createdTeacherIds: string[] = [];

async function cleanup() {
  if (createdClassIds.length > 0) {
    await pool.query(`DELETE FROM class_subject_teachers WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM student_enrollments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [createdClassIds]);
    createdClassIds.length = 0;
  }

  if (createdSubjectIds.length > 0) {
    await pool.query(`DELETE FROM class_subject_teachers WHERE subject_id = ANY($1::uuid[])`, [createdSubjectIds]);
    await pool.query(`DELETE FROM class_subjects WHERE subject_id = ANY($1::uuid[])`, [createdSubjectIds]);
    await pool.query(`DELETE FROM subjects WHERE id = ANY($1::uuid[])`, [createdSubjectIds]);
    createdSubjectIds.length = 0;
  }

  if (createdTeacherIds.length > 0) {
    await pool.query(`DELETE FROM class_subject_teachers WHERE teacher_id = ANY($1::uuid[])`, [createdTeacherIds]);
    await pool.query(`DELETE FROM class_teacher_assignments WHERE teacher_id = ANY($1::uuid[])`, [createdTeacherIds]);
    await pool.query(`DELETE FROM teachers WHERE id = ANY($1::uuid[])`, [createdTeacherIds]);
    createdTeacherIds.length = 0;
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

async function createAuthenticatedUser({ email, password, fullName }: { email: string; password: string; fullName: string; }) {
  const user = await createActiveUser({ email, password, fullName });
  const loginResponse = await request(app).post("/api/auth/login").send({ identifier: user.email ?? user.phone ?? "", password });
  return { user, accessToken: loginResponse.body.accessToken };
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

async function createClass(accessToken: string, organizationId: string, name: string, extra: Record<string, unknown> = {}) {
  const response = await request(app)
    .post(`/api/organizations/${organizationId}/classes`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name, ...extra });
  if (response.body?.class?.id) {
    createdClassIds.push(response.body.class.id);
  }
  return response;
}

async function createSubject(accessToken: string, organizationId: string, name: string, code?: string) {
  const response = await request(app)
    .post(`/api/organizations/${organizationId}/subjects`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send(code ? { name, code } : { name });
  if (response.body?.subject?.id) {
    createdSubjectIds.push(response.body.subject.id);
  }
  return response.body.subject;
}

async function createTeacher(accessToken: string, organizationId: string, userId: string) {
  const response = await request(app)
    .post(`/api/organizations/${organizationId}/teachers`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ user_id: userId });
  if (response.body?.teacher?.id) {
    createdTeacherIds.push(response.body.teacher.id);
  }
  return response.body.teacher;
}

describe("US-032 subject management & class-subject mapping", () => {
  it("creates a custom subject for a school without a hard-coded list", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-custom")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Custom Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Custom School", slug: `custom-${uniqueValue("slug")}` });

    const subject = await createSubject(accessToken, org.id, "Robotics", "ROBO");
    expect(subject.name).toBe("Robotics");
    expect(subject.code).toBe("ROBO");
    expect(subject.status).toBe("ACTIVE");
    expect(subject.organization_id).toBe(org.id);
  });

  it("creates ordinary coaching-centre subjects (no NEET-specific logic)", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-coach")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Coach Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "COACHING_CENTRE", name: "Apex Academy", slug: `apex-${uniqueValue("slug")}` });

    const physics = await createSubject(accessToken, org.id, "Physics", "PHY");
    const chemistry = await createSubject(accessToken, org.id, "Chemistry", "CHEM");
    const biology = await createSubject(accessToken, org.id, "Biology", "BIO");
    expect(physics.name).toBe("Physics");
    expect(chemistry.name).toBe("Chemistry");
    expect(biology.name).toBe("Biology");
  });

  it("rejects a subject without a name", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-noname")}@example.com`,
      password: "StrongPassword123!",
      fullName: "No Name Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "No Name School", slug: `noname-${uniqueValue("slug")}` });

    const res = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "X" });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate subject names within the same organization", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-dup")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dup Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Dup School", slug: `dup-${uniqueValue("slug")}` });

    await createSubject(accessToken, org.id, "Mathematics", "MATH");
    const dup = await request(app)
      .post(`/api/organizations/${org.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "mathematics" });
    expect(dup.status).toBe(409);
  });

  it("allows the same subject name in different organizations", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-isoname-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Iso A",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Iso A School", slug: `isoa-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-isoname-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Iso B",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "SCHOOL", name: "Iso B School", slug: `isob-${uniqueValue("slug")}` });

    const a = await createSubject(tokenA, orgA.id, "Mathematics");
    const b = await createSubject(tokenB, orgB.id, "Mathematics");
    expect(a.id).not.toBe(b.id);
    expect(a.organization_id).toBe(orgA.id);
    expect(b.organization_id).toBe(orgB.id);
  });

  it("rejects cross-tenant subject access", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-cross-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross A",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Cross A School", slug: `crossa-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-cross-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross B",
    });
    await createOrganizationForUser({ userId: adminB.id, type: "SCHOOL", name: "Cross B School", slug: `crossb-${uniqueValue("slug")}` });

    const subject = await createSubject(tokenA, orgA.id, "Science");

    const get = await request(app).get(`/api/subjects/${subject.id}`).set("Authorization", `Bearer ${tokenB}`);
    expect(get.status).toBe(403);

    const status = await request(app).post(`/api/subjects/${subject.id}/status`).set("Authorization", `Bearer ${tokenB}`).send({ status: "INACTIVE" });
    expect(status.status).toBe(403);
  });

  it("deactivates and reactivates a subject via the status endpoint", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-status")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Status School", slug: `status-${uniqueValue("slug")}` });

    const subject = await createSubject(accessToken, org.id, "History", "HIS");

    const deactivate = await request(app)
      .post(`/api/subjects/${subject.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "INACTIVE" });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.subject.status).toBe("INACTIVE");

    const reactivate = await request(app)
      .post(`/api/subjects/${subject.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "ACTIVE" });
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.subject.status).toBe("ACTIVE");
  });

  it("rejects invalid subject status values", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-badstatus")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Bad Status Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Bad Status School", slug: `badstatus-${uniqueValue("slug")}` });

    const subject = await createSubject(accessToken, org.id, "Civics");
    const res = await request(app)
      .post(`/api/subjects/${subject.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "BOGUS" });
    expect(res.status).toBe(400);
  });

  it("rejects subject status changes by a non-admin", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-status-role")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Role Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Status Role School", slug: `statusrole-${uniqueValue("slug")}` });

    const subject = await createSubject(accessToken, org.id, "Geography");

    const teacherUser = await createActiveUser({
      email: `${uniqueValue("s32-status-role-teacher")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Status Role Teacher",
    });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const res = await request(app)
      .post(`/api/subjects/${subject.id}/status`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ status: "INACTIVE" });
    expect(res.status).toBe(403);
  });

  it("deactivating a subject does not delete its class mappings", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-subject-preserve")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Preserve Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Preserve School", slug: `preserve-${uniqueValue("slug")}` });

    const subject = await createSubject(accessToken, org.id, "Mathematics", "MATH");
    const classRes = await createClass(accessToken, org.id, "Grade 9", { section: "A" });
    await request(app)
      .post(`/api/classes/${classRes.body.class.id}/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    await request(app).post(`/api/subjects/${subject.id}/status`).set("Authorization", `Bearer ${accessToken}`).send({ status: "INACTIVE" });

    const dbCheck = await pool.query(`SELECT id FROM class_subjects WHERE subject_id = $1`, [subject.id]);
    expect(dbCheck.rows.length).toBe(1);
  });

  it("maps a subject to a class and lists active class subjects", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-map")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Map Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Map School", slug: `map-${uniqueValue("slug")}` });

    const math = await createSubject(accessToken, org.id, "Mathematics", "MATH");
    const science = await createSubject(accessToken, org.id, "Science", "SCI");
    const classRes = await createClass(accessToken, org.id, "Grade 10", { section: "A" });

    const map1 = await request(app)
      .post(`/api/classes/${classRes.body.class.id}/subjects/${math.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(map1.status).toBe(201);

    const map2 = await request(app)
      .post(`/api/classes/${classRes.body.class.id}/subjects/${science.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(map2.status).toBe(201);

    const list = await request(app).get(`/api/classes/${classRes.body.class.id}/subjects`).set("Authorization", `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.subjects.length).toBe(2);
  });

  it("prevents duplicate active class-subject mappings", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-mapdup")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Map Dup Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Map Dup School", slug: `mapdup-${uniqueValue("slug")}` });

    const subject = await createSubject(accessToken, org.id, "English", "ENG");
    const classRes = await createClass(accessToken, org.id, "Grade 8", { section: "A" });

    await request(app).post(`/api/classes/${classRes.body.class.id}/subjects/${subject.id}`).set("Authorization", `Bearer ${accessToken}`);
    const dup = await request(app).post(`/api/classes/${classRes.body.class.id}/subjects/${subject.id}`).set("Authorization", `Bearer ${accessToken}`);
    expect(dup.status).toBe(409);
  });

  it("maps the same subject across multiple classes", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-multiclass")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Multi Class Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Multi Class School", slug: `multiclass-${uniqueValue("slug")}` });

    const subject = await createSubject(accessToken, org.id, "Mathematics", "MATH");
    const classA = await createClass(accessToken, org.id, "Grade 10", { section: "A" });
    const classB = await createClass(accessToken, org.id, "Grade 10", { section: "B" });

    const a = await request(app).post(`/api/classes/${classA.body.class.id}/subjects/${subject.id}`).set("Authorization", `Bearer ${accessToken}`);
    const b = await request(app).post(`/api/classes/${classB.body.class.id}/subjects/${subject.id}`).set("Authorization", `Bearer ${accessToken}`);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const listA = await request(app).get(`/api/classes/${classA.body.class.id}/subjects`).set("Authorization", `Bearer ${accessToken}`);
    const listB = await request(app).get(`/api/classes/${classB.body.class.id}/subjects`).set("Authorization", `Bearer ${accessToken}`);
    expect(listA.body.subjects.length).toBe(1);
    expect(listB.body.subjects.length).toBe(1);
  });

  it("soft-deletes a mapping, preserves it, and reactivates on re-map", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-softdelete")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Soft Delete Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Soft Delete School", slug: `softdel-${uniqueValue("slug")}` });

    const subject = await createSubject(accessToken, org.id, "Biology", "BIO");
    const classRes = await createClass(accessToken, org.id, "Grade 11", { section: "A" });
    const classId = classRes.body.class.id;

    await request(app).post(`/api/classes/${classId}/subjects/${subject.id}`).set("Authorization", `Bearer ${accessToken}`);

    const del = await request(app).delete(`/api/classes/${classId}/subjects/${subject.id}`).set("Authorization", `Bearer ${accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const dbCheck = await pool.query(`SELECT id, status FROM class_subjects WHERE subject_id = $1 AND class_id = $2`, [subject.id, classId]);
    expect(dbCheck.rows.length).toBe(1);
    expect(dbCheck.rows[0].status).toBe("INACTIVE");

    const listAfterDelete = await request(app).get(`/api/classes/${classId}/subjects`).set("Authorization", `Bearer ${accessToken}`);
    expect(listAfterDelete.body.subjects).toHaveLength(0);

    const remap = await request(app).post(`/api/classes/${classId}/subjects/${subject.id}`).set("Authorization", `Bearer ${accessToken}`);
    expect(remap.status).toBe(200);
    expect(remap.body.class_subject.status).toBe("ACTIVE");

    const listAfterRemap = await request(app).get(`/api/classes/${classId}/subjects`).set("Authorization", `Bearer ${accessToken}`);
    expect(listAfterRemap.body.subjects.length).toBe(1);
  });

  it("rejects cross-organization class-subject mapping", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-mapcross-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Map Cross A",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Map Cross A School", slug: `mapcrossa-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-mapcross-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Map Cross B",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "SCHOOL", name: "Map Cross B School", slug: `mapcrossb-${uniqueValue("slug")}` });

    const classA = await createClass(tokenA, orgA.id, "Grade 10", { section: "A" });
    const subjectB = await createSubject(tokenB, orgB.id, "Science");

    const res = await request(app)
      .post(`/api/classes/${classA.body.class.id}/subjects/${subjectB.id}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORGANIZATION_MISMATCH");
  });

  it("bulk maps multiple subjects to a class", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-bulk")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Bulk Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Bulk School", slug: `bulk-${uniqueValue("slug")}` });

    const math = await createSubject(accessToken, org.id, "Mathematics", "MATH");
    const science = await createSubject(accessToken, org.id, "Science", "SCI");
    const english = await createSubject(accessToken, org.id, "English", "ENG");
    const robotics = await createSubject(accessToken, org.id, "Robotics", "ROBO");
    const classRes = await createClass(accessToken, org.id, "Grade 10", { section: "A" });

    const bulk = await request(app)
      .post(`/api/classes/${classRes.body.class.id}/subjects`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ subject_ids: [math.id, science.id, english.id] });
    expect(bulk.status).toBe(201);
    expect(bulk.body.total).toBe(3);

    const list = await request(app).get(`/api/classes/${classRes.body.class.id}/subjects`).set("Authorization", `Bearer ${accessToken}`);
    expect(list.body.subjects.length).toBe(3);

    const roboticsMapped = list.body.subjects.some((s: { subject_id: string }) => s.subject_id === robotics.id);
    expect(roboticsMapped).toBe(false);
  });

  it("bulk mapping rejects a subject from another organization", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-bulkcross-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Bulk Cross A",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Bulk Cross A School", slug: `bulkcrossa-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-bulkcross-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Bulk Cross B",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "SCHOOL", name: "Bulk Cross B School", slug: `bulkcrossb-${uniqueValue("slug")}` });

    const classA = await createClass(tokenA, orgA.id, "Grade 10", { section: "A" });
    const subjectB = await createSubject(tokenB, orgB.id, "Physics");

    const res = await request(app)
      .post(`/api/classes/${classA.body.class.id}/subjects`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ subject_ids: [subjectB.id] });
    expect(res.status).toBe(403);
  });

  it("keeps subject teacher assignment working through class_subject_teachers", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-subjteach")}@example.com`,
      password: "StrongPassword123!",
      fullName: "SubjTeach Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "SubjTeach School", slug: `subjteach-${uniqueValue("slug")}` });

    const math = await createSubject(accessToken, org.id, "Mathematics", "MATH");
    const classRes = await createClass(accessToken, org.id, "Grade 10", { section: "A" });
    const classId = classRes.body.class.id;
    await request(app).post(`/api/classes/${classId}/subjects/${math.id}`).set("Authorization", `Bearer ${accessToken}`);

    const teacherUser = await createActiveUser({ email: `${uniqueValue("s32-subjteach-t")}@example.com`, password: "StrongPassword123!", fullName: "Math Teacher" });
    const teacher = await createTeacher(accessToken, org.id, teacherUser.id);

    const assign = await request(app)
      .post(`/api/classes/${classId}/subject-teachers`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ teacher_id: teacher.id, subject_id: math.id });
    expect(assign.status).toBe(201);

    const list = await request(app).get(`/api/classes/${classId}/subject-teachers`).set("Authorization", `Bearer ${accessToken}`);
    expect(list.body.subjectTeachers.length).toBe(1);
    expect(list.body.subjectTeachers[0].subject_id).toBe(math.id);
  });

  it("keeps class teacher and subject teacher logically separate", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-ct-sep")}@example.com`,
      password: "StrongPassword123!",
      fullName: "CT Sep Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "CT Sep School", slug: `ctsep-${uniqueValue("slug")}` });

    const math = await createSubject(accessToken, org.id, "Mathematics", "MATH");
    const science = await createSubject(accessToken, org.id, "Science", "SCI");
    const classRes = await createClass(accessToken, org.id, "Grade 10", { section: "A" });
    const classId = classRes.body.class.id;
    await request(app).post(`/api/classes/${classId}/subjects/${math.id}`).set("Authorization", `Bearer ${accessToken}`);
    await request(app).post(`/api/classes/${classId}/subjects/${science.id}`).set("Authorization", `Bearer ${accessToken}`);

    const teacherAUser = await createActiveUser({ email: `${uniqueValue("s32-ct-sep-a")}@example.com`, password: "StrongPassword123!", fullName: "Teacher A" });
    const teacherBUser = await createActiveUser({ email: `${uniqueValue("s32-ct-sep-b")}@example.com`, password: "StrongPassword123!", fullName: "Teacher B" });
    const teacherA = await createTeacher(accessToken, org.id, teacherAUser.id);
    const teacherB = await createTeacher(accessToken, org.id, teacherBUser.id);

    await request(app).post(`/api/classes/${classId}/teachers`).set("Authorization", `Bearer ${accessToken}`).send({ teacher_id: teacherA.id });
    await request(app).post(`/api/classes/${classId}/subject-teachers`).set("Authorization", `Bearer ${accessToken}`).send({ teacher_id: teacherA.id, subject_id: math.id });
    await request(app).post(`/api/classes/${classId}/subject-teachers`).set("Authorization", `Bearer ${accessToken}`).send({ teacher_id: teacherB.id, subject_id: science.id });

    const classTeachers = await request(app).get(`/api/classes/${classId}/teachers`).set("Authorization", `Bearer ${accessToken}`);
    const subjectTeachers = await request(app).get(`/api/classes/${classId}/subject-teachers`).set("Authorization", `Bearer ${accessToken}`);
    expect(classTeachers.body.classTeachers.filter((t: { status: string }) => t.status === "ACTIVE").length).toBe(1);
    expect(subjectTeachers.body.subjectTeachers.length).toBe(2);
  });

  it("does not create subjects automatically when creating a class", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-noauto")}@example.com`,
      password: "StrongPassword123!",
      fullName: "No Auto Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "No Auto School", slug: `noauto-${uniqueValue("slug")}` });

    await createClass(accessToken, org.id, "Grade 6", { section: "A" });

    const list = await request(app).get(`/api/organizations/${org.id}/subjects`).set("Authorization", `Bearer ${accessToken}`);
    expect(list.body.subjects).toHaveLength(0);
  });

  it("rejects class-subject mapping by a non-admin", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("s32-map-role")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Map Role Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Map Role School", slug: `maprole-${uniqueValue("slug")}` });

    const subject = await createSubject(accessToken, org.id, "History", "HIS");
    const classRes = await createClass(accessToken, org.id, "Grade 7", { section: "A" });

    const teacherUser = await createActiveUser({
      email: `${uniqueValue("s32-map-role-teacher")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Map Role Teacher",
    });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const res = await request(app)
      .post(`/api/classes/${classRes.body.class.id}/subjects/${subject.id}`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`);
    expect(res.status).toBe(403);
  });
});

