import pool from "../../../db.js";
import type { CreateAcademicCalendarInput, CreateAcademicCalendarPeriodInput, UpdateAcademicCalendarInput, UpdateAcademicCalendarPeriodInput } from "./types.js";

export const academicYearExists = (id: string) => pool.query("SELECT id FROM academic_years WHERE id=$1 AND status='ACTIVE'", [id]);
export const organizationExists = (id: string) => pool.query("SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE'", [id]);
export const boardExists = (id: string) => pool.query("SELECT id FROM boards WHERE id=$1 AND status='ACTIVE'", [id]);
export const listCalendars = (organizationId?: string) => pool.query(
  `SELECT * FROM academic_calendars
   WHERE status IN ('PUBLISHED','RETIRED') AND (scope='REFERENCE' OR organization_id=$1)
   ORDER BY academic_year_id, name, version`, [organizationId ?? null]);
export const getCalendar = (id: string) => pool.query("SELECT * FROM academic_calendars WHERE id=$1", [id]);
export const createCalendar = (input: CreateAcademicCalendarInput) => pool.query(
  `INSERT INTO academic_calendars (academic_year_id,organization_id,board_id,calendar_code,name,version,scope,status,metadata)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [input.academicYearId, input.organizationId ?? null, input.boardId ?? null, input.calendarCode, input.name, input.version, input.scope, input.status ?? "DRAFT", input.metadata ?? {}]);
export const updateCalendar = (id: string, input: UpdateAcademicCalendarInput) => pool.query(
  `UPDATE academic_calendars SET academic_year_id=COALESCE($2,academic_year_id),board_id=$3,
   calendar_code=COALESCE($4,calendar_code),name=COALESCE($5,name),version=COALESCE($6,version),
   metadata=COALESCE($7,metadata),updated_at=now() WHERE id=$1 RETURNING *`,
  [id, input.academicYearId ?? null, input.boardId ?? null, input.calendarCode ?? null, input.name ?? null, input.version ?? null, input.metadata ?? null]);
export const setCalendarStatus = (id: string, status: string) => pool.query("UPDATE academic_calendars SET status=$2,updated_at=now() WHERE id=$1 RETURNING *", [id, status]);
export const listPeriods = (calendarId: string) => pool.query("SELECT * FROM academic_calendar_periods WHERE calendar_id=$1 ORDER BY sequence_number,starts_on,name", [calendarId]);
export const getPeriod = (id: string) => pool.query("SELECT * FROM academic_calendar_periods WHERE id=$1", [id]);
export const createPeriod = (input: CreateAcademicCalendarPeriodInput) => pool.query(
  `INSERT INTO academic_calendar_periods (calendar_id,parent_period_id,period_type,name,sequence_number,starts_on,ends_on,status,metadata)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [input.calendarId, input.parentPeriodId ?? null, input.periodType, input.name, input.sequenceNumber ?? 0, input.startsOn, input.endsOn, input.status ?? "DRAFT", input.metadata ?? {}]);
export const updatePeriod = (id: string, input: UpdateAcademicCalendarPeriodInput) => pool.query(
  `UPDATE academic_calendar_periods SET parent_period_id=COALESCE($2,parent_period_id),period_type=COALESCE($3,period_type),
   name=COALESCE($4,name),sequence_number=COALESCE($5,sequence_number),starts_on=COALESCE($6,starts_on),
   ends_on=COALESCE($7,ends_on),metadata=COALESCE($8,metadata),updated_at=now() WHERE id=$1 RETURNING *`,
  [id, input.parentPeriodId ?? null, input.periodType ?? null, input.name ?? null, input.sequenceNumber ?? null, input.startsOn ?? null, input.endsOn ?? null, input.metadata ?? null]);
export const deletePeriod = (id: string) => pool.query("DELETE FROM academic_calendar_periods WHERE id=$1 RETURNING *", [id]);
