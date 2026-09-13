import pool from "../../db.js";
import type { CreateReportDefinitionInput, UpdateReportDefinitionInput } from "./types.js";

// ---------------------------------------------------------------------------
// Report definitions (organization-scoped, reusable custom report config)
// ---------------------------------------------------------------------------

export const createDefinition = (organizationId: string, createdByUserId: string, input: CreateReportDefinitionInput) =>
  pool.query(
    `INSERT INTO report_definitions (organization_id, created_by_user_id, name, description, configuration)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [organizationId, createdByUserId, input.name.trim(), input.description ?? null, JSON.stringify(input.configuration ?? {})]
  );

export const listDefinitions = (organizationId: string) =>
  pool.query(
    `SELECT * FROM report_definitions WHERE organization_id = $1 ORDER BY created_at DESC`,
    [organizationId]
  );

export const getDefinition = (id: string, organizationId: string) =>
  pool.query(
    `SELECT * FROM report_definitions WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, organizationId]
  );

export const updateDefinition = (id: string, organizationId: string, input: UpdateReportDefinitionInput) => {
  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${index++}`);
    values.push(input.name.trim());
  }
  if (input.description !== undefined) {
    fields.push(`description = $${index++}`);
    values.push(input.description ?? null);
  }
  if (input.configuration !== undefined) {
    fields.push(`configuration = $${index++}`);
    values.push(JSON.stringify(input.configuration ?? {}));
  }
  if (input.status !== undefined) {
    fields.push(`status = $${index++}`);
    values.push(input.status);
  }

  if (fields.length === 0) {
    return pool.query(
      `SELECT * FROM report_definitions WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
  }

  fields.push(`updated_at = now()`);
  values.push(id, organizationId);

  return pool.query(
    `UPDATE report_definitions SET ${fields.join(", ")} WHERE id = $${index++} AND organization_id = $${index++} RETURNING *`,
    values
  );
};

// ---------------------------------------------------------------------------
// Institution-level aggregations (derived from canonical domain tables)
// ---------------------------------------------------------------------------

export const institutionCounts = (organizationId: string) =>
  pool.query(
    `SELECT
       (SELECT count(*)::int FROM students_v2 WHERE organization_id = $1 AND status = 'ACTIVE') AS students,
       (SELECT count(*)::int FROM classes WHERE organization_id = $1 AND status = 'ACTIVE') AS classes,
       (SELECT count(*)::int FROM teachers WHERE organization_id = $1 AND status = 'ACTIVE') AS teachers,
       (SELECT count(*)::int FROM subjects WHERE organization_id = $1 AND status = 'ACTIVE') AS subjects,
       (SELECT count(*)::int FROM student_enrollments WHERE organization_id = $1 AND status = 'ACTIVE') AS enrollments,
       (SELECT count(*)::int FROM assessment_events WHERE organization_id = $1 AND status = 'SCHEDULED' AND scheduled_start >= now()) AS upcoming_assessments,
       (SELECT count(*)::int FROM learning_resources WHERE organization_id = $1 AND status = 'PUBLISHED') AS published_resources`,
    [organizationId]
  );

export const studentsByGrade = (organizationId: string) =>
  pool.query(
    `SELECT COALESCE(NULLIF(btrim(grade_level), ''), 'Unassigned') AS grade,
            count(*)::int AS students
     FROM students_v2
     WHERE organization_id = $1 AND status = 'ACTIVE'
     GROUP BY 1
     ORDER BY 1`,
    [organizationId]
  );

export const enrollmentsByGrade = (organizationId: string) =>
  pool.query(
    `SELECT COALESCE(NULLIF(btrim(s.grade_level), ''), 'Unassigned') AS grade,
            count(*)::int AS enrollments
     FROM student_enrollments se
     JOIN students_v2 s ON s.id = se.student_id
     WHERE se.organization_id = $1 AND se.status = 'ACTIVE'
     GROUP BY 1`,
    [organizationId]
  );

export const classSummaries = (organizationId: string) =>
  pool.query(
    `SELECT c.id, c.name, c.section, c.academic_year,
            count(DISTINCT se.student_id)::int AS students,
            count(DISTINCT cs.subject_id)::int AS subjects,
            count(DISTINCT cta.teacher_id)::int AS teachers,
            (SELECT count(*)::int FROM assessment_events ae
              WHERE ae.class_id = c.id AND ae.status = 'SCHEDULED' AND ae.scheduled_start >= now()) AS upcoming_assessments
     FROM classes c
     LEFT JOIN student_enrollments se ON se.class_id = c.id AND se.status = 'ACTIVE'
     LEFT JOIN class_subjects cs ON cs.class_id = c.id AND cs.status = 'ACTIVE'
     LEFT JOIN class_teacher_assignments cta ON cta.class_id = c.id AND cta.status = 'ACTIVE'
     WHERE c.organization_id = $1 AND c.status = 'ACTIVE'
     GROUP BY c.id
     ORDER BY c.name`,
    [organizationId]
  );

export const subjectSummaries = (organizationId: string) =>
  pool.query(
    `SELECT s.id, s.name, s.code,
            count(DISTINCT cs.class_id)::int AS classes,
            (SELECT count(*)::int FROM assessment_events ae
              WHERE ae.subject_id = s.id AND ae.status = 'SCHEDULED' AND ae.scheduled_start >= now()) AS upcoming_assessments
     FROM subjects s
     LEFT JOIN class_subjects cs ON cs.subject_id = s.id AND cs.status = 'ACTIVE'
     WHERE s.organization_id = $1 AND s.status = 'ACTIVE'
     GROUP BY s.id
     ORDER BY s.name`,
    [organizationId]
  );

export const upcomingAssessments = (organizationId: string, limit = 20) =>
  pool.query(
    `SELECT ae.id, ae.title, ae.class_id, c.name AS class_name, s.name AS subject_name,
            ae.scheduled_start, ae.scheduled_end, ae.status
     FROM assessment_events ae
     JOIN classes c ON c.id = ae.class_id
     LEFT JOIN subjects s ON s.id = ae.subject_id
     WHERE ae.organization_id = $1
       AND ae.status = 'SCHEDULED'
       AND ae.scheduled_start >= now()
     ORDER BY ae.scheduled_start ASC
     LIMIT $2`,
    [organizationId, limit]
  );

// ---------------------------------------------------------------------------
// Structural "needs attention" signals (real, grounded data only)
// ---------------------------------------------------------------------------

export const classesWithoutTeacher = (organizationId: string) =>
  pool.query(
    `SELECT c.id, c.name, c.section, c.academic_year
     FROM classes c
     WHERE c.organization_id = $1 AND c.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM class_teacher_assignments cta WHERE cta.class_id = c.id AND cta.status = 'ACTIVE')
     ORDER BY c.name`,
    [organizationId]
  );

export const classesWithoutSubjects = (organizationId: string) =>
  pool.query(
    `SELECT c.id, c.name, c.section, c.academic_year
     FROM classes c
     WHERE c.organization_id = $1 AND c.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id = c.id AND cs.status = 'ACTIVE')
     ORDER BY c.name`,
    [organizationId]
  );

export const unenrolledStudents = (organizationId: string) =>
  pool.query(
    `SELECT s.id, s.full_name, s.grade_level, s.enrollment_number
     FROM students_v2 s
     WHERE s.organization_id = $1 AND s.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM student_enrollments se WHERE se.student_id = s.id AND se.status = 'ACTIVE')
     ORDER BY s.full_name`,
    [organizationId]
  );

