import crypto from "node:crypto";
import type { CurriculumConfiguration } from "./types.js";
import { validateConfiguration } from "./validation.js";
import pool from "../../../db.js";

export async function loadConfiguration(configuration: CurriculumConfiguration, options: { dryRun?: boolean; publish?: boolean } = {}) {
  validateConfiguration(configuration);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const checksum = crypto.createHash("sha256").update(JSON.stringify(configuration)).digest("hex");
    const existing = await client.query(`SELECT d.id,d.status,d.checksum FROM curriculum_reference_datasets d JOIN curriculum_versions cv ON cv.id=d.curriculum_version_id JOIN boards b ON b.id=cv.board_id WHERE lower(b.code)=lower($1) AND lower(cv.version)=lower($2) AND lower(d.dataset_code)=lower($3) AND lower(d.dataset_version)=lower($4)`, [configuration.boardCode,configuration.version,configuration.datasetCode,configuration.datasetVersion]);
    if (existing.rows[0] && ["PUBLISHED","RETIRED"].includes(existing.rows[0].status)) {
      if (existing.rows[0].checksum !== checksum) throw new Error("Published dataset identity conflicts with supplied configuration");
      if (options.dryRun) {
        await client.query("ROLLBACK");
        return { dataset: existing.rows[0], dryRun: true };
      }
      await client.query("COMMIT");
      return { dataset: existing.rows[0], dryRun: false };
    }
    const board = await client.query("SELECT id FROM boards WHERE lower(code)=lower($1) AND status='ACTIVE'", [configuration.boardCode]);
    if (!board.rows[0]) throw new Error(`Unknown active board: ${configuration.boardCode}`);
    const language = await client.query("SELECT code FROM languages WHERE lower(code)=ANY($1::text[]) AND status='ACTIVE'", [configuration.languages.map(x => x.toLowerCase())]);
    if (language.rows.length !== configuration.languages.length) throw new Error("Configuration references unknown language");
    const mediums = await client.query("SELECT code FROM mediums WHERE lower(code)=ANY($1::text[]) AND status='ACTIVE'", [configuration.mediumCodes.map(x => x.toLowerCase())]);
    if (mediums.rows.length !== configuration.mediumCodes.length) throw new Error("Configuration references unknown medium");
    const ayExisting = await client.query("SELECT id FROM academic_years WHERE lower(code)=lower($1)", [configuration.academicYear.code]);
    const ay = ayExisting.rows[0]
      ? await client.query("UPDATE academic_years SET name=$2,start_date=$3,end_date=$4 WHERE id=$1 RETURNING id", [ayExisting.rows[0].id, configuration.academicYear.name, configuration.academicYear.startDate, configuration.academicYear.endDate])
      : await client.query("INSERT INTO academic_years(code,name,start_date,end_date) VALUES($1,$2,$3,$4) RETURNING id", [configuration.academicYear.code,configuration.academicYear.name,configuration.academicYear.startDate,configuration.academicYear.endDate]);
    const eyExisting = await client.query("SELECT id FROM examination_years WHERE lower(code)=lower($1)", [configuration.examinationYear.code]);
    const ey = eyExisting.rows[0]
      ? await client.query("UPDATE examination_years SET name=$2,year_value=$3 WHERE id=$1 RETURNING id", [eyExisting.rows[0].id, configuration.examinationYear.name, configuration.examinationYear.yearValue])
      : await client.query("INSERT INTO examination_years(code,name,year_value) VALUES($1,$2,$3) RETURNING id", [configuration.examinationYear.code,configuration.examinationYear.name,configuration.examinationYear.yearValue]);
    const cvExisting = await client.query("SELECT id FROM curriculum_versions WHERE board_id=$1 AND lower(version)=lower($2)", [board.rows[0].id, configuration.version]);
    const cv = cvExisting.rows[0]
      ? await client.query("UPDATE curriculum_versions SET academic_year_id=$2,examination_year_id=$3,source_metadata=$4 WHERE id=$1 RETURNING id", [cvExisting.rows[0].id, ay.rows[0].id, ey.rows[0].id, configuration.source.citation ?? {}])
      : await client.query("INSERT INTO curriculum_versions(board_id,academic_year_id,examination_year_id,version,source_metadata) VALUES($1,$2,$3,$4,$5) RETURNING id", [board.rows[0].id,ay.rows[0].id,ey.rows[0].id,configuration.version,configuration.source.citation ?? {}]);
    const datasetExisting = await client.query("SELECT id,status,checksum FROM curriculum_reference_datasets WHERE curriculum_version_id=$1 AND lower(dataset_code)=lower($2) AND lower(dataset_version)=lower($3)", [cv.rows[0].id, configuration.datasetCode, configuration.datasetVersion]);
    const dataset = datasetExisting.rows[0]
      ? await client.query("UPDATE curriculum_reference_datasets SET source_name=$2,source_uri=$3,citation_metadata=$4,checksum=$5,loaded_at=now() WHERE id=$1 RETURNING id,status,checksum", [datasetExisting.rows[0].id,configuration.source.name,configuration.source.uri ?? null,configuration.source.citation ?? {},checksum])
      : await client.query("INSERT INTO curriculum_reference_datasets(curriculum_version_id,dataset_code,dataset_version,source_name,source_uri,citation_metadata,checksum,loaded_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,now(),'DRAFT') RETURNING id,status,checksum", [cv.rows[0].id,configuration.datasetCode,configuration.datasetVersion,configuration.source.name,configuration.source.uri ?? null,configuration.source.citation ?? {},checksum]);
    if (dataset.rows[0].status !== "DRAFT" && dataset.rows[0].checksum !== checksum) throw new Error("Published dataset identity is immutable; create a new dataset version");
    if (options.dryRun) { await client.query("ROLLBACK"); return { dataset: dataset.rows[0], dryRun: true }; }
    const datasetId = dataset.rows[0].id;
    for (const structure of configuration.structures) {
      const s = await client.query(`INSERT INTO curriculum_structures(reference_dataset_id,structure_key,structure_kind,name,reference_metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT (reference_dataset_id,(lower(structure_key))) WHERE reference_dataset_id IS NOT NULL AND structure_key IS NOT NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`, [datasetId,structure.key,structure.kind,structure.name,{source:configuration.source.name}]);
      const nodeIds = new Map<string,string>();
      for (const node of structure.nodes) {
        const type = await client.query("SELECT id FROM curriculum_node_types WHERE lower(code)=lower($1) AND status='ACTIVE'", [node.type]);
        if (!type.rows[0]) throw new Error(`Unknown node type: ${node.type}`);
        const n = await client.query(`INSERT INTO curriculum_nodes(curriculum_structure_id,node_key,parent_node_id,node_type_id,title,sequence_number,description) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (curriculum_structure_id,(lower(node_key))) WHERE node_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,sequence_number=EXCLUDED.sequence_number RETURNING id`, [s.rows[0].id,node.key,node.parentKey ? nodeIds.get(node.parentKey) : null,type.rows[0].id,node.title,node.sequence ?? null,node.description ?? null]);
        nodeIds.set(node.key,n.rows[0].id);
        for (const code of node.knowledgeCodes ?? []) {
          const knowledge = await client.query(`INSERT INTO knowledge_items(kind,code,name) VALUES('CONCEPT',$1,$2) ON CONFLICT ((lower(code))) WHERE code IS NOT NULL DO NOTHING RETURNING id`, [code, node.title]);
          if (!knowledge.rows[0]) { const existingKnowledge = await client.query("SELECT id FROM knowledge_items WHERE lower(code)=lower($1)", [code]); knowledge.rows.push(existingKnowledge.rows[0]); }
          await client.query(`INSERT INTO curriculum_node_knowledge_items(curriculum_node_id,knowledge_item_id,coverage_level) VALUES($1,$2,'PARTIAL') ON CONFLICT DO NOTHING`, [n.rows[0].id, knowledge.rows[0].id]);
        }
        for (const element of node.elements ?? []) {
          const et = await client.query("SELECT id FROM learning_element_types WHERE lower(code)=lower($1) AND status='ACTIVE'", [element.type]);
          if (!et.rows[0]) throw new Error(`Unknown element type: ${element.type}`);
          await client.query(`INSERT INTO learning_elements(curriculum_node_id,element_key,element_type_id,title) VALUES($1,$2,$3,$4) ON CONFLICT (curriculum_node_id,(lower(element_key))) WHERE element_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title`, [n.rows[0].id,element.key,et.rows[0].id,element.title]);
        }
      }
    }
    await client.query("UPDATE curriculum_reference_datasets SET status='VALIDATED' WHERE id=$1", [datasetId]);
    if (options.publish) await client.query("UPDATE curriculum_reference_datasets SET status='PUBLISHED' WHERE id=$1", [datasetId]);
    await client.query("COMMIT");
    return { dataset: { ...dataset.rows[0], status: options.publish ? "PUBLISHED" : "VALIDATED" }, dryRun: false };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
