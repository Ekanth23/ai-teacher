import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();

const unique = (prefix: string) => `${prefix.slice(0, 20)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const created = {
  users: [] as string[],
  organizations: [] as string[],
  students: [] as string[],
  enrollments: [] as string[],
  classes: [] as string[],
  years: [] as string[],
  events: [] as string[],
  questions: [] as string[],
  attempts: [] as string[],
};

async function cleanup() {
  if (created.attempts.length) {
    await pool.query("DELETE FROM assessment_results WHERE attempt_id = ANY($1::uuid[])", [created.attempts]);
    await pool.query("DELETE FROM assessment_answers WHERE attempt_id = ANY($1::uuid[])", [created.attempts]);
    await pool.query("DELETE FROM assessment_attempts WHERE id = ANY($1::uuid[])", [created.attempts]);
  }
  if (created.questions.length) await pool.query("DELETE FROM assessment_questions WHERE id = ANY($1::uuid[])", [created.questions]);
  if (created.events.length) await pool.query("DELETE FROM assessment_events WHERE id = ANY($1::uuid[])", [created.events]);
  if (created.enrollments.length) await pool.query("DELETE FROM student_enrollments WHERE id = ANY($1::uuid[])", [created.enrollments]);
  if (created.classes.length) await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  if (created.students.length) await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.years.length) await pool.query("DELETE FROM academic_years WHERE id = ANY($1::uuid[])", [created.years]);
  if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  Object.values(created).forEach((ids) => { ids.length = 0; });
}

afterEach(cleanup);

async function createUser(label: string) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${unique(`ep9c_${label}`)}@example.com`, `Epic 9C ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Epic 9C ${label}`, unique(`ep9c_org_${label}`), ownerUserId]
  );
  created.organizations.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function addMember(userId: string, organizationId: string, roleName: string) {
  const role = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [roleName]);
  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [userId, organizationId, role.rows[0].id]
  );
}

async function createClass(organizationId: string, ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO classes (organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, `Epic 9C class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createYear(label: string) {
  const code = `ep9cy_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
  const result = await pool.query(
    `INSERT INTO academic_years (code, name, start_date, end_date)
     VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`,
    [code, `Epic 9C year ${label}`]
  );
  created.years.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createStudent(organizationId: string, userId: string, fullName: string) {
  const result = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status)
     VALUES ($1, $2, $3, '8', 'ACTIVE') RETURNING id`,
    [userId, organizationId, fullName]
  );
  created.students.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function enrollStudent(organizationId: string, studentId: string, classId: string) {
  const result = await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, studentId, classId]
  );
  created.enrollments.push(result.rows[0].id);
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

type Fixture = {
  organizationId: string;
  classId: string;
  yearId: string;
  adminId: string;
  adminToken: string;
  teacherId: string;
  teacherToken: string;
  studentUserId: string;
  studentId: string;
  studentToken: string;
};

async function baseFixture(label: string): Promise<Fixture> {
  const adminId = await createUser(`${label}-admin`);
  const organizationId = await createOrganization(adminId, `${label}-org`);
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  const teacherId = await createUser(`${label}-teacher`);
  await addMember(teacherId, organizationId, "TEACHER");
  const classId = await createClass(organizationId, adminId, label);
  const yearId = await createYear(label);
  const studentUserId = await createUser(`${label}-student`);
  await addMember(studentUserId, organizationId, "STUDENT");
  const studentId = await createStudent(organizationId, studentUserId, `${label} Student`);
  await enrollStudent(organizationId, studentId, classId);
  return {
    organizationId, classId, yearId, adminId, adminToken: createAccessToken(adminId),
    teacherId, teacherToken: createAccessToken(teacherId),
    studentUserId, studentId, studentToken: createAccessToken(studentUserId),
  };
}

async function createEvent(f: Fixture, status = "DRAFT") {
  const start = new Date(Date.now() - 3600_000).toISOString();
  const end = new Date(Date.now() + 3600_000).toISOString();
  const result = await pool.query(
    `INSERT INTO assessment_events (organization_id, academic_year_id, class_id, title, scheduled_start, scheduled_end, status)
     VALUES ($1, $2, $3, 'Epic 9C exam', $4, $5, $6) RETURNING id`,
    [f.organizationId, f.yearId, f.classId, start, end, status]
  );
  created.events.push(result.rows[0].id);
  return result.rows[0].id as string;
}

const questionBody = (correct: string, marks: number, keys = ["A", "B"]) => ({
  question_text: `Q ${correct} ${marks} ${Math.random().toString(36).slice(2, 6)}`,
  question_type: "MULTIPLE_CHOICE_SINGLE",
  options: keys.map((k) => ({ key: k, text: `opt ${k}` })),
  correct_option_key: correct,
  marks,
});

async function addQuestion(f: Fixture, eventId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/assessment-events/${eventId}/questions`)
    .set(auth(f.adminToken, f.organizationId))
    .send(body);
  expect(res.status).toBe(201);
  created.questions.push(res.body.question.id);
  return res.body.question.id as string;
}

