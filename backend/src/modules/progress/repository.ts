import pool from "../../db.js";
import type { AvailablePractice } from "./types.js";

// Read-only consumption of Epic 8 practice data. Nothing here writes to,
// duplicates, or reinterprets Epic 8 result ownership: it only reports which
// PUBLISHED practices exist (available) so the service can intersect them
// with the student's SUBMITTED attempts (completed).

// Available PUBLISHED practices with their curriculum attribution in one
// round-trip. Chapter = the topic's direct CHAPTER-typed parent (topics are
// created as children of chapters); subject = the structure's subject_id.
// Practices whose topic has no CHAPTER parent, or whose structure has no
// subject, still count at every level they can be attributed to.
export const listAvailablePractices = (organizationId: string) =>
  pool.query(
    `SELECT p.id AS practice_id,
            n.id AS topic_id,
            n.title AS topic_title,
            CASE WHEN pct.id IS NOT NULL THEN pc.id END AS chapter_id,
            CASE WHEN pct.id IS NOT NULL THEN pc.title END AS chapter_title,
            cs.subject_id AS subject_id,
            s.name AS subject_name,
            s.code AS subject_code
     FROM practices p
     JOIN curriculum_nodes n ON n.id = p.curriculum_node_id
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     LEFT JOIN curriculum_nodes pc ON pc.id = n.parent_node_id
     LEFT JOIN curriculum_node_types pct ON pct.id = pc.node_type_id AND lower(pct.code) = 'chapter'
     LEFT JOIN subjects s ON s.id = cs.subject_id AND s.organization_id = $1
     WHERE p.organization_id = $1
       AND p.status = 'PUBLISHED'`,
    [organizationId]
  );

// Distinct practices the student completed: at least one SUBMITTED attempt.
// DISTINCT keeps multiple submissions for one practice counting only once.
// IN_PROGRESS attempts never appear here.
export const listCompletedPracticeIds = (organizationId: string, studentId: string) =>
  pool.query(
    `SELECT DISTINCT practice_id
     FROM practice_attempts
     WHERE organization_id = $1 AND student_id = $2 AND status = 'SUBMITTED'`,
    [organizationId, studentId]
  );

// Curriculum enumeration for the organization (levels with zero available
// published practices are still reported, with percentage null — the
// "no progress data" state, never a fabricated 0%).
// Subjects are organization-scoped; chapters/topics come from structures
// linked to the organization through syllabus -> class.
export const listSubjects = (organizationId: string) =>
  pool.query(
    `SELECT id, name, code FROM subjects WHERE organization_id = $1 AND status = 'ACTIVE' ORDER BY name`,
    [organizationId]
  );

export const listChapters = (organizationId: string) =>
  pool.query(
    `SELECT DISTINCT n.id, n.title, cs.subject_id
     FROM curriculum_nodes n
     JOIN curriculum_node_types t ON t.id = n.node_type_id AND lower(t.code) = 'chapter'
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     JOIN classes c ON c.id = s.class_id
     WHERE c.organization_id = $1 AND n.status = 'ACTIVE'
     ORDER BY n.title`,
    [organizationId]
  );

export const listTopics = (organizationId: string) =>
  pool.query(
    `SELECT DISTINCT n.id, n.title,
            CASE WHEN pct.id IS NOT NULL THEN pc.id END AS chapter_id,
            cs.subject_id
     FROM curriculum_nodes n
     JOIN curriculum_node_types t ON t.id = n.node_type_id AND lower(t.code) = 'topic'
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     JOIN classes c ON c.id = s.class_id
     LEFT JOIN curriculum_nodes pc ON pc.id = n.parent_node_id
     LEFT JOIN curriculum_node_types pct ON pct.id = pc.node_type_id AND lower(pct.code) = 'chapter'
     WHERE c.organization_id = $1 AND n.status = 'ACTIVE'
     ORDER BY n.title`,
    [organizationId]
  );

// Staff-path guards (read-only).
export const getStudentInOrganization = (studentId: string, organizationId: string) =>
  pool.query(
    `SELECT id, full_name FROM students_v2 WHERE id = $1 AND organization_id = $2 AND status = 'ACTIVE' LIMIT 1`,
    [studentId, organizationId]
  );

