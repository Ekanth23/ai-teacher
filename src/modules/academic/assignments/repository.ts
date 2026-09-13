import pool from "../../../db.js";
import type { CreateAssignmentInput } from "./types.js";

export const getTeacherForUser = (organizationId: string, userId: string) =>
  pool.query(
    `SELECT id, organization_id, status
     FROM teachers
     WHERE organization_id = $1 AND user_id = $2 AND status = 'ACTIVE'
     LIMIT 1`,
    [organizationId, userId]
  );

export const classSubjectActive = (organizationId: string, classId: string, subjectId: string) =>
  pool.query(
    `SELECT id
     FROM class_subjects
     WHERE organization_id = $1 AND class_id = $2 AND subject_id = $3 AND status = 'ACTIVE'
     LIMIT 1`,
    [organizationId, classId, subjectId]
  );

export const classInOrganization = (classId: string, organizationId: string) =>
  pool.query(
    `SELECT id
     FROM classes
     WHERE id = $1 AND organization_id = $2
     LIMIT 1`,
    [classId, organizationId]
  );

export const teacherAssignedToClass = (classId: string, organizationId: string, userId: string) =>
  pool.query(
    `SELECT cta.id
     FROM class_teacher_assignments cta
     JOIN teachers t ON t.id = cta.teacher_id
     WHERE cta.class_id = $1
       AND cta.organization_id = $2
       AND t.organization_id = $2
       AND t.user_id = $3
       AND t.status = 'ACTIVE'
       AND cta.status = 'ACTIVE'
     LIMIT 1`,
    [classId, organizationId, userId]
  );

export const subjectTeacherAssigned = (organizationId: string, classId: string, subjectId: string, userId: string) =>
  pool.query(
    `SELECT cst.id
     FROM class_subject_teachers cst
     JOIN teachers t ON t.id = cst.teacher_id
     WHERE cst.organization_id = $1
       AND cst.class_id = $2
       AND cst.subject_id = $3
       AND t.user_id = $4
       AND t.status = 'ACTIVE'
       AND cst.status = 'ACTIVE'
     LIMIT 1`,
    [organizationId, classId, subjectId, userId]
  );

export const nodeClassOrganization = (nodeId: string) =>
  pool.query(
    `SELECT c.id AS class_id, c.organization_id
     FROM curriculum_nodes n
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     JOIN classes c ON c.id = s.class_id
     WHERE n.id = $1
     LIMIT 1`,
    [nodeId]
  );

export const createAssignment = (input: CreateAssignmentInput & { organizationId: string; teacherId: string }) =>
  pool.query(
    `INSERT INTO assignments
       (organization_id, teacher_id, class_id, subject_id, curriculum_node_id, title, description, due_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT')
     RETURNING *`,
    [
      input.organizationId,
      input.teacherId,
      input.classId,
      input.subjectId,
      input.curriculumNodeId ?? null,
      input.title,
      input.description ?? null,
      input.dueAt ?? null,
    ]
  );

export const getAssignmentForOrganization = (id: string, organizationId: string) =>
  pool.query(
    `SELECT *
     FROM assignments
     WHERE id = $1 AND organization_id = $2
     LIMIT 1`,
    [id, organizationId]
  );

// Atomic DRAFT -> PUBLISHED transition. The status guard ensures a concurrent
// or repeat publish cannot accidentally re-transition an already-moved assignment.
export const publishDraftAssignment = (id: string, organizationId: string) =>
  pool.query(
    `UPDATE assignments
     SET status = 'PUBLISHED', updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status = 'DRAFT'
     RETURNING *`,
    [id, organizationId]
  );

// Atomic PUBLISHED -> OPEN transition. The status guard prevents a concurrent
// or repeat open from re-transitioning an assignment that is no longer published.
export const openPublishedAssignment = (id: string, organizationId: string) =>
  pool.query(
    `UPDATE assignments
     SET status = 'OPEN', updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status = 'PUBLISHED'
     RETURNING *`,
    [id, organizationId]
  );

// Atomic OPEN -> CLOSED transition. The status guard prevents a concurrent
// or repeat close from re-transitioning an assignment that is no longer open.
export const closeOpenAssignment = (id: string, organizationId: string) =>
  pool.query(
    `UPDATE assignments
     SET status = 'CLOSED', updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status = 'OPEN'
     RETURNING *`,
    [id, organizationId]
  );

export const getStudentForUser = (organizationId: string, userId: string) =>
  pool.query(
    `SELECT id, status
     FROM students_v2
     WHERE organization_id = $1 AND user_id = $2 AND status = 'ACTIVE'
     LIMIT 1`,
    [organizationId, userId]
  );