async function scheduledEvent(f: Fixture, bodies: Record<string, unknown>[]) {
  const eventId = await createEvent(f, "DRAFT");
  const questionIds: string[] = [];
  for (const body of bodies) questionIds.push(await addQuestion(f, eventId, body));
  await pool.query("UPDATE assessment_events SET status = 'SCHEDULED' WHERE id = $1", [eventId]);
  return { eventId, questionIds };
}

async function startAttempt(f: Fixture, eventId: string, expectedStatus = 201) {
  const res = await request(app)
    .post(`/api/student/assessment-events/${eventId}/attempts`)
    .set(auth(f.studentToken, f.organizationId));
  expect(res.status).toBe(expectedStatus);
  if (expectedStatus === 201 || expectedStatus === 200) created.attempts.push(res.body.attempt.id);
  return res;
}

async function saveAnswer(f: Fixture, attemptId: string, questionId: string, option: string, expected = 200) {
  const res = await request(app)
    .put(`/api/student/assessment-attempts/${attemptId}/answers`)
    .set(auth(f.studentToken, f.organizationId))
    .send({ answers: [{ question_id: questionId, selected_option: option }] });
  expect(res.status).toBe(expected);
  return res;
}

async function submit(f: Fixture, attemptId: string) {
  return request(app)
    .post(submitUrl(attemptId))
    .set(auth(f.studentToken, f.organizationId))
    .send({});
}

const submitUrl = (attemptId: string) => `/api/student/assessment-attempts/${attemptId}/submit`;

describe("US-091 submit assessment - authorization", () => {
  it("rejects unauthenticated submission", async () => {
    expect((await request(app).post(submitUrl("00000000-0000-4000-8000-000000000000"))).status).toBe(401);
  });

  it("rejects a non-student role", async () => {
    const f = await baseFixture("sub-role");
    const { eventId } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    const res = await request(app)
      .post(submitUrl(started.body.attempt.id))
      .set(auth(f.adminToken, f.organizationId));
    expect(res.status).toBe(403);
  });

  it("rejects a cross-tenant attempt as not found", async () => {
    const a = await baseFixture("sub-ta");
    const b = await baseFixture("sub-tb");
    const { eventId } = await scheduledEvent(a, [questionBody("B", 2)]);
    const started = await startAttempt(a, eventId);
    const res = await request(app)
      .post(submitUrl(started.body.attempt.id))
      .set(auth(b.studentToken, b.organizationId));
    expect(res.status).toBe(404);
  });

  it("rejects another student's attempt (IDOR)", async () => {
    const f = await baseFixture("sub-idor");
    const { eventId } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    const otherUser = await createUser("sub-idor-other");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudent = await createStudent(f.organizationId, otherUser, "Intruder");
    await enrollStudent(f.organizationId, otherStudent, f.classId);
    const res = await request(app)
      .post(submitUrl(started.body.attempt.id))
      .set(auth(createAccessToken(otherUser), f.organizationId));
    expect(res.status).toBe(404);
  });

  it("ignores client-supplied student identity", async () => {
    const f = await baseFixture("sub-spoof");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    const otherUser = await createUser("sub-spoof-other");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudent = await createStudent(f.organizationId, otherUser, "Other");
    const res = await request(app)
      .post(submitUrl(started.body.attempt.id))
      .set(auth(f.studentToken, f.organizationId))
      .send({ student_id: otherStudent, organization_id: f.organizationId });
    expect(res.status).toBe(200);
    expect(res.body.result.student.id).toBe(f.studentId);
    const db = await pool.query("SELECT student_id FROM assessment_results WHERE attempt_id = $1", [started.body.attempt.id]);
    expect(db.rows[0].student_id).toBe(f.studentId);
  });
});

