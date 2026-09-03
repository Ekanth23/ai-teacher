import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pool from "../../src/db.js";
import { validatePeriodInput } from "../../src/modules/academic/calendar/validation.js";
import { AssessmentValidationError, validateComponent, validateEvent, validateEventUpdate, validatePortion } from "../../src/modules/academic/assessment/validation.js";
import { isValidEventTransition, createEventForClass, deletePortion, getSchemeDetail, listAssessmentTypes, updateEvent } from "../../src/modules/academic/assessment/service.js";
import * as calendarService from "../../src/modules/academic/calendar/service.js";
import type { AuthenticatedUser } from "../../src/auth/tokens.js";

const created = {
  users: [] as string[], organizations: [] as string[], classes: [] as string[],
  years: [] as string[], boards: [] as string[], types: [] as string[],
  schemes: [] as string[], events: [] as string[], portions: [] as string[],
  calendars: [] as string[],
  syllabi: [] as string[], syllabusVersions: [] as string[], structures: [] as string[],
};

const unique = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const requestFor = (organizationId: string) => ({ headers: { "x-organization-id": organizationId }, params: {} } as never);
const userFor = (id: string, email: string) => ({ id, email } as AuthenticatedUser);

async function fixture() {
  const users = await Promise.all(["a", "b"].map(async (suffix) => {
    const result = await pool.query(
      `INSERT INTO users (email,password_hash,full_name,status) VALUES ($1,'test-hash',$2,'ACTIVE') RETURNING id,email`,
      [`${unique(`phase020b_${suffix}`)}@example.com`, `Phase 020B ${suffix}`],
    );
    created.users.push(result.rows[0].id);
    return result.rows[0];
  }));
  const organizations = await Promise.all(users.map(async (user, index) => {
    const result = await pool.query(
      `INSERT INTO organizations (name,slug,type,status,created_by_user_id) VALUES ($1,$2,'SCHOOL','ACTIVE',$3) RETURNING id`,
      [`Phase 020B ${index}`, unique(`phase020b_org_${index}`), user.id],
    );
    created.organizations.push(result.rows[0].id);
    const role = await pool.query(`SELECT id FROM roles WHERE name='SCHOOL_ADMIN' LIMIT 1`);
    await pool.query(`INSERT INTO organization_members (user_id,organization_id,role_id,status) VALUES ($1,$2,$3,'ACTIVE')`, [user.id, result.rows[0].id, role.rows[0].id]);
    return result.rows[0].id;
  }));
  const year = await pool.query(
    `INSERT INTO academic_years (code,name,start_date,end_date) VALUES ($1,'Phase 020B year','2026-04-01','2027-03-31') RETURNING id`,
    [unique("yr")],
  );
  created.years.push(year.rows[0].id);
  const classes = await Promise.all(organizations.map(async (organizationId, index) => {
    const result = await pool.query(`INSERT INTO classes (organization_id,name,created_by_user_id) VALUES ($1,$2,$3) RETURNING id`, [organizationId, `Phase 020B class ${index}`, users[index].id]);
    created.classes.push(result.rows[0].id);
    return result.rows[0].id;
  }));
  const board = await pool.query(`SELECT id FROM boards WHERE status='ACTIVE' ORDER BY id LIMIT 1`);
  const medium = await pool.query(`SELECT id FROM mediums WHERE status='ACTIVE' ORDER BY id LIMIT 1`);
  const syllabus = await pool.query(`INSERT INTO syllabi (class_id,board_id,medium_id,name,code) VALUES ($1,$2,$3,'Phase 020B syllabus',$4) RETURNING id`, [classes[0], board.rows[0].id, medium.rows[0].id, unique("syllabus")]);
  created.syllabi.push(syllabus.rows[0].id);
  const syllabusVersion = await pool.query(`INSERT INTO syllabus_versions (syllabus_id,version,status) VALUES ($1,'1','ACTIVE') RETURNING id`, [syllabus.rows[0].id]);
  created.syllabusVersions.push(syllabusVersion.rows[0].id);
  const structure = await pool.query(`INSERT INTO curriculum_structures (syllabus_version_id,structure_kind,name) VALUES ($1,'SYLLABUS','Phase 020B structure') RETURNING id`, [syllabusVersion.rows[0].id]);
  created.structures.push(structure.rows[0].id);
  return { users, organizations, yearId: year.rows[0].id, classes, structureId: structure.rows[0].id };
}

