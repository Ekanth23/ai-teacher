import type { Pool } from "pg";
import pool from "../../db.js";
import type {
  ActiveBoardIdentity,
  BoardEvidenceAuthority,
} from "./board-response.types.js";

export type BoardEvidenceQueryable = Pick<Pool, "query">;

export interface AuthoritativeBoardContextRow {
  board_id: string;
  board_name: string;
  board_code: string;
  class_id: string;
  class_name: string;
  syllabus_id: string;
  syllabus_name: string;
  syllabus_code: string;
  medium_id: string;
  medium_name: string;
  medium_code: string;
}

export interface BoardLanguageRow {
  id: string;
  name: string;
  code: string;
}

export interface AuthoritativeEvidenceRow {
  authority: BoardEvidenceAuthority;
  sourceKind: "CURRICULUM_NODE" | "CURRICULUM_ELEMENT" | "LEARNING_RESOURCE";
  sourceLabel: string;
  content: string;
}

export interface BoardEvidenceBundle {
  primarySourceCount: number;
  sources: AuthoritativeEvidenceRow[];
}

export interface BoardEvidenceLookup {
  organizationId: string;
  studentId: string;
  classId: string;
  syllabusId: string;
  subjectId: string | null;
  chapterId: string | null;
  topicId: string | null;
}

/**
 * Narrow, read-only US-119 curriculum boundary. Every query repeats the
 * organization/class/syllabus predicates and returns only allowlisted,
 * model-safe fields. No file pointer, ownership, provider, or raw metadata is
 * selected.
 */
export class BoardEvidenceRepository {
  constructor(private readonly db: BoardEvidenceQueryable = pool) {}

  async listActiveBoards(): Promise<ActiveBoardIdentity[]> {
    const result = await this.db.query<ActiveBoardIdentity>(
      `SELECT id, name, code
         FROM boards
        WHERE status = 'ACTIVE'
        ORDER BY name ASC, code ASC`
    );
    return result.rows;
  }

  /**
   * Resolve only an explicitly designated authoritative syllabus for an
   * active class enrollment of this authenticated student and the exact active
   * board. No ordering or LIMIT is used, so ambiguity remains observable.
   */
  async getAuthoritativeBoardContexts(
    organizationId: string,
    studentId: string,
    boardId: string
  ) {
    return this.db.query<AuthoritativeBoardContextRow>(
      `SELECT b.id AS board_id,
              b.name AS board_name,
              b.code AS board_code,
              c.id AS class_id,
              c.name AS class_name,
              s.id AS syllabus_id,
              s.name AS syllabus_name,
              s.code AS syllabus_code,
              m.id AS medium_id,
              m.name AS medium_name,
              m.code AS medium_code
         FROM students_v2 student
         JOIN student_enrollments se
           ON se.student_id = student.id
          AND se.organization_id = student.organization_id
          AND se.status = 'ACTIVE'
         JOIN classes c
           ON c.id = se.class_id
          AND c.organization_id = se.organization_id
          AND c.status = 'ACTIVE'
         JOIN syllabi s
           ON s.class_id = c.id
          AND s.is_authoritative = TRUE
          AND s.status = 'ACTIVE'
         JOIN boards b
           ON b.id = s.board_id
          AND b.id = $3
          AND b.status = 'ACTIVE'
         JOIN mediums m
           ON m.id = s.medium_id
          AND m.status = 'ACTIVE'
        WHERE student.id = $2
          AND student.organization_id = $1
          AND student.status = 'ACTIVE'`,
      [organizationId, studentId, boardId]
    );
  }

  async getSyllabusLanguages(syllabusId: string) {
    return this.db.query<BoardLanguageRow>(
      `SELECT l.id, l.name, l.code
         FROM syllabus_languages sl
         JOIN languages l ON l.id = sl.language_id
        WHERE sl.syllabus_id = $1
          AND l.status = 'ACTIVE'
        ORDER BY l.name ASC, l.id ASC`,
      [syllabusId]
    );
  }

