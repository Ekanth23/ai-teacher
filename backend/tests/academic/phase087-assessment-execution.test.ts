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
    [`${unique(`ep9_${label}`)}@example.com`, `Epic 9 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Epic 9 ${label}`, unique(`ep9_org_${label}`), ownerUserId]
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
    [organizationId, `Epic 9 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createYear(label: string) {
  const code = `ep9y_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
  const result = await pool.query(
    `INSERT INTO academic_years (code, name, start_date, end_date)
     VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`,
    [code, `Epic 9 year ${label}`]
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

async function baseFixture(label: string, opts: { enrolled?: boolean } = {}): Promise<Fixture> {
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
  if (opts.enrolled !== false) await enrollStudent(organizationId, studentId, classId);
  return {
    organizationId, classId, yearId, adminId, adminToken: createAccessToken(adminId),
    teacherId, teacherToken: createAccessToken(teacherId),
    studentUserId, studentId, studentToken: createAccessToken(studentUserId),
  };
}

async function createEvent(
  f: Fixture,
  overrides: { status?: string; startOffsetMs?: number; endOffsetMs?: number } = {}
) {
  const status = overrides.status ?? "DRAFT";
  const start = new Date(Date.now() + (overrides.startOffsetMs ?? -3600_000)).toISOString();
  const end = new Date(Date.now() + (overrides.endOffsetMs ?? 3600_000)).toISOString();
  const result = await pool.query(
    `INSERT INTO assessment_events (organization_id, academic_year_id, class_id, title, scheduled_start, scheduled_end, status)
     VALUES ($1, $2, $3, 'Epic 9 exam', $4, $5, $6) RETURNING id, status`,
    [f.organizationId, f.yearId, f.classId, start, end, status]
  );
  created.events.push(result.rows[0].id);
  return result.rows[0].id as string;
}

const QUESTION = {
  question_text: "2 + 2 = ?",
  question_type: "MULTIPLE_CHOICE_SINGLE",
  options: [
    { key: "A", text: "3" },
    { key: "B", text: "4" },
  ],
  correct_option_key: "B",
  marks: 2,
};

async function addQuestion(f: Fixture, eventId: string, body: Record<string, unknown> = QUESTION) {
  const res = await request(app)
    .post(`/api/assessment-events/${eventId}/questions`)
    .set(auth(f.adminToken, f.organizationId))
    .send(body);
  expect(res.status).toBe(201);
  created.questions.push(res.body.question.id);
  return res.body.question.id as string;
}

async function scheduledEventWithQuestion(f: Fixture) {
  const eventId = await createEvent(f, { status: "DRAFT" });
  const questionId = await addQuestion(f, eventId);
  await pool.query("UPDATE assessment_events SET status = 'SCHEDULED' WHERE id = $1", [eventId]);
  const updated = await pool.query("SELECT * FROM assessment_events WHERE id = $1", [eventId]);
  void updated;
  return { eventId, questionId };
}

async function startAttempt(f: Fixture, eventId: string, expectedStatus = 201) {
  const res = await request(app)
    .post(`/api/student/assessment-events/${eventId}/attempts`)
    .set(auth(f.studentToken, f.organizationId));
  expect(res.status).toBe(expectedStatus);
  if (expectedStatus === 201 || expectedStatus === 200) created.attempts.push(res.body.attempt.id);
  return res;
}

describe("US-087/US-088 authoring - auth and validation", () => {
  it("rejects unauthenticated question management", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await request(app).get(`/api/assessment-events/${id}/questions`)).status).toBe(401);
    expect((await request(app).post(`/api/assessment-events/${id}/questions`).send({})).status).toBe(401);
    expect((await request(app).patch(`/api/assessment-events/${id}/questions/${id}`).send({})).status).toBe(401);
    expect((await request(app).delete(`/api/assessment-events/${id}/questions/${id}`)).status).toBe(401);
  });

  it("rejects a student role for authoring", async () => {
    const f = await baseFixture("auth-role");
    const eventId = await createEvent(f);
    const res = await request(app)
      .post(`/api/assessment-events/${eventId}/questions`)
      .set(auth(f.studentToken, f.organizationId))
      .send(QUESTION);
    expect(res.status).toBe(403);
  });

  it("allows a teacher to author questions", async () => {
    const f = await baseFixture("teacher");
    const eventId = await createEvent(f);
    const res = await request(app)
      .post(`/api/assessment-events/${eventId}/questions`)
      .set(auth(f.teacherToken, f.organizationId))
      .send(QUESTION);
    expect(res.status).toBe(201);
    created.questions.push(res.body.question.id);
  });

  it("creates and lists questions with stored correct key and marks", async () => {
    const f = await baseFixture("crud");
    const eventId = await createEvent(f);
    const questionId = await addQuestion(f, eventId);

    const list = await request(app)
      .get(`/api/assessment-events/${eventId}/questions`)
      .set(auth(f.adminToken, f.organizationId));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.questions[0].id).toBe(questionId);
    expect(list.body.questions[0].correct_option_key).toBe("B");
    expect(Number(list.body.questions[0].marks)).toBe(2);
  });

  it("rejects invalid question input", async () => {
    const f = await baseFixture("invalid-q");
    const eventId = await createEvent(f);
    for (const body of [
      { ...QUESTION, options: [] },
      { ...QUESTION, options: [{ key: "A", text: "3" }, { key: "A", text: "dup" }] },
      { ...QUESTION, correct_option_key: "Z" },
      { ...QUESTION, marks: -1 },
      { ...QUESTION, question_type: "ESSAY" },
    ]) {
      const res = await request(app)
        .post(`/api/assessment-events/${eventId}/questions`)
        .set(auth(f.adminToken, f.organizationId))
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it("rejects a duplicate sequence number", async () => {
    const f = await baseFixture("dup-seq");
    const eventId = await createEvent(f);
    await addQuestion(f, eventId);
    const res = await request(app)
      .post(`/api/assessment-events/${eventId}/questions`)
      .set(auth(f.adminToken, f.organizationId))
      .send({ ...QUESTION, sequence_number: 0 });
    expect(res.status).toBe(409);
  });

  it("rejects a cross-tenant event", async () => {
    const a = await baseFixture("tenant-a");
    const b = await baseFixture("tenant-b");
    const eventId = await createEvent(a);
    const res = await request(app)
      .post(`/api/assessment-events/${eventId}/questions`)
      .set(auth(b.adminToken, b.organizationId))
      .send(QUESTION);
    expect(res.status).toBe(404);
  });

  it("updates and deletes questions while draft", async () => {
    const f = await baseFixture("upd-del");
    const eventId = await createEvent(f);
    const questionId = await addQuestion(f, eventId);

    const updated = await request(app)
      .patch(`/api/assessment-events/${eventId}/questions/${questionId}`)
      .set(auth(f.adminToken, f.organizationId))
      .send({ question_text: "2 + 3 = ?", sequence_number: 5 });
    expect(updated.status).toBe(200);
    expect(updated.body.question.question_text).toBe("2 + 3 = ?");
    expect(Number(updated.body.question.sequence_number)).toBe(5);

    const deleted = await request(app)
      .delete(`/api/assessment-events/${eventId}/questions/${questionId}`)
      .set(auth(f.adminToken, f.organizationId));
    expect(deleted.status).toBe(200);
  });

  it("rejects a question from another assessment (cross-assessment)", async () => {
    const f = await baseFixture("cross-q");
    const eventA = await createEvent(f);
    const eventB = await createEvent(f);
    const questionId = await addQuestion(f, eventA);

    const res = await request(app)
      .patch(`/api/assessment-events/${eventB}/questions/${questionId}`)
      .set(auth(f.adminToken, f.organizationId))
      .send({ question_text: "changed" });
    expect(res.status).toBe(404);
  });

  it("locks questions once the assessment is scheduled", async () => {
    const f = await baseFixture("locked");
    const eventId = await createEvent(f);
    const questionId = await addQuestion(f, eventId);
    await pool.query("UPDATE assessment_events SET status = 'SCHEDULED' WHERE id = $1", [eventId]);

    expect(
      (await request(app).post(`/api/assessment-events/${eventId}/questions`).set(auth(f.adminToken, f.organizationId)).send(QUESTION)).status
    ).toBe(400);
    expect(
      (await request(app).patch(`/api/assessment-events/${eventId}/questions/${questionId}`).set(auth(f.adminToken, f.organizationId)).send({ question_text: "x" })).status
    ).toBe(400);
    expect(
      (await request(app).delete(`/api/assessment-events/${eventId}/questions/${questionId}`).set(auth(f.adminToken, f.organizationId))).status
    ).toBe(400);
  });
});

describe("US-089 start assessment attempt", () => {
  it("rejects unauthenticated start", async () => {
    expect(
      (await request(app).post("/api/student/assessment-events/00000000-0000-4000-8000-000000000000/attempts")).status
    ).toBe(401);
  });

  it("rejects a non-student role", async () => {
    const f = await baseFixture("start-role");
    const { eventId } = await scheduledEventWithQuestion(f);
    const res = await request(app)
      .post(`/api/student/assessment-events/${eventId}/attempts`)
      .set(auth(f.adminToken, f.organizationId));
    expect(res.status).toBe(403);
  });

  it("starts an attempt with safe (answer-key-free) questions", async () => {
    const f = await baseFixture("start-ok");
    const { eventId } = await scheduledEventWithQuestion(f);
    const res = await startAttempt(f, eventId);
    expect(res.body.attempt.status).toBe("IN_PROGRESS");
    expect(res.body.questions.length).toBe(1);
    expect(res.body.questions[0]).not.toHaveProperty("correct_option_key");
    expect(res.body.questions[0]).not.toHaveProperty("explanation");
  });

  it("rejects a draft assessment", async () => {
    const f = await baseFixture("start-draft");
    const eventId = await createEvent(f, { status: "DRAFT" });
    await startAttempt(f, eventId, 400);
  });

  it("rejects an assessment outside its scheduled window", async () => {
    const f = await baseFixture("start-window");
    const past = await createEvent(f, { status: "SCHEDULED", startOffsetMs: -7200_000, endOffsetMs: -3600_000 });
    await startAttempt(f, past, 400);
    const future = await createEvent(f, { status: "SCHEDULED", startOffsetMs: 3600_000, endOffsetMs: 7200_000 });
    await startAttempt(f, future, 400);
  });

  it("rejects an unenrolled student", async () => {
    const f = await baseFixture("start-unenrolled", { enrolled: false });
    const { eventId } = await scheduledEventWithQuestion(f);
    await startAttempt(f, eventId, 403);
  });

  it("rejects a cross-tenant assessment", async () => {
    const a = await baseFixture("start-ta");
    const b = await baseFixture("start-tb");
    const { eventId } = await scheduledEventWithQuestion(a);
    const res = await request(app)
      .post(`/api/student/assessment-events/${eventId}/attempts`)
      .set(auth(b.studentToken, b.organizationId));
    expect(res.status).toBe(404);
  });

  it("resumes an existing in-progress attempt instead of duplicating", async () => {
    const f = await baseFixture("resume");
    const { eventId } = await scheduledEventWithQuestion(f);
    const first = await startAttempt(f, eventId);
    const second = await request(app)
      .post(`/api/student/assessment-events/${eventId}/attempts`)
      .set(auth(f.studentToken, f.organizationId));
    expect(second.status).toBe(200);
    expect(second.body.attempt.id).toBe(first.body.attempt.id);
    const count = await pool.query("SELECT count(*)::int AS c FROM assessment_attempts WHERE assessment_event_id = $1", [eventId]);
    expect(count.rows[0].c).toBe(1);
  });

  it("ignores client-supplied student identity", async () => {
    const f = await baseFixture("start-identity");
    const { eventId } = await scheduledEventWithQuestion(f);
    const otherUser = await createUser("start-identity-other");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudentId = await createStudent(f.organizationId, otherUser, "Other");
    await enrollStudent(f.organizationId, otherStudentId, f.classId);

    const res = await request(app)
      .post(`/api/student/assessment-events/${eventId}/attempts`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ student_id: otherStudentId });
    expect(res.status).toBe(201);
    created.attempts.push(res.body.attempt.id);
    const db = await pool.query("SELECT student_id FROM assessment_attempts WHERE id = $1", [res.body.attempt.id]);
    expect(db.rows[0].student_id).toBe(f.studentId);
  });
});