// OPEN assignments for classes the student is actively enrolled in (org-scoped).
export const listOpenAssignmentsForStudent = (organizationId: string, userId: string) =>
  pool.query(
    `SELECT a.id, a.class_id, a.subject_id, a.curriculum_node_id, a.title, a.description, a.status, a.created_at, a.updated_at
     FROM assignments a
     WHERE a.organization_id = $1
       AND a.status = 'OPEN'
       AND a.class_id IN (
         SELECT se.class_id
         FROM student_enrollments se
         JOIN students_v2 s ON s.id = se.student_id
         WHERE s.user_id = $2
           AND s.organization_id = $1
           AND s.status = 'ACTIVE'
           AND se.status = 'ACTIVE'
       )
     ORDER BY a.created_at DESC`,
    [organizationId, userId]
  );

// A single OPEN assignment, constrained to the student's organization and enrolled classes.
export const getOpenAssignmentForStudent = (id: string, organizationId: string, userId: string) =>
  pool.query(
    `SELECT a.id, a.class_id, a.subject_id, a.curriculum_node_id, a.title, a.description, a.status, a.created_at, a.updated_at
     FROM assignments a
     WHERE a.id = $1
       AND a.organization_id = $2
       AND a.status = 'OPEN'
       AND a.class_id IN (
         SELECT se.class_id
         FROM student_enrollments se
         JOIN students_v2 s ON s.id = se.student_id
         WHERE s.user_id = $3
           AND s.organization_id = $2
           AND s.status = 'ACTIVE'
           AND se.status = 'ACTIVE'
       )
     LIMIT 1`,
    [id, organizationId, userId]
  );

// Atomically inserts a submission only if the assignment is OPEN and the student
// is actively enrolled in the assignment's class within the same organization.
// Returns zero rows when the assignment is not found, not OPEN, cross-tenant, or
// the student is not enrolled. A duplicate submission raises a unique violation
// (23505), which the route maps to 409.
export const createSubmission = (organizationId: string, studentId: string, assignmentId: string, content: string) =>
  pool.query(
    `INSERT INTO submissions (organization_id, assignment_id, student_id, content, submitted_at)
     SELECT $1, a.id, $2, $3, now()
     FROM assignments a
     WHERE a.id = $4
       AND a.organization_id = $1
       AND a.status = 'OPEN'
       AND EXISTS (
         SELECT 1
         FROM student_enrollments se
         WHERE se.student_id = $2
           AND se.class_id = a.class_id
           AND se.organization_id = $1
           AND se.status = 'ACTIVE'
       )
     RETURNING id, assignment_id, student_id, content, submitted_at, created_at, updated_at`,
    [organizationId, studentId, content, assignmentId]
  );

// Derived completion: a student is "completed" when a submission exists for the
// (student, assignment) pair. The assignment must be OPEN or CLOSED (i.e. it has
// been made available to students) and the student must be actively enrolled in
// its class. Returns zero rows when the assignment is not found, DRAFT/PUBLISHED,
// cross-tenant, or the student is not enrolled.
export const getCompletionForStudent = (organizationId: string, studentId: string, assignmentId: string) =>
  pool.query(
    `SELECT a.id AS assignment_id,
            s.id AS submission_id,
            s.submitted_at AS completed_at
     FROM assignments a
     LEFT JOIN submissions s
       ON s.assignment_id = a.id
      AND s.organization_id = a.organization_id
      AND s.student_id = $2
     WHERE a.id = $3
       AND a.organization_id = $1
       AND a.status IN ('OPEN', 'CLOSED')
       AND EXISTS (
         SELECT 1
         FROM student_enrollments se
         WHERE se.student_id = $2
           AND se.class_id = a.class_id
           AND se.organization_id = $1
           AND se.status = 'ACTIVE'
       )
     LIMIT 1`,
    [organizationId, studentId, assignmentId]
  );

// Derived overdue: overdue = (due_at passed AND no submission). Same
// eligibility as completion (assignment OPEN or CLOSED, student enrolled).
// A NULL due_at never produces overdue.
export const getOverdueForStudent = (organizationId: string, studentId: string, assignmentId: string) =>
  pool.query(
    `SELECT a.id AS assignment_id,
            a.due_at,
            s.id AS submission_id,
            (a.due_at IS NOT NULL AND now() > a.due_at AND s.id IS NULL) AS overdue
     FROM assignments a
     LEFT JOIN submissions s
       ON s.assignment_id = a.id
      AND s.organization_id = a.organization_id
      AND s.student_id = $2
     WHERE a.id = $3
       AND a.organization_id = $1
       AND a.status IN ('OPEN', 'CLOSED')
       AND EXISTS (
         SELECT 1
         FROM student_enrollments se
         WHERE se.student_id = $2
           AND se.class_id = a.class_id
           AND se.organization_id = $1
           AND se.status = 'ACTIVE'
       )
     LIMIT 1`,
    [organizationId, studentId, assignmentId]
  );