export const listActiveEnrollmentClassIds = (organizationId: string, studentId: string) =>
  pool.query(
    `SELECT class_id FROM student_enrollments
     WHERE organization_id = $1 AND student_id = $2 AND status = 'ACTIVE'`,
    [organizationId, studentId]
  );

// US-102 weak-topic evidence (read-only Epic 8): one row per answered
// response on a SUBMITTED attempt for a currently PUBLISHED practice, with
// the topic attribution and both option keys for exact-match correctness.
// Unanswered questions have no row (042 semantics); NULL/blank selections
// are excluded defensively. IN_PROGRESS attempts never appear.
export const listTopicAnswerRows = (organizationId: string, studentId: string) =>
  pool.query(
    `SELECT a.id AS attempt_id,
            n.id AS topic_id,
            n.title AS topic_title,
            CASE WHEN pct.id IS NOT NULL THEN pc.id END AS chapter_id,
            ans.selected_option AS selected_option,
            q.correct_option_key AS correct_option_key
     FROM practice_attempts a
     JOIN practices p ON p.id = a.practice_id AND p.organization_id = a.organization_id AND p.status = 'PUBLISHED'
     JOIN practice_attempt_answers ans ON ans.attempt_id = a.id
       AND ans.selected_option IS NOT NULL AND length(trim(ans.selected_option)) > 0
     JOIN practice_questions q ON q.id = ans.question_id AND q.practice_id = p.id
     JOIN curriculum_nodes n ON n.id = p.curriculum_node_id
     LEFT JOIN curriculum_nodes pc ON pc.id = n.parent_node_id
     LEFT JOIN curriculum_node_types pct ON pct.id = pc.node_type_id AND lower(pct.code) = 'chapter'
     WHERE a.organization_id = $1 AND a.student_id = $2 AND a.status = 'SUBMITTED'
     ORDER BY n.title ASC, a.id ASC`,
    [organizationId, studentId]
  );

// US-105 mapping writes (internal/test-seeded path; no authoring routes or
// UI in this slice). kind = CONCEPT is enforced here because plain DDL
// cannot join-check it. Existence of the question in its domain is verified
// so a mapping can never point at a missing question.
export const getKnowledgeItemKind = (knowledgeItemId: string) =>
  pool.query("SELECT kind FROM knowledge_items WHERE id = $1 LIMIT 1", [knowledgeItemId]);

export const practiceQuestionExists = (organizationId: string, questionId: string) =>
  pool.query(
    `SELECT q.id FROM practice_questions q
     JOIN practices p ON p.id = q.practice_id
     WHERE q.id = $1 AND p.organization_id = $2 LIMIT 1`,
    [questionId, organizationId]
  );

