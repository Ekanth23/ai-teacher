import { isValidUuid } from "../../../auth/organization.js";
import type { CreateAcademicCalendarInput, CreateAcademicCalendarPeriodInput, UpdateAcademicCalendarInput, UpdateAcademicCalendarPeriodInput } from "./types.js";

export class AcademicCalendarValidationError extends Error {
  code = "VALIDATION_ERROR";
}

const requiredUuid = (value: string | null | undefined, field: string) => {
  if (!value || !isValidUuid(value)) throw new AcademicCalendarValidationError(`${field} is invalid.`);
  return value.trim();
};
const text = (value: string | null | undefined, field: string) => {
  const result = value?.trim();
  if (!result) throw new AcademicCalendarValidationError(`${field} is required.`);
  return result;
};
const date = (value: string, field: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new AcademicCalendarValidationError(`${field} is invalid.`);
};

export function validateCalendarInput(input: CreateAcademicCalendarInput | UpdateAcademicCalendarInput) {
  if ("academicYearId" in input && input.academicYearId !== undefined) requiredUuid(input.academicYearId, "Academic year id");
  if ("organizationId" in input && input.organizationId) requiredUuid(input.organizationId, "Organization id");
  if (input.boardId) requiredUuid(input.boardId, "Board id");
  if (input.calendarCode !== undefined) text(input.calendarCode, "Calendar code");
  if (input.name !== undefined) text(input.name, "Calendar name");
  if (input.version !== undefined) text(input.version, "Calendar version");
  if ("scope" in input && input.scope !== undefined && !["REFERENCE", "ORGANIZATION"].includes(input.scope)) throw new AcademicCalendarValidationError("Calendar scope is invalid.");
}

export function validatePeriodInput(input: CreateAcademicCalendarPeriodInput | UpdateAcademicCalendarPeriodInput) {
  if ("calendarId" in input && input.calendarId !== undefined) requiredUuid(input.calendarId, "Calendar id");
  if (input.parentPeriodId) requiredUuid(input.parentPeriodId, "Parent period id");
  if (input.periodType !== undefined) text(input.periodType, "Period type");
  if (input.name !== undefined) text(input.name, "Period name");
  if (input.sequenceNumber !== undefined && (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 0)) throw new AcademicCalendarValidationError("Sequence number is invalid.");
  if (input.startsOn !== undefined) date(input.startsOn, "Period start date");
  if (input.endsOn !== undefined) date(input.endsOn, "Period end date");
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) throw new AcademicCalendarValidationError("Period dates are invalid.");
}

export { requiredUuid, text };
