import request from "supertest";
import { describe, expect, it, afterEach } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

// US-101: assessment performance as SEPARATE INDIVIDUAL RESULTS (Decision
// #12). No aggregation, no composite, read-only over Epic 8 + Epic 9.

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
  teachers: [] as string[],
  structures: [] as string[],
  nodes: [] as string[],
  practices: [] as string[],
  practiceAttempts: [] as string[],
  events: [] as string[],
  portions: [] as string[],
  questions: [] as string[],
  formalAttempts: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
  years: [] as string[],
  curriculumVersions: [] as string[],
};

async function cleanup() {
  if (created.formalAttempts.length) {
    await pool.query("DELETE FROM assessment_results WHERE attempt_id = ANY($1::uuid[])", [created.formalAttempts]);
    await pool.query("DELETE FROM assessment_answers WHERE attempt_id = ANY($1::uuid[])", [created.formalAttempts]);
    await pool.query("DELETE FROM assessment_attempts WHERE id = ANY($1::uuid[])", [created.formalAttempts]);
  }
  if (created.questions.length) await pool.query("DELETE FROM assessment_questions WHERE id = ANY($1::uuid[])", [created.questions]);
  if (created.portions.length) await pool.query("DELETE FROM assessment_event_curriculum_portions WHERE id = ANY($1::uuid[])", [created.portions]);
  if (created.events.length) await pool.query("DELETE FROM assessment_events WHERE id = ANY($1::uuid[])", [created.events]);
  if (created.practiceAttempts.length) {
    await pool.query("DELETE FROM practice_attempt_answers WHERE attempt_id = ANY($1::uuid[])", [created.practiceAttempts]);
    await pool.query("DELETE FROM practice_attempts WHERE id = ANY($1::uuid[])", [created.practiceAttempts]);
  }
  if (created.practices.length) {
    await pool.query("DELETE FROM practice_questions WHERE practice_id = ANY($1::uuid[])", [created.practices]);
    await pool.query("DELETE FROM practices WHERE id = ANY($1::uuid[])", [created.practices]);
  }
  if (created.nodes.length) await pool.query("DELETE FROM curriculum_nodes WHERE id = ANY($1::uuid[])", [created.nodes]);
  if (created.structures.length) await pool.query("DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])", [created.structures]);
  if (created.syllabusVersions.length) await pool.query("DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])", [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
  if (created.curriculumVersions.length) await pool.query("DELETE FROM curriculum_versions WHERE id = ANY($1::uuid[])", [created.curriculumVersions]);
  if (created.years.length) await pool.query("DELETE FROM academic_years WHERE id = ANY($1::uuid[])", [created.years]);
  if (created.teachers.length) await pool.query("DELETE FROM teachers WHERE id = ANY($1::uuid[])", [created.teachers]);
  if (created.classSubjects.length) await pool.query("DELETE FROM class_subjects WHERE id = ANY($1::uuid[])", [created.classSubjects]);
  if (created.subjects.length) await pool.query("DELETE FROM subjects WHERE id = ANY($1::uuid[])", [created.subjects]);
  if (created.enrollments.length) await pool.query("DELETE FROM student_enrollments WHERE id = ANY($1::uuid[])", [created.enrollments]);
  if (created.classes.length) await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  if (created.students.length) await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  Object.values(created).forEach((ids) => { ids.length = 0; });
}

afterEach(cleanup);

async function createUser(label: string) {
  const r = await pool.query(`INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`, [`${unique(`ep101_${label}`)}@example.com`, `Epic 101 ${label}`]);
  created.users.push(r.rows[0].id);
  return r.rows[0].id as string;
}

type Fixture = {
  organizationId: string;
  classId: string;
  subjectId: string;
  adminToken: string;
  teacherToken: string;
  studentToken: string;
  studentId: string;
  otherStudentToken: string;
  topicId: string;
  topicTitle: string;
  structureId: string;
  yearId: string;
  practices: string[];
};

async function buildFixture(label: string, opts: { assignTeacher?: boolean } = {}): Promise<Fixture> {
  const adminId = await createUser(`${label}-admin`);
  const orgRes = await pool.query(`INSERT INTO organizations (name, slug, type, status, created_by_user_id) VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`, [`Epic 101 ${label}`, unique(`ep101_org_${label}`), adminId]);
  created.organizations.push(orgRes.rows[0].id);
  const organizationId = orgRes.rows[0].id as string;
  const addMember = async (userId: string, role: string) => {
    const roleRes = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [role]);
    await pool.query(`INSERT INTO organization_members (user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [userId, organizationId, roleRes.rows[0].id]);
  };
  await addMember(adminId, "SCHOOL_ADMIN");
  const teacherUserId = await createUser(`${label}-teacher`);
  await addMember(teacherUserId, "TEACHER");
  const classRes = await pool.query(`INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, `Epic 101 class ${label}`, adminId]);
  created.classes.push(classRes.rows[0].id);
  const classId = classRes.rows[0].id as string;
  const teacherRes = await pool.query(`INSERT INTO teachers (organization_id, user_id) VALUES ($1, $2) RETURNING id`, [organizationId, teacherUserId]);
  created.teachers.push(teacherRes.rows[0].id);
  if (opts.assignTeacher !== false) {
    await pool.query(`INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id) VALUES ($1, $2, $3)`, [organizationId, classId, teacherRes.rows[0].id]);
  }
  const subjectRes = await pool.query(`INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, `Epic 101 Subject ${label}`, unique(`ep101_s_${label}`)]);
  created.subjects.push(subjectRes.rows[0].id);
  const subjectId = subjectRes.rows[0].id as string;
  const csRes = await pool.query(`INSERT INTO class_subjects (organization_id, class_id, subject_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, classId, subjectId]);
  created.classSubjects.push(csRes.rows[0].id);

  const mkStudent = async (suffix: string) => {
    const userId = await createUser(`${label}-${suffix}`);
    await addMember(userId, "STUDENT");
    const sRes = await pool.query(`INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status) VALUES ($1, $2, $3, '8', 'ACTIVE') RETURNING id`, [userId, organizationId, `${label} ${suffix}`]);
    created.students.push(sRes.rows[0].id);
    const eRes = await pool.query(`INSERT INTO student_enrollments (organization_id, student_id, class_id, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, sRes.rows[0].id, classId]);
    created.enrollments.push(eRes.rows[0].id);
    return { studentId: sRes.rows[0].id as string, token: createAccessToken(userId) };
  };
  const student = await mkStudent("student");
  const other = await mkStudent("other");

  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const yearRes = await pool.query(`INSERT INTO academic_years (code, name, start_date, end_date) VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`, [`ep101y_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32), `Epic 101 year ${label}`]);
  created.years.push(yearRes.rows[0].id);
  const yearId = yearRes.rows[0].id as string;
  const cvRes = await pool.query(`INSERT INTO curriculum_versions (board_id, academic_year_id, version) VALUES ($1, $2, $3) RETURNING id`, [board.id, yearId, unique(`ep101_cv_${label}`)]);
  created.curriculumVersions.push(cvRes.rows[0].id);
  const syRes = await pool.query(`INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [classId, board.id, medium.id, `Epic 101 syllabus ${label}`, unique(`ep101_sy_${label}`)]);
  created.syllabi.push(syRes.rows[0].id);
  const svRes = await pool.query(`INSERT INTO syllabus_versions (syllabus_id, curriculum_version_id, version, status) VALUES ($1, $2, '1', 'ACTIVE') RETURNING id`, [syRes.rows[0].id, cvRes.rows[0].id]);
  created.syllabusVersions.push(svRes.rows[0].id);
  const stRes = await pool.query(`INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`, [svRes.rows[0].id, `Epic 101 structure ${label}`, subjectId]);
  created.structures.push(stRes.rows[0].id);
  const structureId = stRes.rows[0].id as string;
  const chapterType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'chapter' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const topicType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const chRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, node_type_id, title) VALUES ($1, $2, $3) RETURNING id`, [structureId, chapterType, `Chapter ${label}`]);
  created.nodes.push(chRes.rows[0].id);
  const topicTitle = `Fractions ${label}`;
  const tRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title) VALUES ($1, $2, $3, $4) RETURNING id`, [structureId, chRes.rows[0].id, topicType, topicTitle]);
  created.nodes.push(tRes.rows[0].id);
  const topicId = tRes.rows[0].id as string;

  const practices: string[] = [];
  for (const tag of ["a", "b"]) {
    const pRes = await pool.query(`INSERT INTO practices (organization_id, curriculum_node_id, title, practice_type, status, created_by_user_id) VALUES ($1, $2, $3, 'PRACTICE', 'PUBLISHED', $4) RETURNING id`, [organizationId, topicId, `Epic 101 practice ${label} ${tag}`, adminId]);
    created.practices.push(pRes.rows[0].id);
    practices.push(pRes.rows[0].id as string);
    await pool.query(`INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks) VALUES ($1, 0, 'MULTIPLE_CHOICE_SINGLE', $2, $3, 'A', 2)`, [pRes.rows[0].id, `Q ${tag}`, JSON.stringify([{ key: "A", text: "yes" }, { key: "B", text: "no" }])]);
  }

  return { organizationId, classId, subjectId, adminToken: createAccessToken(adminId), teacherToken: createAccessToken(teacherUserId), studentToken: student.token, studentId: student.studentId, otherStudentToken: other.token, topicId, topicTitle, structureId, yearId, practices };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function submitPractice(f: Fixture, practiceId: string, correct: boolean) {
  const started = await request(app).post(`/api/student/practices/${practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.practiceAttempts.push(started.body.attempt.id);
  const q = (started.body.questions as { id: string }[])[0];
  const saved = await request(app).put(`/api/student/attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers: [{ question_id: q.id, selected_option: correct ? "A" : "B" }] });
  expect(saved.status).toBe(200);
  const submitted = await request(app).post(`/api/student/attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(200);
  return submitted.body;
}

async function submitFormal(f: Fixture, tag: string, linkTopic: boolean, answerCorrectly: boolean) {
  const start = new Date(Date.now() - 3600_000).toISOString();
  const end = new Date(Date.now() + 3600_000).toISOString();
  const evRes = await pool.query(`INSERT INTO assessment_events (organization_id, academic_year_id, class_id, subject_id, title, scheduled_start, scheduled_end, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT') RETURNING id`, [f.organizationId, f.yearId, f.classId, f.subjectId, `Epic 101 exam ${tag}`, start, end]);
  created.events.push(evRes.rows[0].id);
  const eventId = evRes.rows[0].id as string;
  if (linkTopic) {
    const portion = await request(app).post(`/api/assessment-events/${eventId}/curriculum-portions`).set(auth(f.adminToken, f.organizationId)).send({ curriculumStructureId: f.structureId, curriculumNodeId: f.topicId });
    expect(portion.status).toBe(201);
    created.portions.push(portion.body.curriculumPortion.id);
  }
  const q = await request(app).post(`/api/assessment-events/${eventId}/questions`).set(auth(f.adminToken, f.organizationId))
    .send({ question_text: `FQ ${tag}`, question_type: "MULTIPLE_CHOICE_SINGLE", options: [{ key: "A", text: "yes" }, { key: "B", text: "no" }], correct_option_key: "A", marks: 5 });
  expect(q.status).toBe(201);
  created.questions.push(q.body.question.id);
  const scheduled = await request(app).post(`/api/assessment-events/${eventId}/status`).set(auth(f.adminToken, f.organizationId)).send({ status: "SCHEDULED" });
  expect(scheduled.status).toBe(200);
  const started = await request(app).post(`/api/student/assessment-events/${eventId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.formalAttempts.push(started.body.attempt.id);
  if (answerCorrectly) {
    const saved = await request(app).put(`/api/student/assessment-attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers: [{ question_id: q.body.question.id, selected_option: "A" }] });
    expect(saved.status).toBe(200);
  }
  const submitted = await request(app).post(`/api/student/assessment-attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(200);
  return { eventId, attemptId: started.body.attempt.id as string };
}

describe("US-101 individual results", () => {
  it("preserves practice and formal results 1:1 with source values", async () => {
    const f = await buildFixture("one-to-one");
    const practice = await submitPractice(f, f.practices[0], true);
    const formal = await submitFormal(f, "formalone", true, true);

    const res = await request(app).get("/api/student/assessment-performance").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.practice_results).toHaveLength(1);
    expect(res.body.formal_assessment_results).toHaveLength(1);
    const pr = res.body.practice_results[0];
    expect(pr).toMatchObject({ attempt_id: practice.id, practice_id: f.practices[0], score: 2, max_score: 2, percentage: 100, correct_count: 1 });
    expect(pr.practice_title).toBeTruthy();
    expect(pr.topic).toBe(f.topicTitle);
    const fr = res.body.formal_assessment_results[0];
    expect(fr).toMatchObject({ attempt_id: formal.attemptId, assessment_event_id: formal.eventId, score: 5, max_score: 5, percentage: 100 });
    expect(fr.assessment_title).toBeTruthy();
    expect(fr.subject_id).toBe(f.subjectId);
    expect(fr.topics).toContain(f.topicTitle);

    // Values match the source rows exactly.
    const dbPractice = (await pool.query("SELECT score, max_score, percentage FROM practice_attempts WHERE id = $1", [practice.id])).rows[0];
    expect([pr.score, pr.max_score, pr.percentage]).toEqual([Number(dbPractice.score), Number(dbPractice.max_score), Number(dbPractice.percentage)]);
    const dbFormal = (await pool.query("SELECT score, max_score, percentage FROM assessment_results WHERE attempt_id = $1", [formal.attemptId])).rows[0];
    expect([fr.score, fr.max_score, fr.percentage]).toEqual([Number(dbFormal.score), Number(dbFormal.max_score), Number(dbFormal.percentage)]);
  });

  it("keeps sources separate with no combined or aggregate fields", async () => {
    const f = await buildFixture("separate");
    await submitPractice(f, f.practices[0], true);
    await submitFormal(f, "sep", true, false);
    const res = await request(app).get("/api/student/assessment-performance").set(auth(f.studentToken, f.organizationId));
    expect(Object.keys(res.body).sort()).toEqual(["formal_assessment_results", "practice_results"]);
    const flat = JSON.stringify(res.body);
    for (const key of ["combined", "overall", "average", "weighted", "latest", "best", "total_score", "composite"]) {
      expect(flat).not.toContain(`"${key}"`);
    }
  });

  it("excludes IN_PROGRESS attempts and unsubmitted formal attempts", async () => {
    const f = await buildFixture("inprogress");
    const started = await request(app).post(`/api/student/practices/${f.practices[0]}/attempts`).set(auth(f.studentToken, f.organizationId));
    expect(started.status).toBe(201);
    created.practiceAttempts.push(started.body.attempt.id);
    const res = await request(app).get("/api/student/assessment-performance").set(auth(f.studentToken, f.organizationId));
    expect(res.body.practice_results).toHaveLength(0);
    expect(res.body.formal_assessment_results).toHaveLength(0);
  });

  it("returns empty collections when a source has no results", async () => {
    const f = await buildFixture("empty");
    await submitPractice(f, f.practices[0], true);
    const onlyPractice = await request(app).get("/api/student/assessment-performance").set(auth(f.studentToken, f.organizationId));
    expect(onlyPractice.body.practice_results).toHaveLength(1);
    expect(onlyPractice.body.formal_assessment_results).toEqual([]);
    const fresh = await request(app).get("/api/student/assessment-performance").set(auth(f.otherStudentToken, f.organizationId));
    expect(fresh.body).toEqual({ practice_results: [], formal_assessment_results: [] });
  });

  it("preserves multiple results per source newest-first", async () => {
    const f = await buildFixture("multi");
    const first = await submitPractice(f, f.practices[0], true);
    const second = await submitPractice(f, f.practices[1], false);
    const formal1 = await submitFormal(f, "m1", false, true);
    const formal2 = await submitFormal(f, "m2", false, false);
    const res = await request(app).get("/api/student/assessment-performance").set(auth(f.studentToken, f.organizationId));
    expect(res.body.practice_results.map((r: { attempt_id: string }) => r.attempt_id)).toEqual([second.id, first.id]);
    expect(res.body.formal_assessment_results.map((r: { attempt_id: string }) => r.attempt_id)).toEqual([formal2.attemptId, formal1.attemptId]);
    expect(res.body.formal_assessment_results[1].topics).toEqual([]);
  });
});

describe("US-101 authorization and tenancy", () => {
  it("rejects unauthenticated reads", async () => {
    expect((await request(app).get("/api/student/assessment-performance")).status).toBe(401);
    expect((await request(app).get("/api/organizations/00000000-0000-4000-8000-000000000000/students/00000000-0000-4000-8000-000000000000/assessment-performance")).status).toBe(401);
  });

  it("restricts students to their own results", async () => {
    const f = await buildFixture("ownership");
    await submitPractice(f, f.practices[0], true);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/assessment-performance`).set(auth(f.studentToken, f.organizationId))).status).toBe(403);
    const other = await request(app).get("/api/student/assessment-performance").set(auth(f.otherStudentToken, f.organizationId));
    expect(other.body).toEqual({ practice_results: [], formal_assessment_results: [] });
  });

  it("serves assigned teachers and admins with student identity", async () => {
    const f = await buildFixture("staff");
    await submitPractice(f, f.practices[0], true);
    await submitFormal(f, "staff", true, true);
    for (const token of [f.teacherToken, f.adminToken]) {
      const res = await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/assessment-performance`).set(auth(token, f.organizationId));
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(f.studentId);
      expect(res.body.practice_results).toHaveLength(1);
      expect(res.body.formal_assessment_results).toHaveLength(1);
    }
  });

  it("rejects unassigned teachers and isolates tenants", async () => {
    const f = await buildFixture("unassigned", { assignTeacher: false });
    await submitPractice(f, f.practices[0], true);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/assessment-performance`).set(auth(f.teacherToken, f.organizationId))).status).toBe(403);
    const other = await buildFixture("other-org");
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/assessment-performance`).set(auth(other.adminToken, other.organizationId))).status).toBe(403);
    const self = await request(app).get("/api/student/assessment-performance").set(auth(other.studentToken, other.organizationId));
    expect(self.body).toEqual({ practice_results: [], formal_assessment_results: [] });
  });

  it("handles invalid identifiers and unknown students", async () => {
    const f = await buildFixture("edge");
    expect((await request(app).get(`/api/organizations/nope/students/${f.studentId}/assessment-performance`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/nope/assessment-performance`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/00000000-0000-4000-8000-000000000000/assessment-performance`).set(auth(f.adminToken, f.organizationId))).status).toBe(404);
  });

  it("returns deterministic repeated results", async () => {
    const f = await buildFixture("deterministic");
    await submitPractice(f, f.practices[0], true);
    await submitFormal(f, "det", true, false);
    const first = await request(app).get("/api/student/assessment-performance").set(auth(f.studentToken, f.organizationId));
    const second = await request(app).get("/api/student/assessment-performance").set(auth(f.studentToken, f.organizationId));
    expect(second.body).toEqual(first.body);
  });
});
