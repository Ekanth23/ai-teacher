import * as repository from "./repository.js";
import { loadConfiguration } from "./loader.js";
import tn from "../tn-state-board/configuration.js";
import cbse from "../cbse/configuration.js";
import icse from "../icse/configuration.js";
import type { CurriculumConfiguration } from "./types.js";
import * as curriculumService from "../service.js";
const fixtures: Record<string, CurriculumConfiguration> = { TNSTATE: tn, CBSE: cbse, ICSE: icse };
const domainError = (message: string, code = "VALIDATION_ERROR") => { const e = new Error(message); (e as Error & { code?: string }).code = code; return e; };
export const listLanguages = async () => (await repository.list("languages", "WHERE status='ACTIVE'")).rows;
export const listAcademicYears = async () => (await repository.list("academic_years", "WHERE status='ACTIVE'")).rows;
export const listExaminationYears = async () => (await repository.list("examination_years", "WHERE status='ACTIVE'")).rows;
export const listVersions = async (boardId?: string) => (await repository.query(`SELECT cv.*,b.code AS board_code FROM curriculum_versions cv JOIN boards b ON b.id=cv.board_id ${boardId ? "WHERE cv.board_id=$1" : ""} ORDER BY cv.version`, boardId ? [boardId] : [])).rows;
export const listDatasets = async () => (await repository.listDatasets()).rows;
export const getDataset = async (id: string) => { const r = await repository.getDataset(id); if (!r.rows[0]) { const e = new Error("Dataset not found"); (e as Error & {code?:string}).code="NOT_FOUND"; throw e; } return r.rows[0]; };
export const load = async (config: CurriculumConfiguration, options?: {dryRun?:boolean;publish?:boolean}) => {
  try { return await loadConfiguration(config, options); } catch (error) {
    if (error && typeof error === "object" && !(error as {code?: string}).code) (error as {code?: string}).code = "VALIDATION_ERROR";
    throw error;
  }
};
export const getFixture = (boardCode: string) => fixtures[boardCode.toUpperCase()];
export const publish = async (id: string) => { const d = await getDataset(id); if (d.status !== "VALIDATED") throw domainError("Only validated datasets can be published"); return (await repository.query("UPDATE curriculum_reference_datasets SET status='PUBLISHED' WHERE id=$1 RETURNING *",[id])).rows[0]; };
export async function attachVersion(req: any, user: any, versionId: string, curriculumVersionId: string) {
  const context = await repository.getVersionContext(versionId);
  if (!context.rows[0]) throw domainError("Syllabus version not found", "NOT_FOUND");
  await curriculumService.getClassForUser(req, user, context.rows[0].class_id, "manage");
  const cv = (await repository.query("SELECT id,board_id FROM curriculum_versions WHERE id=$1 AND status='ACTIVE'", [curriculumVersionId])).rows[0];
  if (!cv) throw domainError("Curriculum version not found", "NOT_FOUND");
  if (cv.board_id !== context.rows[0].board_id) throw domainError("Curriculum version board does not match syllabus board");
  return (await repository.attachVersion(versionId, curriculumVersionId, context.rows[0].board_id)).rows[0];
}
export async function datasetsForVersion(req: any, user: any, versionId: string) {
  const context = await repository.getVersionContext(versionId); if (!context.rows[0]) throw domainError("Syllabus version not found", "NOT_FOUND");
  await curriculumService.getClassForUser(req,user,context.rows[0].class_id,"read");
  return (await repository.listDatasetsForBoard(context.rows[0].board_id)).rows;
}
export async function materialize(req: any, user: any, versionId: string, datasetId: string) {
  const context=await repository.getVersionContext(versionId); if(!context.rows[0]) throw domainError("Syllabus version not found", "NOT_FOUND");
  await curriculumService.getClassForUser(req,user,context.rows[0].class_id,"manage");
  const client=await repository.getClient(); try { await client.query("BEGIN"); const result=await repository.materialize(client,versionId,datasetId); await client.query("COMMIT"); return result; } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export async function syllabusLanguages(req:any,user:any,syllabusId:string) {
  const syllabus=await curriculumService.getSyllabusById(req,user,syllabusId); return (await repository.listSyllabusLanguages(syllabus.id)).rows;
}
export async function addSyllabusLanguage(req:any,user:any,syllabusId:string,code:string,role:string) {
  const syllabus=await curriculumService.getSyllabusById(req,user,syllabusId); await curriculumService.getClassForUser(req,user,syllabus.class_id,"manage");
  const result=await repository.setSyllabusLanguage(syllabus.id,code,role); if(!result.rows[0]) throw domainError("Unknown or inactive language"); return result.rows[0];
}
