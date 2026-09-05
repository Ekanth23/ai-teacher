import pool from "../../../db.js";
import type { CreateNodeInput, UpdateChapterOrTopicInput } from "./types.js";

export const getNodeTypeIdByCode = (code: string) =>
  pool.query("SELECT id, code, name FROM curriculum_node_types WHERE lower(code) = lower($1) AND status = 'ACTIVE' LIMIT 1", [code]);

export const getStructureClassId = (structureId: string) =>
  pool.query(
    `SELECT c.id AS class_id, c.organization_id, cs.subject_id
     FROM curriculum_structures cs
     JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
     JOIN syllabi s ON s.id = sv.syllabus_id
     JOIN classes c ON c.id = s.class_id
     WHERE cs.id = $1
     LIMIT 1`,
    [structureId]
  );

export const getNodeDetail = (nodeId: string) =>
  pool.query(
    `SELECT n.*, t.code AS node_type_code, t.name AS node_type_name, cs.subject_id
     FROM curriculum_nodes n
     JOIN curriculum_node_types t ON t.id = n.node_type_id
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     WHERE n.id = $1
     LIMIT 1`,
    [nodeId]
  );

export const listChildNodesByType = (structureId: string, nodeTypeCode: string, parentNodeId: string | null) =>
  pool.query(
    `SELECT n.*, t.code AS node_type_code, t.name AS node_type_name, cs.subject_id
     FROM curriculum_nodes n
     JOIN curriculum_node_types t ON t.id = n.node_type_id
     JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
     WHERE n.curriculum_structure_id = $1
       AND lower(t.code) = lower($2)
       AND ((n.parent_node_id IS NULL AND $3::uuid IS NULL) OR n.parent_node_id = $3)
     ORDER BY n.sequence_number NULLS LAST, n.created_at`,
    [structureId, nodeTypeCode, parentNodeId]
  );

export const createNode = (input: CreateNodeInput) =>
  pool.query(
    `WITH inserted AS (
       INSERT INTO curriculum_nodes
         (curriculum_structure_id, parent_node_id, node_type_id, title, code, sequence_number, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *
     )
     SELECT inserted.*, t.code AS node_type_code, t.name AS node_type_name, cs.subject_id
     FROM inserted
     JOIN curriculum_node_types t ON t.id = inserted.node_type_id
     JOIN curriculum_structures cs ON cs.id = inserted.curriculum_structure_id`,
    [
      input.curriculumStructureId,
      input.parentNodeId ?? null,
      input.nodeTypeId,
      input.title,
      input.code ?? null,
      input.sequenceNumber ?? null,
      input.description ?? null,
      input.metadata ?? {},
    ]
  );

export const updateNode = (nodeId: string, input: UpdateChapterOrTopicInput) =>
  pool.query(
    `WITH updated AS (
       UPDATE curriculum_nodes SET
         title = COALESCE($2, title),
         code = COALESCE($3, code),
         sequence_number = COALESCE($4, sequence_number),
         description = COALESCE($5, description),
         metadata = COALESCE($6, metadata),
         status = COALESCE($7, status),
         updated_at = now()
       WHERE id = $1
       RETURNING *
     )
     SELECT updated.*, t.code AS node_type_code, t.name AS node_type_name, cs.subject_id
     FROM updated
     JOIN curriculum_node_types t ON t.id = updated.node_type_id
     JOIN curriculum_structures cs ON cs.id = updated.curriculum_structure_id`,
    [
      nodeId,
      input.title ?? null,
      input.code ?? null,
      input.sequenceNumber ?? null,
      input.description ?? null,
      input.metadata ?? null,
      input.status ?? null,
    ]
  );