describe("US-091 submit assessment - lifecycle", () => {
  it("submits a fully answered attempt and freezes it", async () => {
    const f = await baseFixture("sub-ok");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    const res = await submit(f, started.body.attempt.id);
    expect(res.status).toBe(200);
    expect(res.body.attempt.status).toBe("SUBMITTED");
    expect(res.body.attempt.submitted_at).toBeTruthy();
    expect(res.body.result.score).toBe(2);
    const db = await pool.query("SELECT status, submitted_at FROM assessment_attempts WHERE id = $1", [started.body.attempt.id]);
    expect(db.rows[0].status).toBe("SUBMITTED");
    expect(db.rows[0].submitted_at).toBeTruthy();
  });

  it("allows submission with unanswered questions", async () => {
    const f = await baseFixture("sub-unans");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2), questionBody("A", 3)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    const res = await submit(f, started.body.attempt.id);
    expect(res.status).toBe(200);
    expect(res.body.result.score).toBe(2);
    expect(res.body.result.max_score).toBe(5);
    expect(res.body.result.correct_count).toBe(1);
    expect(res.body.result.unanswered_count).toBe(1);
  });

  it("rejects submission of a zero-question assessment without a result", async () => {
    const f = await baseFixture("sub-zero");
    const eventId = await createEvent(f, "DRAFT");
    await pool.query("UPDATE assessment_events SET status = 'SCHEDULED' WHERE id = $1", [eventId]);
    const started = await startAttempt(f, eventId);
    const res = await submit(f, started.body.attempt.id);
    expect(res.status).toBe(400);
    const db = await pool.query("SELECT status FROM assessment_attempts WHERE id = $1", [started.body.attempt.id]);
    expect(db.rows[0].status).toBe("IN_PROGRESS");
    const results = await pool.query("SELECT count(*)::int AS c FROM assessment_results WHERE attempt_id = $1", [started.body.attempt.id]);
    expect(results.rows[0].c).toBe(0);
  });

  it("protects duplicate submission without duplicating the result", async () => {
    const f = await baseFixture("sub-dup");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    expect((await submit(f, started.body.attempt.id)).status).toBe(200);
    expect((await submit(f, started.body.attempt.id)).status).toBe(400);
    const count = await pool.query("SELECT count(*)::int AS c FROM assessment_results WHERE attempt_id = $1", [started.body.attempt.id]);
    expect(count.rows[0].c).toBe(1);
  });

  it("serializes concurrent submissions to a single result", async () => {
    const f = await baseFixture("sub-race");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    const headers = auth(f.studentToken, f.organizationId);
    const calls = Array.from({ length: 5 }, () =>
      request(app).post(submitUrl(started.body.attempt.id)).set(headers).send({})
    );
    const responses = await Promise.all(calls);
    const succeeded = responses.filter((r) => r.status === 200);
    expect(succeeded.length).toBe(1);
    const count = await pool.query("SELECT count(*)::int AS c FROM assessment_results WHERE attempt_id = $1", [started.body.attempt.id]);
    expect(count.rows[0].c).toBe(1);
  });

  it("rejects answer mutation after submission", async () => {
    const f = await baseFixture("sub-frozen");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    expect((await submit(f, started.body.attempt.id)).status).toBe(200);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "A", 400);
  });
});

describe("US-092 calculate assessment result", () => {
  it("scores all correct as full marks with 100%", async () => {
    const f = await baseFixture("calc-all");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2), questionBody("A", 3)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    await saveAnswer(f, started.body.attempt.id, questionIds[1], "A");
    const res = await submit(f, started.body.attempt.id);
    expect(res.status).toBe(200);
    expect(res.body.result.score).toBe(5);
    expect(res.body.result.max_score).toBe(5);
    expect(res.body.result.percentage).toBe(100);
    expect(res.body.result.correct_count).toBe(2);
    expect(res.body.result.incorrect_count).toBe(0);
    expect(res.body.result.unanswered_count).toBe(0);
  });

  it("scores all incorrect as zero without negative marking", async () => {
    const f = await baseFixture("calc-none");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2), questionBody("A", 3)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "A");
    await saveAnswer(f, started.body.attempt.id, questionIds[1], "B");
    const res = await submit(f, started.body.attempt.id);
    expect(res.body.result.score).toBe(0);
    expect(res.body.result.max_score).toBe(5);
    expect(res.body.result.percentage).toBe(0);
    expect(res.body.result.correct_count).toBe(0);
    expect(res.body.result.incorrect_count).toBe(2);
    expect(res.body.result.unanswered_count).toBe(0);
  });

  it("scores mixed answers with weighted marks and no partial credit", async () => {
    const f = await baseFixture("calc-mix");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2), questionBody("A", 3), questionBody("A", 1)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    await saveAnswer(f, started.body.attempt.id, questionIds[1], "B");
    const res = await submit(f, started.body.attempt.id);
    expect(res.body.result.score).toBe(2);
    expect(res.body.result.max_score).toBe(6);
    expect(res.body.result.correct_count).toBe(1);
    expect(res.body.result.incorrect_count).toBe(1);
    expect(res.body.result.unanswered_count).toBe(1);
  });

  it("rounds percentage deterministically to 2 decimals", async () => {
    const f = await baseFixture("calc-round");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("A", 1), questionBody("A", 1), questionBody("A", 1)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "A");
    const res = await submit(f, started.body.attempt.id);
    expect(res.body.result.score).toBe(1);
    expect(res.body.result.max_score).toBe(3);
    expect(res.body.result.percentage).toBe(33.33);
  });

  it("exposes no pass/fail, grading, or negative-marking output", async () => {
    const f = await baseFixture("calc-shape");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    const res = await submit(f, started.body.attempt.id);
    for (const key of ["pass_fail", "passed", "grade", "band", "negative", "negative_marks", "partial", "curve"]) {
      expect(res.body.result).not.toHaveProperty(key);
    }
  });

  it("fails safely on inconsistent persisted options without persisting state", async () => {
    const f = await baseFixture("calc-bad");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    await pool.query(
      `INSERT INTO assessment_answers (attempt_id, question_id, selected_option) VALUES ($1, $2, 'Z')`,
      [started.body.attempt.id, questionIds[0]]
    );
    const res = await submit(f, started.body.attempt.id);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INCONSISTENT_RESULT_DATA");
    const db = await pool.query("SELECT status FROM assessment_attempts WHERE id = $1", [started.body.attempt.id]);
    expect(db.rows[0].status).toBe("IN_PROGRESS");
    const results = await pool.query("SELECT count(*)::int AS c FROM assessment_results WHERE attempt_id = $1", [started.body.attempt.id]);
    expect(results.rows[0].c).toBe(0);
  });
});

