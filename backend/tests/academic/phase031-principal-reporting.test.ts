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
const createdTeacherIds: string[] = [];
const createdSubjectIds: string[] = [];
const createdAcademicYearIds: string[] = [];
const createdAssessmentEventIds: string[] = [];
const createdResourceIds: string[] = [];
const createdReportDefinitionIds: string[] = [];

async function cleanup() {
  if (createdReportDefinitionIds.length) {
    await pool.query(`DELETE FROM report_definitions WHERE id = ANY($1::uuid[])`, [createdReportDefinitionIds]);
    createdReportDefinitionIds.length = 0;
  }
  if (createdAssessmentEventIds.length) {
    await pool.query(`DELETE FROM assessment_events WHERE id = ANY($1::uuid[])`, [createdAssessmentEventIds]);
    createdAssessmentEventIds.length = 0;
  }
  if (createdResourceIds.length) {
    await pool.query(`DELETE FROM learning_resources WHERE id = ANY($1::uuid[])`, [createdResourceIds]);
    createdResourceIds.length = 0;
  }
  if (createdClassIds.length) {
    await pool.query(`DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
    await pool.query(`DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])`, [createdClassIds]);
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
    await pool.query(`DELETE FROM subjects WHERE organization_id = ANY($1::uuid[])`, [createdOrganizationIds]);
    await pool.query(`DELETE FROM teachers WHERE organization_id = ANY($1::uuid[])`, [createdOrganizationIds]);
    await pool.query(`DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])`, [createdOrganizationIds]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [createdOrganizationIds]);
    createdOrganizationIds.length = 0;
  }
  if (createdAcademicYearIds.length) {
    await pool.query(`DELETE FROM academic_years WHERE id = ANY($1::uuid[])`, [createdAcademicYearIds]);
    createdAcademicYearIds.length = 0;
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

async function createActiveUser({ email, password, fullName = "User" }: { email?: string | null; password: string; fullName?: string; }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, phone, password_hash, full_name, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE')
     RETURNING id, full_name, email, status`,
    [email ?? null, null, passwordHash, fullName]
  );
  createdUserIds.push(result.rows[0].id);
  return result.rows[0];
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

async function createAuthenticatedUser({ email, password, fullName }: { email?: string | null; password: string; fullName?: string; }) {
  const user = await createActiveUser({ email, password, fullName });
  const loginResponse = await request(app).post("/api/auth/login").send({ identifier: user.email ?? "", password });
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

async function createTeacher(accessToken: string, organizationId: string, userId: string) {
  const res = await request(app)
    .post(`/api/organizations/${organizationId}/teachers`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ user_id: userId });
  if (res.status === 201 && res.body?.teacher?.id) createdTeacherIds.push(res.body.teacher.id);
  return res;
}

async function createSubject(accessToken: string, organizationId: string, name: string, code?: string) {
  const res = await request(app)
    .post(`/api/organizations/${organizationId}/subjects`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name, code: code ?? null });
  if (res.status === 201 && res.body?.subject?.id) createdSubjectIds.push(res.body.subject.id);
  return res;
}

async function createAcademicYear(label: string) {
  const result = await pool.query(
    `INSERT INTO academic_years (code, name, start_date, end_date) VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`,
    [uniqueValue(`ay_${label}`), `AY ${label}`]
  );
  createdAcademicYearIds.push(result.rows[0].id);
  return result.rows[0];
}

async function createAssessmentEvent({ organizationId, classId, academicYearId, title, start, end }: { organizationId: string; classId: string; academicYearId: string; title: string; start: Date; end: Date; }) {
  const result = await pool.query(
    `INSERT INTO assessment_events (organization_id, academic_year_id, class_id, title, scheduled_start, scheduled_end, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED')
     RETURNING id`,
    [organizationId, academicYearId, classId, title, start.toISOString(), end.toISOString()]
  );
  createdAssessmentEventIds.push(result.rows[0].id);
  return result.rows[0];
}

async function createLearningResource(organizationId: string, createdByUserId: string, title: string) {
  const result = await pool.query(
    `INSERT INTO learning_resources (organization_id, created_by_user_id, resource_type, title, file_url, status, visibility)
     VALUES ($1, $2, 'WORKSHEET', $3, 'https://example.com/resource', 'PUBLISHED', 'ORGANIZATION')
     RETURNING id`,
    [organizationId, createdByUserId, title]
  );
  createdResourceIds.push(result.rows[0].id);
  return result.rows[0];
}