  async getEvidence(input: BoardEvidenceLookup): Promise<BoardEvidenceBundle> {
    const [primarySources, primaryEvidence, supportingEvidence] = await Promise.all([
      this.db.query<{ primary_source_count: number }>(
        `SELECT COUNT(DISTINCT cs.id)::int AS primary_source_count
           FROM curriculum_structures cs
           JOIN syllabus_versions sv
             ON sv.id = cs.syllabus_version_id
           JOIN syllabi s
             ON s.id = sv.syllabus_id
            AND s.class_id = $2
            AND s.id = $3
            AND s.is_authoritative = TRUE
            AND s.status = 'ACTIVE'
           JOIN classes c
             ON c.id = s.class_id
            AND c.organization_id = $1
            AND c.status = 'ACTIVE'
           LEFT JOIN curriculum_versions cv
             ON cv.id = sv.curriculum_version_id
            AND cv.board_id = s.board_id
          WHERE cs.subject_id = $4
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
            AND EXISTS (
              SELECT 1
                FROM class_subjects cls
               WHERE cls.organization_id = c.organization_id
                 AND cls.class_id = c.id
                 AND cls.subject_id = cs.subject_id
                 AND cls.status = 'ACTIVE'
            )`,
        [input.organizationId, input.classId, input.syllabusId, input.subjectId]
      ),
      this.db.query<Omit<AuthoritativeEvidenceRow, "authority">>(
        `WITH scoped_structures AS (
          SELECT cs.id, cs.subject_id
            FROM curriculum_structures cs
            JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
            JOIN syllabi s
              ON s.id = sv.syllabus_id
             AND s.class_id = $2
             AND s.id = $3
             AND s.is_authoritative = TRUE
             AND s.status = 'ACTIVE'
            JOIN classes c
              ON c.id = s.class_id
             AND c.organization_id = $1
             AND c.status = 'ACTIVE'
            LEFT JOIN curriculum_versions cv
              ON cv.id = sv.curriculum_version_id
             AND cv.board_id = s.board_id
           WHERE cs.subject_id = $4
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
             AND EXISTS (
               SELECT 1
                 FROM class_subjects cls
                WHERE cls.organization_id = c.organization_id
                  AND cls.class_id = c.id
                  AND cls.subject_id = cs.subject_id
                  AND cls.status = 'ACTIVE'
             )
        )
        SELECT 'CURRICULUM_NODE'::text AS "sourceKind",
               n.title AS "sourceLabel",
               n.description AS content
          FROM scoped_structures ss
          JOIN curriculum_nodes n ON n.curriculum_structure_id = ss.id
          JOIN curriculum_node_types nt
            ON nt.id = n.node_type_id
           AND nt.status = 'ACTIVE'
         WHERE n.status = 'ACTIVE'
           AND NULLIF(BTRIM(n.description), '') IS NOT NULL
           AND (
             ($6::uuid IS NOT NULL AND (
               n.id = $6
               OR n.parent_node_id = $6
               OR n.id = (
                 SELECT parent.parent_node_id
                   FROM curriculum_nodes parent
                  WHERE parent.id = $6
                    AND parent.curriculum_structure_id = n.curriculum_structure_id
               )
             ))
             OR (
               $6::uuid IS NULL
               AND $5::uuid IS NOT NULL
               AND (n.id = $5 OR n.parent_node_id = $5)
             )
             OR ($6::uuid IS NULL AND $5::uuid IS NULL)
           )
        UNION ALL
        SELECT 'CURRICULUM_ELEMENT'::text AS "sourceKind",
               CASE
                 WHEN element_type.name IS NOT NULL
                   THEN element_type.name || ': ' || le.title
                 ELSE le.title
               END AS "sourceLabel",
               le.description AS content
          FROM scoped_structures ss
          JOIN curriculum_nodes n ON n.curriculum_structure_id = ss.id
          JOIN curriculum_node_types nt
            ON nt.id = n.node_type_id
           AND nt.status = 'ACTIVE'
          JOIN learning_elements le
            ON le.curriculum_node_id = n.id
           AND le.status = 'ACTIVE'
          JOIN learning_element_types element_type
            ON element_type.id = le.element_type_id
           AND element_type.status = 'ACTIVE'
         WHERE n.status = 'ACTIVE'
           AND NULLIF(BTRIM(le.description), '') IS NOT NULL
           AND (
             ($6::uuid IS NOT NULL AND (
               n.id = $6
               OR n.parent_node_id = $6
               OR n.id = (
                 SELECT parent.parent_node_id
                   FROM curriculum_nodes parent
                  WHERE parent.id = $6
                    AND parent.curriculum_structure_id = n.curriculum_structure_id
               )
             ))
             OR (
               $6::uuid IS NULL
               AND $5::uuid IS NOT NULL
               AND (n.id = $5 OR n.parent_node_id = $5)
             )
             OR ($6::uuid IS NULL AND $5::uuid IS NULL)
           )
        ORDER BY "sourceKind", "sourceLabel"
        LIMIT 100`,
        [
          input.organizationId,
          input.classId,
          input.syllabusId,
          input.subjectId,
          input.chapterId,
          input.topicId,
        ]
      ),
      this.db.query<{
        sourceKind: "LEARNING_RESOURCE";
        sourceLabel: string;
        content: string;
      }>(
        `SELECT 'LEARNING_RESOURCE'::text AS "sourceKind",
                lr.title AS "sourceLabel",
                lr.description AS content
           FROM learning_resources lr
          WHERE lr.organization_id = $1
            AND lr.status = 'PUBLISHED'
            AND lr.approved_by_user_id IS NOT NULL
            AND lr.approved_at IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM organization_members creator_member
                JOIN roles creator_role ON creator_role.id = creator_member.role_id
               WHERE creator_member.organization_id = lr.organization_id
                 AND creator_member.user_id = lr.created_by_user_id
                 AND creator_member.status = 'ACTIVE'
                 AND creator_role.name IN ('SCHOOL_ADMIN', 'COACHING_ADMIN', 'TEACHER')
            )
            AND EXISTS (
              SELECT 1
                FROM organization_members approver_member
                JOIN roles approver_role ON approver_role.id = approver_member.role_id
               WHERE approver_member.organization_id = lr.organization_id
                 AND approver_member.user_id = lr.approved_by_user_id
                 AND approver_member.status = 'ACTIVE'
                 AND approver_role.name IN ('SCHOOL_ADMIN', 'COACHING_ADMIN')
            )
            AND lr.resource_type IN (
              'TEXTBOOK',
              'TEACHER_NOTES',
              'WORKSHEET',
              'QUESTION_BANK',
              'PREVIOUS_YEAR_PAPER',
              'SYLLABUS_DOCUMENT',
              'FORMULA_SHEET'
            )
            AND lr.visibility IN ('ORGANIZATION', 'CLASS')
            AND NULLIF(BTRIM(lr.description), '') IS NOT NULL
            AND (
              (lr.curriculum_node_id IS NULL AND lr.class_id = $2)
              OR (
                lr.curriculum_node_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                    FROM curriculum_nodes n
                    JOIN curriculum_structures cs
                      ON cs.id = n.curriculum_structure_id
                     AND cs.status = 'ACTIVE'
                    JOIN syllabus_versions sv
                      ON sv.id = cs.syllabus_version_id
                     AND sv.status = 'ACTIVE'
                     AND (sv.effective_from IS NULL OR sv.effective_from <= CURRENT_DATE)
                     AND (sv.effective_to IS NULL OR sv.effective_to >= CURRENT_DATE)
                    JOIN syllabi s
                      ON s.id = sv.syllabus_id
                     AND s.class_id = $2
                     AND s.id = $3
                     AND s.is_authoritative = TRUE
                     AND s.status = 'ACTIVE'
                    JOIN classes c
                      ON c.id = s.class_id
                     AND c.organization_id = $1
                     AND c.status = 'ACTIVE'
                    LEFT JOIN curriculum_versions cv
                      ON cv.id = sv.curriculum_version_id
                     AND cv.board_id = s.board_id
                    JOIN curriculum_node_types nt
                      ON nt.id = n.node_type_id
                     AND nt.status = 'ACTIVE'
                   WHERE n.id = lr.curriculum_node_id
                     AND n.status = 'ACTIVE'
                     AND ($4::uuid IS NULL OR cs.subject_id = $4)
                     AND (
                       cv.id IS NULL
                       OR (
                         cv.status = 'ACTIVE'
                         AND (cv.effective_from IS NULL OR cv.effective_from <= CURRENT_DATE)
                         AND (cv.effective_to IS NULL OR cv.effective_to >= CURRENT_DATE)
                       )
                     )
                     AND (
                       (
                         $6::uuid IS NOT NULL
                         AND (
                           n.id = $6
                           OR n.parent_node_id = $6
                           OR n.id = (
                             SELECT parent.parent_node_id
                               FROM curriculum_nodes parent
                              WHERE parent.id = $6
                                AND parent.curriculum_structure_id = n.curriculum_structure_id
                           )
                         )
                       )
                       OR (
                         $6::uuid IS NULL
                         AND $7::uuid IS NOT NULL
                         AND (n.id = $7 OR n.parent_node_id = $7)
                       )
                       OR ($6::uuid IS NULL AND $7::uuid IS NULL)
                     )
                )
              )
            )
            AND (
              lr.visibility = 'ORGANIZATION'
              OR (
                lr.visibility = 'CLASS'
                AND lr.class_id = $2
                AND EXISTS (
                  SELECT 1
                    FROM student_enrollments se
                    JOIN students_v2 student
                      ON student.id = se.student_id
                     AND student.organization_id = se.organization_id
                     AND student.status = 'ACTIVE'
                   WHERE se.organization_id = $1
                     AND se.student_id = $5
                     AND se.class_id = $2
                     AND se.status = 'ACTIVE'
                )
              )
            )
            AND (
              lr.language_code IS NULL
              OR EXISTS (
                SELECT 1
                  FROM syllabus_languages sl
                  JOIN languages l ON l.id = sl.language_id
                 WHERE sl.syllabus_id = $3
                   AND l.status = 'ACTIVE'
                   AND (
                     LOWER(BTRIM(l.code)) = LOWER(BTRIM(lr.language_code))
                     OR LOWER(BTRIM(l.name)) = LOWER(BTRIM(lr.language_code))
                   )
              )
            )
          ORDER BY lr.title ASC, lr.id ASC
          LIMIT 50`,
        [
          input.organizationId,
          input.classId,
          input.syllabusId,
          input.subjectId,
          input.studentId,
          input.topicId,
          input.chapterId,
        ]
      ),
    ]);

    const primarySourceCount = Number(primarySources.rows[0]?.primary_source_count ?? 0);
    return {
      primarySourceCount,
      sources: [
        ...primaryEvidence.rows.map((row) => ({ ...row, authority: "AUTHORITATIVE_CURRICULUM" as const })),
        ...supportingEvidence.rows.map((row) => ({ ...row, authority: "APPROVED_PUBLISHED_RESOURCE" as const })),
      ],
    };
  }
}

export const boardEvidenceRepository = new BoardEvidenceRepository();
