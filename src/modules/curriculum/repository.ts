import pool from "../../db.js";

export async function listBoards() {
  return pool.query(
    `SELECT id, name, code, status, created_at, updated_at
     FROM boards
     ORDER BY name ASC`
  );
}

export async function getBoardById(boardId: string) {
  return pool.query(
    `SELECT id, name, code, status, created_at, updated_at
     FROM boards
     WHERE id = $1
     LIMIT 1`,
    [boardId]
  );
}

export async function listMediums() {
  return pool.query(
    `SELECT id, name, code, status, created_at, updated_at
     FROM mediums
     ORDER BY name ASC`
  );
}

export async function getMediumById(mediumId: string) {
  return pool.query(
    `SELECT id, name, code, status, created_at, updated_at
     FROM mediums
     WHERE id = $1
     LIMIT 1`,
    [mediumId]
  );
}

export async function getClassById(classId: string) {
  return pool.query(
    `SELECT id, organization_id, name, section, academic_year, status, created_by_user_id, created_at, updated_at
     FROM classes
     WHERE id = $1
     LIMIT 1`,
    [classId]
  );
}

export async function listSyllabiForClass(classId: string) {
  return pool.query(
    `SELECT s.id,
            s.class_id,
            s.board_id,
            s.medium_id,
            s.name,
            s.code,
            s.status,
            s.created_at,
            s.updated_at,
            b.name AS board_name,
            b.code AS board_code,
            m.name AS medium_name,
            m.code AS medium_code,
            c.name AS class_name,
            c.section AS class_section,
            c.academic_year
     FROM syllabi s
     JOIN classes c ON c.id = s.class_id
     JOIN boards b ON b.id = s.board_id
     JOIN mediums m ON m.id = s.medium_id
     WHERE s.class_id = $1
     ORDER BY s.name ASC`,
    [classId]
  );
}

export async function getSyllabusById(syllabusId: string) {
  return pool.query(
    `SELECT s.id,
            s.class_id,
            s.board_id,
            s.medium_id,
            s.name,
            s.code,
            s.status,
            s.created_at,
            s.updated_at,
            b.name AS board_name,
            b.code AS board_code,
            b.status AS board_status,
            m.name AS medium_name,
            m.code AS medium_code,
            m.status AS medium_status,
            c.name AS class_name,
            c.section AS class_section,
            c.academic_year,
            c.organization_id
     FROM syllabi s
     JOIN classes c ON c.id = s.class_id
     JOIN boards b ON b.id = s.board_id
     JOIN mediums m ON m.id = s.medium_id
     WHERE s.id = $1
     LIMIT 1`,
    [syllabusId]
  );
}

export async function findSyllabusByClassBoardMediumCode(classId: string, boardId: string, mediumId: string, code: string) {
  return pool.query(
    `SELECT id
     FROM syllabi
     WHERE class_id = $1 AND board_id = $2 AND medium_id = $3 AND lower(code) = lower($4)
     LIMIT 1`,
    [classId, boardId, mediumId, code]
  );
}

export async function findTeacherAssignment(classId: string, organizationId: string, userId: string) {
  return pool.query(
    `SELECT cta.id
     FROM class_teacher_assignments cta
     JOIN teachers t ON t.id = cta.teacher_id
     WHERE cta.class_id = $1
       AND t.organization_id = $2
       AND t.user_id = $3
     LIMIT 1`,
    [classId, organizationId, userId]
  );
}

export async function findActiveClassEnrollmentForStudent(userId: string, classId: string) {
  return pool.query(
    `SELECT se.id
     FROM student_enrollments se
     JOIN students_v2 s ON s.id = se.student_id
     WHERE s.user_id = $1
       AND se.class_id = $2
       AND se.status = 'ACTIVE'
     LIMIT 1`,
    [userId, classId]
  );
}

export async function createSyllabus(data: {
  classId: string;
  boardId: string;
  mediumId: string;
  name: string;
  code: string;
  status: string;
}) {
  return pool.query(
    `INSERT INTO syllabi (class_id, board_id, medium_id, name, code, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, class_id, board_id, medium_id, name, code, status, created_at, updated_at`,
    [data.classId, data.boardId, data.mediumId, data.name, data.code, data.status]
  );
}

export async function listVersionsForSyllabus(syllabusId: string) {
  return pool.query(
    `SELECT id, syllabus_id, version, effective_from, effective_to, status, created_at, updated_at
     FROM syllabus_versions
     WHERE syllabus_id = $1
     ORDER BY effective_from DESC NULLS LAST, created_at DESC`,
    [syllabusId]
  );
}

export async function findVersionForSyllabus(syllabusId: string, version: string) {
  return pool.query(
    `SELECT id
     FROM syllabus_versions
     WHERE syllabus_id = $1 AND lower(version) = lower($2)
     LIMIT 1`,
    [syllabusId, version]
  );
}

export async function createSyllabusVersion(data: {
  syllabusId: string;
  version: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
}) {
  return pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, effective_from, effective_to, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, syllabus_id, version, effective_from, effective_to, status, created_at, updated_at`,
    [data.syllabusId, data.version, data.effectiveFrom, data.effectiveTo, data.status]
  );
}

export default {
  listBoards,
  getBoardById,
  listMediums,
  getMediumById,
  getClassById,
  listSyllabiForClass,
  getSyllabusById,
  findSyllabusByClassBoardMediumCode,
  findTeacherAssignment,
  findActiveClassEnrollmentForStudent,
  createSyllabus,
  listVersionsForSyllabus,
  findVersionForSyllabus,
  createSyllabusVersion,
};
