import pool from "../../../db.js";
import type { LearningElementInput, MappingProfileInput, NodeInput, StructureInput, KnowledgeItemInput, PathwayRequirementInput } from "./types.js";

export const listNodeTypes = () => pool.query("SELECT * FROM curriculum_node_types WHERE status = 'ACTIVE' ORDER BY name");
export const listElementTypes = () => pool.query("SELECT * FROM learning_element_types WHERE status = 'ACTIVE' ORDER BY name");
export const getSyllabusVersionClassId = (versionId: string) => pool.query(
  `SELECT c.id AS class_id
   FROM syllabus_versions sv
   JOIN syllabi s ON s.id = sv.syllabus_id
   JOIN classes c ON c.id = s.class_id
   WHERE sv.id = $1 LIMIT 1`,
  [versionId]
);
export const getStructureClassId = (structureId: string) => pool.query(
  `SELECT c.id AS class_id
   FROM curriculum_structures cs
   JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
   JOIN syllabi s ON s.id = sv.syllabus_id
   JOIN classes c ON c.id = s.class_id
   WHERE cs.id = $1 LIMIT 1`,
  [structureId]
);
export const getNodeClassId = (nodeId: string) => pool.query(
  `SELECT c.id AS class_id
   FROM curriculum_nodes n
   JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
   JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
   JOIN syllabi s ON s.id = sv.syllabus_id
   JOIN classes c ON c.id = s.class_id
   WHERE n.id = $1 LIMIT 1`,
  [nodeId]
);
export const getParentNodeStructureId = (nodeId: string) => pool.query(
  "SELECT curriculum_structure_id FROM curriculum_nodes WHERE id = $1 LIMIT 1",
  [nodeId]
);
export const getPathwayStageVersionId = (stageId: string) => pool.query(
  "SELECT target_pathway_version_id FROM target_pathway_stages WHERE id = $1 LIMIT 1",
  [stageId]
);
export const getElementNodeClassId = (elementId: string) => pool.query(
  `SELECT c.id AS class_id
   FROM learning_elements le
   JOIN curriculum_nodes n ON n.id = le.curriculum_node_id
   JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
   JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
   JOIN syllabi s ON s.id = sv.syllabus_id
   JOIN classes c ON c.id = s.class_id
   WHERE le.id = $1 LIMIT 1`,
  [elementId]
);
export const getMappingProfileSourceTarget = (profileId: string) => pool.query(
  `SELECT cmp.source_syllabus_version_id, cmp.target_syllabus_version_id,
          src_c.id AS source_class_id, target_c.id AS target_class_id
   FROM curriculum_mapping_profiles cmp
   JOIN syllabus_versions src_sv ON src_sv.id = cmp.source_syllabus_version_id
   JOIN syllabi src_s ON src_s.id = src_sv.syllabus_id
   JOIN classes src_c ON src_c.id = src_s.class_id
   LEFT JOIN syllabus_versions target_sv ON target_sv.id = cmp.target_syllabus_version_id
   LEFT JOIN syllabi target_s ON target_s.id = target_sv.syllabus_id
   LEFT JOIN classes target_c ON target_c.id = target_s.class_id
   WHERE cmp.id = $1 LIMIT 1`,
  [profileId]
);
export const createStructure = (input: StructureInput) => pool.query(
  `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, reference_metadata, subject_id)
   VALUES ($1, $2, $3, $4, $5) RETURNING *`,
  [input.syllabusVersionId ?? null, input.structureKind, input.name, input.referenceMetadata ?? {}, input.subjectId ?? null]
);
export const updateStructureSubject = (structureId: string, subjectId: string) => pool.query(
  `UPDATE curriculum_structures SET subject_id = $2, updated_at = now() WHERE id = $1 RETURNING *`,
  [structureId, subjectId]
);
export const classHasSubject = (organizationId: string, classId: string, subjectId: string) => pool.query(
  "SELECT id FROM class_subjects WHERE organization_id = $1 AND class_id = $2 AND subject_id = $3 LIMIT 1",
  [organizationId, classId, subjectId]
);
export const listStructures = (syllabusVersionId: string) => pool.query(
  "SELECT * FROM curriculum_structures WHERE syllabus_version_id = $1 ORDER BY created_at",
  [syllabusVersionId]
);
export const createNode = (input: NodeInput) => pool.query(
  `INSERT INTO curriculum_nodes
   (curriculum_structure_id, parent_node_id, node_type_id, title, code, sequence_number, description, metadata)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [input.curriculumStructureId, input.parentNodeId ?? null, input.nodeTypeId, input.title, input.code ?? null,
    input.sequenceNumber ?? null, input.description ?? null, input.metadata ?? {}]
);
export const listNodes = (structureId: string) => pool.query(
  `SELECT n.*, t.code AS node_type_code, t.name AS node_type_name
   FROM curriculum_nodes n JOIN curriculum_node_types t ON t.id = n.node_type_id
   WHERE n.curriculum_structure_id = $1 ORDER BY n.sequence_number NULLS LAST, n.created_at`,
  [structureId]
);
export const getNode = (id: string) => pool.query("SELECT * FROM curriculum_nodes WHERE id = $1", [id]);
export const createLearningElement = (input: LearningElementInput) => pool.query(
  `INSERT INTO learning_elements (curriculum_node_id, element_type_id, title, description, metadata)
   VALUES ($1,$2,$3,$4,$5) RETURNING *`,
  [input.curriculumNodeId, input.elementTypeId, input.title, input.description ?? null, input.metadata ?? {}]
);
export const listKnowledgeItems = () => pool.query("SELECT * FROM knowledge_items WHERE status = 'ACTIVE' ORDER BY name");
export const createKnowledgeItem = (input: KnowledgeItemInput) => pool.query(
  `INSERT INTO knowledge_items
   (kind, code, name, description, expected_mastery, depth, complexity, difficulty, application_level, metadata)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [input.kind, input.code ?? null, input.name, input.description ?? null, input.expectedMastery ?? null,
    input.depth ?? null, input.complexity ?? null, input.difficulty ?? null, input.applicationLevel ?? null, input.metadata ?? {}]
);
export const addPrerequisite = (itemId: string, prerequisiteId: string) => pool.query(
  `INSERT INTO knowledge_item_prerequisites (knowledge_item_id, prerequisite_knowledge_item_id)
   VALUES ($1,$2) RETURNING *`, [itemId, prerequisiteId]
);
export const addProblemType = (itemId: string, problemType: string) => pool.query(
  `INSERT INTO knowledge_item_problem_types (knowledge_item_id, problem_type) VALUES ($1,$2) RETURNING *`,
  [itemId, problemType]
);
export const mapNodeKnowledge = (nodeId: string, itemId: string, coverageLevel: string, depth: number | null) => pool.query(
  `INSERT INTO curriculum_node_knowledge_items (curriculum_node_id, knowledge_item_id, coverage_level, depth)
   VALUES ($1,$2,$3,$4) RETURNING *`, [nodeId, itemId, coverageLevel, depth]
);
export const listPathways = () => pool.query("SELECT * FROM target_pathways WHERE status = 'ACTIVE' ORDER BY name");
export const listPathwayVersions = (pathwayId: string) => pool.query(
  "SELECT * FROM target_pathway_versions WHERE target_pathway_id = $1 ORDER BY version", [pathwayId]
);
export const listPathwayStages = (versionId: string) => pool.query(
  "SELECT * FROM target_pathway_stages WHERE target_pathway_version_id = $1 ORDER BY sequence_number NULLS LAST, name", [versionId]
);
export const createPathwayRequirement = (input: PathwayRequirementInput) => pool.query(
  `INSERT INTO target_pathway_requirements
   (target_pathway_version_id, target_pathway_stage_id, knowledge_item_id, required_mastery, depth, complexity, difficulty, application_level, problem_type)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [input.targetPathwayVersionId, input.targetPathwayStageId ?? null, input.knowledgeItemId,
    input.requiredMastery ?? null, input.depth ?? null, input.complexity ?? null, input.difficulty ?? null,
    input.applicationLevel ?? null, input.problemType ?? null]
);
export const createMappingProfile = (input: MappingProfileInput) => pool.query(
  `INSERT INTO curriculum_mapping_profiles
   (source_syllabus_version_id, target_syllabus_version_id, target_pathway_version_id, target_type, rules)
   VALUES ($1,$2,$3,$4,$5) RETURNING *`,
  [input.sourceSyllabusVersionId, input.targetSyllabusVersionId ?? null, input.targetPathwayVersionId ?? null,
    input.targetType, input.rules ?? {}]
);
export const listMappingProfiles = (organizationId: string, userId: string, roleName: string) => pool.query(
  `SELECT cmp.*
   FROM curriculum_mapping_profiles cmp
   JOIN syllabus_versions sv ON sv.id = cmp.source_syllabus_version_id
   JOIN syllabi s ON s.id = sv.syllabus_id
   JOIN classes c ON c.id = s.class_id
   WHERE c.organization_id = $1
     AND (
       $3 IN ('SCHOOL_ADMIN', 'COACHING_ADMIN')
       OR EXISTS (
         SELECT 1
         FROM class_teacher_assignments cta
         JOIN teachers t ON t.id = cta.teacher_id
         WHERE cta.class_id = c.id AND t.organization_id = c.organization_id AND t.user_id = $2
       )
       OR (
         $3 = 'STUDENT'
         AND EXISTS (
           SELECT 1
           FROM student_enrollments se
           JOIN students_v2 st ON st.id = se.student_id
           WHERE se.class_id = c.id AND st.user_id = $2 AND se.status = 'ACTIVE'
         )
       )
     )
   ORDER BY cmp.created_at DESC`,
  [organizationId, userId, roleName]
);
