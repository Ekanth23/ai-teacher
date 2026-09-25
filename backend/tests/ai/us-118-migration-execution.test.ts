import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

const migration48Url = new URL("../../migrations/048_add_current_enrollment_selection.sql", import.meta.url);
const migration49Url = new URL("../../migrations/049_add_authoritative_syllabus_designation.sql", import.meta.url);
const clients: Client[] = [];
const schemas: string[] = [];

function dbConfig() {
  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
  };
}

async function isolatedClient(prefix: string) {
  const schema = `${prefix}_${randomUUID().replace(/-/g, "")}`;
  const client = new Client(dbConfig());
  clients.push(client);
  schemas.push(schema);
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  return client;
}

async function createAcademicFixture(client: Client) {
  await client.query(`
    CREATE TABLE students_v2 (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      organization_id UUID NOT NULL,
      full_name TEXT NOT NULL,
      grade_level TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX ux_students_v2_id_organization
      ON students_v2 (id, organization_id);
    CREATE TABLE classes (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE student_enrollments (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL,
      student_id UUID NOT NULL,
      class_id UUID NOT NULL,
      academic_year TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

afterEach(async () => {
  const pendingSchemas = schemas.splice(0);
  for (const client of clients.splice(0)) {
    for (const schema of pendingSchemas) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
});

describe("US-118 executable migration compatibility", () => {
  it("upgrades 048 with null selection, enforces ownership, and reruns safely", async () => {
    const client = await isolatedClient("us118_migration048");
    await createAcademicFixture(client);
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const studentId = randomUUID();
    const otherStudentId = randomUUID();
    const classId = randomUUID();
    const otherClassId = randomUUID();
    const enrollmentId = randomUUID();
    const foreignEnrollmentId = randomUUID();
    await client.query(
      `INSERT INTO students_v2 (id, user_id, organization_id, full_name)
       VALUES ($1, $2, $3, 'Student'), ($4, $5, $6, 'Other')`,
      [studentId, randomUUID(), organizationId, otherStudentId, randomUUID(), otherOrganizationId]
    );
    await client.query(
      `INSERT INTO classes (id, organization_id, name)
       VALUES ($1, $2, 'Class 8'), ($3, $4, 'Other Class')`,
      [classId, organizationId, otherClassId, otherOrganizationId]
    );
    await client.query(
      `INSERT INTO student_enrollments (id, organization_id, student_id, class_id)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [enrollmentId, organizationId, studentId, classId, foreignEnrollmentId, otherOrganizationId, otherStudentId, otherClassId]
    );

    const migration = await readFile(migration48Url, "utf8");
    await client.query(migration);
    await client.query(migration);

    const initial = await client.query(
      `SELECT current_enrollment_id FROM students_v2 WHERE id = $1`,
      [studentId]
    );
    expect(initial.rows[0].current_enrollment_id).toBeNull();

    await client.query(
      `UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`,
      [enrollmentId, studentId]
    );
    const selected = await client.query(
      `SELECT current_enrollment_id FROM students_v2 WHERE id = $1`,
      [studentId]
    );
    expect(selected.rows[0].current_enrollment_id).toBe(enrollmentId);

    await expect(
      client.query(
        `UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`,
        [foreignEnrollmentId, studentId]
      )
    ).rejects.toMatchObject({ code: expect.stringMatching(/23503|P0001/) });

    await client.query(`UPDATE student_enrollments SET status = 'INACTIVE' WHERE id = $1`, [enrollmentId]);
    await expect(
      client.query(
        `UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`,
        [enrollmentId, studentId]
      )
    ).rejects.toMatchObject({ code: "P0001" });

    await client.query(`DELETE FROM student_enrollments WHERE id = $1`, [enrollmentId]);
    const cleared = await client.query(
      `SELECT current_enrollment_id FROM students_v2 WHERE id = $1`,
      [studentId]
    );
    expect(cleared.rows[0].current_enrollment_id).toBeNull();
  });

  it("composes with the migration runner transaction without committing early", async () => {
    const client = await isolatedClient("us118_runner_tx_048");
    await createAcademicFixture(client);
    const organizationId = randomUUID();
    const studentId = randomUUID();
    const classId = randomUUID();
    await client.query(
      `INSERT INTO students_v2 (id, user_id, organization_id, full_name)
       VALUES ($1, $2, $3, 'Student')`,
      [studentId, randomUUID(), organizationId]
    );
    await client.query(`INSERT INTO classes (id, organization_id, name) VALUES ($1, $2, 'Class 8')`, [classId, organizationId]);
    const migration = await readFile(migration48Url, "utf8");
    await client.query("BEGIN");
    await client.query(migration);
    expect((await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'students_v2'
          AND column_name = 'current_enrollment_id'`
    )).rows).toHaveLength(1);
    await client.query("ROLLBACK");
    expect((await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'students_v2'
          AND column_name = 'current_enrollment_id'`
    )).rows).toHaveLength(0);
  });

  it("clears a selected enrollment safely through enrollment, student, and class cascades", async () => {
    const client = await isolatedClient("us118_migration048_cascade");
    await createAcademicFixture(client);
    const organizationId = randomUUID();
    const studentId = randomUUID();
    const classId = randomUUID();
    const enrollmentId = randomUUID();
    await client.query(
      `INSERT INTO students_v2 (id, user_id, organization_id, full_name)
       VALUES ($1, $2, $3, 'Student')`,
      [studentId, randomUUID(), organizationId]
    );
    await client.query(
      `INSERT INTO classes (id, organization_id, name) VALUES ($1, $2, 'Class 8')`,
      [classId, organizationId]
    );
    await client.query(
      `INSERT INTO student_enrollments (id, organization_id, student_id, class_id)
       VALUES ($1, $2, $3, $4)`,
      [enrollmentId, organizationId, studentId, classId]
    );
    const migration = await readFile(migration48Url, "utf8");
    await client.query(migration);
    await client.query(`UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`, [enrollmentId, studentId]);

    await client.query(`DELETE FROM student_enrollments WHERE id = $1`, [enrollmentId]);
    expect((await client.query(`SELECT current_enrollment_id FROM students_v2 WHERE id = $1`, [studentId])).rows[0].current_enrollment_id).toBeNull();

    await client.query(
      `INSERT INTO student_enrollments (id, organization_id, student_id, class_id)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), organizationId, studentId, classId]
    );
    const secondEnrollment = await client.query(
      `SELECT id FROM student_enrollments WHERE student_id = $1 AND class_id = $2`,
      [studentId, classId]
    );
    await client.query(`UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`, [secondEnrollment.rows[0].id, studentId]);
    await client.query(`DELETE FROM classes WHERE id = $1`, [classId]);
    expect((await client.query(`SELECT current_enrollment_id FROM students_v2 WHERE id = $1`, [studentId])).rows[0].current_enrollment_id).toBeNull();

    const thirdClass = randomUUID();
    await client.query(`INSERT INTO classes (id, organization_id, name) VALUES ($1, $2, 'Class 9')`, [thirdClass, organizationId]);
    const thirdEnrollment = randomUUID();
    await client.query(
      `INSERT INTO student_enrollments (id, organization_id, student_id, class_id)
       VALUES ($1, $2, $3, $4)`,
      [thirdEnrollment, organizationId, studentId, thirdClass]
    );
    await client.query(`UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`, [thirdEnrollment, studentId]);
    await client.query(`DELETE FROM students_v2 WHERE id = $1`, [studentId]);
    const remaining = await client.query(`SELECT COUNT(*)::int AS count FROM student_enrollments WHERE id = $1`, [thirdEnrollment]);
    expect(remaining.rows[0].count).toBe(0);
  });

  it("rejects a cross-tenant enrollment row after 048", async () => {
    const client = await isolatedClient("us118_migration048_tenant");
    await createAcademicFixture(client);
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const studentA = randomUUID();
    const classB = randomUUID();
    await client.query(
      `INSERT INTO students_v2 (id, user_id, organization_id, full_name)
       VALUES ($1, $2, $3, 'A')`,
      [studentA, randomUUID(), organizationA]
    );
    await client.query(`INSERT INTO classes (id, organization_id, name) VALUES ($1, $2, 'B')`, [classB, organizationB]);
    const migration = await readFile(migration48Url, "utf8");
    await client.query(migration);
    await expect(
      client.query(
        `INSERT INTO student_enrollments (id, organization_id, student_id, class_id)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), organizationB, studentA, classB]
      )
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("upgrades 049 without promoting existing rows and enforces one designation", async () => {
    const client = await isolatedClient("us118_migration049");
    await client.query(`
      CREATE TABLE syllabi (
        id UUID PRIMARY KEY,
        class_id UUID NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    const classId = randomUUID();
    const existingSyllabusId = randomUUID();
    const secondSyllabusId = randomUUID();
    await client.query(
      `INSERT INTO syllabi (id, class_id, name) VALUES ($1, $2, 'Existing')`,
      [existingSyllabusId, classId]
    );

    const migration = await readFile(migration49Url, "utf8");
    await client.query(migration);
    await client.query(migration);

    const existing = await client.query(`SELECT is_authoritative FROM syllabi WHERE id = $1`, [existingSyllabusId]);
    expect(existing.rows[0].is_authoritative).toBe(false);
    await client.query(`UPDATE syllabi SET is_authoritative = TRUE WHERE id = $1`, [existingSyllabusId]);
    await client.query(`INSERT INTO syllabi (id, class_id, name) VALUES ($1, $2, 'Second')`, [secondSyllabusId, classId]);
    await expect(
      client.query(`UPDATE syllabi SET is_authoritative = TRUE WHERE id = $1`, [secondSyllabusId])
    ).rejects.toMatchObject({ code: "23505" });
  });
});