describe("US-090 save assessment answers", () => {
  it("rejects unauthenticated save", async () => {
    expect(
      (await request(app).put("/api/student/assessment-attempts/00000000-0000-4000-8000-000000000000/answers").send({ answers: [] })).status
    ).toBe(401);
  });

  it("saves and updates answers while IN_PROGRESS", async () => {
    const f = await baseFixture("save-ok");
    const { eventId, questionId } = await scheduledEventWithQuestion(f);
    const started = await startAttempt(f, eventId);
    const attemptId = started.body.attempt.id as string;

    const first = await request(app)
      .put(`/api/student/assessment-attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: questionId, selected_option: "B" }] });
    expect(first.status).toBe(200);
    expect(first.body.answers[0].selected_option).toBe("B");

    const second = await request(app)
      .put(`/api/student/assessment-attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: questionId, selected_option: "A" }] });
    expect(second.status).toBe(200);
    const db = await pool.query("SELECT selected_option FROM assessment_answers WHERE attempt_id = $1", [attemptId]);
    expect(db.rows[0].selected_option).toBe("A");
  });

  it("rejects an invalid option and a foreign question", async () => {
    const f = await baseFixture("save-bad");
    const { eventId, questionId } = await scheduledEventWithQuestion(f);
    const started = await startAttempt(f, eventId);
    const attemptId = started.body.attempt.id as string;

    const badOption = await request(app)
      .put(`/api/student/assessment-attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: questionId, selected_option: "Z" }] });
    expect(badOption.status).toBe(400);

    const otherEvent = await createEvent(f, { status: "DRAFT" });
    const otherQuestion = await addQuestion(f, otherEvent);
    const foreign = await request(app)
      .put(`/api/student/assessment-attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: otherQuestion, selected_option: "B" }] });
    expect(foreign.status).toBe(400);
  });

  it("rejects a cross-student answer save (IDOR)", async () => {
    const f = await baseFixture("save-idor");
    const { eventId } = await scheduledEventWithQuestion(f);
    const started = await startAttempt(f, eventId);
    const attemptId = started.body.attempt.id as string;

    const otherUser = await createUser("save-intruder");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudentId = await createStudent(f.organizationId, otherUser, "Intruder");
    await enrollStudent(f.organizationId, otherStudentId, f.classId);

    const res = await request(app)
      .put(`/api/student/assessment-attempts/${attemptId}/answers`)
      .set(auth(createAccessToken(otherUser), f.organizationId))
      .send({ answers: [] });
    expect(res.status).toBe(404);
  });

  it("rejects mutation of a non-IN_PROGRESS attempt", async () => {
    const f = await baseFixture("save-final");
    const { eventId, questionId } = await scheduledEventWithQuestion(f);
    const started = await startAttempt(f, eventId);
    const attemptId = started.body.attempt.id as string;
    await pool.query("UPDATE assessment_attempts SET status = 'SUBMITTED', submitted_at = now() WHERE id = $1", [attemptId]);

    const res = await request(app)
      .put(`/api/student/assessment-attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: questionId, selected_option: "B" }] });
    expect(res.status).toBe(400);
  });
});
