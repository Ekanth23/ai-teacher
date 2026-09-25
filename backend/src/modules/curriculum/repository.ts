import pool from "../../db.js";

export type CurriculumClass = {
  id: string;
  organization_id: string;
  name: string;
  section: string | null;
  academic_year: string | null;
  status: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

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
  return pool.query<CurriculumClass>(
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
            s.is_authoritative,
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
            s.is_authoritative,
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

export type AuthoritativeSyllabusRow = {
  syllabus_id: string;
  class_id: string;
  board_id: string;
  board_name: string;
  board_code: string;
  medium_id: string;
  medium_name: string;
  medium_code: string;
  syllabus_name: string;
  syllabus_code: string;
  syllabus_status: string;
  class_organization_id: string;
  class_status: string;
};

/**
 * Return all explicitly designated, active syllabi for a class.  No ordering
 * or LIMIT is used: the resolver must be able to observe ambiguity rather than
 * silently selecting a row.
 */
export async function getAuthoritativeSyllabiForClass(classId: string, organizationId: string) {
  return pool.query<AuthoritativeSyllabusRow>(
    `SELECT s.id AS syllabus_id,
            s.class_id,
            b.id AS board_id,
            b.name AS board_name,
            b.code AS board_code,
            m.id AS medium_id,
            m.name AS medium_name,
            m.code AS medium_code,
            s.name AS syllabus_name,
            s.code AS syllabus_code,
            s.status AS syllabus_status,
            c.organization_id AS class_organization_id,
            c.status AS class_status
       FROM syllabi s
       JOIN classes c
         ON c.id = s.class_id
        AND c.organization_id = $2
       JOIN boards b
         ON b.id = s.board_id
       JOIN mediums m
         ON m.id = s.medium_id
      WHERE s.class_id = $1
        AND s.is_authoritative = TRUE
        AND s.status = 'ACTIVE'
        AND c.status = 'ACTIVE'
        AND b.status = 'ACTIVE'
        AND m.status = 'ACTIVE'`,
    [classId, organizationId]
  );
}

export async function getSyllabusLanguages(syllabusId: string) {
  return pool.query(
    `SELECT l.id, l.code, l.name, sl.language_role
       FROM syllabus_languages sl
       JOIN languages l ON l.id = sl.language_id
      WHERE sl.syllabus_id = $1
        AND l.status = 'ACTIVE'
      ORDER BY l.name ASC, l.id ASC`,
    [syllabusId]
  );
}

/**
 * Resolve a subject only through the class-subject relationship.  Matching is
 * exact (case/whitespace normalized), never semantic or keyword based.
 */
export async function findActiveSubjectsForClass(
  organizationId: string,
  classId: string,
  label: string
) {
  if (!label.trim()) return { rows: [] as Array<{ id: string; name: string; code: string | null }> };
  return pool.query<{ id: string; name: string; code: string | null }>(
    `SELECT s.id, s.name, s.code
       FROM class_subjects cs
       JOIN subjects s
         ON s.id = cs.subject_id
        AND s.organization_id = cs.organization_id
      WHERE cs.organization_id = $1
        AND cs.class_id = $2
        AND cs.status = 'ACTIVE'
        AND s.status = 'ACTIVE'
        AND (lower(btrim(s.name)) = lower(btrim($3))
             OR (s.code IS NOT NULL AND lower(btrim(s.code)) = lower(btrim($3))))`,
    [organizationId, classId, label.trim()]
  );
}

export type AuthoritativeNodeRow = {
  id: string;
  title: string;
  code: string | null;
  subject_id: string | null;
  parent_id: string | null;
  parent_title: string | null;
  parent_type: string | null;
};

/**
 * Resolve an exact active curriculum node through the designated syllabus and
 * class-subject relationship.  This reads labels for context only; it does not
 * retrieve curriculum content or create a mapping.
 */
export async function findActiveCurriculumNodes(
  organizationId: string,
  classId: string,
  syllabusId: string,
  subjectId: string,
  nodeType: "CHAPTER" | "TOPIC",
  label: string,
  parentNodeId?: string | null
) {
  if (!label.trim()) return { rows: [] as AuthoritativeNodeRow[] };
  return pool.query<AuthoritativeNodeRow>(
    `SELECT n.id,
            n.title,
            n.code,
            cs.subject_id,
            parent.id AS parent_id,
            parent.title AS parent_title,
            parent_type.code AS parent_type
       FROM curriculum_nodes n
       JOIN curriculum_node_types node_type
         ON node_type.id = n.node_type_id
       JOIN curriculum_structures cs
         ON cs.id = n.curriculum_structure_id
       JOIN syllabus_versions sv
         ON sv.id = cs.syllabus_version_id
       JOIN syllabi s
         ON s.id = sv.syllabus_id
        AND s.class_id = $2
        AND s.id = $3
        AND s.is_authoritative = TRUE
        AND s.status = 'ACTIVE'
       LEFT JOIN curriculum_versions cv
         ON cv.id = sv.curriculum_version_id
        AND cv.board_id = s.board_id
       LEFT JOIN curriculum_nodes parent
         ON parent.id = n.parent_node_id
        AND parent.curriculum_structure_id = n.curriculum_structure_id
        AND parent.status = 'ACTIVE'
       LEFT JOIN curriculum_node_types parent_type
         ON parent_type.id = parent.node_type_id
        AND parent_type.status = 'ACTIVE'
      WHERE s.class_id = $2
        AND cs.subject_id = $4
        AND cs.status = 'ACTIVE'
        AND sv.status = 'ACTIVE'
        AND (sv.effective_from IS NULL OR sv.effective_from <= CURRENT_DATE)
        AND (sv.effective_to IS NULL OR sv.effective_to >= CURRENT_DATE)
        AND (
          cv.id IS NULL
          OR (
            cv.status = 'ACTIVE'
            AND (cv.effective_from IS NULL OR cv.effective_from <= CURRENT_DATE)
            AND (cv.effective_to IS NULL OR cv.effective_to >= CURRENT_DATE)
          )
        )
        AND n.status = 'ACTIVE'
        AND node_type.status = 'ACTIVE'
        AND lower(node_type.code) = lower($5)
        AND lower(btrim(n.title)) = lower(btrim($6))
        AND ($7::uuid IS NULL OR n.parent_node_id = $7::uuid)
        AND EXISTS (
          SELECT 1
            FROM classes c
           WHERE c.id = s.class_id
             AND c.organization_id = $1
             AND c.status = 'ACTIVE'
        )`,
    [organizationId, classId, syllabusId, subjectId, nodeType, label.trim(), parentNodeId ?? null]
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
       AND t.status = 'ACTIVE'
       AND cta.status = 'ACTIVE'
     LIMIT 1`,
    [classId, organizationId, userId]
  );
}

export async function findActiveClassEnrollmentForStudent(
  userId: string,
  classId: string,
  organizationId: string
) {
  return pool.query(
    `SELECT se.id
     FROM student_enrollments se
     JOIN students_v2 s
       ON s.id = se.student_id
      AND s.organization_id = se.organization_id
     JOIN classes c
       ON c.id = se.class_id
      AND c.organization_id = se.organization_id
     WHERE s.user_id = $1
       AND s.organization_id = $3
       AND s.status = 'ACTIVE'
       AND se.class_id = $2
       AND se.organization_id = $3
       AND se.status = 'ACTIVE'
       AND c.status = 'ACTIVE'
     LIMIT 1`,
    [userId, classId, organizationId]
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
     RETURNING id, class_id, board_id, medium_id, name, code, status, is_authoritative, created_at, updated_at`,
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

/**
 * Explicitly designate one syllabus for a class.  The class/syllabus ownership
 * predicate is repeated inside the transaction, and the partial unique index
 * from migration 049 protects against concurrent competing designations.
 */
export async function designateAuthoritativeSyllabus(input: {
  organizationId: string;
  classId: string;
  syllabusId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize designation changes for a class so two explicit requests
    // cannot lock different syllabus rows and then update the whole class in
    // opposing orders.
    const classLock = await client.query(
      `SELECT id FROM classes
        WHERE id = $1 AND organization_id = $2
        FOR UPDATE`,
      [input.classId, input.organizationId]
    );
    if (classLock.rows.length === 0) {
      throw new Error("Class not found for the requested organization.");
    }
    const target = await client.query(
      `SELECT s.id, s.class_id, s.status, c.organization_id, c.status AS class_status,
              b.status AS board_status, m.status AS medium_status
         FROM syllabi s
         JOIN classes c ON c.id = s.class_id
         JOIN boards b ON b.id = s.board_id
         JOIN mediums m ON m.id = s.medium_id
        WHERE s.id = $1
          AND s.class_id = $2
          AND c.organization_id = $3
        FOR UPDATE`,
      [input.syllabusId, input.classId, input.organizationId]
    );
    if (target.rows.length === 0) {
      throw new Error("Syllabus not found for the requested class and organization.");
    }
    if (
      target.rows[0].status !== "ACTIVE" ||
      target.rows[0].class_status !== "ACTIVE" ||
      target.rows[0].board_status !== "ACTIVE" ||
      target.rows[0].medium_status !== "ACTIVE"
    ) {
      throw new Error("Only an active syllabus with an active board and medium on an active class can be designated.");
    }

    // The partial unique index in migration 049 is enforced for each row
    // update. Demote the previous designation before promoting the target so
    // switching is safe in either direction. Both statements run in the
    // class-locked transaction above; any failure rolls both changes back.
    await client.query(
      `UPDATE syllabi
          SET is_authoritative = FALSE,
              updated_at = NOW()
        WHERE class_id = $1
          AND is_authoritative = TRUE
          AND id <> $2`,
      [input.classId, input.syllabusId]
    );
    const promoted = await client.query(
      `UPDATE syllabi
          SET is_authoritative = TRUE,
              updated_at = NOW()
        WHERE id = $1
          AND class_id = $2
        RETURNING id`,
      [input.syllabusId, input.classId]
    );
    if (promoted.rowCount !== 1) {
      throw new Error("Syllabus could not be promoted as authoritative.");
    }

    const result = await client.query(
      `SELECT s.id, s.class_id, s.board_id, s.medium_id, s.name, s.code,
              s.status, s.is_authoritative, s.created_at, s.updated_at,
              b.name AS board_name, b.code AS board_code,
              m.name AS medium_name, m.code AS medium_code,
              c.organization_id
         FROM syllabi s
         JOIN classes c ON c.id = s.class_id
         JOIN boards b ON b.id = s.board_id
         JOIN mediums m ON m.id = s.medium_id
        WHERE s.id = $1`,
      [input.syllabusId]
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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
  getAuthoritativeSyllabiForClass,
  getSyllabusLanguages,
  findActiveSubjectsForClass,
  findActiveCurriculumNodes,
  createSyllabus,
  listVersionsForSyllabus,
  findVersionForSyllabus,
  createSyllabusVersion,
  designateAuthoritativeSyllabus,
};
