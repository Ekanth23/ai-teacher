import pool from "../../../db.js";
import type { CreateLearningResourceInput, UpdateLearningResourceInput } from "./types.js";

export const organizationActive = (id: string) => pool.query("SELECT id FROM organizations WHERE id = $1 AND status = 'ACTIVE'", [id]);

export const classInOrganization = (classId: string, organizationId: string) =>
  pool.query("SELECT id FROM classes WHERE id = $1 AND organization_id = $2", [classId, organizationId]);

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
     LIMIT 1`,
    [classId, organizationId, userId]
  );

export const nodeOrganization = (nodeId: string) =>
  pool.query(
    `SELECT c.organization_id
     FROM curriculum_nodes n
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     JOIN classes c ON c.id = s.class_id
     WHERE n.id = $1
     LIMIT 1`,
    [nodeId]
  );

export const getResource = (id: string) => pool.query("SELECT * FROM learning_resources WHERE id = $1 LIMIT 1", [id]);

export const isClassMember = (classId: string, userId: string, organizationId: string) =>
  pool.query(
    `SELECT 1 AS member WHERE EXISTS (
       SELECT 1 FROM class_teacher_assignments cta
       JOIN teachers t ON t.id = cta.teacher_id
       WHERE cta.class_id = $1 AND t.organization_id = $3 AND t.user_id = $2
     ) OR EXISTS (
       SELECT 1 FROM student_enrollments se
       JOIN students_v2 st ON st.id = se.student_id
       WHERE se.class_id = $1 AND st.user_id = $2 AND se.status = 'ACTIVE'
     )`,
    [classId, userId, organizationId]
  );

export type ListResourcesParams = {
  organizationId: string;
  userId: string;
  isContributor: boolean;
  isTeacher: boolean;
  curriculumNodeId?: string;
  classId?: string;
  resourceType?: string;
  status?: string;
};

export function listResources(params: ListResourcesParams) {
  const conditions: string[] = ["lr.organization_id = $1"];
  const values: unknown[] = [params.organizationId];
  let index = 2;

  if (params.curriculumNodeId) {
    conditions.push(`lr.curriculum_node_id = $${index++}`);
    values.push(params.curriculumNodeId);
  }
  if (params.classId) {
    conditions.push(`lr.class_id = $${index++}`);
    values.push(params.classId);
  }
  if (params.resourceType) {
    conditions.push(`lr.resource_type = $${index++}`);
    values.push(params.resourceType);
  }

  if (params.isContributor) {
    if (params.status) {
      conditions.push(`lr.status = $${index++}`);
      values.push(params.status);
    }
    if (params.isTeacher) {
      values.push(params.userId);
      const teacherIdx = index++;
      conditions.push(
        `(lr.created_by_user_id = $${teacherIdx} OR (lr.class_id IS NOT NULL AND EXISTS (
           SELECT 1
           FROM class_teacher_assignments cta
           JOIN teachers t ON t.id = cta.teacher_id
           WHERE cta.class_id = lr.class_id
             AND cta.organization_id = lr.organization_id
             AND t.organization_id = lr.organization_id
             AND t.user_id = $${teacherIdx}
             AND t.status = 'ACTIVE'
         )))`
      );
    }
  } else {
    values.push(params.userId);
    const userIdx = index++;
    conditions.push(
      `lr.status = 'PUBLISHED' AND (
         lr.visibility = 'ORGANIZATION'
         OR (lr.visibility = 'PRIVATE' AND lr.created_by_user_id = $${userIdx})
         OR (lr.visibility = 'CLASS' AND lr.class_id IS NOT NULL AND (
              EXISTS (
                SELECT 1 FROM class_teacher_assignments cta
                JOIN teachers t ON t.id = cta.teacher_id
                WHERE cta.class_id = lr.class_id AND t.organization_id = lr.organization_id AND t.user_id = $${userIdx}
              )
              OR EXISTS (
                SELECT 1 FROM student_enrollments se
                JOIN students_v2 st ON st.id = se.student_id
                WHERE se.class_id = lr.class_id AND st.user_id = $${userIdx} AND se.status = 'ACTIVE'
              )
         ))
       )`
    );
  }

  return pool.query(
    `SELECT lr.* FROM learning_resources lr WHERE ${conditions.join(" AND ")} ORDER BY lr.created_at DESC`,
    values
  );
}

export const createResource = (
  input: CreateLearningResourceInput & { organizationId: string; createdByUserId: string }
) =>
  pool.query(
    `INSERT INTO learning_resources
       (organization_id, curriculum_node_id, class_id, resource_type, title, description, language_code,
        file_url, file_name, mime_type, file_size_bytes, visibility, status, metadata, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'DRAFT', $13, $14)
     RETURNING *`,
    [
      input.organizationId,
      input.curriculumNodeId ?? null,
      input.classId ?? null,
      input.resourceType,
      input.title,
      input.description ?? null,
      input.languageCode ?? null,
      input.fileUrl,
      input.fileName ?? null,
      input.mimeType ?? null,
      input.fileSizeBytes ?? null,
      input.visibility ?? "ORGANIZATION",
      input.metadata ?? {},
      input.createdByUserId,
    ]
  );

export const updateResource = (id: string, input: UpdateLearningResourceInput) =>
  pool.query(
    `UPDATE learning_resources SET
       curriculum_node_id = COALESCE($2, curriculum_node_id),
       class_id = COALESCE($3, class_id),
       resource_type = COALESCE($4, resource_type),
       title = COALESCE($5, title),
       description = COALESCE($6, description),
       language_code = COALESCE($7, language_code),
       file_url = COALESCE($8, file_url),
       file_name = COALESCE($9, file_name),
       mime_type = COALESCE($10, mime_type),
       file_size_bytes = COALESCE($11, file_size_bytes),
       visibility = COALESCE($12, visibility),
       metadata = COALESCE($13, metadata),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.curriculumNodeId ?? null,
      input.classId ?? null,
      input.resourceType ?? null,
      input.title ?? null,
      input.description ?? null,
      input.languageCode ?? null,
      input.fileUrl ?? null,
      input.fileName ?? null,
      input.mimeType ?? null,
      input.fileSizeBytes ?? null,
      input.visibility ?? null,
      input.metadata ?? null,
    ]
  );

export const setStatus = (id: string, status: string, approvedByUserId: string | null = null) =>
  pool.query(
    `UPDATE learning_resources SET
       status = $2::varchar(20),
       approved_by_user_id = COALESCE($3, approved_by_user_id),
       approved_at = CASE WHEN $2::text = 'PUBLISHED' THEN now() ELSE approved_at END,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, approvedByUserId]
  );
