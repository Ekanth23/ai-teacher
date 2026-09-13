import pool from "../../db.js";
import type { CreatePracticeInput, PracticeOption } from "./types.js";

// Resolves the curriculum node's type, class and organization in a single
// round-trip. Used to (a) enforce that a practice is attached to a TOPIC and
// (b) bind the practice to the node's organization/class context.
export const getTopicContext = (nodeId: string) =>
  pool.query(
    `SELECT n.id AS node_id,
            t.code AS node_type_code,
            c.id AS class_id,
            c.organization_id
     FROM curriculum_nodes n
     JOIN curriculum_node_types t ON t.id = n.node_type_id
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     JOIN classes c ON c.id = s.class_id
     WHERE n.id = $1
     LIMIT 1`,
    [nodeId]
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

export const createPractice = (input: CreatePracticeInput & { organizationId: string; createdByUserId: string }) =>
  pool.query(
    `INSERT INTO practices (organization_id, curriculum_node_id, title, description, practice_type, status, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6)
     RETURNING *`,
    [
      input.organizationId,
      input.curriculumNodeId,
      input.title,
      input.description ?? null,
      input.practiceType,
      input.createdByUserId,
    ]
  );

export const getPractice = (id: string) =>
  pool.query("SELECT * FROM practices WHERE id = $1 LIMIT 1", [id]);

export const listPracticesForOrganization = (organizationId: string) =>
  pool.query(
    "SELECT * FROM practices WHERE organization_id = $1 ORDER BY created_at DESC",
    [organizationId]
  );

export const listPracticesForTeacher = (organizationId: string, userId: string) =>
  pool.query(
    `SELECT DISTINCT p.*
     FROM practices p
     JOIN curriculum_nodes n ON n.id = p.curriculum_node_id
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     JOIN classes c ON c.id = s.class_id
     JOIN class_teacher_assignments cta ON cta.class_id = c.id
     JOIN teachers t ON t.id = cta.teacher_id
     WHERE p.organization_id = $1
       AND c.organization_id = $1
       AND t.organization_id = $1
       AND t.user_id = $2
       AND t.status = 'ACTIVE'
       AND cta.status = 'ACTIVE'
     ORDER BY p.created_at DESC`,
    [organizationId, userId]
  );

export const updatePractice = (
  id: string,
  organizationId: string,
  input: { title: string; description: string | null; practiceType: string }
) =>
  pool.query(
    `UPDATE practices
     SET title = $2, description = $3, practice_type = $4, updated_at = now()
     WHERE id = $1 AND organization_id = $5 AND status = 'DRAFT'
     RETURNING *`,
    [id, input.title, input.description, input.practiceType, organizationId]
  );

export const publishPractice = (id: string, organizationId: string) =>
  pool.query(
    `UPDATE practices
     SET status = 'PUBLISHED', updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status = 'DRAFT'
     RETURNING *`,
    [id, organizationId]
  );

export const archivePractice = (id: string, organizationId: string) =>
  pool.query(
    `UPDATE practices
     SET status = 'ARCHIVED', updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status IN ('DRAFT', 'PUBLISHED')
     RETURNING *`,
    [id, organizationId]
  );

// === question methods below ===
export const createQuestion = (input: {
  practiceId: string;
  sequenceNumber: number;
  questionType: string;
  questionText: string;
  options: PracticeOption[];
  correctOptionKey: string;
  marks: number;
  explanation: string | null;
}) =>
  pool.query(
    `INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks, explanation, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb)
     RETURNING *`,
    [
      input.practiceId,
      input.sequenceNumber,
      input.questionType,
      input.questionText,
      JSON.stringify(input.options),
      input.correctOptionKey,
      input.marks,
      input.explanation,
    ]
  );

export const listQuestionsForPractice = (practiceId: string) =>
  pool.query(
    "SELECT * FROM practice_questions WHERE practice_id = $1 ORDER BY sequence_number ASC, created_at ASC",
    [practiceId]
  );

export const getQuestion = (id: string) =>
  pool.query("SELECT * FROM practice_questions WHERE id = $1 LIMIT 1", [id]);

export const nextQuestionSequence = (practiceId: string) =>
  pool.query(
    `SELECT COALESCE(MAX(sequence_number) + 1, 0) AS next_sequence
     FROM practice_questions WHERE practice_id = $1`,
    [practiceId]
  );

export const findQuestionBySequence = (practiceId: string, sequenceNumber: number, excludeId?: string) =>
  pool.query(
    `SELECT id FROM practice_questions
     WHERE practice_id = $1 AND sequence_number = $2 AND ($3::uuid IS NULL OR id <> $3)
     LIMIT 1`,
    [practiceId, sequenceNumber, excludeId ?? null]
  );

export const updateQuestion = (
  id: string,
  input: { questionText: string; options: PracticeOption[]; correctOptionKey: string; marks: number; sequenceNumber: number; explanation: string | null }
) =>
  pool.query(
    `UPDATE practice_questions
     SET question_text = $2, options = $3, correct_option_key = $4, marks = $5, explanation = $6, sequence_number = $7, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.questionText,
      JSON.stringify(input.options),
      input.correctOptionKey,
      input.marks,
      input.explanation,
      input.sequenceNumber,
    ]
  );

export const deleteQuestion = (id: string) =>
  pool.query("DELETE FROM practice_questions WHERE id = $1 RETURNING *", [id]);

// Student discovery: published practices in the student's organization whose
// TOPIC belongs to a class the student is actively enrolled in.
export const listPublishedPracticesForStudent = (organizationId: string, studentId: string) =>
  pool.query(
    `SELECT p.id, p.title, p.description, p.practice_type,
            n.id AS topic_id, n.title AS topic_name
     FROM practices p
     JOIN curriculum_nodes n ON n.id = p.curriculum_node_id
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     JOIN classes c ON c.id = s.class_id
     JOIN student_enrollments se ON se.class_id = c.id AND se.organization_id = c.organization_id
     WHERE p.organization_id = $1
       AND p.status = 'PUBLISHED'
       AND se.student_id = $2
       AND se.status = 'ACTIVE'
     ORDER BY p.created_at DESC`,
    [organizationId, studentId]
  );

// Student detail: one published, enrolled-accessible practice (returns nothing
// for draft/archived, cross-tenant, or non-enrolled contexts).
export const getPublishedPracticeForStudent = (id: string, organizationId: string, studentId: string) =>
  pool.query(
    `SELECT p.id, p.title, p.description, p.practice_type,
            n.id AS topic_id, n.title AS topic_name
     FROM practices p
     JOIN curriculum_nodes n ON n.id = p.curriculum_node_id
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     JOIN classes c ON c.id = s.class_id
     JOIN student_enrollments se ON se.class_id = c.id AND se.organization_id = c.organization_id
     WHERE p.id = $1
       AND p.organization_id = $2
       AND p.status = 'PUBLISHED'
       AND se.student_id = $3
       AND se.status = 'ACTIVE'
     LIMIT 1`,
    [id, organizationId, studentId]
  );

