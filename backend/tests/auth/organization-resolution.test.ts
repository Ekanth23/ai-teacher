import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();

const unique = (prefix: string) => `${prefix.slice(0, 20)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const created = {
  users: [] as string[],
  organizations: [] as string[],
  students: [] as string[],
  classes: [] as string[],
  subjects: [] as string[],
};

async function cleanup() {
  if (created.subjects.length) await pool.query("DELETE FROM subjects WHERE id = ANY($1::uuid[])", [created.subjects]);
  if (created.classes.length) {
    await pool.query("DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM student_enrollments WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  }
  if (created.students.length) {
    await pool.query("DELETE FROM student_enrollments WHERE student_id = ANY($1::uuid[])", [created.students]);
    await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
  }
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.users.length) {
    await pool.query("DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])", [created.users]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  }
  Object.values(created).forEach((ids) => { ids.length = 0; });
}

afterEach(cleanup);

async function createUser(label: string) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${unique(`orgres_${label}`)}@example.com`, `Org Res ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Org Res ${label}`, unique(`orgres_org_${label}`), ownerUserId]
  );
  created.organizations.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function addMember(userId: string, organizationId: string, roleName: string, status = "ACTIVE") {
  const role = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [roleName]);
  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     VALUES ($1, $2, $3, $4)`,
    [userId, organizationId, role.rows[0].id, status]
  );
}

async function createClass(organizationId: string, ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO classes (organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, `Org Res class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createStudent(organizationId: string, userId: string, classId: string, fullName: string, gradeLevel: string | null = null) {
  const student = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE') RETURNING id`,
    [userId, organizationId, fullName, gradeLevel]
  );
  created.students.push(student.rows[0].id);
  await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [organizationId, student.rows[0].id, classId]
  );
  return student.rows[0].id as string;
}

function dashboard(token: string) {
  return request(app).get("/api/student/dashboard").set("Authorization", `Bearer ${token}`);
}
describe("organization auto-resolution (single active membership)", () => {
  it("resolves a single active organization without X-Organization-Id", async () => {
    const studentUserId = await createUser("single");
    const orgId = await createOrganization(studentUserId, "school");
    await addMember(studentUserId, orgId, "STUDENT");
    const classId = await createClass(orgId, studentUserId, "8a");
    await createStudent(orgId, studentUserId, classId, "Alice Student", "8");

    const res = await dashboard(createAccessToken(studentUserId));
    expect(res.status).toBe(200);
    expect(res.body.current_class.name).toBe("Org Res class 8a");
  });

  it("fails closed with ORGANIZATION_REQUIRED for multiple active organizations", async () => {
    const studentUserId = await createUser("multi");
    const orgA = await createOrganization(studentUserId, "a");
    const orgB = await createOrganization(studentUserId, "b");
    await addMember(studentUserId, orgA, "STUDENT");
    await addMember(studentUserId, orgB, "STUDENT");

    const res = await dashboard(createAccessToken(studentUserId));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORGANIZATION_REQUIRED");
  });

  it("fails closed when the user has zero active organizations", async () => {
    const userId = await createUser("zero");

    const res = await dashboard(createAccessToken(userId));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORGANIZATION_REQUIRED");
  });

  it("still honors an explicit valid X-Organization-Id", async () => {
    const studentUserId = await createUser("explicit");
    const orgId = await createOrganization(studentUserId, "school");
    await addMember(studentUserId, orgId, "STUDENT");
    const classId = await createClass(orgId, studentUserId, "8a");
    await createStudent(orgId, studentUserId, classId, "Alice Student", "8");

    const res = await dashboard(createAccessToken(studentUserId)).set("x-organization-id", orgId);
    expect(res.status).toBe(200);
  });
  it("blocks an explicit organization the user is not a member of", async () => {
    const studentUserId = await createUser("cross");
    const orgA = await createOrganization(studentUserId, "school");
    await addMember(studentUserId, orgA, "STUDENT");
    const classA = await createClass(orgA, studentUserId, "8a");
    await createStudent(orgA, studentUserId, classA, "Alice Student", "8");

    const otherAdmin = await createUser("other-admin");
    const orgB = await createOrganization(otherAdmin, "other");
    await addMember(otherAdmin, orgB, "SCHOOL_ADMIN");

    const res = await dashboard(createAccessToken(studentUserId)).set("x-organization-id", orgB);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("does not auto-resolve an inactive membership", async () => {
    const studentUserId = await createUser("inactive");
    const orgId = await createOrganization(studentUserId, "school");
    await addMember(studentUserId, orgId, "STUDENT", "INACTIVE");

    const res = await dashboard(createAccessToken(studentUserId));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORGANIZATION_REQUIRED");
  });

  it("derives student identity from the authenticated user, not client input", async () => {
    const studentUserId = await createUser("identity");
    const orgId = await createOrganization(studentUserId, "school");
    await addMember(studentUserId, orgId, "STUDENT");
    const classId = await createClass(orgId, studentUserId, "8a");
    const studentId = await createStudent(orgId, studentUserId, classId, "Alice Student", "8");

    const res = await dashboard(createAccessToken(studentUserId)).query({
      student_id: "00000000-0000-4000-8000-000000000000",
      organization_id: "00000000-0000-4000-8000-000000000001",
    });
    expect(res.status).toBe(200);
    expect(res.body.student.id).toBe(studentId);
    expect(res.body.student.full_name).toBe("Alice Student");
  });

  it("preserves cross-tenant isolation for class-scoped student access", async () => {
    const studentUserId = await createUser("tenant");
    const orgA = await createOrganization(studentUserId, "school");
    await addMember(studentUserId, orgA, "STUDENT");
    const classA = await createClass(orgA, studentUserId, "8a");
    await createStudent(orgA, studentUserId, classA, "Alice Student", "8");

    const otherAdmin = await createUser("tenant-other");
    const orgB = await createOrganization(otherAdmin, "other");
    await addMember(otherAdmin, orgB, "SCHOOL_ADMIN");
    const classB = await createClass(orgB, otherAdmin, "9b");

    const res = await request(app)
      .get(`/api/student/classes/${classB}/subjects`)
      .set("Authorization", `Bearer ${createAccessToken(studentUserId)}`);
    expect(res.status).toBe(403);
  });
});


