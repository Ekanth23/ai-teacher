export type JsonObject = Record<string, unknown>;
export type CalendarScope = "REFERENCE" | "ORGANIZATION";
export type CalendarStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export type AcademicCalendar = {
  id: string;
  academic_year_id: string;
  organization_id: string | null;
  board_id: string | null;
  calendar_code: string;
  name: string;
  version: string;
  scope: CalendarScope;
  status: CalendarStatus;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type AcademicCalendarPeriod = {
  id: string;
  calendar_id: string;
  parent_period_id: string | null;
  period_type: string;
  name: string;
  sequence_number: number;
  starts_on: string;
  ends_on: string;
  status: CalendarStatus;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type CreateAcademicCalendarInput = {
  academicYearId: string;
  organizationId?: string | null;
  boardId?: string | null;
  calendarCode: string;
  name: string;
  version: string;
  scope: CalendarScope;
  status?: CalendarStatus;
  metadata?: JsonObject;
};

export type UpdateAcademicCalendarInput = Partial<Omit<CreateAcademicCalendarInput, "scope" | "organizationId">> & {
  boardId?: string | null;
  metadata?: JsonObject;
};

export type CreateAcademicCalendarPeriodInput = {
  calendarId: string;
  parentPeriodId?: string | null;
  periodType: string;
  name: string;
  sequenceNumber?: number;
  startsOn: string;
  endsOn: string;
  status?: CalendarStatus;
  metadata?: JsonObject;
};

export type UpdateAcademicCalendarPeriodInput = Partial<Omit<CreateAcademicCalendarPeriodInput, "calendarId">>;