describe("Phase 031 principal/administrator academic reporting", () => {
  it("requires authentication for the institutional dashboard", async () => {
    const res = await request(app).get("/api/organizations/00000000-0000-4000-8000-000000000000/reporting/dashboard");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin organization members", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Reporting Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Reporting School", slug: `reporting-${uniqueValue("slug")}` });

    const otherUser = await createActiveUser({ email: `${uniqueValue("r-other")}@example.com`, password: "StrongPassword123!", fullName: "Other Member" });
    await createOrganizationMember({ userId: otherUser.id, organizationId: org.id, roleName: "STUDENT" });
    const otherLogin = await request(app).post("/api/auth/login").send({ identifier: otherUser.email, password: "StrongPassword123!" });

    const res = await request(app)
      .get(`/api/organizations/${org.id}/reporting/dashboard`)
      .set("Authorization", `Bearer ${otherLogin.body.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ROLE_REQUIRED");
  });

  it("rejects cross-organization access", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("r-cross-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Cross A School", slug: `cross-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("r-cross-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Cross B Admin",
    });
    await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Cross B Centre", slug: `cross-b-${uniqueValue("slug")}` });

    const studentUser = await createActiveUser({ email: `${uniqueValue("r-cross-student")}@example.com`, password: "StrongPassword123!", fullName: "Cross Student" });
    await createStudent(tokenA, orgA.id, { user_id: studentUser.id, full_name: "Cross Student" });

    const res = await request(app)
      .get(`/api/organizations/${orgA.id}/reporting/dashboard`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  it("returns a default dashboard with real institutional metrics", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-dash-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Dash Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Dash School", slug: `dash-${uniqueValue("slug")}` });

    const studentUser = await createActiveUser({ email: `${uniqueValue("r-dash-student")}@example.com`, password: "StrongPassword123!", fullName: "Arun" });
    await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Arun", grade_level: "10" });
    await createClass(accessToken, org.id, "10-A");

    const teacherUser = await createActiveUser({ email: `${uniqueValue("r-dash-teacher")}@example.com`, password: "StrongPassword123!", fullName: "Teacher" });
    await createTeacher(accessToken, org.id, teacherUser.id);
    await createSubject(accessToken, org.id, "Mathematics", "MATH");

    const res = await request(app).get(`/api/organizations/${org.id}/reporting/dashboard`).set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.organization.id).toBe(org.id);
    expect(body.metrics.students.value).toBe(1);
    expect(body.metrics.classes.value).toBe(1);
    expect(body.metrics.teachers.value).toBe(1);
    expect(body.metrics.subjects.value).toBe(1);
    expect(body.metrics.students.available).toBe(true);
    expect(body.dataAvailability).toBeInstanceOf(Array);
    expect(body.dataAvailability.length).toBeGreaterThan(0);
  });

  it("aggregates students by grade", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-grade-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Grade Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Grade School", slug: `grade-${uniqueValue("slug")}` });

    const s1 = await createActiveUser({ email: `${uniqueValue("r-grade-1")}@example.com`, password: "StrongPassword123!", fullName: "G1" });
    const s2 = await createActiveUser({ email: `${uniqueValue("r-grade-2")}@example.com`, password: "StrongPassword123!", fullName: "G2" });
    await createStudent(accessToken, org.id, { user_id: s1.id, full_name: "G1", grade_level: "10" });
    await createStudent(accessToken, org.id, { user_id: s2.id, full_name: "G2", grade_level: "9" });

    const res = await request(app).get(`/api/organizations/${org.id}/reporting/grades`).set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const grades = res.body.grades as { grade: string; students: number }[];
    expect(grades.some((g) => g.grade === "10" && g.students === 1)).toBe(true);
    expect(grades.some((g) => g.grade === "9" && g.students === 1)).toBe(true);
  });

  it("aggregates enrollment at class level", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-class-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Class Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Class School", slug: `class-${uniqueValue("slug")}` });

    const studentUser = await createActiveUser({ email: `${uniqueValue("r-class-student")}@example.com`, password: "StrongPassword123!", fullName: "Class Student" });
    const studentRes = await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Class Student", grade_level: "10" });
    const classRes = await createClass(accessToken, org.id, "10-C");

    await request(app)
      .post(`/api/classes/${classRes.body.class.id}/students`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ student_id: studentRes.body.student.id });

    const res = await request(app).get(`/api/organizations/${org.id}/reporting/classes`).set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const classes = res.body.classes as { name: string; students: number }[];
    const target = classes.find((c) => c.name === "10-C");
    expect(target).toBeTruthy();
    expect(target!.students).toBe(1);
  });

  it("aggregates subject-level data", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-subj-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Subject Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Subject School", slug: `subj-${uniqueValue("slug")}` });

    const subjectRes = await createSubject(accessToken, org.id, "Science", "SCI");
    const classRes = await createClass(accessToken, org.id, "10-C");
    await request(app)
      .post(`/api/classes/${classRes.body.class.id}/subjects/${subjectRes.body.subject.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    const res = await request(app).get(`/api/organizations/${org.id}/reporting/subjects`).set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const subjects = res.body.subjects as { name: string; classes: number }[];
    const target = subjects.find((s) => s.name === "Science");
    expect(target).toBeTruthy();
    expect(target!.classes).toBe(1);
  });

  it("lists upcoming assessments from assessment events", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-upc-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Upcoming Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Upcoming School", slug: `upc-${uniqueValue("slug")}` });
    const classRes = await createClass(accessToken, org.id, "10-C");
    const year = await createAcademicYear("upc");

    await createAssessmentEvent({
      organizationId: org.id,
      classId: classRes.body.class.id,
      academicYearId: year.id,
      title: "Science Unit Test",
      start: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      end: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
    });

    const res = await request(app).get(`/api/organizations/${org.id}/reporting/upcoming`).set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.upcoming.length).toBe(1);
    expect(res.body.upcoming[0].title).toBe("Science Unit Test");
    expect(res.body.upcoming[0].class_name).toBe("10-C");
  });

  it("flags performance ranking as unavailable instead of fabricating values", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-top-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Top Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Top School", slug: `top-${uniqueValue("slug")}` });
    const studentUser = await createActiveUser({ email: `${uniqueValue("r-top-student")}@example.com`, password: "StrongPassword123!", fullName: "Top Student" });
    await createStudent(accessToken, org.id, { user_id: studentUser.id, full_name: "Top Student" });

    const topRes = await request(app).get(`/api/organizations/${org.id}/reporting/top-students`).set("Authorization", `Bearer ${accessToken}`);
    expect(topRes.status).toBe(200);
    expect(topRes.body.available).toBe(false);
    expect(topRes.body.students).toEqual([]);

    const needsRes = await request(app).get(`/api/organizations/${org.id}/reporting/students-needing-support`).set("Authorization", `Bearer ${accessToken}`);
    expect(needsRes.status).toBe(200);
    expect(needsRes.body.performanceBased.available).toBe(false);
    expect(needsRes.body.performanceBased.students).toEqual([]);
  });

  it("reports structural attention signals from real data", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-attn-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Attention Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Attention School", slug: `attn-${uniqueValue("slug")}` });

    await createClass(accessToken, org.id, "10-A"); // no teacher, no subjects
    const orphanStudent = await createActiveUser({ email: `${uniqueValue("r-attn-student")}@example.com`, password: "StrongPassword123!", fullName: "Orphan Student" });
    await createStudent(accessToken, org.id, { user_id: orphanStudent.id, full_name: "Orphan Student" }); // no enrollment

    const res = await request(app).get(`/api/organizations/${org.id}/reporting/dashboard`).set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.attention.classesWithoutTeacher.length).toBe(1);
    expect(res.body.attention.classesWithoutSubjects.length).toBe(1);
    expect(res.body.attention.unenrolledStudents.length).toBe(1);
  });

  it("handles empty institutions without errors", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-empty-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Empty Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Empty School", slug: `empty-${uniqueValue("slug")}` });

    const res = await request(app).get(`/api/organizations/${org.id}/reporting/dashboard`).set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.metrics.students.value).toBe(0);
    expect(res.body.metrics.classes.value).toBe(0);
    expect(res.body.grades).toEqual([]);
    expect(res.body.classes).toEqual([]);
    expect(res.body.upcoming).toEqual([]);
  });

  it("creates, lists, gets, and updates an organization-scoped report definition", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-def-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Definition Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Definition School", slug: `def-${uniqueValue("slug")}` });

    const createRes = await request(app)
      .post(`/api/organizations/${org.id}/reporting/reports`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Grade 10 Monthly Review", configuration: { groupBy: "class", metrics: ["students", "assessment_score"] } });
    expect(createRes.status).toBe(201);
    expect(createRes.body.organization_id).toBe(org.id);
    const reportId = createRes.body.id;
    createdReportDefinitionIds.push(reportId);

    const listRes = await request(app).get(`/api/organizations/${org.id}/reporting/reports`).set("Authorization", `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(1);

    const getRes = await request(app).get(`/api/organizations/${org.id}/reporting/reports/${reportId}`).set("Authorization", `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe("Grade 10 Monthly Review");

    const updateRes = await request(app)
      .patch(`/api/organizations/${org.id}/reporting/reports/${reportId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ description: "Updated description" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.description).toBe("Updated description");
  });

  it("isolates report definitions by organization", async () => {
    const { user: adminA, accessToken: tokenA } = await createAuthenticatedUser({
      email: `${uniqueValue("r-iso-a")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Iso A Admin",
    });
    const orgA = await createOrganizationForUser({ userId: adminA.id, type: "SCHOOL", name: "Iso A School", slug: `iso-a-${uniqueValue("slug")}` });

    const { user: adminB, accessToken: tokenB } = await createAuthenticatedUser({
      email: `${uniqueValue("r-iso-b")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Iso B Admin",
    });
    await createOrganizationForUser({ userId: adminB.id, type: "COACHING_CENTRE", name: "Iso B Centre", slug: `iso-b-${uniqueValue("slug")}` });

    const createRes = await request(app)
      .post(`/api/organizations/${orgA.id}/reporting/reports`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Org A Report" });
    expect(createRes.status).toBe(201);
    createdReportDefinitionIds.push(createRes.body.id);

    const crossGet = await request(app).get(`/api/organizations/${orgA.id}/reporting/reports/${createRes.body.id}`).set("Authorization", `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(403);

    const crossList = await request(app).get(`/api/organizations/${orgA.id}/reporting/reports`).set("Authorization", `Bearer ${tokenB}`);
    expect(crossList.status).toBe(403);
  });

  it("generates a custom report from a saved definition and flags unavailable metrics", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-run-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Run Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Run School", slug: `run-${uniqueValue("slug")}` });

    await createClass(accessToken, org.id, "10-C");
    await createClass(accessToken, org.id, "9-A");

    const createRes = await request(app)
      .post(`/api/organizations/${org.id}/reporting/reports`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Class Overview",
        configuration: { groupBy: "class", metrics: ["students", "assessment_score"], sort: { field: "label", direction: "asc" } },
      });
    expect(createRes.status).toBe(201);
    createdReportDefinitionIds.push(createRes.body.id);

    const runRes = await request(app)
      .post(`/api/organizations/${org.id}/reporting/reports/${createRes.body.id}/run`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(runRes.status).toBe(200);
    expect(runRes.body.groups.length).toBe(2);
    expect(runRes.body.definition.name).toBe("Class Overview");
    expect(runRes.body.unavailableMetrics.some((m: { key: string }) => m.key === "assessment_score")).toBe(true);
  });

  it("generates an ad-hoc custom report without saving", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("r-adhoc-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Adhoc Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Adhoc School", slug: `adhoc-${uniqueValue("slug")}` });

    const s1 = await createActiveUser({ email: `${uniqueValue("r-adhoc-1")}@example.com`, password: "StrongPassword123!", fullName: "A1" });
    const s2 = await createActiveUser({ email: `${uniqueValue("r-adhoc-2")}@example.com`, password: "StrongPassword123!", fullName: "A2" });
    await createStudent(accessToken, org.id, { user_id: s1.id, full_name: "A1", grade_level: "10" });
    await createStudent(accessToken, org.id, { user_id: s2.id, full_name: "A2", grade_level: "9" });

    const runRes = await request(app)
      .post(`/api/organizations/${org.id}/reporting/reports/run`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ groupBy: "grade", sort: { field: "students", direction: "desc" } });
    expect(runRes.status).toBe(200);
    expect(runRes.body.organization_id).toBe(org.id);
    expect(runRes.body.groups.length).toBe(2);
    expect(runRes.body.groups[0].metrics.students).toBe(1);
  });
});
