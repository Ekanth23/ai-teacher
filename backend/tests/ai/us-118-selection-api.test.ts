import "dotenv/config";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";
import { LearningContextService } from "../../src/modules/ai/learning-context.service.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();
const created = {
  users: [] as string[],
  organizations: [] as string[],
  students: [] as string[],
  classes: [] as string[],
  enrollments: [] as string[],
  subjects: [] as string[],
  syllabi: [] as string[],
};

async function cleanup() {
  if (created.syllabi.length) await pool.query("DELETE FROM syllabus_versions WHERE syllabus_id = ANY($1::uuid[])", [created.syllabi]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
  if (created.subjects.length) await pool.query("DELETE FROM subjects WHERE id = ANY($1::uuid[])", [created.subjects]);
  if (created.enrollments.length) await pool.query("DELETE FROM student_enrollments WHERE id = ANY($1::uuid[])", [created.enrollments]);
  if (created.students.length) await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
  if (created.classes.length) {
    await pool.query("DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  }
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  Object.values(created).forEach((ids) => { ids.length = 0; });
}

afterEach(cleanup);

async function user(label: string) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${label}-${randomUUID()}@example.com`, label]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function organization(ownerId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [label, `${label}-${randomUUID()}`, ownerId]
  );
  created.organizations.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function member(userId: string, organizationId: string, roleName: string) {
  const role = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [roleName]);
  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [userId, organizationId, role.rows[0].id]
  );
}

async function student(organizationId: string, userId: string, name: string) {
  const result = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status)
     VALUES ($1, $2, $3, '8', 'ACTIVE') RETURNING id`,
    [userId, organizationId, name]
  );
  created.students.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function klass(organizationId: string, ownerId: string, name: string) {
  const result = await pool.query(
    `INSERT INTO classes (organization_id, name, created_by_user_id, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, name, ownerId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function enrollment(organizationId: string, studentId: string, classId: string) {
  const result = await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, studentId, classId]
  );
  created.enrollments.push(result.rows[0].id);
  return result.rows[0].id as string;
}

function auth(userId: string, organizationId: string) {
  return { Authorization: `Bearer ${createAccessToken(userId)}`, "x-organization-id": organizationId };
}

describe("US-118 explicit current enrollment and syllabus designation", () => {
  it("requires an explicit valid selection, replaces it explicitly, and isolates ownership", async () => {
    const adminId = await user("us118-admin");
    const studentUserId = await user("us118-student");
    const otherStudentUserId = await user("us118-other-student");
    const organizationId = await organization(adminId, "US-118 organization");
    const otherOrganizationId = await organization(adminId, "US-118 other organization");
    await member(adminId, organizationId, "SCHOOL_ADMIN");
    await member(studentUserId, organizationId, "STUDENT");
    await member(otherStudentUserId, organizationId, "STUDENT");
    const studentId = await student(organizationId, studentUserId, "Student");
    const otherStudentId = await student(organizationId, otherStudentUserId, "Other Student");
    const classA = await klass(organizationId, adminId, "Class 8 A");
    const classB = await klass(organizationId, adminId, "Class 8 B");
    const enrollmentA = await enrollment(organizationId, studentId, classA);
    const enrollmentB = await enrollment(organizationId, studentId, classB);
    const foreignEnrollment = await enrollment(organizationId, otherStudentId, classA);
    const otherClass = await klass(otherOrganizationId, adminId, "Foreign class");
    const otherStudent = await student(otherOrganizationId, studentUserId, "Foreign student");
    const crossTenantEnrollment = await enrollment(otherOrganizationId, otherStudent, otherClass);

    const initial = await request(app).get("/api/student/current-enrollment").set(auth(studentUserId, organizationId));
    expect(initial.status).toBe(200);
    expect(initial.body.status).toBe("unresolved");
    expect(initial.body.current_class).toBeNull();

    const selected = await request(app)
      .put("/api/student/current-enrollment")
      .set(auth(studentUserId, organizationId))
      .send({ enrollment_id: enrollmentA });
    expect(selected.status).toBe(200);
    expect(selected.body.current_class.id).toBe(classA);

    const foreign = await request(app)
      .put("/api/student/current-enrollment")
      .set(auth(studentUserId, organizationId))
      .send({ enrollment_id: foreignEnrollment });
    expect(foreign.status).toBe(403);
    const crossTenant = await request(app)
      .put("/api/student/current-enrollment")
      .set(auth(studentUserId, organizationId))
      .send({ enrollment_id: crossTenantEnrollment });
    expect(crossTenant.status).toBe(403);

    const changed = await request(app)
      .patch("/api/student/current-enrollment")
      .set(auth(studentUserId, organizationId))
      .send({ enrollment_id: enrollmentB });
    expect(changed.status).toBe(200);
    expect(changed.body.current_class.id).toBe(classB);
    expect(changed.body.enrollment.id).toBe(enrollmentB);

    const dashboard = await request(app).get("/api/student/dashboard").set(auth(studentUserId, organizationId));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.current_class.id).toBe(classB);
    expect(dashboard.body.classes.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([classA, classB]));

    const staffAttempt = await request(app)
      .put("/api/student/current-enrollment")
      .set(auth(adminId, organizationId))
      .send({ enrollment_id: enrollmentA });
    expect(staffAttempt.status).toBe(403);
  });

  it("explicitly designates one syllabus, switches both directions, and does not promote existing rows", async () => {
    const adminId = await user("us118-syllabus-admin");
    const studentUserId = await user("us118-syllabus-student");
    const organizationId = await organization(adminId, "US-118 syllabus organization");
    await member(adminId, organizationId, "SCHOOL_ADMIN");
    await member(studentUserId, organizationId, "STUDENT");
    const studentId = await student(organizationId, studentUserId, "Syllabus student");
    const classId = await klass(organizationId, adminId, "Syllabus class");
    const enrollmentId = await enrollment(organizationId, studentId, classId);
    const selected = await request(app)
      .put("/api/student/current-enrollment")
      .set(auth(studentUserId, organizationId))
      .send({ enrollment_id: enrollmentId });
    expect(selected.status).toBe(200);
    const subject = await pool.query(
      `INSERT INTO subjects (organization_id, name, code, status)
       VALUES ($1, 'Mathematics', $2, 'ACTIVE') RETURNING id`,
      [organizationId, `us118-subject-${randomUUID()}`]
    );
    created.subjects.push(subject.rows[0].id);
    await pool.query(
      `INSERT INTO class_subjects (organization_id, class_id, subject_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [organizationId, classId, subject.rows[0].id]
    );
    const board = (await pool.query("SELECT id FROM boards WHERE code = 'CBSE' LIMIT 1")).rows[0];
    const medium = (await pool.query("SELECT id FROM mediums WHERE code = 'EN' LIMIT 1")).rows[0];
    const syllabusA = await pool.query(
      `INSERT INTO syllabi (class_id, board_id, medium_id, name, code, status)
       VALUES ($1, $2, $3, 'Syllabus A', $4, 'ACTIVE') RETURNING id`,
      [classId, board.id, medium.id, `us118-a-${randomUUID()}`]
    );
    const syllabusB = await pool.query(
      `INSERT INTO syllabi (class_id, board_id, medium_id, name, code, status)
       VALUES ($1, $2, $3, 'Syllabus B', $4, 'ACTIVE') RETURNING id`,
      [classId, board.id, medium.id, `us118-b-${randomUUID()}`]
    );
    created.syllabi.push(syllabusA.rows[0].id, syllabusB.rows[0].id);

    const before = await pool.query(`SELECT is_authoritative FROM syllabi WHERE id = $1`, [syllabusA.rows[0].id]);
    expect(before.rows[0].is_authoritative).toBe(false);

    const denied = await request(app)
      .put(`/api/classes/${classId}/syllabus/${syllabusA.rows[0].id}/authoritative`)
      .set(auth(studentUserId, organizationId));
    expect(denied.status).toBe(403);

    const designated = await request(app)
      .put(`/api/classes/${classId}/syllabus/${syllabusA.rows[0].id}/authoritative`)
      .set(auth(adminId, organizationId));
    expect(designated.status).toBe(200);
    expect(designated.body.syllabus.is_authoritative).toBe(true);
    const rows = await pool.query(`SELECT id, is_authoritative FROM syllabi WHERE class_id = $1`, [classId]);
    expect(rows.rows.filter((row) => row.is_authoritative)).toHaveLength(1);
    expect(rows.rows.find((row) => row.id === syllabusA.rows[0].id).is_authoritative).toBe(true);

    const assembled = await new LearningContextService().assemble({
      organizationId,
      studentId,
      conversationId: randomUUID(),
      branchId: randomUUID(),
      history: [],
      scope: { subject: "Mathematics" },
    });
    expect(assembled.currentClass.id).toBe(classId);
    expect(assembled.authoritativeSyllabus.id).toBe(syllabusA.rows[0].id);
    expect(assembled.board.name).toBe("CBSE");
    expect(assembled.medium.name).toBe("English");
    expect(assembled.subject.name).toBe("Mathematics");

    const changed = await request(app)
      .patch(`/api/syllabus/${syllabusB.rows[0].id}/authoritative`)
      .set(auth(adminId, organizationId));
    expect(changed.status).toBe(200);
    const changedRows = await pool.query(`SELECT id, is_authoritative FROM syllabi WHERE class_id = $1`, [classId]);
    expect(changedRows.rows.find((row) => row.id === syllabusA.rows[0].id).is_authoritative).toBe(false);
    expect(changedRows.rows.find((row) => row.id === syllabusB.rows[0].id).is_authoritative).toBe(true);

    const changedBack = await request(app)
      .put(`/api/classes/${classId}/syllabus/${syllabusA.rows[0].id}/authoritative`)
      .set(auth(adminId, organizationId));
    expect(changedBack.status).toBe(200);
    expect(changedBack.body.syllabus.is_authoritative).toBe(true);

    const changedBackRows = await pool.query(`SELECT id, is_authoritative FROM syllabi WHERE class_id = $1`, [classId]);
    expect(changedBackRows.rows.filter((row) => row.is_authoritative)).toHaveLength(1);
    expect(changedBackRows.rows.find((row) => row.id === syllabusA.rows[0].id).is_authoritative).toBe(true);
    expect(changedBackRows.rows.find((row) => row.id === syllabusB.rows[0].id).is_authoritative).toBe(false);
  });
});