describe("US-093 store assessment result", () => {
  it("persists exactly one tenant-correct immutable result", async () => {
    const f = await baseFixture("store-one");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2), questionBody("A", 3)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    await saveAnswer(f, started.body.attempt.id, questionIds[1], "B");
    const res = await submit(f, started.body.attempt.id);
    expect(res.status).toBe(200);
    const db = await pool.query("SELECT * FROM assessment_results WHERE attempt_id = $1", [started.body.attempt.id]);
    expect(db.rows.length).toBe(1);
    const row = db.rows[0];
    expect(row.organization_id).toBe(f.organizationId);
    expect(row.assessment_event_id).toBe(eventId);
    expect(row.student_id).toBe(f.studentId);
    expect(Number(row.score)).toBe(2);
    expect(Number(row.max_score)).toBe(5);
    expect(Number(row.percentage)).toBe(40);
    expect(row.correct_count).toBe(1);
    expect(row.incorrect_count).toBe(1);
    expect(row.unanswered_count).toBe(0);
    expect(row.submitted_at).toBeTruthy();
    expect(new Date(row.submitted_at).valueOf()).toBe(new Date(res.body.attempt.submitted_at).valueOf());
  });

  it("exposes no result update or delete endpoint", async () => {
    const f = await baseFixture("store-imm");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    await submit(f, started.body.attempt.id);
    const headers = auth(f.adminToken, f.organizationId);
    expect((await request(app).put(`/api/assessment-events/${eventId}/results`).set(headers).send({})).status).toBe(404);
    expect((await request(app).delete(`/api/assessment-events/${eventId}/results`).set(headers)).status).toBe(404);
    expect((await request(app).patch(`/api/assessment-events/${eventId}/results/${started.body.attempt.id}`).set(headers).send({})).status).toBe(404);
  });

  it("never writes formal results to practice tables", async () => {
    const f = await baseFixture("store-sep");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    await submit(f, started.body.attempt.id);
    const practice = await pool.query("SELECT count(*)::int AS c FROM practice_attempts WHERE student_id = $1", [f.studentId]);
    expect(practice.rows[0].c).toBe(0);
    const formal = await pool.query("SELECT count(*)::int AS c FROM assessment_results WHERE student_id = $1", [f.studentId]);
    expect(formal.rows[0].c).toBe(1);
  });
});