async function cleanup() {
  if (created.portions.length) await pool.query(`DELETE FROM assessment_event_curriculum_portions WHERE id=ANY($1::uuid[])`, [created.portions]);
  if (created.calendars.length) await pool.query(`DELETE FROM academic_calendars WHERE id=ANY($1::uuid[])`, [created.calendars]);
  if (created.events.length) await pool.query(`DELETE FROM assessment_events WHERE id=ANY($1::uuid[])`, [created.events]);
  if (created.structures.length) await pool.query(`DELETE FROM curriculum_structures WHERE id=ANY($1::uuid[])`, [created.structures]);
  if (created.syllabusVersions.length) await pool.query(`DELETE FROM syllabus_versions WHERE id=ANY($1::uuid[])`, [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query(`DELETE FROM syllabi WHERE id=ANY($1::uuid[])`, [created.syllabi]);
  if (created.schemes.length) {
    await pool.query(`DELETE FROM assessment_scheme_components WHERE assessment_scheme_version_id=ANY($1::uuid[])`, [created.schemes]);
    await pool.query(`DELETE FROM assessment_scheme_versions WHERE id=ANY($1::uuid[])`, [created.schemes]);
  }
  if (created.types.length) await pool.query(`DELETE FROM assessment_types WHERE id=ANY($1::uuid[])`, [created.types]);
  if (created.classes.length) await pool.query(`DELETE FROM classes WHERE id=ANY($1::uuid[])`, [created.classes]);
  if (created.organizations.length) {
    await pool.query(`DELETE FROM organization_members WHERE organization_id=ANY($1::uuid[])`, [created.organizations]);
    await pool.query(`DELETE FROM organizations WHERE id=ANY($1::uuid[])`, [created.organizations]);
  }
  if (created.years.length) await pool.query(`DELETE FROM academic_years WHERE id=ANY($1::uuid[])`, [created.years]);
  if (created.boards.length) await pool.query(`DELETE FROM boards WHERE id=ANY($1::uuid[])`, [created.boards]);
  if (created.users.length) await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [created.users]);
  Object.values(created).forEach((ids) => { ids.length = 0; });
}

afterEach(cleanup);

describe("Phase 020-B domain validation", () => {
  it("rejects reversed calendar period dates", () => {
    expect(() => validatePeriodInput({ calendarId: "11111111-1111-4111-8111-111111111111", periodType: "CUSTOM", name: "Invalid", startsOn: "2026-06-01", endsOn: "2026-05-01" })).toThrow("Period dates are invalid.");
  });
  it("rejects invalid assessment event schedules", () => {
    expect(() => validateEvent({ organizationId: "11111111-1111-4111-8111-111111111111", academicYearId: "11111111-1111-4111-8111-111111111111", classId: "11111111-1111-4111-8111-111111111111", title: "Exam", scheduledStart: "not-a-date", scheduledEnd: "2026-06-01T10:00:00Z" })).toThrow("Assessment schedule is invalid.");
  });
  it("rejects negative assessment component values", () => {
    expect(() => validateComponent({ schemeId: "11111111-1111-4111-8111-111111111111", assessmentTypeId: "11111111-1111-4111-8111-111111111111", code: "WRITTEN", name: "Written", maximumMarks: -1 })).toThrow("Maximum marks cannot be negative.");
  });
  it("requires structural curriculum portion references", () => {
    expect(() => validatePortion({ assessmentEventId: "11111111-1111-4111-8111-111111111111", curriculumStructureId: "invalid" })).toThrow(AssessmentValidationError);
  });
  it("enforces the assessment event lifecycle", () => {
    expect(isValidEventTransition("DRAFT", "SCHEDULED")).toBe(true);
    expect(isValidEventTransition("SCHEDULED", "COMPLETED")).toBe(true);
    expect(isValidEventTransition("COMPLETED", "DRAFT")).toBe(false);
    expect(isValidEventTransition("CANCELLED", "DRAFT")).toBe(false);
  });
  it("rejects malformed event updates and reversed merged schedules", () => {
    expect(() => validateEventUpdate({ scheduledStart: "invalid" })).toThrow("Assessment start is invalid.");
    expect(() => validateEventUpdate({ calendarId: "invalid" })).toThrow(AssessmentValidationError);
    expect(() => validateEvent({ academicYearId: "11111111-1111-4111-8111-111111111111", classId: "11111111-1111-4111-8111-111111111111", title: "Exam", scheduledStart: "2026-06-02T10:00:00Z", scheduledEnd: "2026-06-01T10:00:00Z" })).toThrow("Assessment schedule is invalid.");
  });

  it("lists active assessment types through the PostgreSQL catalog query", async () => {
    const result = await pool.query(`INSERT INTO assessment_types (code,name,status) VALUES ($1,'Phase 020B active','ACTIVE'),($2,'Phase 020B inactive','INACTIVE') RETURNING id,code`, [unique("active"), unique("inactive")]);
    created.types.push(...result.rows.map((row) => row.id));
    const types = await listAssessmentTypes();
    expect(types.some((type) => type.id === result.rows[0].id)).toBe(true);
    expect(types.some((type) => type.id === result.rows[1].id)).toBe(false);
  });

  it("returns a published scheme and its components from PostgreSQL", async () => {
    const scheme = await pool.query(`SELECT id FROM assessment_scheme_versions WHERE status='PUBLISHED' ORDER BY created_at LIMIT 1`);
    expect(scheme.rows[0]).toBeTruthy();
    const detail = await getSchemeDetail(scheme.rows[0].id);
    expect(detail).toMatchObject({ id: scheme.rows[0].id, status: "PUBLISHED" });
    expect(Array.isArray(detail.components)).toBe(true);
  });

  it("rejects a cross-tenant event update using PostgreSQL authorization", async () => {
    const f = await fixture();
    const event = await pool.query(`INSERT INTO assessment_events (organization_id,academic_year_id,class_id,title,scheduled_start,scheduled_end) VALUES ($1,$2,$3,'Exam','2026-06-01 09:00Z','2026-06-01 10:00Z') RETURNING id`, [f.organizations[0], f.yearId, f.classes[0]]);
    created.events.push(event.rows[0].id);
    await expect(updateEvent(requestFor(f.organizations[1]), userFor(f.users[1].id, f.users[1].email), event.rows[0].id, { title: "Changed" })).rejects.toThrow("Assessment event was not found.");
    const unchanged = await pool.query(`SELECT title FROM assessment_events WHERE id=$1`, [event.rows[0].id]);
    expect(unchanged.rows[0].title).toBe("Exam");
  });

  it("updates only mutable fields while preserving the database tenant", async () => {
    const f = await fixture();
    const event = await pool.query(`INSERT INTO assessment_events (organization_id,academic_year_id,class_id,title,scheduled_start,scheduled_end) VALUES ($1,$2,$3,'Exam','2026-06-01 09:00Z','2026-06-01 10:00Z') RETURNING id`, [f.organizations[0], f.yearId, f.classes[0]]);
    created.events.push(event.rows[0].id);
    await updateEvent(requestFor(f.organizations[0]), userFor(f.users[0].id, f.users[0].email), event.rows[0].id, { title: "Changed", organizationId: f.organizations[1], academicYearId: randomUUID(), classId: randomUUID() } as never);
    const row = await pool.query(`SELECT organization_id,academic_year_id,class_id,title FROM assessment_events WHERE id=$1`, [event.rows[0].id]);
    expect(row.rows[0]).toMatchObject({ organization_id: f.organizations[0], academic_year_id: f.yearId, class_id: f.classes[0], title: "Changed" });
  });

  it("rejects class-derived creation when PostgreSQL class authorization fails", async () => {
    const f = await fixture();
    await expect(createEventForClass(requestFor(f.organizations[0]), userFor(f.users[1].id, f.users[1].email), f.classes[0], { academicYearId: f.yearId, title: "Exam", scheduledStart: "2026-06-01T09:00:00Z", scheduledEnd: "2026-06-01T10:00:00Z" })).rejects.toThrow("You are not a member of this organization.");
  });

  it("requires the authorized event before deleting a curriculum portion", async () => {
    const f = await fixture();
    const event = await pool.query(`INSERT INTO assessment_events (organization_id,academic_year_id,class_id,title,scheduled_start,scheduled_end) VALUES ($1,$2,$3,'Exam','2026-06-01 09:00Z','2026-06-01 10:00Z') RETURNING id`, [f.organizations[0], f.yearId, f.classes[0]]);
    created.events.push(event.rows[0].id);
    await expect(deletePortion(requestFor(f.organizations[1]), userFor(f.users[1].id, f.users[1].email), event.rows[0].id, randomUUID())).rejects.toThrow("Assessment event was not found.");
  });

  it("rejects explicit organization context bypass for calendar reads and writes", async () => {
    const f = await fixture();
    const calendar = await pool.query(`INSERT INTO academic_calendars (academic_year_id,organization_id,calendar_code,name,version,scope,status) VALUES ($1,$2,$3,'Calendar','1','ORGANIZATION','DRAFT') RETURNING id`, [f.yearId, f.organizations[0], unique("calendar")]);
    created.calendars.push(calendar.rows[0].id);
    await expect(calendarService.get(requestFor(f.organizations[1]), userFor(f.users[1].id, f.users[1].email), calendar.rows[0].id, f.organizations[0])).rejects.toThrow("You are not a member of this organization.");
    await expect(calendarService.list(requestFor(f.organizations[1]), userFor(f.users[1].id, f.users[1].email), f.organizations[0])).rejects.toThrow("You are not a member of this organization.");
    const row = await pool.query(`SELECT organization_id FROM academic_calendars WHERE id=$1`, [calendar.rows[0].id]);
    expect(row.rows[0].organization_id).toBe(f.organizations[0]);
  });

  it("rejects cross-tenant portion deletion and preserves PostgreSQL rows", async () => {
    const f = await fixture();
    const event = await pool.query(`INSERT INTO assessment_events (organization_id,academic_year_id,class_id,title,scheduled_start,scheduled_end) VALUES ($1,$2,$3,'Exam','2026-06-01 09:00Z','2026-06-01 10:00Z') RETURNING id`, [f.organizations[0], f.yearId, f.classes[0]]);
    created.events.push(event.rows[0].id);
    const portion = await pool.query(`INSERT INTO assessment_event_curriculum_portions (assessment_event_id,curriculum_structure_id) VALUES ($1,$2) RETURNING id`, [event.rows[0].id, f.structureId]);
    created.portions.push(portion.rows[0].id);
    await expect(deletePortion(requestFor(f.organizations[1]), userFor(f.users[1].id, f.users[1].email), event.rows[0].id, portion.rows[0].id)).rejects.toThrow("Assessment event was not found.");
    const persisted = await pool.query(`SELECT assessment_event_id FROM assessment_event_curriculum_portions WHERE id=$1`, [portion.rows[0].id]);
    expect(persisted.rows[0].assessment_event_id).toBe(event.rows[0].id);
  });

  it("rejects deleting a portion through a different event ID", async () => {
    const f = await fixture();
    const events = await pool.query(`INSERT INTO assessment_events (organization_id,academic_year_id,class_id,title,scheduled_start,scheduled_end) VALUES ($1,$2,$3,'Exam A','2026-06-01 09:00Z','2026-06-01 10:00Z'),($1,$2,$3,'Exam B','2026-06-02 09:00Z','2026-06-02 10:00Z') RETURNING id`, [f.organizations[0], f.yearId, f.classes[0]]);
    created.events.push(...events.rows.map((row) => row.id));
    const portion = await pool.query(`INSERT INTO assessment_event_curriculum_portions (assessment_event_id,curriculum_structure_id) VALUES ($1,$2) RETURNING id`, [events.rows[0].id, f.structureId]);
    created.portions.push(portion.rows[0].id);
    await expect(deletePortion(requestFor(f.organizations[0]), userFor(f.users[0].id, f.users[0].email), events.rows[1].id, portion.rows[0].id)).rejects.toThrow("Curriculum portion was not found.");
    const persisted = await pool.query(`SELECT assessment_event_id FROM assessment_event_curriculum_portions WHERE id=$1`, [portion.rows[0].id]);
    expect(persisted.rows[0].assessment_event_id).toBe(events.rows[0].id);
  });
});
