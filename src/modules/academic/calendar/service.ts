import type { Request } from "express";
import type { AuthenticatedUser } from "../../../auth/tokens.js";
import { AuthorizationError, resolveOrganizationContext } from "../../../auth/organization.js";
import * as repository from "./repository.js";
import { AcademicCalendarValidationError, requiredUuid, validateCalendarInput, validatePeriodInput } from "./validation.js";
import type { CreateAcademicCalendarInput, CreateAcademicCalendarPeriodInput, UpdateAcademicCalendarInput, UpdateAcademicCalendarPeriodInput } from "./types.js";

const notFound = (name: string) => { const error = new AcademicCalendarValidationError(`${name} was not found.`); error.code = "NOT_FOUND"; return error; };
const management = (role: string) => { if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(role)) throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to manage academic calendars."); };

async function validateReferences(input: CreateAcademicCalendarInput) {
  if (!(await repository.academicYearExists(input.academicYearId)).rows[0]) throw notFound("Academic year");
  if (input.boardId && !(await repository.boardExists(input.boardId)).rows[0]) throw notFound("Board");
  if (input.scope === "ORGANIZATION") {
    if (!input.organizationId || !(await repository.organizationExists(input.organizationId)).rows[0]) throw notFound("Organization");
  } else if (input.organizationId !== null && input.organizationId !== undefined) {
    throw new AcademicCalendarValidationError("Reference calendars cannot have an organization.");
  }
}

