import bcrypt from "bcryptjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../src/db.js";

// Stable development fixture identifiers. The email/password are supplied via
// DEV_STUDENT_EMAIL / DEV_STUDENT_PASSWORD (never hard-coded) and passed in by
// the CLI entry point or, for isolated tests, by the caller.
const DEFAULT_ORGANIZATION_NAME = "Dev Student Academy";
const DEFAULT_ORGANIZATION_SLUG = "dev-student-academy";
const STUDENT_FULL_NAME = "Dev Student";
const GRADE_LEVEL = "8";
const CLASS_NAME = "Grade 8";
const CLASS_SECTION = "A";
const ACADEMIC_YEAR = "2026-27";
const SUBJECT_NAME = "Mathematics";
const SUBJECT_CODE = "MATH";

export interface SeedDevStudentInput {
  email: string;
  password: string;
  organizationName?: string;
  organizationSlug?: string;
}

export interface SeedDevStudentSummary {
  email: string;
  organizationId: string;
  userId: string;
  studentId: string;
  classId: string;
  subjectId: string;
}

function assertDevelopmentMode() {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== "development") {
    throw new Error(
      `Development seed requires NODE_ENV=development (current: ${nodeEnv ?? "<unset>"}). Refusing to run.`
    );
  }
}

export async function seedDevStudent(input: SeedDevStudentInput): Promise<SeedDevStudentSummary> {
  assertDevelopmentMode();

  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error("A non-empty student email is required.");
  }
  if (!input.password) {
    throw new Error("A non-empty student password is required.");
  }

  const organizationName = input.organizationName ?? DEFAULT_ORGANIZATION_NAME;
  const organizationSlug = input.organizationSlug ?? DEFAULT_ORGANIZATION_SLUG;

  const passwordHash = await bcrypt.hash(input.password, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Active student user (stable email).
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             full_name = EXCLUDED.full_name,
             status = 'ACTIVE',
             updated_at = NOW()
       RETURNING id, email`,
      [email, passwordHash, STUDENT_FULL_NAME]
    );
    const userId: string = userResult.rows[0].id;

    // 2. Development organization (stable slug).
    const orgResult = await client.query(
      `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
       VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             status = 'ACTIVE',
             updated_at = NOW()
       RETURNING id`,
      [organizationName, organizationSlug, userId]
    );
    const organizationId: string = orgResult.rows[0].id;

    // 3. STUDENT membership (reuses the migration-seeded role).
    const roleResult = await client.query(`SELECT id FROM roles WHERE name = 'STUDENT' LIMIT 1`);
    if (roleResult.rows.length === 0) {
      throw new Error("STUDENT role is missing; run migrations before seeding.");
    }
    const studentRoleId: string = roleResult.rows[0].id;
    await client.query(
      `INSERT INTO organization_members (user_id, organization_id, role_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (user_id, organization_id) DO UPDATE
         SET role_id = EXCLUDED.role_id,
             status = 'ACTIVE',
             updated_at = NOW()`,
      [userId, organizationId, studentRoleId]
    );
    // 4. students_v2 record (one per organization + user).
    const studentResult = await client.query(
      `INSERT INTO students_v2 (organization_id, user_id, full_name, grade_level, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             grade_level = COALESCE(EXCLUDED.grade_level, students_v2.grade_level),
             status = 'ACTIVE',
             updated_at = NOW()
       RETURNING id`,
      [organizationId, userId, STUDENT_FULL_NAME, GRADE_LEVEL]
    );
    const studentId: string = studentResult.rows[0].id;

    // 5. Class (find-or-create by organization + name + section + academic year).
    const classLookup = await client.query(
      `SELECT id FROM classes
       WHERE organization_id = $1
         AND lower(name) = lower($2)
         AND COALESCE(section, '') = COALESCE($3, '')
         AND COALESCE(academic_year, '') = COALESCE($4, '')
       LIMIT 1`,
      [organizationId, CLASS_NAME, CLASS_SECTION, ACADEMIC_YEAR]
    );
    let classId: string;
    if (classLookup.rows.length > 0) {
      classId = classLookup.rows[0].id;
    } else {
      const classResult = await client.query(
        `INSERT INTO classes (organization_id, name, section, academic_year, status, created_by_user_id)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
         RETURNING id`,
        [organizationId, CLASS_NAME, CLASS_SECTION, ACADEMIC_YEAR, userId]
      );
      classId = classResult.rows[0].id;
    }

    // 6. Active enrollment (reuse if already present).
    const enrollmentLookup = await client.query(
      `SELECT id FROM student_enrollments
       WHERE organization_id = $1 AND student_id = $2 AND class_id = $3 AND status = 'ACTIVE'
       LIMIT 1`,
      [organizationId, studentId, classId]
    );
    if (enrollmentLookup.rows.length === 0) {
      await client.query(
        `INSERT INTO student_enrollments (organization_id, student_id, class_id, academic_year, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')`,
        [organizationId, studentId, classId, ACADEMIC_YEAR]
      );
    }

    // 7. Subject + class mapping so the dashboard shows a meaningful "My Subjects".
    const subjectLookup = await client.query(
      `SELECT id FROM subjects WHERE organization_id = $1 AND lower(name) = lower($2) LIMIT 1`,
      [organizationId, SUBJECT_NAME]
    );
    let subjectId: string;
    if (subjectLookup.rows.length > 0) {
      subjectId = subjectLookup.rows[0].id;
    } else {
      const subjectResult = await client.query(
        `INSERT INTO subjects (organization_id, name, code, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         RETURNING id`,
        [organizationId, SUBJECT_NAME, SUBJECT_CODE]
      );
      subjectId = subjectResult.rows[0].id;
    }

    await client.query(
      `INSERT INTO class_subjects (organization_id, class_id, subject_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (organization_id, class_id, subject_id) DO UPDATE
         SET status = 'ACTIVE', updated_at = NOW()`,
      [organizationId, classId, subjectId]
    );

    await client.query("COMMIT");

    return { email, organizationId, userId, studentId, classId, subjectId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function printSummary(summary: SeedDevStudentSummary) {
  console.log("Development student seed complete.");
  console.log(`  Email:           ${summary.email}`);
  console.log(`  Organization ID: ${summary.organizationId}`);
  console.log(`  Class ID:        ${summary.classId}`);
  console.log(`  Subject ID:      ${summary.subjectId}`);
  console.log("  Password:        supplied via DEV_STUDENT_PASSWORD (not printed).");
}

async function main() {
  try {
    assertDevelopmentMode();
    const email = (process.env.DEV_STUDENT_EMAIL ?? "").trim();
    const password = process.env.DEV_STUDENT_PASSWORD ?? "";
    if (!email || !password) {
      throw new Error("DEV_STUDENT_EMAIL and DEV_STUDENT_PASSWORD must be set.");
    }
    const summary = await seedDevStudent({ email, password });
    printSummary(summary);
  } catch (error) {
    console.error("Development seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const thisPath = fileURLToPath(import.meta.url);
const isDirectRun = invokedPath !== "" && thisPath.toLowerCase() === invokedPath.toLowerCase();

if (isDirectRun) {
  void main();
}

