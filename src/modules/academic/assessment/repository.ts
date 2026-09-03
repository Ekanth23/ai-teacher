import pool from "../../../db.js";
import type { CreateAssessmentEventInput, CreateAssessmentPortionInput, CreateAssessmentSchemeComponentInput, CreateAssessmentSchemeInput, UpdateAssessmentEventInput } from "./types.js";

export const createScheme = (i: CreateAssessmentSchemeInput) => pool.query(`INSERT INTO assessment_scheme_versions (board_id,academic_year_id,scheme_code,name,version,source_metadata,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [i.boardId,i.academicYearId??null,i.schemeCode,i.name,i.version,i.sourceMetadata??{},i.metadata??{}]);
export const listAssessmentTypes = () => pool.query("SELECT id,code,name,description,status,metadata,created_at,updated_at FROM assessment_types WHERE status='ACTIVE' ORDER BY name,code");
export const getPublishedScheme = (id: string) => pool.query("SELECT * FROM assessment_scheme_versions WHERE id=$1 AND status='PUBLISHED'", [id]);
export const getScheme = (id: string) => pool.query("SELECT * FROM assessment_scheme_versions WHERE id=$1", [id]);
export const listSchemes = (boardId?: string) => pool.query("SELECT * FROM assessment_scheme_versions WHERE status='PUBLISHED' AND ($1::uuid IS NULL OR board_id=$1) ORDER BY name,version", [boardId??null]);
export const setSchemeStatus = (id: string, status: string) => pool.query("UPDATE assessment_scheme_versions SET status=$2,updated_at=now() WHERE id=$1 RETURNING *", [id,status]);
export const createComponent = (i: CreateAssessmentSchemeComponentInput) => pool.query(`INSERT INTO assessment_scheme_components (assessment_scheme_version_id,assessment_type_id,code,name,maximum_marks,weightage,duration_minutes,sequence_number,is_required,assessment_method,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [i.schemeId,i.assessmentTypeId,i.code,i.name,i.maximumMarks??null,i.weightage??null,i.durationMinutes??null,i.sequenceNumber??0,i.isRequired??true,i.assessmentMethod??null,i.metadata??{}]);
export const listComponents = (schemeId: string) => pool.query("SELECT * FROM assessment_scheme_components WHERE assessment_scheme_version_id=$1 ORDER BY sequence_number,code", [schemeId]);
export const createEvent = (i: CreateAssessmentEventInput) => pool.query(`INSERT INTO assessment_events (organization_id,academic_year_id,class_id,subject_id,calendar_id,calendar_period_id,assessment_scheme_version_id,assessment_type_id,title,scheduled_start,scheduled_end,status,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [i.organizationId,i.academicYearId,i.classId,i.subjectId??null,i.calendarId??null,i.calendarPeriodId??null,i.assessmentSchemeVersionId??null,i.assessmentTypeId??null,i.title,i.scheduledStart,i.scheduledEnd,i.status??"DRAFT",i.metadata??{}]);
export const getEvent = (id: string) => pool.query("SELECT * FROM assessment_events WHERE id=$1", [id]);
export const getEventForOrganization = (id: string, organizationId: string) => pool.query("SELECT * FROM assessment_events WHERE id=$1 AND organization_id=$2", [id, organizationId]);
export const listEvents = (organizationId: string, academicYearId?: string) => pool.query("SELECT * FROM assessment_events WHERE organization_id=$1 AND ($2::uuid IS NULL OR academic_year_id=$2) ORDER BY scheduled_start", [organizationId,academicYearId??null]);
export const setEventStatus = (id: string, status: string) => pool.query("UPDATE assessment_events SET status=$2,updated_at=now() WHERE id=$1 RETURNING *", [id,status]);
export const updateEvent = (id: string, organizationId: string, input: UpdateAssessmentEventInput) => pool.query(
  `UPDATE assessment_events SET subject_id=COALESCE($2,subject_id),calendar_id=COALESCE($3,calendar_id),
   calendar_period_id=COALESCE($4,calendar_period_id),assessment_scheme_version_id=COALESCE($5,assessment_scheme_version_id),
   assessment_type_id=COALESCE($6,assessment_type_id),title=COALESCE($7,title),scheduled_start=COALESCE($8,scheduled_start),
   scheduled_end=COALESCE($9,scheduled_end),metadata=COALESCE($10,metadata),updated_at=now()
   WHERE id=$1 AND organization_id=$11 RETURNING *`,
  [id,input.subjectId ?? null,input.calendarId ?? null,input.calendarPeriodId ?? null,input.assessmentSchemeVersionId ?? null,input.assessmentTypeId ?? null,input.title ?? null,input.scheduledStart ?? null,input.scheduledEnd ?? null,input.metadata ?? null,organizationId]);
export const createPortion = (i: CreateAssessmentPortionInput) => pool.query(`INSERT INTO assessment_event_curriculum_portions (assessment_event_id,curriculum_structure_id,curriculum_node_id,source_type,metadata) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [i.assessmentEventId,i.curriculumStructureId,i.curriculumNodeId??null,i.sourceType??"BOARD_CURRICULUM",i.metadata??{}]);
export const listPortions = (eventId: string) => pool.query("SELECT * FROM assessment_event_curriculum_portions WHERE assessment_event_id=$1 ORDER BY created_at,id", [eventId]);
export const getPortionStructureContext = (structureId: string) => pool.query(
  `SELECT cs.id AS curriculum_structure_id, cs.syllabus_version_id, cs.reference_dataset_id,
          sv.curriculum_version_id AS syllabus_curriculum_version_id,
          cv.academic_year_id AS syllabus_academic_year_id, cv.board_id AS syllabus_board_id,
          d.curriculum_version_id AS dataset_curriculum_version_id,
          dcv.academic_year_id AS dataset_academic_year_id, dcv.board_id AS dataset_board_id,
          s.class_id, c.organization_id
   FROM curriculum_structures cs
   LEFT JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
   LEFT JOIN curriculum_versions cv ON cv.id = sv.curriculum_version_id
   LEFT JOIN curriculum_reference_datasets d ON d.id = cs.reference_dataset_id
   LEFT JOIN curriculum_versions dcv ON dcv.id = d.curriculum_version_id
   LEFT JOIN syllabi s ON s.id = sv.syllabus_id
   LEFT JOIN classes c ON c.id = s.class_id
   WHERE cs.id=$1`, [structureId]);
export const getNodeStructure = (nodeId: string) => pool.query("SELECT id, curriculum_structure_id FROM curriculum_nodes WHERE id=$1", [nodeId]);
export const getClassSubject = (organizationId: string, classId: string, subjectId: string) => pool.query("SELECT id FROM class_subjects WHERE organization_id=$1 AND class_id=$2 AND subject_id=$3", [organizationId, classId, subjectId]);
export const getClassOrganization = (classId: string, organizationId: string) => pool.query("SELECT id FROM classes WHERE id=$1 AND organization_id=$2", [classId, organizationId]);
export const getAcademicYear = (id: string) => pool.query("SELECT id FROM academic_years WHERE id=$1", [id]);
export const getCalendarForEvent = (id: string, organizationId: string) => pool.query("SELECT * FROM academic_calendars WHERE id=$1 AND (scope='REFERENCE' OR organization_id=$2)", [id, organizationId]);
export const getAssessmentScheme = (id: string) => pool.query("SELECT * FROM assessment_scheme_versions WHERE id=$1 AND status='PUBLISHED'", [id]);
export const getAssessmentType = (id: string) => pool.query("SELECT id FROM assessment_types WHERE id=$1", [id]);
export const getCurriculumVersion = (id: string) => pool.query("SELECT id, board_id FROM curriculum_versions WHERE id=$1", [id]);
export const getPeriodForCalendar = (id: string, calendarId: string) => pool.query("SELECT id FROM academic_calendar_periods WHERE id=$1 AND calendar_id=$2", [id, calendarId]);
export const addSchemeCurriculum = (schemeId: string, curriculumVersionId: string) => pool.query("INSERT INTO assessment_scheme_curriculum_versions (assessment_scheme_version_id,curriculum_version_id) VALUES ($1,$2) RETURNING *", [schemeId,curriculumVersionId]);
export const deletePortionForEvent = (portionId: string, eventId: string) => pool.query("DELETE FROM assessment_event_curriculum_portions WHERE id=$1 AND assessment_event_id=$2 RETURNING *", [portionId,eventId]);
export async function createEventWithPortions(event: CreateAssessmentEventInput, portions: CreateAssessmentPortionInput[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`INSERT INTO assessment_events (organization_id,academic_year_id,class_id,subject_id,calendar_id,calendar_period_id,assessment_scheme_version_id,assessment_type_id,title,scheduled_start,scheduled_end,status,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [event.organizationId,event.academicYearId,event.classId,event.subjectId??null,event.calendarId??null,event.calendarPeriodId??null,event.assessmentSchemeVersionId??null,event.assessmentTypeId??null,event.title,event.scheduledStart,event.scheduledEnd,event.status??"DRAFT",event.metadata??{}]);
    const created = result.rows[0];
    for (const portion of portions) await client.query(`INSERT INTO assessment_event_curriculum_portions (assessment_event_id,curriculum_structure_id,curriculum_node_id,source_type,metadata) VALUES ($1,$2,$3,$4,$5)`, [created.id,portion.curriculumStructureId,portion.curriculumNodeId??null,portion.sourceType??"BOARD_CURRICULUM",portion.metadata??{}]);
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