// All submissions for an assignment within an organization, with student identity.
export const listSubmissionsForAssignment = (assignmentId: string, organizationId: string) =>
  pool.query(
    `SELECT sub.id,
            sub.assignment_id,
            sub.student_id,
            st.full_name AS student_name,
            sub.content,
            sub.decision,
            sub.feedback,
            sub.submitted_at,
            sub.created_at,
            sub.updated_at
     FROM submissions sub
     JOIN students_v2 st ON st.id = sub.student_id AND st.organization_id = sub.organization_id
     WHERE sub.assignment_id = $1
       AND sub.organization_id = $2
     ORDER BY sub.submitted_at DESC`,
    [assignmentId, organizationId]
  );

// A specific submission for an assignment within an organization, with the
// canonical student identity. The WHERE clause enforces the assignment and
// organization relationship so a submission cannot be exposed across
// assignments or tenants.
export const getSubmissionForAssignment = (assignmentId: string, submissionId: string, organizationId: string) =>
  pool.query(
    `SELECT sub.id,
            sub.assignment_id,
            sub.student_id,
            st.full_name AS student_name,
            sub.content,
            sub.decision,
            sub.feedback,
            sub.submitted_at,
            sub.created_at,
            sub.updated_at
     FROM submissions sub
     JOIN students_v2 st ON st.id = sub.student_id AND st.organization_id = sub.organization_id
     WHERE sub.id = $1
       AND sub.assignment_id = $2
       AND sub.organization_id = $3
     LIMIT 1`,
    [submissionId, assignmentId, organizationId]
  );

// Records the teacher's review decision on a specific submission. The UPDATE
// enforces the assignment + organization relationship so a decision cannot be
// written across assignments or tenants, and returns the teacher-facing
// projection (including the canonical student identity) in a single round trip.
export const setSubmissionDecision = (assignmentId: string, submissionId: string, organizationId: string, decision: string) =>
  pool.query(
    `WITH updated AS (
       UPDATE submissions
       SET decision = $4, updated_at = now()
       WHERE id = $1
         AND assignment_id = $2
         AND organization_id = $3
       RETURNING id, assignment_id, student_id, content, decision, feedback, submitted_at, created_at, updated_at
     )
     SELECT u.id,
            u.assignment_id,
            u.student_id,
            st.full_name AS student_name,
            u.content,
            u.decision,
            u.feedback,
            u.submitted_at,
            u.created_at,
            u.updated_at
     FROM updated u
     JOIN students_v2 st ON st.id = u.student_id AND st.organization_id = $3`,
    [submissionId, assignmentId, organizationId, decision]
  );

// Records teacher feedback on a specific submission. The UPDATE enforces the
// assignment + organization relationship so feedback cannot be written across
// assignments or tenants, and feedback may be set to null to clear it. Returns
// the teacher-facing projection in a single round trip.
export const setSubmissionFeedback = (assignmentId: string, submissionId: string, organizationId: string, feedback: string | null) =>
  pool.query(
    `WITH updated AS (
       UPDATE submissions
       SET feedback = $4, updated_at = now()
       WHERE id = $1
         AND assignment_id = $2
         AND organization_id = $3
       RETURNING id, assignment_id, student_id, content, decision, feedback, submitted_at, created_at, updated_at
     )
     SELECT u.id,
            u.assignment_id,
            u.student_id,
            st.full_name AS student_name,
            u.content,
            u.decision,
            u.feedback,
            u.submitted_at,
            u.created_at,
            u.updated_at
     FROM updated u
     JOIN students_v2 st ON st.id = u.student_id AND st.organization_id = $3`,
    [submissionId, assignmentId, organizationId, feedback]
  );

export const updateAssignment = (
  id: string,
  input: { classId: string; subjectId: string; curriculumNodeId: string | null; title: string; description: string | null; dueAt: string | null }
) =>
  pool.query(
    `UPDATE assignments SET
       class_id = $2,
       subject_id = $3,
       curriculum_node_id = $4,
       title = $5,
       description = $6,
       due_at = $7,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, input.classId, input.subjectId, input.curriculumNodeId, input.title, input.description, input.dueAt]
  );
