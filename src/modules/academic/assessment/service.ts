import type { Request } from "express";
import type { AuthenticatedUser } from "../../../auth/tokens.js";
import { AuthorizationError, resolveOrganizationContext } from "../../../auth/organization.js";
import * as curriculumService from "../../curriculum/service.js";
import * as repository from "./repository.js";
import { AssessmentValidationError, validateComponent, validateEvent, validatePortion, validateScheme, uuid } from "./validation.js";
import type { CreateAssessmentEventInput, CreateAssessmentPortionInput, CreateAssessmentSchemeComponentInput, CreateAssessmentSchemeInput } from "./types.js";

const notFound = (name: string) => { const error = new AssessmentValidationError(`${name} was not found.`); error.code = "NOT_FOUND"; return error; };
const admin = (role: string) => { if (!["PLATFORM_REFERENCE_ADMIN"].includes(role)) throw new AuthorizationError("ROLE_REQUIRED","Reference assessment scheme administration is not available to organization-scoped users."); };
const schemeTransition = (from: string, to: string) => (from === "DRAFT" && to === "VALIDATED") || (from === "VALIDATED" && to === "PUBLISHED") || (from === "PUBLISHED" && to === "RETIRED");
export const isValidEventTransition = (from: string, to: string) => from === to || (from === "DRAFT" && to === "SCHEDULED") || (from === "SCHEDULED" && (to === "COMPLETED" || to === "CANCELLED"));

