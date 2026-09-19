import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

// US-096 verification only: proves a TOPIC-scoped formal assessment flows
// through the existing Epic 9 pipeline (US-087–US-094) end to end.
// No production code, no migrations, no new subsystem, no Epic 8 coupling.

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
  classSubjects: [] as string[],
  subjects: [] as string[],
  years: [] as string[],
  events: [] as string[],
  portions: [] as string[],
  questions: [] as string[],
  attempts: [] as string[],
  nodes: [] as string[],
  structures: [] as string[],
  datasets: [] as string[],
  curriculumVersions: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
};

async function cleanup() {
  if (created.portions.length) await pool.query("DELETE FROM assessment_event_curriculum_portions WHERE id = ANY($1::uuid[])", [created.portions]);
  if (created.attempts.length) {
    await pool.query("DELETE FROM assessment_results WHERE attempt_id = ANY($1::uuid[])", [created.attempts]);
    await pool.query("DELETE FROM assessment_answers WHERE attempt_id = ANY($1::uuid[])", [created.attempts]);
    await pool.query("DELETE FROM assessment_attempts WHERE id = ANY($1::uuid[])", [created.attempts]);
  }
  if (created.questions.length) await pool.query("DELETE FROM assessment_questions WHERE id = ANY($1::uuid[])", [created.questions]);
  if (created.events.length) await pool.query("DELETE FROM assessment_events WHERE id = ANY($1::uuid[])", [created.events]);
  if (created.nodes.length) await pool.query("DELETE FROM curriculum_nodes WHERE id = ANY($1::uuid[])", [created.nodes]);
  if (created.structures.length) await pool.query("DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])", [created.structures]);
  if (created.datasets.length) await pool.query("DELETE FROM curriculum_reference_datasets WHERE id = ANY($1::uuid[])", [created.datasets]);
  if (created.syllabusVersions.length) await pool.query("DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])", [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
  if (created.curriculumVersions.length) await pool.query("DELETE FROM curriculum_versions WHERE id = ANY($1::uuid[])", [created.curriculumVersions]);
  if (created.classSubjects.length) await pool.query("DELETE FROM class_subjects WHERE id = ANY($1::uuid[])", [created.classSubjects]);
  if (created.subjects.length) await pool.query("DELETE FROM subjects WHERE id = ANY($1::uuid[])", [created.subjects]);
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
    [`${unique(`ep96_${label}`)}@example.com`, `Epic 96 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Epic 96 ${label}`, unique(`ep96_org_${label}`), ownerUserId]
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

type TopicFixture = {
  organizationId: string;
  classId: string;
  subjectId: string;
  yearId: string;
  adminToken: string;
  teacherToken: string;
  studentToken: string;
  studentId: string;
  structureId: string;
  topicNodeId: string;
  topicTitle: string;
};

async function topicFixture(label: string): Promise<TopicFixture> {
  const adminId = await createUser(`${label}-admin`);
  const organizationId = await createOrganization(adminId, `${label}-org`);
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  const teacherId = await createUser(`${label}-teacher`);
  await addMember(teacherId, organizationId, "TEACHER");
  const classRes = await pool.query(
    `INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, `Epic 96 class ${label}`, adminId]
  );
  created.classes.push(classRes.rows[0].id);
  const classId = classRes.rows[0].id as string;
  const yearRes = await pool.query(
    `INSERT INTO academic_years (code, name, start_date, end_date) VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`,
    [`ep96y_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32), `Epic 96 year ${label}`]
  );
  created.years.push(yearRes.rows[0].id);
  const yearId = yearRes.rows[0].id as string;
  const subjectRes = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Epic 96 Maths ${label}`, unique(`ep96_sub_${label}`)]
  );
  created.subjects.push(subjectRes.rows[0].id);
  const subjectId = subjectRes.rows[0].id as string;
  const csRes = await pool.query(
    `INSERT INTO class_subjects (organization_id, class_id, subject_id) VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, classId, subjectId]
  );
  created.classSubjects.push(csRes.rows[0].id);
  const studentUserId = await createUser(`${label}-student`);
  await addMember(studentUserId, organizationId, "STUDENT");
  const studentRes = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status)
     VALUES ($1, $2, $3, '8', 'ACTIVE') RETURNING id`,
    [studentUserId, organizationId, `${label} Student`]
  );
  created.students.push(studentRes.rows[0].id);
  const studentId = studentRes.rows[0].id as string;
  const enrollRes = await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, studentId, classId]
  );
  created.enrollments.push(enrollRes.rows[0].id);

  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const cvRes = await pool.query(
    `INSERT INTO curriculum_versions (board_id, academic_year_id, version) VALUES ($1, $2, $3) RETURNING id`,
    [board.id, yearId, unique(`ep96_cv_${label}`)]
  );
  created.curriculumVersions.push(cvRes.rows[0].id);
  const dsRes = await pool.query(
    `INSERT INTO curriculum_reference_datasets (curriculum_version_id, dataset_code, dataset_version, source_name, checksum)
     VALUES ($1, $2, '1', 'Epic 96 dataset', $3) RETURNING id`,
    [cvRes.rows[0].id, unique(`ep96_ds_${label}`), unique("checksum")]
  );
  created.datasets.push(dsRes.rows[0].id);
  const stRes = await pool.query(
    `INSERT INTO curriculum_structures (reference_dataset_id, structure_kind, name) VALUES ($1, 'SYLLABUS', $2) RETURNING id`,
    [dsRes.rows[0].id, `Epic 96 structure ${label}`]
  );
  created.structures.push(stRes.rows[0].id);
  const structureId = stRes.rows[0].id as string;
  const topicType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  expect(topicType).toBeTruthy();
  const topicTitle = `Fractions ${label} ${Math.random().toString(36).slice(2, 6)}`;
  const nodeRes = await pool.query(
    `INSERT INTO curriculum_nodes (curriculum_structure_id, node_type_id, title) VALUES ($1, $2, $3) RETURNING id`,
    [structureId, topicType.id, topicTitle]
  );
  created.nodes.push(nodeRes.rows[0].id);

  return {
    organizationId, classId, subjectId, yearId,
    adminToken: createAccessToken(adminId), teacherToken: createAccessToken(teacherId),
    studentToken: createAccessToken(studentUserId), studentId,
    structureId, topicNodeId: nodeRes.rows[0].id as string, topicTitle,
  };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

const questionBody = (correct: string, marks: number) => ({
  question_text: `Topic Q ${correct} ${marks} ${Math.random().toString(36).slice(2, 6)}`,
  question_type: "MULTIPLE_CHOICE_SINGLE",
  options: [{ key: "A", text: "opt A" }, { key: "B", text: "opt B" }],
  correct_option_key: correct,
  marks,
});

async function createTopicEvent(f: TopicFixture, status = "DRAFT") {
  const start = new Date(Date.now() - 3600_000).toISOString();
  const end = new Date(Date.now() + 3600_000).toISOString();
  const result = await pool.query(
    `INSERT INTO assessment_events (organization_id, academic_year_id, class_id, subject_id, title, scheduled_start, scheduled_end, status)
     VALUES ($1, $2, $3, $4, 'Topic test: Fractions', $5, $6, $7) RETURNING id`,
    [f.organizationId, f.yearId, f.classId, f.subjectId, start, end, status]
  );
  created.events.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function linkTopic(f: TopicFixture, eventId: string, structureId?: string, nodeId?: string | null, expected = 201) {
  const res = await request(app)
    .post(`/api/assessment-events/${eventId}/curriculum-portions`)
    .set(auth(f.adminToken, f.organizationId))
    .send({ curriculumStructureId: structureId ?? f.structureId, curriculumNodeId: nodeId === undefined ? f.topicNodeId : nodeId });
  expect(res.status).toBe(expected);
  if (expected === 201) created.portions.push(res.body.curriculumPortion.id);
  return res;
}

async function addQuestion(f: TopicFixture, eventId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/assessment-events/${eventId}/questions`)
    .set(auth(f.adminToken, f.organizationId))
    .send(body);
  expect(res.status).toBe(201);
  created.questions.push(res.body.question.id);
  return res.body.question.id as string;
}

