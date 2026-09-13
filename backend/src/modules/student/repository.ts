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
    `SELECT id, subject, topic, updated_at
     FROM ai_conversations
     WHERE organization_id = $1 AND student_id = $2
     ORDER BY updated_at DESC
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
