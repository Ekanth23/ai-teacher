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

async function assignSubjectToClass(accessToken: string, classId: string, subjectId: string) {
  return request(app)
    .post(`/api/classes/${classId}/subjects/${subjectId}`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({});
}

describe("US-031 class/batch management", () => {
  it("creates a SCHOOL class with a section and academic year", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-school")}@example.com`,
      password: "StrongPassword123!",
      fullName: "School Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Green Valley School", slug: `gvs-${uniqueValue("slug")}` });

    const res = await createClass(accessToken, org.id, "Grade 10", { section: "A", academic_year: "2026-27" });
    expect(res.status).toBe(201);
    expect(res.body.class.name).toBe("Grade 10");
    expect(res.body.class.section).toBe("A");
    expect(res.body.class.academic_year).toBe("2026-27");
    expect(res.body.class.status).toBe("ACTIVE");
    expect(res.body.class.organization_id).toBe(org.id);
  });

  it("creates a COACHING_CENTRE batch structure", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-coach")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Centre Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "COACHING_CENTRE", name: "Apex Coaching", slug: `apex-${uniqueValue("slug")}` });

    const res = await createClass(accessToken, org.id, "NEET", { section: "Batch A", academic_year: "2026-27" });
    expect(res.status).toBe(201);
    expect(res.body.class.name).toBe("NEET");
    expect(res.body.class.section).toBe("Batch A");
    expect(res.body.class.academic_year).toBe("2026-27");
  });

  it("rejects a class without a name", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-noname")}@example.com`,
      password: "StrongPassword123!",
      fullName: "No Name Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "No Name School", slug: `noname-${uniqueValue("slug")}` });

    const res = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ section: "A" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid academic year", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-badyear")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Bad Year Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Bad Year School", slug: `badyear-${uniqueValue("slug")}` });

    const res = await createClass(accessToken, org.id, "Grade 9", { academic_year: "not-a-year" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("normalizes academic year and allows distinct academic instances", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-years")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Years Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Years School", slug: `years-${uniqueValue("slug")}` });

    const first = await createClass(accessToken, org.id, "Grade 10", { section: "A", academic_year: "2025-26" });
    const second = await createClass(accessToken, org.id, "Grade 10", { section: "A", academic_year: "2026-27" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.class.id).not.toBe(second.body.class.id);
  });

  it("allows the same class name in different sections", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-sections")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Sections Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Sections School", slug: `sections-${uniqueValue("slug")}` });

    const a = await createClass(accessToken, org.id, "Grade 10", { section: "A", academic_year: "2026-27" });
    const b = await createClass(accessToken, org.id, "Grade 10", { section: "B", academic_year: "2026-27" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it("prevents duplicate classes within the same organization/academic context", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-dup")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dup Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Dup School", slug: `dup-${uniqueValue("slug")}` });

    const first = await createClass(accessToken, org.id, "Grade 10", { section: "A", academic_year: "2026-27" });
    expect(first.status).toBe(201);

    const dup = await createClass(accessToken, org.id, "grade 10", { section: "A", academic_year: "2026-27" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_CLASS");
  });

  it("allows the same class name in different organizations", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-crossname-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross Name A",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Cross Name A School", slug: `cna-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-crossname-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross Name B",
    });
    const orgB = await createOrganizationForUser({ userId: adminB.id, type: "SCHOOL", name: "Cross Name B School", slug: `cnb-${uniqueValue("slug")}` });

    const a = await createClass(tokenA, orgA.id, "Grade 10", { section: "A" });
    const b = await createClass(tokenB, orgB.id, "Grade 10", { section: "A" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.class.organization_id).toBe(orgA.id);
    expect(b.body.class.organization_id).toBe(orgB.id);
  });

  it("rejects cross-tenant class access", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-crossaccess-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross Access A",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Cross Access A School", slug: `caa-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-crossaccess-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross Access B",
    });
    await createOrganizationForUser({ userId: adminB.id, type: "SCHOOL", name: "Cross Access B School", slug: `cab-${uniqueValue("slug")}` });

    const res = await createClass(tokenA, orgA.id, "Grade 10", { section: "A" });
    const classId = res.body.class.id;

    const get = await request(app).get(`/api/classes/${classId}`).set("Authorization", `Bearer ${tokenB}`);
    expect(get.status).toBe(403);

    const status = await request(app).post(`/api/classes/${classId}/status`).set("Authorization", `Bearer ${tokenB}`).send({ status: "INACTIVE" });
    expect(status.status).toBe(403);
  });

  it("lists and gets a class", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-list")}@example.com`,
      password: "StrongPassword123!",
      fullName: "List Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "List School", slug: `list-${uniqueValue("slug")}` });

    await createClass(accessToken, org.id, "Grade 8", { section: "A", academic_year: "2026-27" });

    const list = await request(app).get(`/api/organizations/${org.id}/classes`).set("Authorization", `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.classes.length).toBe(1);

    const get = await request(app).get(`/api/classes/${list.body.classes[0].id}`).set("Authorization", `Bearer ${accessToken}`);
    expect(get.status).toBe(200);
    expect(get.body.class.name).toBe("Grade 8");
  });

  it("updates a class name, section and academic year", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-update")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Update Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Update School", slug: `update-${uniqueValue("slug")}` });

    const res = await createClass(accessToken, org.id, "Grade 7", { section: "A", academic_year: "2026-27" });

    const patch = await request(app)
      .patch(`/api/classes/${res.body.class.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 8", section: "B", academic_year: "2027-28" });
    expect(patch.status).toBe(200);
    expect(patch.body.class.name).toBe("Grade 8");
    expect(patch.body.class.section).toBe("B");
    expect(patch.body.class.academic_year).toBe("2027-28");
  });

  it("deactivates a class without deleting it (historical preservation)", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-deactivate")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Deactivate Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Deactivate School", slug: `deact-${uniqueValue("slug")}` });

    const res = await createClass(accessToken, org.id, "Grade 9", { section: "A", academic_year: "2026-27" });
    const classId = res.body.class.id;

    const status = await request(app)
      .post(`/api/classes/${classId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "INACTIVE" });
    expect(status.status).toBe(200);
    expect(status.body.class.status).toBe("INACTIVE");

    const get = await request(app).get(`/api/classes/${classId}`).set("Authorization", `Bearer ${accessToken}`);
    expect(get.status).toBe(200);
    expect(get.body.class.status).toBe("INACTIVE");

    const dbCheck = await pool.query(`SELECT id FROM classes WHERE id = $1`, [classId]);
    expect(dbCheck.rows.length).toBe(1);
  });

  it("rejects invalid class status values", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-badstatus")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Bad Status Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Bad Status School", slug: `badstatus-${uniqueValue("slug")}` });

    const res = await createClass(accessToken, org.id, "Grade 6");
    const status = await request(app)
      .post(`/api/classes/${res.body.class.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "BOGUS" });
    expect(status.status).toBe(400);
  });

  it("does not auto-assign teachers, subjects or students on class creation", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-noauto")}@example.com`,
      password: "StrongPassword123!",
      fullName: "No Auto Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "No Auto School", slug: `noauto-${uniqueValue("slug")}` });

    const res = await createClass(accessToken, org.id, "Grade 5");
    const classId = res.body.class.id;

    const teachers = await request(app).get(`/api/classes/${classId}/teachers`).set("Authorization", `Bearer ${accessToken}`);
    expect(teachers.body.classTeachers).toHaveLength(0);

    const subjects = await request(app).get(`/api/classes/${classId}/subjects`).set("Authorization", `Bearer ${accessToken}`);
    expect(subjects.body.subjects).toHaveLength(0);
  });

  it("rejects class management by a non-admin member", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("c31-role")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Role Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Role School", slug: `role-${uniqueValue("slug")}` });

    const teacherUser = await createActiveUser({
      email: `${uniqueValue("c31-role-teacher")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Role Teacher",
    });
    await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

    const res = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ name: "Grade 4" });
    expect(res.status).toBe(403);
  });

  describe("class teacher vs subject teacher", () => {
    async function fixture() {
      const { user: adminUser, accessToken } = await createAuthenticatedUser({
        email: `${uniqueValue("c31-ct-admin")}@example.com`,
        password: "StrongPassword123!",
        fullName: "CT Admin",
      });
      const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "CT School", slug: `ct-${uniqueValue("slug")}` });

      const classA = await createClass(accessToken, org.id, "Grade 10", { section: "A", academic_year: "2026-27" });
      const classB = await createClass(accessToken, org.id, "Grade 10", { section: "B", academic_year: "2026-27" });

      const math = await createSubject(accessToken, org.id, "Mathematics", "MATH");
      const science = await createSubject(accessToken, org.id, "Science", "SCI");
      const english = await createSubject(accessToken, org.id, "English", "ENG");
      await assignSubjectToClass(accessToken, classA.body.class.id, math.id);
      await assignSubjectToClass(accessToken, classA.body.class.id, science.id);
      await assignSubjectToClass(accessToken, classA.body.class.id, english.id);

      const teacherAUser = await createActiveUser({ email: `${uniqueValue("c31-teacher-a")}@example.com`, password: "StrongPassword123!", fullName: "Teacher A" });
      const teacherBUser = await createActiveUser({ email: `${uniqueValue("c31-teacher-b")}@example.com`, password: "StrongPassword123!", fullName: "Teacher B" });
      const teacherCUser = await createActiveUser({ email: `${uniqueValue("c31-teacher-c")}@example.com`, password: "StrongPassword123!", fullName: "Teacher C" });
      const teacherA = await createTeacher(accessToken, org.id, teacherAUser.id);
      const teacherB = await createTeacher(accessToken, org.id, teacherBUser.id);
      const teacherC = await createTeacher(accessToken, org.id, teacherCUser.id);

      return { accessToken, org, classA: classA.body.class, classB: classB.body.class, math, science, english, teacherA, teacherB, teacherC };
    }

    it("designates a class teacher and keeps it class-specific", async () => {
      const { accessToken, classA, classB, teacherA } = await fixture();

      const designate = await request(app)
        .post(`/api/classes/${classA.id}/teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherA.id });
      expect(designate.status).toBe(201);
      expect(designate.body.classTeacher.teacher_id).toBe(teacherA.id);
      expect(designate.body.classTeacher.class_id).toBe(classA.id);
      expect(designate.body.classTeacher.status).toBe("ACTIVE");

      const listA = await request(app).get(`/api/classes/${classA.id}/teachers`).set("Authorization", `Bearer ${accessToken}`);
      expect(listA.body.classTeachers.length).toBe(1);

      const listB = await request(app).get(`/api/classes/${classB.id}/teachers`).set("Authorization", `Bearer ${accessToken}`);
      expect(listB.body.classTeachers.length).toBe(0);
    });

    it("allows the same teacher to be class teacher for multiple classes", async () => {
      const { accessToken, classA, classB, teacherA } = await fixture();

      const designateA = await request(app)
        .post(`/api/classes/${classA.id}/teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherA.id });
      expect(designateA.status).toBe(201);

      const designateB = await request(app)
        .post(`/api/classes/${classB.id}/teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherA.id });
      expect(designateB.status).toBe(201);
    });

    it("enforces one active class teacher per class and preserves history on change", async () => {
      const { accessToken, classA, teacherA, teacherB } = await fixture();

      await request(app).post(`/api/classes/${classA.id}/teachers`).set("Authorization", `Bearer ${accessToken}`).send({ teacher_id: teacherA.id });
      const replace = await request(app).post(`/api/classes/${classA.id}/teachers`).set("Authorization", `Bearer ${accessToken}`).send({ teacher_id: teacherB.id });
      expect(replace.status).toBe(201);
      expect(replace.body.classTeacher.teacher_id).toBe(teacherB.id);

      const list = await request(app).get(`/api/classes/${classA.id}/teachers`).set("Authorization", `Bearer ${accessToken}`);
      const active = list.body.classTeachers.filter((t: { status: string }) => t.status === "ACTIVE");
      const inactive = list.body.classTeachers.filter((t: { status: string }) => t.status === "INACTIVE");
      expect(active.length).toBe(1);
      expect(active[0].teacher_id).toBe(teacherB.id);
      expect(inactive.length).toBe(1);
      expect(inactive[0].teacher_id).toBe(teacherA.id);
    });

    it("assigns multiple subject teachers and a class teacher that is also a subject teacher", async () => {
      const { accessToken, classA, math, science, teacherA, teacherB } = await fixture();

      await request(app).post(`/api/classes/${classA.id}/teachers`).set("Authorization", `Bearer ${accessToken}`).send({ teacher_id: teacherA.id });

      const assignMath = await request(app)
        .post(`/api/classes/${classA.id}/subject-teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherA.id, subject_id: math.id });
      expect(assignMath.status).toBe(201);

      const assignScience = await request(app)
        .post(`/api/classes/${classA.id}/subject-teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherB.id, subject_id: science.id });
      expect(assignScience.status).toBe(201);

      const list = await request(app).get(`/api/classes/${classA.id}/subject-teachers`).set("Authorization", `Bearer ${accessToken}`);
      expect(list.status).toBe(200);
      expect(list.body.subjectTeachers.length).toBe(2);

      const listClassTeachers = await request(app).get(`/api/classes/${classA.id}/teachers`).set("Authorization", `Bearer ${accessToken}`);
      expect(listClassTeachers.body.classTeachers.filter((t: { status: string }) => t.status === "ACTIVE").length).toBe(1);
    });

    it("allows a teacher to teach multiple classes and subjects", async () => {
      const { accessToken, classA, classB, math, science, teacherA } = await fixture();

      await assignSubjectToClass(accessToken, classB.id, math.id);
      await assignSubjectToClass(accessToken, classB.id, science.id);

      const a1 = await request(app)
        .post(`/api/classes/${classA.id}/subject-teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherA.id, subject_id: math.id });
      expect(a1.status).toBe(201);

      const a2 = await request(app)
        .post(`/api/classes/${classA.id}/subject-teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherA.id, subject_id: science.id });
      expect(a2.status).toBe(201);

      const b1 = await request(app)
        .post(`/api/classes/${classB.id}/subject-teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherA.id, subject_id: math.id });
      expect(b1.status).toBe(201);

      const listA = await request(app).get(`/api/classes/${classA.id}/subject-teachers`).set("Authorization", `Bearer ${accessToken}`);
      const listB = await request(app).get(`/api/classes/${classB.id}/subject-teachers`).set("Authorization", `Bearer ${accessToken}`);
      expect(listA.body.subjectTeachers.length).toBe(2);
      expect(listB.body.subjectTeachers.length).toBe(1);
    });

    it("requires a subject to be assigned to the class before assigning a subject teacher", async () => {
      const { accessToken, classB, math, teacherA } = await fixture();

      const res = await request(app)
        .post(`/api/classes/${classB.id}/subject-teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherA.id, subject_id: math.id });
      expect(res.status).toBe(400);
    });

    it("removes a subject teacher without removing the class teacher", async () => {
      const { accessToken, classA, math, teacherA, teacherB } = await fixture();

      await request(app).post(`/api/classes/${classA.id}/teachers`).set("Authorization", `Bearer ${accessToken}`).send({ teacher_id: teacherA.id });
      const assign = await request(app)
        .post(`/api/classes/${classA.id}/subject-teachers`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ teacher_id: teacherB.id, subject_id: math.id });
      const assignmentId = assign.body.subjectTeacher.id;

      const remove = await request(app)
        .delete(`/api/classes/${classA.id}/subject-teachers/${assignmentId}`)
        .set("Authorization", `Bearer ${accessToken}`);
      expect(remove.status).toBe(200);
      expect(remove.body.subjectTeacher.status).toBe("INACTIVE");

      const subjectTeachers = await request(app).get(`/api/classes/${classA.id}/subject-teachers`).set("Authorization", `Bearer ${accessToken}`);
      expect(subjectTeachers.body.subjectTeachers.length).toBe(0);

      const classTeachers = await request(app).get(`/api/classes/${classA.id}/teachers`).set("Authorization", `Bearer ${accessToken}`);
      expect(classTeachers.body.classTeachers.filter((t: { status: string }) => t.status === "ACTIVE").length).toBe(1);
    });

    it("rejects class teacher designation by a non-admin", async () => {
      const { accessToken, org, classA, teacherA } = await fixture();

      const teacherUser = await createActiveUser({
        email: `${uniqueValue("c31-ct-role")}@example.com`,
        password: "StrongPassword123!",
        fullName: "CT Role Teacher",
      });
      await createOrganizationMember({ userId: teacherUser.id, organizationId: org.id, roleName: "TEACHER" });
      const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });

      const res = await request(app)
        .post(`/api/classes/${classA.id}/teachers`)
        .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
        .send({ teacher_id: teacherA.id });
      expect(res.status).toBe(403);
    });
  });
});
