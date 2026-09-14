import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { seedDevStudent } from "../../scripts/seed-dev-student.js";

const unique = (prefix: string) => `${prefix.slice(0, 20)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DEV_STUDENT_EMAIL: process.env.DEV_STUDENT_EMAIL,
  DEV_STUDENT_PASSWORD: process.env.DEV_STUDENT_PASSWORD,
};

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function restoreEnv() {
  setEnv("NODE_ENV", originalEnv.NODE_ENV);
  setEnv("DEV_STUDENT_EMAIL", originalEnv.DEV_STUDENT_EMAIL);
  setEnv("DEV_STUDENT_PASSWORD", originalEnv.DEV_STUDENT_PASSWORD);
}

let activeSeed: { organizationId: string; userId: string } | null = null;

async function cleanupSeeded(organizationId: string, userId: string) {
  await pool.query("DELETE FROM student_enrollments WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM class_subjects WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM subjects WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM classes WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM students_v2 WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_members WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

afterEach(async () => {
  restoreEnv();
  if (activeSeed) {
    await cleanupSeeded(activeSeed.organizationId, activeSeed.userId);
    activeSeed = null;
  }
});

describe("development student seed", () => {
  it("is rejected when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    await expect(seedDevStudent({ email: "nobody@example.com", password: "secret" })).rejects.toThrow(
      /NODE_ENV=development/
    );
  });

  it("is rejected when NODE_ENV is unset", async () => {
    delete process.env.NODE_ENV;
    await expect(seedDevStudent({ email: "nobody@example.com", password: "secret" })).rejects.toThrow(
      /NODE_ENV=development/
    );
  });

  it("creates a complete student/org/class/enrollment graph", async () => {
    process.env.NODE_ENV = "development";
    const email = `seed-${unique("user")}@example.com`;
    const password = "StrongSeededPassword123!";
    const slug = unique("devorg");

    const summary = await seedDevStudent({ email, password, organizationSlug: slug });
    activeSeed = { organizationId: summary.organizationId, userId: summary.userId };

    const user = await pool.query("SELECT status FROM users WHERE id = $1", [summary.userId]);
    expect(user.rows).toHaveLength(1);
    expect(user.rows[0].status).toBe("ACTIVE");

    const member = await pool.query(
      `SELECT r.name AS role, om.status
       FROM organization_members om
       JOIN roles r ON r.id = om.role_id
       WHERE om.user_id = $1 AND om.organization_id = $2`,
      [summary.userId, summary.organizationId]
    );
    expect(member.rows).toHaveLength(1);
    expect(member.rows[0].role).toBe("STUDENT");
    expect(member.rows[0].status).toBe("ACTIVE");

    const student = await pool.query("SELECT status FROM students_v2 WHERE id = $1", [summary.studentId]);
    expect(student.rows).toHaveLength(1);
    expect(student.rows[0].status).toBe("ACTIVE");

    const cls = await pool.query("SELECT status FROM classes WHERE id = $1", [summary.classId]);
    expect(cls.rows).toHaveLength(1);

    const enrollment = await pool.query(
      "SELECT status FROM student_enrollments WHERE student_id = $1 AND class_id = $2",
      [summary.studentId, summary.classId]
    );
    expect(enrollment.rows).toHaveLength(1);
    expect(enrollment.rows[0].status).toBe("ACTIVE");

    const subject = await pool.query("SELECT status FROM subjects WHERE id = $1", [summary.subjectId]);
    expect(subject.rows).toHaveLength(1);
  });

  it("is idempotent when run twice", async () => {
    process.env.NODE_ENV = "development";
    const email = `seed-${unique("user")}@example.com`;
    const password = "StrongSeededPassword123!";
    const slug = unique("devorg");

    const first = await seedDevStudent({ email, password, organizationSlug: slug });
    activeSeed = { organizationId: first.organizationId, userId: first.userId };

    const second = await seedDevStudent({ email, password, organizationSlug: slug });

    expect(second.organizationId).toBe(first.organizationId);
    expect(second.userId).toBe(first.userId);
    expect(second.studentId).toBe(first.studentId);
    expect(second.classId).toBe(first.classId);
    expect(second.subjectId).toBe(first.subjectId);

    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM users WHERE id = $1) AS users,
         (SELECT COUNT(*)::int FROM organizations WHERE id = $2) AS organizations,
         (SELECT COUNT(*)::int FROM organization_members WHERE organization_id = $2) AS members,
         (SELECT COUNT(*)::int FROM students_v2 WHERE organization_id = $2) AS students,
         (SELECT COUNT(*)::int FROM student_enrollments WHERE organization_id = $2) AS enrollments`,
      [first.userId, first.organizationId]
    );
    expect(counts.rows[0]).toEqual({
      users: 1,
      organizations: 1,
      members: 1,
      students: 1,
      enrollments: 1,
    });
  });
});