describe("US-094 teacher reviews assessment results", () => {
  it("rejects unauthenticated review", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await request(app).get(`/api/assessment-events/${id}/results`)).status).toBe(401);
    expect((await request(app).get(`/api/assessment-events/${id}/results/${id}`)).status).toBe(401);
  });

  it("rejects a student role", async () => {
    const f = await baseFixture("rev-role");
    const { eventId } = await scheduledEvent(f, [questionBody("B", 2)]);
    const list = await request(app)
      .get(`/api/assessment-events/${eventId}/results`)
      .set(auth(f.studentToken, f.organizationId));
    expect(list.status).toBe(403);
    const detail = await request(app)
      .get(`/api/assessment-events/${eventId}/results/00000000-0000-4000-8000-000000000000`)
      .set(auth(f.studentToken, f.organizationId));
    expect(detail.status).toBe(403);
  });

  it("lists and details submitted results for teacher and admin", async () => {
    const f = await baseFixture("rev-ok");
    const { eventId, questionIds } = await scheduledEvent(f, [questionBody("B", 2), questionBody("A", 3)]);
    const started = await startAttempt(f, eventId);
    await saveAnswer(f, started.body.attempt.id, questionIds[0], "B");
    await submit(f, started.body.attempt.id);

    const list = await request(app)
      .get(`/api/assessment-events/${eventId}/results`)
      .set(auth(f.teacherToken, f.organizationId));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.results[0].attempt_id).toBe(started.body.attempt.id);
    expect(list.body.results[0].score).toBe(2);
    expect(list.body.results[0].max_score).toBe(5);
    expect(list.body.results[0].percentage).toBe(40);
    expect(list.body.results[0].student.id).toBe(f.studentId);

    const adminList = await request(app)
      .get(`/api/assessment-events/${eventId}/results`)
      .set(auth(f.adminToken, f.organizationId));
    expect(adminList.status).toBe(200);
    expect(adminList.body.total).toBe(1);

    const detail = await request(app)
      .get(`/api/assessment-events/${eventId}/results/${started.body.attempt.id}`)
      .set(auth(f.teacherToken, f.organizationId));
    expect(detail.status).toBe(200);
    expect(detail.body.result.assessment_event_id).toBe(eventId);
    expect(detail.body.result.correct_count).toBe(1);
    expect(detail.body.result.incorrect_count).toBe(0);
    expect(detail.body.result.unanswered_count).toBe(1);
    expect(detail.body.result.submitted_at).toBeTruthy();
  });

  it("excludes in-progress attempts from review", async () => {
    const f = await baseFixture("rev-open");
    const { eventId } = await scheduledEvent(f, [questionBody("B", 2)]);
    const started = await startAttempt(f, eventId);
    const list = await request(app)
      .get(`/api/assessment-events/${eventId}/results`)
      .set(auth(f.teacherToken, f.organizationId));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
    const detail = await request(app)
      .get(`/api/assessment-events/${eventId}/results/${started.body.attempt.id}`)
      .set(auth(f.teacherToken, f.organizationId));
    expect(detail.status).toBe(404);
  });

  it("rejects cross-tenant event review as not found", async () => {
    const a = await baseFixture("rev-ta");
    const b = await baseFixture("rev-tb");
    const { eventId } = await scheduledEvent(a, [questionBody("B", 2)]);
    const list = await request(app)
      .get(`/api/assessment-events/${eventId}/results`)
      .set(auth(b.teacherToken, b.organizationId));
    expect(list.status).toBe(404);
  });

  it("rejects a result from another assessment", async () => {
    const f = await baseFixture("rev-cross");
    const first = await scheduledEvent(f, [questionBody("B", 2)]);
    const second = await scheduledEvent(f, [questionBody("A", 1)]);
    const started = await startAttempt(f, first.eventId);
    await saveAnswer(f, started.body.attempt.id, first.questionIds[0], "B");
    await submit(f, started.body.attempt.id);
    const res = await request(app)
      .get(`/api/assessment-events/${second.eventId}/results/${started.body.attempt.id}`)
      .set(auth(f.teacherToken, f.organizationId));
    expect(res.status).toBe(404);
  });

  it("keeps review tenant-scoped and analytics-free", async () => {
    const a = await baseFixture("rev-scope-a");
    const b = await baseFixture("rev-scope-b");
    const ea = await scheduledEvent(a, [questionBody("B", 2)]);
    const eb = await scheduledEvent(b, [questionBody("B", 2)]);
    const started = await startAttempt(a, ea.eventId);
    await saveAnswer(a, started.body.attempt.id, ea.questionIds[0], "B");
    await submit(a, started.body.attempt.id);

    const bList = await request(app)
      .get(`/api/assessment-events/${eb.eventId}/results`)
      .set(auth(b.teacherToken, b.organizationId));
    expect(bList.status).toBe(200);
    expect(bList.body.total).toBe(0);
    expect(JSON.stringify(bList.body)).not.toContain(a.organizationId);

    const aList = await request(app)
      .get(`/api/assessment-events/${ea.eventId}/results`)
      .set(auth(a.teacherToken, a.organizationId));
    for (const key of ["average", "ranking", "rank", "trend", "analytics", "distribution"]) {
      expect(JSON.stringify(aList.body)).not.toContain(`"${key}"`);
    }
  });
});