export const formalQuestionExists = (organizationId: string, questionId: string) =>
  pool.query(
    `SELECT id FROM assessment_questions WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [questionId, organizationId]
  );

export const insertQuestionConcept = (
  scope: "PRACTICE" | "FORMAL",
  questionId: string,
  knowledgeItemId: string,
  isPrimary: boolean
) =>
  pool.query(
    `INSERT INTO question_concepts (question_scope, question_id, knowledge_item_id, is_primary)
     VALUES ($1, $2, $3, $4)
     RETURNING question_scope, question_id, knowledge_item_id, is_primary, created_at`,
    [scope, questionId, knowledgeItemId, isPrimary]
  );

// US-105 evidence (read-only Epic 8 + Epic 9): incorrect answered responses
// on SUBMITTED attempts joined to their PRIMARY concept mapping, with
// scope-qualified identities so PRACTICE and FORMAL records never merge.
// Unanswered questions have no answer row and never appear; correct answers
// are filtered here (selected <> correct) using each domain's exact
// correctness semantics.
export const listConceptMistakeRows = (organizationId: string, studentId: string) =>
  pool.query(
    `SELECT 'PRACTICE' AS attempt_scope,
            a.id AS attempt_id,
            'PRACTICE' AS question_scope,
            ans.question_id AS question_id,
            k.id AS concept_id,
            k.name AS concept_name,
            k.code AS concept_code,
            ans.selected_option AS selected_option,
            q.correct_option_key AS correct_option_key
     FROM practice_attempts a
     JOIN practice_attempt_answers ans ON ans.attempt_id = a.id
       AND ans.selected_option IS NOT NULL AND length(trim(ans.selected_option)) > 0
     JOIN practice_questions q ON q.id = ans.question_id AND q.practice_id = a.practice_id
     JOIN question_concepts qc ON qc.question_scope = 'PRACTICE' AND qc.question_id = q.id AND qc.is_primary
     JOIN knowledge_items k ON k.id = qc.knowledge_item_id
     WHERE a.organization_id = $1 AND a.student_id = $2 AND a.status = 'SUBMITTED'
       AND ans.selected_option <> q.correct_option_key
     UNION ALL
     SELECT 'FORMAL' AS attempt_scope,
            a.id AS attempt_id,
            'FORMAL' AS question_scope,
            ans.question_id AS question_id,
            k.id AS concept_id,
            k.name AS concept_name,
            k.code AS concept_code,
            ans.selected_option AS selected_option,
            q.correct_option_key AS correct_option_key
     FROM assessment_attempts a
     JOIN assessment_answers ans ON ans.attempt_id = a.id
     JOIN assessment_questions q ON q.id = ans.question_id AND q.assessment_event_id = a.assessment_event_id
     JOIN question_concepts qc ON qc.question_scope = 'FORMAL' AND qc.question_id = q.id AND qc.is_primary
     JOIN knowledge_items k ON k.id = qc.knowledge_item_id
     WHERE a.organization_id = $1 AND a.student_id = $2 AND a.status = 'SUBMITTED'
       AND ans.selected_option <> q.correct_option_key
     ORDER BY concept_name ASC`,
    [organizationId, studentId]
  );

// US-101 formal-result consumption (read-only Epic 9): individual submitted
// formal assessment results with event + curriculum context passthrough.
// Topics aggregate as a context list only — never a performance grouping.
export const listFormalResultsForStudent = (organizationId: string, studentId: string) =>
  pool.query(
    `SELECT r.id AS result_id,
            r.attempt_id AS attempt_id,
            r.assessment_event_id AS assessment_event_id,
            e.title AS assessment_title,
            e.subject_id AS subject_id,
            COALESCE(array_agg(DISTINCT n.title) FILTER (WHERE n.id IS NOT NULL), '{}') AS topics,
            r.score AS score,
            r.max_score AS max_score,
            r.percentage AS percentage,
            r.correct_count AS correct_count,
            r.incorrect_count AS incorrect_count,
            r.unanswered_count AS unanswered_count,
            r.submitted_at AS submitted_at
     FROM assessment_results r
     JOIN assessment_attempts a ON a.id = r.attempt_id AND a.status = 'SUBMITTED'
     JOIN assessment_events e ON e.id = r.assessment_event_id AND e.organization_id = r.organization_id
     LEFT JOIN assessment_event_curriculum_portions p ON p.assessment_event_id = e.id
     LEFT JOIN curriculum_nodes n ON n.id = p.curriculum_node_id
     WHERE r.organization_id = $1 AND r.student_id = $2
     GROUP BY r.id, e.id
     ORDER BY r.submitted_at DESC, r.id DESC`,
    [organizationId, studentId]
  );

// US-100 homework signals (read-only Epic 7 consumption): eligible
// assignments (OPEN/CLOSED + ACTIVE enrollment, mirroring
// getCompletionForStudent/getOverdueForStudent) with the student's
// submission timestamp, if any. Decision/feedback never affect state.
export const listHomeworkRows = (organizationId: string, studentId: string) =>
  pool.query(
    `SELECT a.id AS assignment_id,
            a.due_at AS due_at,
            s.submitted_at AS submitted_at
     FROM assignments a
     JOIN student_enrollments se
       ON se.class_id = a.class_id
      AND se.organization_id = a.organization_id
      AND se.status = 'ACTIVE'
      AND se.student_id = $2
     LEFT JOIN submissions s
       ON s.assignment_id = a.id
      AND s.organization_id = a.organization_id
      AND s.student_id = $2
     WHERE a.organization_id = $1
       AND a.status IN ('OPEN', 'CLOSED')
     ORDER BY a.created_at ASC, a.id ASC`,
    [organizationId, studentId]
  );
