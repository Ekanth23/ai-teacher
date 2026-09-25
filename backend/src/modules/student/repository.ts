import pool from "../../db.js";

// Canonical student identity resolved from the authenticated user within an
// organization. Never trusts a client-supplied student_id.
export const getStudentByUser = (organizationId: string, userId: string) =>
  pool.query(
    `SELECT id, user_id, organization_id, full_name, grade_level, status
     FROM students_v2
     WHERE organization_id = $1 AND user_id = $2 AND status = 'ACTIVE'
     LIMIT 1`,
    [organizationId, userId]
  );

// Active class enrollments for a student (their own classes only).
export const listActiveEnrollmentsForStudent = (organizationId: string, studentId: string) =>
  pool.query(
    `SELECT c.id, c.name, c.section
     FROM student_enrollments se
     JOIN classes c ON c.id = se.class_id AND c.organization_id = se.organization_id
     WHERE se.student_id = $1
       AND se.organization_id = $2
       AND se.status = 'ACTIVE'
     ORDER BY c.name ASC`,
    [studentId, organizationId]
  );

export type CurrentEnrollmentRow = {
  current_enrollment_id: string | null;
  enrollment_id: string | null;
  enrollment_status: string | null;
  academic_year: string | null;
  class_id: string | null;
  class_name: string | null;
  class_section: string | null;
  class_status: string | null;
  class_organization_id: string | null;
  student_organization_id: string | null;
  student_grade_level: string | null;
};

/**
 * Resolve only the explicitly selected enrollment.  The LEFT JOINs are
 * intentional: a non-NULL selection that is stale, inactive, deleted, or
 * foreign is represented as unresolved instead of being replaced by another
 * active enrollment. There is deliberately no ordering or fallback row.
 */
export const getCurrentEnrollmentForStudent = (organizationId: string, studentId: string) =>
  pool.query<CurrentEnrollmentRow>(
    `SELECT s.current_enrollment_id,
            se.id AS enrollment_id,
            se.status AS enrollment_status,
            se.academic_year,
            c.id AS class_id,
            c.name AS class_name,
            c.section AS class_section,
            c.status AS class_status,
            c.organization_id AS class_organization_id,
            s.organization_id AS student_organization_id,
            s.grade_level AS student_grade_level
       FROM students_v2 s
       LEFT JOIN student_enrollments se
         ON se.id = s.current_enrollment_id
        AND se.student_id = s.id
        AND se.organization_id = s.organization_id
       LEFT JOIN classes c
         ON c.id = se.class_id
        AND c.organization_id = se.organization_id
      WHERE s.id = $1
        AND s.organization_id = $2
        AND s.status = 'ACTIVE'
      LIMIT 1`,
    [studentId, organizationId]
  );

export type StudentEnrollmentRow = {
  enrollment_id: string;
  class_id: string;
  class_name: string;
  class_section: string | null;
  enrollment_status: string;
  class_status: string;
  academic_year: string | null;
  is_current: boolean;
};

/** Active enrollments with the explicit-selection marker used by student APIs. */
export const listStudentEnrollments = (organizationId: string, studentId: string) =>
  pool.query<StudentEnrollmentRow>(
    `SELECT se.id AS enrollment_id,
            c.id AS class_id,
            c.name AS class_name,
            c.section AS class_section,
            se.status AS enrollment_status,
            c.status AS class_status,
            se.academic_year,
            (s.current_enrollment_id = se.id) AS is_current
       FROM students_v2 s
       JOIN student_enrollments se
         ON se.student_id = s.id
        AND se.organization_id = s.organization_id
       JOIN classes c
         ON c.id = se.class_id
        AND c.organization_id = se.organization_id
      WHERE s.id = $1
        AND s.organization_id = $2
        AND s.status = 'ACTIVE'
        AND se.status = 'ACTIVE'
        AND c.status = 'ACTIVE'
      ORDER BY c.name ASC, se.id ASC`,
    [studentId, organizationId]
  );

/**
 * Change the student's explicit current enrollment.  The EXISTS predicate
 * repeats ownership, tenant, active-enrollment, and active-class checks in
 * the write statement so a concurrent lifecycle change cannot select an
 * invalid row between validation and update.
 */
export const setCurrentEnrollmentForStudent = (
  organizationId: string,
  studentId: string,
  enrollmentId: string
) =>
  pool.query<CurrentEnrollmentRow>(
    `WITH updated AS (
       UPDATE students_v2 s
          SET current_enrollment_id = $3,
              updated_at = NOW()
        WHERE s.id = $2
          AND s.organization_id = $1
          AND s.status = 'ACTIVE'
          AND EXISTS (
            SELECT 1
              FROM student_enrollments se
              JOIN classes c
                ON c.id = se.class_id
               AND c.organization_id = se.organization_id
             WHERE se.id = $3
               AND se.student_id = s.id
               AND se.organization_id = s.organization_id
               AND se.status = 'ACTIVE'
               AND c.status = 'ACTIVE'
          )
        RETURNING s.id, s.organization_id, s.current_enrollment_id, s.grade_level
     )
     SELECT updated.current_enrollment_id,
            se.id AS enrollment_id,
            se.status AS enrollment_status,
            se.academic_year,
            c.id AS class_id,
            c.name AS class_name,
            c.section AS class_section,
            c.status AS class_status,
            c.organization_id AS class_organization_id,
             updated.organization_id AS student_organization_id,
             updated.grade_level AS student_grade_level
       FROM updated
       JOIN student_enrollments se
         ON se.id = updated.current_enrollment_id
        AND se.student_id = updated.id
        AND se.organization_id = updated.organization_id
       JOIN classes c
         ON c.id = se.class_id
        AND c.organization_id = se.organization_id
      LIMIT 1`,
    [organizationId, studentId, enrollmentId]
  );

export const getCurrentEnrollmentForStudentById = (studentId: string, organizationId: string) =>
  getCurrentEnrollmentForStudent(organizationId, studentId);

// Subjects mapped to a class (student -> enrollment -> class -> class_subjects -> subjects).
export const listSubjectsForClass = (organizationId: string, classId: string) =>
  pool.query(
    `SELECT s.id, s.name, s.code
     FROM class_subjects cs
     JOIN subjects s ON s.id = cs.subject_id AND s.organization_id = cs.organization_id
     WHERE cs.class_id = $1
       AND cs.organization_id = $2
       AND cs.status = 'ACTIVE'
       AND s.status = 'ACTIVE'
     ORDER BY s.name ASC`,
    [classId, organizationId]
  );

// Recent AI conversations for a student (continue-learning trail), student-scoped.
export const listRecentConversationsForStudent = (organizationId: string, studentId: string, limit: number) =>
  pool.query(
    `SELECT id, title, subject, topic, scope_board, scope_class, scope_chapter,
            scope_language, scope_medium, updated_at
     FROM ai_conversations
     WHERE organization_id = $1 AND student_id = $2
       AND deleted_at IS NULL
     ORDER BY updated_at DESC, id DESC
     LIMIT $3`,
    [organizationId, studentId, limit]
  );

// Curriculum structures (syllabus-derived) for a class — navigation anchors for
// the existing chapter/topic endpoints. class_id is already authorized upstream.
export const listCurriculumStructuresForClass = (classId: string) =>
  pool.query(
    `SELECT cs.id, cs.subject_id
     FROM curriculum_structures cs
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     WHERE s.class_id = $1
     ORDER BY cs.created_at ASC`,
    [classId]
  );