export async function createScheme(req: Request, user: AuthenticatedUser, input: CreateAssessmentSchemeInput) { validateScheme(input); admin((await resolveOrganizationContext(req,user)).role.name); return (await repository.createScheme({...input,boardId:uuid(input.boardId,"Board id"),schemeCode:input.schemeCode.trim(),name:input.name.trim(),version:input.version.trim()})).rows[0]; }
export async function listSchemes(boardId?: string) { return (await repository.listSchemes(boardId ? uuid(boardId,"Board id") : undefined)).rows; }
export async function changeSchemeStatus(req: Request, user: AuthenticatedUser, id: string, status: "VALIDATED"|"PUBLISHED"|"RETIRED") { admin((await resolveOrganizationContext(req,user)).role.name); const scheme=(await repository.getScheme(uuid(id,"Scheme id"))).rows[0]; if(!scheme) throw notFound("Assessment scheme"); if(!schemeTransition(scheme.status,status)) throw new AssessmentValidationError(`Invalid scheme lifecycle transition: ${scheme.status} -> ${status}`); return (await repository.setSchemeStatus(scheme.id,status)).rows[0]; }
export async function addComponent(req: Request, user: AuthenticatedUser, input: CreateAssessmentSchemeComponentInput) { validateComponent(input); admin((await resolveOrganizationContext(req,user)).role.name); const scheme=(await repository.getScheme(uuid(input.schemeId,"Scheme id"))).rows[0]; if(!scheme) throw notFound("Assessment scheme"); if(scheme.status !== "DRAFT") throw new AssessmentValidationError("Published schemes cannot be changed."); return (await repository.createComponent(input)).rows[0]; }
export async function listComponents(schemeId: string) { return (await repository.listComponents(uuid(schemeId,"Scheme id"))).rows; }
async function validateEventReferences(input: CreateAssessmentEventInput, organizationId: string) {
  if (input.calendarPeriodId && !input.calendarId) throw new AssessmentValidationError("Calendar period requires a calendar.");
  if (!(await repository.getAcademicYear(input.academicYearId)).rows[0]) throw notFound("Academic year");
  if (!(await repository.getClassOrganization(input.classId, organizationId)).rows[0]) throw notFound("Class");
  if (input.subjectId && !(await repository.getClassSubject(organizationId, input.classId, input.subjectId)).rows[0]) throw new AssessmentValidationError("Subject is not assigned to the class.");
  if (input.calendarId) {
    const calendar = (await repository.getCalendarForEvent(input.calendarId, organizationId)).rows[0];
    if (!calendar) throw new AssessmentValidationError("Calendar is not available to this organization.");
    if (calendar.academic_year_id !== input.academicYearId) throw new AssessmentValidationError("Calendar academic year must match the assessment event.");
    if (calendar.scope === "REFERENCE" && calendar.status !== "PUBLISHED") throw new AssessmentValidationError("Reference calendar must be published.");
    if (input.calendarPeriodId) {
      const period = (await repository.getPeriodForCalendar(input.calendarPeriodId, input.calendarId)).rows[0];
      if (!period) throw new AssessmentValidationError("Calendar period does not belong to the selected calendar.");
    }
  }
  if (input.assessmentSchemeVersionId) {
    const scheme = (await repository.getAssessmentScheme(input.assessmentSchemeVersionId)).rows[0];
    if (!scheme) throw new AssessmentValidationError("Assessment scheme is not published or was not found.");
    if (scheme.academic_year_id && scheme.academic_year_id !== input.academicYearId) throw new AssessmentValidationError("Assessment scheme academic year must match the assessment event.");
  }
  if (input.assessmentTypeId && !(await repository.getAssessmentType(input.assessmentTypeId)).rows[0]) throw notFound("Assessment type");
}
const eventStatuses = new Set(["DRAFT", "SCHEDULED", "COMPLETED", "CANCELLED"]);
const eventTransition = isValidEventTransition;
export async function createEvent(req: Request, user: AuthenticatedUser, input: CreateAssessmentEventInput) { validateEvent(input); const context=await resolveOrganizationContext(req,user); if(!["SCHOOL_ADMIN","COACHING_ADMIN","TEACHER"].includes(context.role.name)) throw new AuthorizationError("ROLE_REQUIRED","You do not have permission to schedule assessments."); await validateEventReferences(input, context.organization.id); return (await repository.createEvent({...input,organizationId:context.organization.id,title:input.title.trim()})).rows[0]; }
export async function createEventWithPortions(req: Request, user: AuthenticatedUser, input: CreateAssessmentEventInput, portions: CreateAssessmentPortionInput[]) { validateEvent(input); portions.forEach(validatePortion); const context=await resolveOrganizationContext(req,user); if(!["SCHOOL_ADMIN","COACHING_ADMIN","TEACHER"].includes(context.role.name)) throw new AuthorizationError("ROLE_REQUIRED","You do not have permission to schedule assessments."); await validateEventReferences(input, context.organization.id); for (const portion of portions) await validatePortionAccess(req, user, input, portion, context.organization.id); return repository.createEventWithPortions({...input,organizationId:context.organization.id,title:input.title.trim()}, portions); }
export async function listEvents(req: Request, user: AuthenticatedUser, academicYearId?: string) { const context=await resolveOrganizationContext(req,user); return (await repository.listEvents(context.organization.id,academicYearId ? uuid(academicYearId,"Academic year id") : undefined)).rows; }
export async function getEvent(req: Request, user: AuthenticatedUser, id: string) { const normalized=uuid(id,"Assessment event id"); const context=await resolveOrganizationContext(req,user); const event=(await repository.getEventForOrganization(normalized,context.organization.id)).rows[0]; if(!event) throw notFound("Assessment event"); return event; }
export async function changeEventStatus(req: Request, user: AuthenticatedUser, id: string, status: string) { if(!eventStatuses.has(status)) throw new AssessmentValidationError("Assessment event status is invalid."); const event=await getEvent(req,user,id); const context=await resolveOrganizationContext(req,user,event.organization_id); if(!["SCHOOL_ADMIN","COACHING_ADMIN","TEACHER"].includes(context.role.name)) throw new AuthorizationError("ROLE_REQUIRED","You do not have permission to update assessments."); if(!eventTransition(event.status,status)) throw new AssessmentValidationError(`Invalid event lifecycle transition: ${event.status} -> ${status}`); return (await repository.setEventStatus(event.id,status)).rows[0]; }
async function validatePortionAccess(req: Request, user: AuthenticatedUser, event: CreateAssessmentEventInput, portion: CreateAssessmentPortionInput, organizationId: string) {
  const structure=(await repository.getPortionStructureContext(portion.curriculumStructureId)).rows[0]; if(!structure) throw notFound("Curriculum structure");
  if (structure.organization_id && structure.organization_id !== organizationId) throw new AuthorizationError("ORGANIZATION_ACCESS_DENIED","Curriculum structure belongs to another organization.");
  const year=structure.syllabus_academic_year_id ?? structure.dataset_academic_year_id; if(year !== event.academicYearId) throw new AssessmentValidationError("Curriculum structure academic year must match the assessment event.");
  if (event.assessmentSchemeVersionId) {
    const scheme = (await repository.getScheme(event.assessmentSchemeVersionId)).rows[0];
    const board = structure.syllabus_board_id ?? structure.dataset_board_id;
    if (scheme && board && board !== scheme.board_id) throw new AssessmentValidationError("Curriculum structure board must match the assessment scheme.");
  }
  if (structure.class_id) {
    if (structure.class_id !== event.classId) throw new AssessmentValidationError("Curriculum structure must belong to the assessment class.");
    await curriculumService.getClassForUser(req, user, structure.class_id, "read");
  }
  if (portion.sourceType && portion.sourceType !== "BOARD_CURRICULUM") throw new AssessmentValidationError("This curriculum source type is not supported yet.");
  if (portion.curriculumNodeId) { const node=(await repository.getNodeStructure(portion.curriculumNodeId)).rows[0]; if(!node || node.curriculum_structure_id !== portion.curriculumStructureId) throw new AssessmentValidationError("Curriculum node must belong to the selected structure."); }
}
export async function addPortion(req: Request, user: AuthenticatedUser, input: CreateAssessmentPortionInput) { validatePortion(input); const event=await getEvent(req,user,input.assessmentEventId); await validatePortionAccess(req,user,event,input,event.organization_id); return (await repository.createPortion(input)).rows[0]; }
export async function listPortions(req: Request, user: AuthenticatedUser, eventId: string) { const event=await getEvent(req,user,eventId); return (await repository.listPortions(event.id)).rows; }
export async function linkSchemeCurriculum(req: Request, user: AuthenticatedUser, schemeId: string, curriculumVersionId: string) { admin((await resolveOrganizationContext(req,user)).role.name); const scheme=(await repository.getScheme(uuid(schemeId,"Scheme id"))).rows[0]; if(!scheme) throw notFound("Assessment scheme"); const curriculum=(await repository.getCurriculumVersion(uuid(curriculumVersionId,"Curriculum version id"))).rows[0]; if(!curriculum) throw notFound("Curriculum version"); if(curriculum.board_id !== scheme.board_id) throw new AssessmentValidationError("Assessment scheme and curriculum version must use the same board."); return (await repository.addSchemeCurriculum(scheme.id,curriculum.id)).rows[0]; }

export const createAssessmentScheme = createScheme;
export const createAssessmentEvent = createEvent;
export const createAssessmentEventWithPortions = createEventWithPortions;