describe("US-096 topic tests - formal topic-test flow", () => {
  it("links a formal assessment to a TOPIC through curriculum portions", async () => {
    const f = await topicFixture("link");
    const eventId = await createTopicEvent(f);
    const res = await linkTopic(f, eventId);
    expect(res.body.curriculumPortion.assessment_event_id).toBe(eventId);
    expect(res.body.curriculumPortion.curriculum_structure_id).toBe(f.structureId);
    expect(res.body.curriculumPortion.curriculum_node_id).toBe(f.topicNodeId);

    const listed = await request(app)
      .get(`/api/assessment-events/${eventId}/curriculum-portions`)
      .set(auth(f.adminToken, f.organizationId));
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.curriculumPortions[0].curriculum_node_id).toBe(f.topicNodeId);

    const db = await pool.query(
      `SELECT n.title, t.code AS node_type FROM assessment_event_curriculum_portions p
       JOIN curriculum_nodes n ON n.id = p.curriculum_node_id
       JOIN curriculum_node_types t ON t.id = n.node_type_id
       WHERE p.assessment_event_id = $1`,
      [eventId]
    );
    expect(db.rows[0].title).toBe(f.topicTitle);
    expect(db.rows[0].node_type.toLowerCase()).toBe("topic");
  });

  it("executes a topic-scoped formal exam end to end", async () => {
    const f = await topicFixture("happy");
    const eventId = await createTopicEvent(f);
    await linkTopic(f, eventId);
    const q1 = await addQuestion(f, eventId, questionBody("B", 2));
    const q2 = await addQuestion(f, eventId, questionBody("A", 3));

    const scheduled = await request(app)
      .post(`/api/assessment-events/${eventId}/status`)
      .set(auth(f.adminToken, f.organizationId))
      .send({ status: "SCHEDULED" });
    expect(scheduled.status).toBe(200);

    const started = await request(app)
      .post(`/api/student/assessment-events/${eventId}/attempts`)
      .set(auth(f.studentToken, f.organizationId));
    expect(started.status).toBe(201);
    const attemptId = started.body.attempt.id as string;
    created.attempts.push(attemptId);

    const saved = await request(app)
      .put(`/api/student/assessment-attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: q1, selected_option: "B" }, { question_id: q2, selected_option: "B" }] });
    expect(saved.status).toBe(200);

    const submitted = await request(app)
      .post(`/api/student/assessment-attempts/${attemptId}/submit`)
      .set(auth(f.studentToken, f.organizationId));
    expect(submitted.status).toBe(200);
    expect(submitted.body.attempt.status).toBe("SUBMITTED");
    expect(submitted.body.result.score).toBe(2);
    expect(submitted.body.result.max_score).toBe(5);
    expect(submitted.body.result.percentage).toBe(40);
    expect(submitted.body.result.correct_count).toBe(1);
    expect(submitted.body.result.incorrect_count).toBe(1);
    expect(submitted.body.result.unanswered_count).toBe(0);

    const resultRow = await pool.query("SELECT * FROM assessment_results WHERE attempt_id = $1", [attemptId]);
    expect(resultRow.rows.length).toBe(1);
    expect(resultRow.rows[0].organization_id).toBe(f.organizationId);
    expect(resultRow.rows[0].assessment_event_id).toBe(eventId);
    expect(resultRow.rows[0].student_id).toBe(f.studentId);

    const list = await request(app)
      .get(`/api/assessment-events/${eventId}/results`)
      .set(auth(f.teacherToken, f.organizationId));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.results[0].attempt_id).toBe(attemptId);
    expect(list.body.results[0].score).toBe(2);

    const detail = await request(app)
      .get(`/api/assessment-events/${eventId}/results/${attemptId}`)
      .set(auth(f.teacherToken, f.organizationId));
    expect(detail.status).toBe(200);
    expect(detail.body.result.assessment_event_id).toBe(eventId);
    expect(detail.body.result.student.id).toBe(f.studentId);
  });

  it("rejects starting a topic test before it is scheduled", async () => {
    const f = await topicFixture("window");
    const eventId = await createTopicEvent(f, "DRAFT");
    await linkTopic(f, eventId);
    await addQuestion(f, eventId, questionBody("B", 2));
    const res = await request(app)
      .post(`/api/student/assessment-events/${eventId}/attempts`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("rejects linking a topic structure from another organization", async () => {
    const f = await topicFixture("foreign");
    const eventId = await createTopicEvent(f);

    const otherAdmin = await createUser("foreign-other-admin");
    const otherOrg = await createOrganization(otherAdmin, "foreign-other-org");
    await addMember(otherAdmin, otherOrg, "SCHOOL_ADMIN");
    const otherClass = await pool.query(
      `INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`,
      [otherOrg, "Epic 96 foreign class", otherAdmin]
    );
    created.classes.push(otherClass.rows[0].id);
    const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
    const medium = (await pool.query("SELECT id FROM mediums WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
    const syllabus = await pool.query(
      `INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [otherClass.rows[0].id, board.id, medium.id, "Epic 96 foreign syllabus", unique("ep96_fsyll")]
    );
    created.syllabi.push(syllabus.rows[0].id);
    const sv = await pool.query(`INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`, [syllabus.rows[0].id]);
    created.syllabusVersions.push(sv.rows[0].id);
    const st = await pool.query(`INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name) VALUES ($1, 'SYLLABUS', 'Epic 96 foreign structure') RETURNING id`, [sv.rows[0].id]);
    created.structures.push(st.rows[0].id);

    const res = await linkTopic(f, eventId, st.rows[0].id, null, 403);
    expect(res.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
    const count = await pool.query("SELECT count(*)::int AS c FROM assessment_event_curriculum_portions WHERE assessment_event_id = $1", [eventId]);
    expect(count.rows[0].c).toBe(0);
  });

  it("rejects a topic node that belongs to a different structure", async () => {
    const f = await topicFixture("mismatch");
    const eventId = await createTopicEvent(f);
    const other = await topicFixture("mismatch-other");
    await linkTopic(f, eventId, other.structureId, other.topicNodeId, 400);
    await linkTopic(f, eventId, f.structureId, "00000000-0000-4000-8000-000000000000", 400);
    const count = await pool.query("SELECT count(*)::int AS c FROM assessment_event_curriculum_portions WHERE assessment_event_id = $1", [eventId]);
    expect(count.rows[0].c).toBe(0);
  });

  it("rejects cross-tenant attempt and result access on a topic test", async () => {
    const a = await topicFixture("xt-a");
    const b = await topicFixture("xt-b");
    const eventId = await createTopicEvent(a);
    await linkTopic(a, eventId);
    await addQuestion(a, eventId, questionBody("B", 2));
    await pool.query("UPDATE assessment_events SET status = 'SCHEDULED' WHERE id = $1", [eventId]);
    const started = await request(app)
      .post(`/api/student/assessment-events/${eventId}/attempts`)
      .set(auth(a.studentToken, a.organizationId));
    expect(started.status).toBe(201);
    created.attempts.push(started.body.attempt.id);

    expect((await request(app).post(`/api/student/assessment-attempts/${started.body.attempt.id}/submit`).set(auth(b.studentToken, b.organizationId))).status).toBe(404);
    expect((await request(app).get(`/api/assessment-events/${eventId}/results`).set(auth(b.teacherToken, b.organizationId))).status).toBe(404);
    expect((await request(app).get(`/api/assessment-events/${eventId}/results/${started.body.attempt.id}`).set(auth(b.teacherToken, b.organizationId))).status).toBe(404);
  });

  it("keeps the topic-test flow inside the formal domain, never practice tables", async () => {
    const f = await topicFixture("separation");
    const eventId = await createTopicEvent(f);
    await linkTopic(f, eventId);
    const q1 = await addQuestion(f, eventId, questionBody("B", 2));
    await pool.query("UPDATE assessment_events SET status = 'SCHEDULED' WHERE id = $1", [eventId]);
    const started = await request(app)
      .post(`/api/student/assessment-events/${eventId}/attempts`)
      .set(auth(f.studentToken, f.organizationId));
    created.attempts.push(started.body.attempt.id);
    await request(app)
      .put(`/api/student/assessment-attempts/${started.body.attempt.id}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: q1, selected_option: "B" }] });
    const submitted = await request(app)
      .post(`/api/student/assessment-attempts/${started.body.attempt.id}/submit`)
      .set(auth(f.studentToken, f.organizationId));
    expect(submitted.status).toBe(200);

    const orgPractices = await pool.query("SELECT count(*)::int AS c FROM practices WHERE organization_id = $1", [f.organizationId]);
    expect(orgPractices.rows[0].c).toBe(0);
    const studentPractice = await pool.query("SELECT count(*)::int AS c FROM practice_attempts WHERE student_id = $1", [f.studentId]);
    expect(studentPractice.rows[0].c).toBe(0);
    const studentPracticeAnswers = await pool.query(
      `SELECT count(*)::int AS c FROM practice_attempt_answers pa
       JOIN practice_attempts p ON p.id = pa.attempt_id WHERE p.student_id = $1`,
      [f.studentId]
    );
    expect(studentPracticeAnswers.rows[0].c).toBe(0);
    const formalQuestions = await pool.query(
      "SELECT count(*)::int AS c FROM assessment_questions WHERE organization_id = $1 AND assessment_event_id = $2",
      [f.organizationId, eventId]
    );
    expect(formalQuestions.rows[0].c).toBe(1);
    const formalAttempts = await pool.query(
      "SELECT count(*)::int AS c FROM assessment_attempts WHERE organization_id = $1 AND assessment_event_id = $2",
      [f.organizationId, eventId]
    );
    expect(formalAttempts.rows[0].c).toBe(1);
    const formalAnswers = await pool.query(
      "SELECT count(*)::int AS c FROM assessment_answers WHERE attempt_id = $1",
      [started.body.attempt.id]
    );
    expect(formalAnswers.rows[0].c).toBe(1);
    const formalResults = await pool.query(
      "SELECT count(*)::int AS c FROM assessment_results WHERE organization_id = $1 AND assessment_event_id = $2",
      [f.organizationId, eventId]
    );
    expect(formalResults.rows[0].c).toBe(1);
  });
});