export async function list(req: Request, user: AuthenticatedUser) { const context = await resolveOrganizationContext(req, user); return (await repository.listCalendars(context.organization.id)).rows; }
export async function get(req: Request, user: AuthenticatedUser, id: string) { const normalized = requiredUuid(id, "Calendar id"); const context = await resolveOrganizationContext(req, user); const row = (await repository.getCalendar(normalized)).rows[0]; if (!row) throw notFound("Calendar"); if (row.scope === "ORGANIZATION" && row.organization_id !== context.organization.id) throw new AuthorizationError("ORGANIZATION_ACCESS_DENIED", "You are not authorized to access this calendar."); return row; }
export async function create(req: Request, user: AuthenticatedUser, input: CreateAcademicCalendarInput) {
  validateCalendarInput(input);
  if (input.scope === "ORGANIZATION") { const context = await resolveOrganizationContext(req, user); management(context.role.name); input = { ...input, organizationId: context.organization.id }; }
  else management((await resolveOrganizationContext(req, user)).role.name);
  await validateReferences(input);
  return (await repository.createCalendar({ ...input, academicYearId: requiredUuid(input.academicYearId, "Academic year id"), calendarCode: input.calendarCode.trim(), name: input.name.trim(), version: input.version.trim() })).rows[0];
}
export async function update(req: Request, user: AuthenticatedUser, id: string, input: UpdateAcademicCalendarInput) {
  validateCalendarInput(input);
  const calendar = await get(req, user, id);
  if (calendar.scope !== "ORGANIZATION") throw new AuthorizationError("ROLE_REQUIRED", "Reference calendars are not organization-editable.");
  const context = await resolveOrganizationContext(req, user, calendar.organization_id); management(context.role.name);
  if (input.academicYearId && !(await repository.academicYearExists(requiredUuid(input.academicYearId, "Academic year id"))).rows[0]) throw notFound("Academic year");
  return (await repository.updateCalendar(calendar.id, input)).rows[0];
}
export async function publish(req: Request, user: AuthenticatedUser, id: string) { return changeStatus(req, user, id, "PUBLISHED"); }
export async function retire(req: Request, user: AuthenticatedUser, id: string) { return changeStatus(req, user, id, "RETIRED"); }
async function changeStatus(req: Request, user: AuthenticatedUser, id: string, status: "PUBLISHED" | "RETIRED") {
  const calendar = await get(req, user, id); if (calendar.scope === "ORGANIZATION") management((await resolveOrganizationContext(req, user, calendar.organization_id)).role.name);
  else management((await resolveOrganizationContext(req, user)).role.name);
  if (!((calendar.status === "DRAFT" && status === "PUBLISHED") || (calendar.status === "PUBLISHED" && status === "RETIRED"))) throw new AcademicCalendarValidationError(`Invalid calendar lifecycle transition: ${calendar.status} -> ${status}`);
  return (await repository.setCalendarStatus(calendar.id, status)).rows[0];
}
export async function listPeriods(req: Request, user: AuthenticatedUser, calendarId: string) { const calendar = await get(req, user, calendarId); return (await repository.listPeriods(calendar.id)).rows; }
export async function createPeriod(req: Request, user: AuthenticatedUser, input: CreateAcademicCalendarPeriodInput) {
  validatePeriodInput(input); const calendar = await get(req, user, input.calendarId);
  if (calendar.scope === "ORGANIZATION") management((await resolveOrganizationContext(req, user, calendar.organization_id)).role.name); else management((await resolveOrganizationContext(req, user)).role.name);
  if (calendar.status !== "DRAFT") throw new AcademicCalendarValidationError("Calendar does not permit period mutation.");
  if (input.parentPeriodId) { const parent = (await repository.getPeriod(requiredUuid(input.parentPeriodId, "Parent period id"))).rows[0]; if (!parent || parent.calendar_id !== calendar.id) throw new AcademicCalendarValidationError("Parent period must belong to the same calendar."); if (input.startsOn < parent.starts_on || input.endsOn > parent.ends_on) throw new AcademicCalendarValidationError("Period must be contained by its parent."); }
  return (await repository.createPeriod({ ...input, calendarId: calendar.id })).rows[0];
}
export async function updatePeriod(req: Request, user: AuthenticatedUser, id: string, input: UpdateAcademicCalendarPeriodInput) {
  validatePeriodInput(input); const period = (await repository.getPeriod(requiredUuid(id, "Period id"))).rows[0]; if (!period) throw notFound("Calendar period"); const calendar = await get(req, user, period.calendar_id);
  if (calendar.scope === "ORGANIZATION") management((await resolveOrganizationContext(req, user, calendar.organization_id)).role.name); else management((await resolveOrganizationContext(req, user)).role.name);
  if (calendar.status !== "DRAFT") throw new AcademicCalendarValidationError("Calendar does not permit period mutation.");
  if (input.parentPeriodId || input.startsOn || input.endsOn) {
    const parentId = input.parentPeriodId ?? period.parent_period_id;
    if (parentId) {
      const parent = (await repository.getPeriod(requiredUuid(parentId, "Parent period id"))).rows[0];
      if (!parent || parent.calendar_id !== calendar.id) throw new AcademicCalendarValidationError("Parent period must belong to the same calendar.");
      const startsOn = input.startsOn ?? period.starts_on;
      const endsOn = input.endsOn ?? period.ends_on;
      if (startsOn < parent.starts_on || endsOn > parent.ends_on) throw new AcademicCalendarValidationError("Period must be contained by its parent.");
    }
  }
  return (await repository.updatePeriod(period.id, input)).rows[0];
}
export async function deletePeriod(req: Request, user: AuthenticatedUser, id: string) { const period = (await repository.getPeriod(requiredUuid(id, "Period id"))).rows[0]; if (!period) throw notFound("Calendar period"); const calendar = await get(req, user, period.calendar_id); if (calendar.scope === "ORGANIZATION") management((await resolveOrganizationContext(req, user, calendar.organization_id)).role.name); else management((await resolveOrganizationContext(req, user)).role.name); if (calendar.status !== "DRAFT") throw new AcademicCalendarValidationError("Calendar does not permit period mutation."); return (await repository.deletePeriod(period.id)).rows[0]; }

export const createAcademicCalendar = create;
export const updateAcademicCalendar = update;
export const publishAcademicCalendar = publish;
export const retireAcademicCalendar = retire;
export const createAcademicCalendarPeriod = createPeriod;
export const updateAcademicCalendarPeriod = updatePeriod;
