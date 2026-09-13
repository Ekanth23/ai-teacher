import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();
const created = {
  users: [] as string[],
  organizations: [] as string[],
  classes: [] as string[],
  years: [] as string[],
  calendars: [] as string[],
  events: [] as string[],
  portions: [] as string[],
  datasets: [] as string[],
  structures: [] as string[],
  curriculumVersions: [] as string[],
  assessmentTypes: [] as string[],
};

const unique = (prefix: string) => `${prefix.slice(0, 12)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

async function fixture() {
  const users = await Promise.all(["a", "b"].map(async (suffix) => {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, status)
       VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
      [`${unique(`phase020c_${suffix}`)}@example.com`, `Phase 020C ${suffix}`]
    );
    created.users.push(result.rows[0].id);
    return result.rows[0];
  }));
  const organizations = await Promise.all(users.map(async (user, index) => {
    const result = await pool.query(
      `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
       VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
      [`Phase 020C ${index}`, unique(`phase020c_org_${index}`), user.id]
    );
    created.organizations.push(result.rows[0].id);
    const role = await pool.query("SELECT id FROM roles WHERE name = 'SCHOOL_ADMIN' LIMIT 1");
    await pool.query(
      `INSERT INTO organization_members (user_id, organization_id, role_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [user.id, result.rows[0].id, role.rows[0].id]
    );
    return result.rows[0].id;
  }));
  const year = await pool.query(
    `INSERT INTO academic_years (code, name, start_date, end_date)
     VALUES ($1, 'Phase 020C year', '2026-04-01', '2027-03-31') RETURNING id`,
    [unique("phase020c_year")]
  );
  created.years.push(year.rows[0].id);
  const classResult = await pool.query(
    `INSERT INTO classes (organization_id, name, created_by_user_id)
     VALUES ($1, 'Phase 020C class', $2) RETURNING id`,
    [organizations[0], users[0].id]
  );
  created.classes.push(classResult.rows[0].id);

  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const curriculumVersion = await pool.query(
    `INSERT INTO curriculum_versions (board_id, academic_year_id, version)
     VALUES ($1, $2, $3) RETURNING id`,
    [board.id, year.rows[0].id, unique("phase020c_curriculum")]
  );
  created.curriculumVersions.push(curriculumVersion.rows[0].id);
  const dataset = await pool.query(
    `INSERT INTO curriculum_reference_datasets
       (curriculum_version_id, dataset_code, dataset_version, source_name, checksum)
     VALUES ($1, $2, '1', 'Phase 020C dataset', $3) RETURNING id`,
    [curriculumVersion.rows[0].id, unique("phase020c_dataset"), unique("checksum")]
  );
  created.datasets.push(dataset.rows[0].id);
  const structure = await pool.query(
    `INSERT INTO curriculum_structures (reference_dataset_id, structure_kind, name)
     VALUES ($1, 'SYLLABUS', 'Phase 020C structure') RETURNING id`,
    [dataset.rows[0].id]
  );
  created.structures.push(structure.rows[0].id);
  const assessmentType = await pool.query(
    `INSERT INTO assessment_types (code, name, status) VALUES ($1, 'Phase 020C type', 'ACTIVE') RETURNING id`,
    [unique("phase020c_type")]
  );
  created.assessmentTypes.push(assessmentType.rows[0].id);
  const scheme = await pool.query(
    "SELECT id, board_id FROM assessment_scheme_versions WHERE status = 'PUBLISHED' ORDER BY created_at LIMIT 1"
  );

  return {
    tokens: users.map((user) => createAccessToken(user.id)),
    organizations,
    yearId: year.rows[0].id,
    classId: classResult.rows[0].id,
    structureId: structure.rows[0].id,
    assessmentTypeId: assessmentType.rows[0].id,
    schemeId: scheme.rows[0].id,
    schemeBoardId: scheme.rows[0].board_id,
  };
}

async function cleanup() {
  if (created.portions.length) await pool.query("DELETE FROM assessment_event_curriculum_portions WHERE id = ANY($1::uuid[])", [created.portions]);
  if (created.events.length) await pool.query("DELETE FROM assessment_events WHERE id = ANY($1::uuid[])", [created.events]);
  if (created.calendars.length) await pool.query("DELETE FROM academic_calendars WHERE id = ANY($1::uuid[])", [created.calendars]);
  if (created.structures.length) await pool.query("DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])", [created.structures]);
  if (created.datasets.length) await pool.query("DELETE FROM curriculum_reference_datasets WHERE id = ANY($1::uuid[])", [created.datasets]);
  if (created.assessmentTypes.length) await pool.query("DELETE FROM assessment_types WHERE id = ANY($1::uuid[])", [created.assessmentTypes]);
  if (created.curriculumVersions.length) await pool.query("DELETE FROM curriculum_versions WHERE id = ANY($1::uuid[])", [created.curriculumVersions]);
  if (created.classes.length) await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.years.length) await pool.query("DELETE FROM academic_years WHERE id = ANY($1::uuid[])", [created.years]);
  if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  Object.values(created).forEach((ids) => { ids.length = 0; });
}

afterEach(cleanup);

describe("Phase 020-C academic APIs", () => {
  it("requires authentication for academic resources", async () => {
    const response = await request(app).get("/api/academic-calendars");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });

  it("manages organization calendars and periods through tenant-scoped APIs", async () => {
    const f = await fixture();
    const agent = request(app);
    const headers = { Authorization: `Bearer ${f.tokens[0]}`, "x-organization-id": f.organizations[0] };
    const calendar = await agent.post("/api/academic-calendars").set(headers).send({
      academicYearId: f.yearId, calendarCode: unique("calendar"), name: "Academic calendar", version: "1", scope: "ORGANIZATION",
    });
    expect(calendar.status).toBe(201);
    created.calendars.push(calendar.body.calendar.id);

    const period = await agent.post(`/api/academic-calendars/${calendar.body.calendar.id}/periods`).set(headers).send({
      periodType: "TERM", name: "Term 1", sequenceNumber: 1, startsOn: "2026-06-01", endsOn: "2026-09-30",
    });
    expect(period.status).toBe(201);
    expect(period.body.period.calendar_id).toBe(calendar.body.calendar.id);

    const periods = await agent.get(`/api/academic-calendars/${calendar.body.calendar.id}/periods`).set(headers);
    expect(periods.status).toBe(200);
    expect(periods.body.periods).toHaveLength(1);
    expect((await agent.post(`/api/academic-calendars/${calendar.body.calendar.id}/publish`).set(headers)).status).toBe(200);
    expect((await agent.patch(`/api/academic-calendar-periods/${period.body.period.id}`).set(headers).send({ name: "Changed" })).status).toBe(400);
  });

  it("does not expose organization calendars or assessment events across tenants", async () => {
    const f = await fixture();
    const calendar = await pool.query(
      `INSERT INTO academic_calendars (academic_year_id, organization_id, calendar_code, name, version, scope)
       VALUES ($1, $2, $3, 'Private calendar', '1', 'ORGANIZATION') RETURNING id`,
      [f.yearId, f.organizations[0], unique("private_calendar")]
    );
    created.calendars.push(calendar.rows[0].id);
    const event = await pool.query(
      `INSERT INTO assessment_events (organization_id, academic_year_id, class_id, title, scheduled_start, scheduled_end)
       VALUES ($1, $2, $3, 'Private assessment', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z') RETURNING id`,
      [f.organizations[0], f.yearId, f.classId]
    );
    created.events.push(event.rows[0].id);
    const headers = { Authorization: `Bearer ${f.tokens[1]}`, "x-organization-id": f.organizations[1] };

    expect((await request(app).get(`/api/academic-calendars/${calendar.rows[0].id}`).set(headers)).status).toBe(403);
    const events = await request(app).get("/api/assessment-events").set(headers);
    expect(events.status).toBe(200);
    expect(events.body.events).toHaveLength(0);
    expect((await request(app).get(`/api/assessment-events/${event.rows[0].id}`).set(headers)).status).toBe(404);
  });

  it("exposes assessment catalogs and manages class events with curriculum portions", async () => {
    const f = await fixture();
    const agent = request(app);
    const headers = { Authorization: `Bearer ${f.tokens[0]}`, "x-organization-id": f.organizations[0] };

    const types = await agent.get("/api/assessment-types").set(headers);
    expect(types.status).toBe(200);
    expect(types.body.assessmentTypes.some((type: { id: string }) => type.id === f.assessmentTypeId)).toBe(true);
    const scheme = await agent.get(`/api/assessment-schemes/${f.schemeId}`).set(headers);
    expect(scheme.status).toBe(200);
    expect(scheme.body.scheme.id).toBe(f.schemeId);
    const schemes = await agent.get(`/api/assessment-schemes?board_id=${f.schemeBoardId}`).set(headers);
    expect(schemes.status).toBe(200);
    expect(schemes.body.schemes.some((item: { id: string }) => item.id === f.schemeId)).toBe(true);

    const event = await agent.post(`/api/classes/${f.classId}/assessment-events`).set(headers).send({
      academicYearId: f.yearId, assessmentTypeId: f.assessmentTypeId,
      title: "Unit test", scheduledStart: "2026-06-01T09:00:00Z", scheduledEnd: "2026-06-01T10:00:00Z",
    });
    expect(event.status).toBe(201);
    created.events.push(event.body.assessmentEvent.id);
    const portion = await agent.post(`/api/assessment-events/${event.body.assessmentEvent.id}/curriculum-portions`).set(headers).send({
      curriculumStructureId: f.structureId,
    });
    expect(portion.status).toBe(201);
    created.portions.push(portion.body.curriculumPortion.id);
    const portions = await agent.get(`/api/assessment-events/${event.body.assessmentEvent.id}/curriculum-portions`).set(headers);
    expect(portions.body.curriculumPortions).toHaveLength(1);

    const scheduled = await agent.post(`/api/assessment-events/${event.body.assessmentEvent.id}/status`).set(headers).send({ status: "SCHEDULED" });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.assessmentEvent.status).toBe("SCHEDULED");
    expect((await agent.patch(`/api/assessment-events/${event.body.assessmentEvent.id}`).set(headers).send({ title: "Updated unit test" })).status).toBe(200);
    expect((await agent.delete(`/api/assessment-events/${event.body.assessmentEvent.id}/curriculum-portions/${portion.body.curriculumPortion.id}`).set(headers)).status).toBe(200);
    created.portions.length = 0;
  });
});
