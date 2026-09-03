import pool from "../../../db.js";
import type { PoolClient } from "pg";
export const query = (text: string, values?: unknown[]) => pool.query(text, values);
export const getClient = () => pool.connect();
export async function list(table: string, where = "", values: unknown[] = []) {
  return query(`SELECT * FROM ${table} ${where} ORDER BY name`, values);
}
export async function getDataset(id: string) { return query("SELECT d.*, cv.board_id, cv.version AS curriculum_version FROM curriculum_reference_datasets d JOIN curriculum_versions cv ON cv.id=d.curriculum_version_id WHERE d.id=$1", [id]); }
export async function listDatasets() { return query("SELECT d.*, cv.board_id, b.code AS board_code, cv.version AS curriculum_version FROM curriculum_reference_datasets d JOIN curriculum_versions cv ON cv.id=d.curriculum_version_id JOIN boards b ON b.id=cv.board_id WHERE d.status IN ('PUBLISHED','RETIRED') ORDER BY d.created_at DESC"); }
export async function getVersionContext(id: string) { return query("SELECT sv.id,sv.syllabus_id,s.board_id,s.class_id FROM syllabus_versions sv JOIN syllabi s ON s.id=sv.syllabus_id WHERE sv.id=$1", [id]); }
export async function listDatasetsForBoard(boardId: string) { return query("SELECT d.*,cv.version AS curriculum_version FROM curriculum_reference_datasets d JOIN curriculum_versions cv ON cv.id=d.curriculum_version_id WHERE cv.board_id=$1 AND d.status='PUBLISHED' ORDER BY d.created_at DESC", [boardId]); }
export async function attachVersion(id: string, curriculumVersionId: string, boardId: string) { return query("UPDATE syllabus_versions SET curriculum_version_id=$1, board_id=$3 WHERE id=$2 RETURNING *", [curriculumVersionId,id,boardId]); }
export async function materialize(client: PoolClient, versionId: string, datasetId: string) {
  const d = await client.query("SELECT d.id,cv.board_id FROM curriculum_reference_datasets d JOIN curriculum_versions cv ON cv.id=d.curriculum_version_id WHERE d.id=$1 AND d.status='PUBLISHED'", [datasetId]);
  if (!d.rows[0]) throw new Error("Published dataset not found");
  const v = await client.query("SELECT sv.id,s.board_id FROM syllabus_versions sv JOIN syllabi s ON s.id=sv.syllabus_id WHERE sv.id=$1 FOR UPDATE", [versionId]);
  if (!v.rows[0] || v.rows[0].board_id !== d.rows[0].board_id) throw new Error("Dataset board does not match syllabus board");
  const structures = await client.query("SELECT * FROM curriculum_structures WHERE reference_dataset_id=$1 ORDER BY created_at", [datasetId]);
  for (const s of structures.rows) {
    const copy = await client.query("INSERT INTO curriculum_structures(syllabus_version_id,structure_kind,name,reference_metadata) VALUES($1,$2,$3,$4) RETURNING id", [versionId,s.structure_kind,s.name,{...s.reference_metadata,source_reference_dataset_id:datasetId,structure_key:s.structure_key}]);
    const nodes = await client.query("SELECT n.*,t.code AS node_type_code FROM curriculum_nodes n JOIN curriculum_node_types t ON t.id=n.node_type_id WHERE n.curriculum_structure_id=$1 ORDER BY n.sequence_number NULLS LAST,n.created_at", [s.id]);
    const ids = new Map<string,string>();
    for (const n of nodes.rows) {
      const type = await client.query("SELECT id FROM curriculum_node_types WHERE lower(code)=lower($1)", [n.node_type_code]);
      const inserted = await client.query("INSERT INTO curriculum_nodes(curriculum_structure_id,parent_node_id,node_type_id,title,code,sequence_number,description,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [copy.rows[0].id,n.parent_node_id ? ids.get(n.parent_node_id) : null,type.rows[0].id,n.title,n.code,n.sequence_number,n.description,{...n.metadata,source_node_key:n.node_key}]);
      ids.set(n.id,inserted.rows[0].id);
      const elements = await client.query("SELECT le.*,t.code AS element_type_code FROM learning_elements le JOIN learning_element_types t ON t.id=le.element_type_id WHERE le.curriculum_node_id=$1", [n.id]);
      for (const e of elements.rows) { const et=await client.query("SELECT id FROM learning_element_types WHERE lower(code)=lower($1)",[e.element_type_code]); await client.query("INSERT INTO learning_elements(curriculum_node_id,element_type_id,title,description,metadata) VALUES($1,$2,$3,$4,$5)",[inserted.rows[0].id,et.rows[0].id,e.title,e.description,{...e.metadata,source_element_key:e.element_key}]); }
      const mappings = await client.query("SELECT * FROM curriculum_node_knowledge_items WHERE curriculum_node_id=$1",[n.id]);
      for (const m of mappings.rows) await client.query("INSERT INTO curriculum_node_knowledge_items(curriculum_node_id,knowledge_item_id,coverage_level,depth,metadata) VALUES($1,$2,$3,$4,$5)",[inserted.rows[0].id,m.knowledge_item_id,m.coverage_level,m.depth,{...m.metadata,source_reference_dataset_id:datasetId}]);
    }
  }
  return (await client.query("UPDATE syllabus_versions SET source_reference_dataset_id=$1 WHERE id=$2 RETURNING *",[datasetId,versionId])).rows[0];
}
export async function listSyllabusLanguages(syllabusId: string) { return query("SELECT sl.*,l.code,l.name FROM syllabus_languages sl JOIN languages l ON l.id=sl.language_id WHERE sl.syllabus_id=$1 ORDER BY l.name", [syllabusId]); }
export async function setSyllabusLanguage(syllabusId: string, languageCode: string, role: string) { return query("INSERT INTO syllabus_languages(syllabus_id,language_id,language_role) SELECT $1,id,$3 FROM languages WHERE lower(code)=lower($2) AND status='ACTIVE' ON CONFLICT DO NOTHING RETURNING *", [syllabusId,languageCode,role]); }
export async function findBoard(code: string) { return query("SELECT * FROM boards WHERE lower(code)=lower($1) AND status='ACTIVE'", [code]); }
export async function upsertReference(c: PoolClient, sql: string, values: unknown[]) { return c.query(sql, values); }
