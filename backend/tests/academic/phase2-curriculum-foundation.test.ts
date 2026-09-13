import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
const createdBoardIds: string[] = [];
const createdMediumIds: string[] = [];
const createdSyllabusIds: string[] = [];
const createdSyllabusVersionIds: string[] = [];

async function cleanup() {
  if (createdSyllabusVersionIds.length > 0) {
    await pool.query(`DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])`, [createdSyllabusVersionIds]);
    createdSyllabusVersionIds.length = 0;
  }

  if (createdSyllabusIds.length > 0) {
    await pool.query(`DELETE FROM syllabi WHERE id = ANY($1::uuid[])`, [createdSyllabusIds]);
    createdSyllabusIds.length = 0;
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

  if (createdBoardIds.length > 0) {
    await pool.query(`DELETE FROM boards WHERE id = ANY($1::uuid[])`, [createdBoardIds]);
    createdBoardIds.length = 0;
  }

  if (createdMediumIds.length > 0) {
    await pool.query(`DELETE FROM mediums WHERE id = ANY($1::uuid[])`, [createdMediumIds]);
    createdMediumIds.length = 0;
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

async function createAuthenticatedUser({ email, phone, password, fullName }: { email?: string | null; phone?: string | null; password: string; fullName?: string; }) {
  const user = await createActiveUser({ email, phone, password, fullName });
  const loginResponse = await request(app).post("/api/auth/login").send({ identifier: user.email ?? user.phone ?? "", password });
  return { user, accessToken: loginResponse.body.accessToken };
}

async function createBoard({ name, code }: { name: string; code: string }) {
  const result = await pool.query(
    `INSERT INTO boards (name, code, status)
     VALUES ($1, $2, 'ACTIVE')
     RETURNING *`,
    [name, code]
  );
  createdBoardIds.push(result.rows[0].id);
  return result.rows[0];
}

async function createMedium({ name, code }: { name: string; code: string }) {
  const result = await pool.query(
    `INSERT INTO mediums (name, code, status)
     VALUES ($1, $2, 'ACTIVE')
     RETURNING *`,
    [name, code]
  );
  createdMediumIds.push(result.rows[0].id);
  return result.rows[0];
}

describe("Phase 2 curriculum foundation", () => {
  it("tracks migration 014 using the project migration runner", async () => {
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

    execFileSync("node", ["scripts/run-migrations.js"], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const migrationCheck = await pool.query(
      `SELECT COUNT(*)::int AS row_count FROM schema_migrations WHERE version = '014_create_curriculum_foundation'`
    );

    expect(migrationCheck.rows[0].row_count).toBeGreaterThan(0);
  });

  it("lists boards and mediums and returns a single board/medium record", async () => {
    const board = await createBoard({ name: `Board ${uniqueValue("board")}`, code: `BD_${uniqueValue("code")}`.slice(0, 20) });
    const medium = await createMedium({ name: `Medium ${uniqueValue("medium")}`, code: `MD_${uniqueValue("code")}`.slice(0, 20) });

    const boardsResponse = await request(app).get("/api/boards");
    expect(boardsResponse.status).toBe(200);
    expect(Array.isArray(boardsResponse.body.boards)).toBe(true);
    expect(boardsResponse.body).not.toHaveProperty("syllabi");

    const boardResponse = await request(app).get(`/api/boards/${board.id}`);
    expect(boardResponse.status).toBe(200);
    expect(boardResponse.body.board.id).toBe(board.id);

    const mediumsResponse = await request(app).get("/api/mediums");
    expect(mediumsResponse.status).toBe(200);
    expect(Array.isArray(mediumsResponse.body.mediums)).toBe(true);

    const mediumResponse = await request(app).get(`/api/mediums/${medium.id}`);
    expect(mediumResponse.status).toBe(200);
    expect(mediumResponse.body.medium.id).toBe(medium.id);
  });

  it("allows an admin to create a syllabus and rejects duplicate syllabi", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("curriculum-admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Curriculum Admin",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Curriculum School", slug: `curriculum-school-${uniqueValue("slug")}` });

    const classCreate = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 8A", section: "A" });
    expect(classCreate.status).toBe(201);
    createdClassIds.push(classCreate.body.class.id);

    const board = await createBoard({ name: `Board ${uniqueValue("curric-board")}`, code: `BOARD_${uniqueValue("code")}`.slice(0, 20) });
    const medium = await createMedium({ name: `Medium ${uniqueValue("curric-medium")}`, code: `MED_${uniqueValue("code")}`.slice(0, 20) });

    const createSyllabus = await request(app)
      .post(`/api/classes/${classCreate.body.class.id}/syllabus`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "English Literature", code: "ENG-LIT-8A", board_id: board.id, medium_id: medium.id });

    expect(createSyllabus.status).toBe(201);
    expect(createSyllabus.body.syllabus.code).toBe("ENG-LIT-8A");
    createdSyllabusIds.push(createSyllabus.body.syllabus.id);

    const duplicateSyllabus = await request(app)
      .post(`/api/classes/${classCreate.body.class.id}/syllabus`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "English Literature", code: "ENG-LIT-8A", board_id: board.id, medium_id: medium.id });

    expect(duplicateSyllabus.status).toBe(409);
    expect(duplicateSyllabus.body.error.code).toBe("DUPLICATE_SYLLABUS");
  });

  it("rejects unauthorized syllabus creation and enforces class access rules", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("curriculum-admin-2")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Curriculum Admin 2",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "COACHING_CENTRE", name: "Curriculum Coaching", slug: `curriculum-coaching-${uniqueValue("slug")}` });

    const classCreate = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 9B", section: "B" });
    createdClassIds.push(classCreate.body.class.id);

    const board = await createBoard({ name: `Board ${uniqueValue("unauth-board")}`, code: `UBOARD_${uniqueValue("code")}`.slice(0, 20) });
    const medium = await createMedium({ name: `Medium ${uniqueValue("unauth-medium")}`, code: `UMED_${uniqueValue("code")}`.slice(0, 20) });

    const teacherUser = await createActiveUser({ email: `${uniqueValue("curriculum-teacher")}@example.com`, password: "StrongPassword123!", fullName: "Curriculum Teacher" });
    const teacherInfo = await request(app)
      .post(`/api/organizations/${org.id}/teachers`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ user_id: teacherUser.id, designation: "Teacher", qualification: "B.Ed" });
    createdTeacherIds.push(teacherInfo.body.teacher.id);

    const teacherLogin = await request(app).post("/api/auth/login").send({ identifier: teacherUser.email, password: "StrongPassword123!" });
    const teacherCreate = await request(app)
      .post(`/api/classes/${classCreate.body.class.id}/syllabus`)
      .set("Authorization", `Bearer ${teacherLogin.body.accessToken}`)
      .send({ name: "Math Core", code: "MATH-CORE-9B", board_id: board.id, medium_id: medium.id });
    expect(teacherCreate.status).toBe(403);

    const studentUser = await createActiveUser({ email: `${uniqueValue("curriculum-student")}@example.com`, password: "StrongPassword123!", fullName: "Curriculum Student" });
    const studentRole = await pool.query(`SELECT id FROM roles WHERE name = 'STUDENT' LIMIT 1`);
    await pool.query(
      `INSERT INTO organization_members (user_id, organization_id, role_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [studentUser.id, org.id, studentRole.rows[0].id]
    );
    const studentProfile = await request(app)
      .post(`/api/organizations/${org.id}/students`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ user_id: studentUser.id, full_name: "Curriculum Student", grade_level: "9" });
    createdStudentIds.push(studentProfile.body.student.id);
    const studentEnrollment = await request(app)
      .post(`/api/classes/${classCreate.body.class.id}/students`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ student_id: studentProfile.body.student.id });
    expect(studentEnrollment.status).toBe(201);

    const studentLogin = await request(app).post("/api/auth/login").send({ identifier: studentUser.email, password: "StrongPassword123!" });
    const studentList = await request(app)
      .get(`/api/classes/${classCreate.body.class.id}/syllabus`)
      .set("Authorization", `Bearer ${studentLogin.body.accessToken}`);
    expect(studentList.status).toBe(200);
    expect(Array.isArray(studentList.body.syllabi)).toBe(true);
    expect(studentList.body).not.toHaveProperty("syllabus");

    const syllabusCreate = await request(app)
      .post(`/api/classes/${classCreate.body.class.id}/syllabus`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class Syllabus", code: "CLASS-SYLLABUS-9B", board_id: board.id, medium_id: medium.id });
    expect(syllabusCreate.status).toBe(201);
    createdSyllabusIds.push(syllabusCreate.body.syllabus.id);

    const crossOrgUser = await createActiveUser({ email: `${uniqueValue("curriculum-cross-org")}@example.com`, password: "StrongPassword123!", fullName: "Cross Org User" });
    const crossOrg = await createOrganizationForUser({ userId: crossOrgUser.id, type: "SCHOOL", name: "Cross Org School", slug: `cross-org-school-${uniqueValue("slug")}` });
    const crossOrgLogin = await request(app).post("/api/auth/login").send({ identifier: crossOrgUser.email, password: "StrongPassword123!" });
    const crossOrgRead = await request(app)
      .get(`/api/syllabus/${syllabusCreate.body.syllabus.id}`)
      .set("Authorization", `Bearer ${crossOrgLogin.body.accessToken}`);
    expect(crossOrgRead.status).toBe(403);
  });

  it("rejects invalid or inactive board and medium inputs and invalid class ids", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("curriculum-admin-3")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Curriculum Admin 3",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Curriculum School 3", slug: `curriculum-school-3-${uniqueValue("slug")}` });
    const classCreate = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 10A", section: "A" });
    createdClassIds.push(classCreate.body.class.id);

    const invalidBoard = await request(app)
      .post(`/api/classes/${classCreate.body.class.id}/syllabus`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "History", code: "HIST-10A", board_id: "not-a-uuid", medium_id: "00000000-0000-0000-0000-000000000001" });
    expect(invalidBoard.status).toBe(400);

    const board = await createBoard({ name: `Board ${uniqueValue("inactive-board")}`, code: `IBOARD_${uniqueValue("code")}`.slice(0, 20) });
    await pool.query(`UPDATE boards SET status = 'INACTIVE' WHERE id = $1`, [board.id]);
    const inactiveBoard = await request(app)
      .post(`/api/classes/${classCreate.body.class.id}/syllabus`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "History 2", code: "HIST-10A-2", board_id: board.id, medium_id: (await createMedium({ name: `Medium ${uniqueValue("valid-medium")}`, code: `VMED_${uniqueValue("code")}`.slice(0, 20) })).id });
    expect(inactiveBoard.status).toBe(400);

    const medium = await createMedium({ name: `Medium ${uniqueValue("inactive-medium")}`, code: `IMED_${uniqueValue("code")}`.slice(0, 20) });
    await pool.query(`UPDATE mediums SET status = 'INACTIVE' WHERE id = $1`, [medium.id]);
    const inactiveMedium = await request(app)
      .post(`/api/classes/${classCreate.body.class.id}/syllabus`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "History 3", code: "HIST-10A-3", board_id: (await createBoard({ name: `Board ${uniqueValue("valid-board")}`, code: `VBOARD_${uniqueValue("code")}`.slice(0, 20) })).id, medium_id: medium.id });
    expect(inactiveMedium.status).toBe(400);

    const invalidClass = await request(app)
      .post(`/api/classes/123e4567-e89b-42d3-a456-426614174000/syllabus`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "History 4", code: "HIST-10A-4", board_id: (await createBoard({ name: `Board ${uniqueValue("valid-board-2")}`, code: `VBOARD2_${uniqueValue("code")}`.slice(0, 20) })).id, medium_id: (await createMedium({ name: `Medium ${uniqueValue("valid-medium-2")}`, code: `VMED2_${uniqueValue("code")}`.slice(0, 20) })).id });
    expect(invalidClass.status).toBe(404);
  });

  it("allows version creation and rejects duplicate/dating problems", async () => {
    const { user: adminUser, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("curriculum-admin-4")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Curriculum Admin 4",
    });
    const org = await createOrganizationForUser({ userId: adminUser.id, type: "SCHOOL", name: "Curriculum School 4", slug: `curriculum-school-4-${uniqueValue("slug")}` });
    const classCreate = await request(app)
      .post(`/api/organizations/${org.id}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Class 11A", section: "A" });
    createdClassIds.push(classCreate.body.class.id);

    const board = await createBoard({ name: `Board ${uniqueValue("version-board")}`, code: `VBOARD_${uniqueValue("code")}`.slice(0, 20) });
    const medium = await createMedium({ name: `Medium ${uniqueValue("version-medium")}`, code: `VMED_${uniqueValue("code")}`.slice(0, 20) });

    const syllabusResponse = await request(app)
      .post(`/api/classes/${classCreate.body.class.id}/syllabus`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Physics", code: "PHYS-11A", board_id: board.id, medium_id: medium.id });
    createdSyllabusIds.push(syllabusResponse.body.syllabus.id);

    const firstVersion = await request(app)
      .post(`/api/syllabus/${syllabusResponse.body.syllabus.id}/versions`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ version: "2025-2026", effective_from: "2025-04-01", effective_to: "2026-03-31", status: "ACTIVE" });
    expect(firstVersion.status).toBe(201);
    expect(firstVersion.body.syllabusVersion.version).toBe("2025-2026");
    expect(firstVersion.body).not.toHaveProperty("version");
    createdSyllabusVersionIds.push(firstVersion.body.syllabusVersion.id);

    const duplicateVersion = await request(app)
      .post(`/api/syllabus/${syllabusResponse.body.syllabus.id}/versions`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ version: "2025-2026", effective_from: "2025-04-01", effective_to: "2026-03-31" });
    expect(duplicateVersion.status).toBe(409);

    const invalidDates = await request(app)
      .post(`/api/syllabus/${syllabusResponse.body.syllabus.id}/versions`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ version: "2026-2027", effective_from: "2026-06-01", effective_to: "2026-05-01" });
    expect(invalidDates.status).toBe(400);
  });
});
