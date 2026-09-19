import request from "supertest";
import { describe, expect, it, afterEach } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

// US-103: strong topics (Decision #17). Strong iff performance >= 90% AND
// answered_responses >= 10. Per-attempt percentages averaged; exact Epic 8
// correctness; unanswered excluded; formal data excluded; no aggregation.

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
  attempts: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
  events: [] as string[],
  questions: [] as string[],
  formalAttempts: [] as string[],
  years: [] as string[],
};

async function cleanup() {
  if (created.formalAttempts.length) {
    await pool.query("DELETE FROM assessment_results WHERE attempt_id = ANY($1::uuid[])", [created.formalAttempts]);
    await pool.query("DELETE FROM assessment_answers WHERE attempt_id = ANY($1::uuid[])", [created.formalAttempts]);
    await pool.query("DELETE FROM assessment_attempts WHERE id = ANY($1::uuid[])", [created.formalAttempts]);
  }
  if (created.questions.length) await pool.query("DELETE FROM assessment_questions WHERE id = ANY($1::uuid[])", [created.questions]);
  if (created.events.length) await pool.query("DELETE FROM assessment_events WHERE id = ANY($1::uuid[])", [created.events]);
  if (created.years.length) await pool.query("DELETE FROM academic_years WHERE id = ANY($1::uuid[])", [created.years]);
  if (created.attempts.length) {
    await pool.query("DELETE FROM practice_attempt_answers WHERE attempt_id = ANY($1::uuid[])", [created.attempts]);
    await pool.query("DELETE FROM practice_attempts WHERE id = ANY($1::uuid[])", [created.attempts]);
  }
  if (created.practices.length) {
    await pool.query("DELETE FROM practice_questions WHERE practice_id = ANY($1::uuid[])", [created.practices]);
    await pool.query("DELETE FROM practices WHERE id = ANY($1::uuid[])", [created.practices]);
  }
  if (created.nodes.length) await pool.query("DELETE FROM curriculum_nodes WHERE id = ANY($1::uuid[])", [created.nodes]);
  if (created.structures.length) await pool.query("DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])", [created.structures]);
  if (created.syllabusVersions.length) await pool.query("DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])", [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
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
  const r = await pool.query(`INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`, [`${unique(`ep103_${label}`)}@example.com`, `Epic 103 ${label}`]);
  created.users.push(r.rows[0].id);
  return r.rows[0].id as string;
}

type Fixture = {
  organizationId: string;
  classId: string;
  adminToken: string;
  teacherToken: string;
  studentToken: string;
  studentId: string;
  otherStudentToken: string;
  topics: Record<string, string>;
};

async function buildFixture(label: string, opts: { assignTeacher?: boolean } = {}): Promise<Fixture> {
  const adminId = await createUser(`${label}-admin`);
  const orgRes = await pool.query(`INSERT INTO organizations (name, slug, type, status, created_by_user_id) VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`, [`Epic 103 ${label}`, unique(`ep103_org_${label}`), adminId]);
  created.organizations.push(orgRes.rows[0].id);
  const organizationId = orgRes.rows[0].id as string;
  const addMember = async (userId: string, role: string) => {
    const roleRes = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [role]);
    await pool.query(`INSERT INTO organization_members (user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [userId, organizationId, roleRes.rows[0].id]);
  };
  await addMember(adminId, "SCHOOL_ADMIN");
  const teacherUserId = await createUser(`${label}-teacher`);
  await addMember(teacherUserId, "TEACHER");
  const classRes = await pool.query(`INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, `Epic 103 class ${label}`, adminId]);
  created.classes.push(classRes.rows[0].id);
  const classId = classRes.rows[0].id as string;
  const teacherRes = await pool.query(`INSERT INTO teachers (organization_id, user_id) VALUES ($1, $2) RETURNING id`, [organizationId, teacherUserId]);
  created.teachers.push(teacherRes.rows[0].id);
  if (opts.assignTeacher !== false) {
    await pool.query(`INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id) VALUES ($1, $2, $3)`, [organizationId, classId, teacherRes.rows[0].id]);
  }
  const subjectRes = await pool.query(`INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, `Epic 103 Subject ${label}`, unique(`ep103_s_${label}`)]);
  created.subjects.push(subjectRes.rows[0].id);
  const csRes = await pool.query(`INSERT INTO class_subjects (organization_id, class_id, subject_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, classId, subjectRes.rows[0].id]);
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
  const syRes = await pool.query(`INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [classId, board.id, medium.id, `Epic 103 syllabus ${label}`, unique(`ep103_sy_${label}`)]);
  created.syllabi.push(syRes.rows[0].id);
  const svRes = await pool.query(`INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`, [syRes.rows[0].id]);
  created.syllabusVersions.push(svRes.rows[0].id);
  const stRes = await pool.query(`INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`, [svRes.rows[0].id, `Epic 103 structure ${label}`, subjectRes.rows[0].id]);
  created.structures.push(stRes.rows[0].id);
  const structureId = stRes.rows[0].id as string;
  const chapterType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'chapter' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const topicType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const chRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, node_type_id, title) VALUES ($1, $2, $3) RETURNING id`, [structureId, chapterType, `Chapter ${label}`]);
  created.nodes.push(chRes.rows[0].id);
  const topics: Record<string, string> = {};
  for (const tag of ["strong", "thin", "edge", "weak", "avg", "alpha", "beta"]) {
    const tRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title) VALUES ($1, $2, $3, $4) RETURNING id`, [structureId, chRes.rows[0].id, topicType, `${tag} ${label}`]);
    created.nodes.push(tRes.rows[0].id);
    topics[tag] = tRes.rows[0].id as string;
  }

  return { organizationId, classId, adminToken: createAccessToken(adminId), teacherToken: createAccessToken(teacherUserId), studentToken: student.token, studentId: student.studentId, otherStudentToken: other.token, topics };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function adminIdFor(f: Fixture) {
  const r = await pool.query(`SELECT created_by_user_id FROM classes WHERE id = $1`, [f.classId]);
  return r.rows[0].created_by_user_id as string;
}

async function mkPractice(f: Fixture, adminId: string, topicId: string, tag: string, numQuestions: number) {
  const pRes = await pool.query(`INSERT INTO practices (organization_id, curriculum_node_id, title, practice_type, status, created_by_user_id) VALUES ($1, $2, $3, 'PRACTICE', 'PUBLISHED', $4) RETURNING id`, [f.organizationId, topicId, `Epic 103 practice ${tag}`, adminId]);
  created.practices.push(pRes.rows[0].id);
  const practiceId = pRes.rows[0].id as string;
  const questionIds: string[] = [];
  for (let i = 0; i < numQuestions; i++) {
    const qRes = await pool.query(`INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks) VALUES ($1, $2, 'MULTIPLE_CHOICE_SINGLE', $3, $4, 'A', 1) RETURNING id`, [practiceId, i, `Q ${tag} ${i}`, JSON.stringify([{ key: "A", text: "yes" }, { key: "B", text: "no" }])]);
    questionIds.push(qRes.rows[0].id as string);
  }
  return { practiceId, questionIds };
}

async function submitAttempt(f: Fixture, practiceId: string, questionIds: string[], correctCount: number) {
  const started = await request(app).post(`/api/student/practices/${practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.attempts.push(started.body.attempt.id);
  const answers = questionIds.map((qid, i) => ({ question_id: qid, selected_option: i < correctCount ? "A" : "B" }));
  const saved = await request(app).put(`/api/student/attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers });
  expect(saved.status).toBe(200);
  const submitted = await request(app).post(`/api/student/attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(200);
  return submitted.body;
}

async function submitPartial(f: Fixture, practiceId: string, questionIds: string[], answerCount: number, correctCount: number) {
  const started = await request(app).post(`/api/student/practices/${practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.attempts.push(started.body.attempt.id);
  const answers = questionIds.slice(0, answerCount).map((qid, i) => ({ question_id: qid, selected_option: i < correctCount ? "A" : "B" }));
  const saved = await request(app).put(`/api/student/attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers });
  expect(saved.status).toBe(200);
  const submitted = await request(app).post(`/api/student/attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(200);
  return submitted.body;
}

const strongIds = (body: { strong_topics: { id: string }[] }) => body.strong_topics.map((t) => t.id);
const byId = <T extends { id: string }>(items: T[], id: string) => items.find((i) => i.id === id);

describe("US-103 strong-topic classification", () => {
  it("flags 10 responses at 90% as Strong", async () => {
    const f = await buildFixture("s90");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "s90", 10);
    await submitAttempt(f, p.practiceId, p.questionIds, 9);
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(byId(res.body.strong_topics, f.topics.strong)).toMatchObject({ performance: 90, answered_responses: 10 });
  });

  it("flags 10 responses at 100% as Strong", async () => {
    const f = await buildFixture("s100");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "s100", 10);
    await submitAttempt(f, p.practiceId, p.questionIds, 10);
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.strong_topics, f.topics.strong)).toMatchObject({ performance: 100, answered_responses: 10 });
  });

  it("does not flag 9 responses at 100% (insufficient evidence)", async () => {
    const f = await buildFixture("thin9");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.thin, "thin9", 10);
    await submitPartial(f, p.practiceId, p.questionIds, 9, 9);
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toEqual({ strong_topics: [] });
  });

  it("does not flag below-90% topics with sufficient evidence", async () => {
    const f = await buildFixture("edge89");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.edge, "e89", 10);
    await submitAttempt(f, p.practiceId, p.questionIds, 8); // 80% + 10 -> NOT strong
    const p2 = await mkPractice(f, adminId, f.topics.weak, "w89", 20);
    await submitAttempt(f, p2.practiceId, p2.questionIds, 17); // 85% + 20 -> NOT strong
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toEqual({ strong_topics: [] });
  });

  it("averages multiple attempts: 80/100 becomes 90", async () => {
    const f = await buildFixture("avg90");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.avg, "avg90", 10);
    await submitAttempt(f, p.practiceId, p.questionIds, 8); // 80%
    await submitAttempt(f, p.practiceId, p.questionIds, 10); // 100% -> mean 90, evidence 20 -> Strong
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.strong_topics, f.topics.avg)).toMatchObject({ performance: 90, answered_responses: 20 });
  });

  it("averages attempts instead of pooling raw answers", async () => {
    const f = await buildFixture("pool90");
    const adminId = await adminIdFor(f);
    const big = await mkPractice(f, adminId, f.topics.avg, "pool-b", 10);
    await submitAttempt(f, big.practiceId, big.questionIds, 10); // 100%
    const small = await mkPractice(f, adminId, f.topics.avg, "pool-s", 2);
    await submitAttempt(f, small.practiceId, small.questionIds, 1); // 50%
    // Mean (100+50)/2 = 75 < 90 with evidence 12 -> NOT strong.
    // Raw pooling would give 11/12 = 91.67% -> Strong. Mean is required.
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toEqual({ strong_topics: [] });
  });

  it("counts repeated answers across attempts separately toward evidence", async () => {
    const f = await buildFixture("repeat10");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "rep", 5);
    await submitAttempt(f, p.practiceId, p.questionIds, 5); // 100%, 5 responses
    await submitAttempt(f, p.practiceId, p.questionIds, 5); // 100%, 5 responses -> evidence 10, mean 100 -> Strong
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.strong_topics, f.topics.strong)).toMatchObject({ performance: 100, answered_responses: 10 });
  });

  it("excludes unanswered questions from performance and evidence", async () => {
    const f = await buildFixture("unans103");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "unans", 12);
    await submitPartial(f, p.practiceId, p.questionIds, 10, 9); // 9/10 = 90%, evidence 10 -> Strong (2 unanswered ignored)
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.strong_topics, f.topics.strong)).toMatchObject({ performance: 90, answered_responses: 10 });
  });

  it("excludes IN_PROGRESS attempts and zero-answer attempts", async () => {
    const f = await buildFixture("open103");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "open", 10);
    const started = await request(app).post(`/api/student/practices/${p.practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
    expect(started.status).toBe(201);
    created.attempts.push(started.body.attempt.id);
    const saved = await request(app).put(`/api/student/attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId))
      .send({ answers: p.questionIds.map((qid) => ({ question_id: qid, selected_option: "A" })) });
    expect(saved.status).toBe(200);
    // Submitted attempt with zero answered questions + open IN_PROGRESS attempt: neither distorts.
    const zero = await request(app).post(`/api/student/practices/${p.practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
    created.attempts.push(zero.body.attempt.id);
    const zeroSub = await request(app).post(`/api/student/attempts/${zero.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
    expect(zeroSub.status).toBe(200);
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toEqual({ strong_topics: [] });
  });

  it("keeps topics separated with exact contract fields and title ordering", async () => {
    const f = await buildFixture("separate103");
    const adminId = await adminIdFor(f);
    const pa = await mkPractice(f, adminId, f.topics.alpha, "sep-a", 10);
    await submitAttempt(f, pa.practiceId, pa.questionIds, 10);
    const pb = await mkPractice(f, adminId, f.topics.beta, "sep-b", 10);
    await submitAttempt(f, pb.practiceId, pb.questionIds, 9);
    const pw = await mkPractice(f, adminId, f.topics.weak, "sep-w", 10);
    await submitAttempt(f, pw.practiceId, pw.questionIds, 2);
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(res.body.strong_topics).toHaveLength(2);
    expect(res.body.strong_topics.map((t: { id: string }) => t.id)).toEqual([f.topics.alpha, f.topics.beta]);
    for (const t of res.body.strong_topics) {
      expect(Object.keys(t).sort()).toEqual(["answered_responses", "chapter_id", "id", "performance", "title"]);
    }
    for (const key of ["weakness_score", "mastery", "combined", "overall", "average_all"]) {
      expect(JSON.stringify(res.body)).not.toContain(`"${key}"`);
    }
  });

  it("ignores formal assessment data", async () => {
    const f = await buildFixture("formal103");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "fIgn", 10);
    await submitAttempt(f, p.practiceId, p.questionIds, 10); // Strong on practice evidence
    const yearRes = await pool.query(`INSERT INTO academic_years (code, name, start_date, end_date) VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`, [`ep103y_${Date.now().toString(36)}`.slice(0, 32), "Epic 103 formal year"]);
    created.years.push(yearRes.rows[0].id);
    const yearId = yearRes.rows[0].id as string;
    const classRow = await pool.query(`SELECT id FROM classes WHERE organization_id = $1 LIMIT 1`, [f.organizationId]);
    const evRes = await pool.query(`INSERT INTO assessment_events (organization_id, academic_year_id, class_id, title, scheduled_start, scheduled_end, status) VALUES ($1, $2, $3, 'Epic 103 formal', $4, $5, 'DRAFT') RETURNING id`, [f.organizationId, yearId, classRow.rows[0].id, new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString()]);
    created.events.push(evRes.rows[0].id);
    const eventId = evRes.rows[0].id as string;
    const q = await request(app).post(`/api/assessment-events/${eventId}/questions`).set(auth(f.adminToken, f.organizationId))
      .send({ question_text: "FQ", question_type: "MULTIPLE_CHOICE_SINGLE", options: [{ key: "A", text: "yes" }, { key: "B", text: "no" }], correct_option_key: "A", marks: 5 });
    expect(q.status).toBe(201);
    created.questions.push(q.body.question.id);
    await pool.query("UPDATE assessment_events SET status = 'SCHEDULED' WHERE id = $1", [eventId]);
    const started = await request(app).post(`/api/student/assessment-events/${eventId}/attempts`).set(auth(f.studentToken, f.organizationId));
    expect(started.status).toBe(201);
    created.formalAttempts.push(started.body.attempt.id);
    await request(app).put(`/api/student/assessment-attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers: [{ question_id: q.body.question.id, selected_option: "A" }] });
    const submitted = await request(app).post(`/api/student/assessment-attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
    expect(submitted.status).toBe(200);
    // Perfect formal result must not create, remove, or alter strong-topic output.
    const res = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.strong_topics, f.topics.strong)).toMatchObject({ performance: 100, answered_responses: 10 });
  });
});

describe("US-103 authorization and tenancy", () => {
  it("rejects unauthenticated reads", async () => {
    expect((await request(app).get("/api/student/strong-topics")).status).toBe(401);
    expect((await request(app).get("/api/organizations/00000000-0000-4000-8000-000000000000/students/00000000-0000-4000-8000-000000000000/strong-topics")).status).toBe(401);
  });

  it("restricts students to their own strong topics", async () => {
    const f = await buildFixture("ownership103");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "own", 10);
    await submitAttempt(f, p.practiceId, p.questionIds, 10);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/strong-topics`).set(auth(f.studentToken, f.organizationId))).status).toBe(403);
    const other = await request(app).get("/api/student/strong-topics").set(auth(f.otherStudentToken, f.organizationId));
    expect(other.body).toEqual({ strong_topics: [] });
  });

  it("serves assigned teachers and admins with student identity", async () => {
    const f = await buildFixture("staff103");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "stf", 10);
    await submitAttempt(f, p.practiceId, p.questionIds, 9);
    for (const token of [f.teacherToken, f.adminToken]) {
      const res = await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/strong-topics`).set(auth(token, f.organizationId));
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(f.studentId);
      expect(byId(res.body.strong_topics, f.topics.strong)).toMatchObject({ performance: 90, answered_responses: 10 });
    }
  });

  it("rejects unassigned teachers and isolates tenants", async () => {
    const f = await buildFixture("unassigned103", { assignTeacher: false });
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "una", 10);
    await submitAttempt(f, p.practiceId, p.questionIds, 10);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/strong-topics`).set(auth(f.teacherToken, f.organizationId))).status).toBe(403);
    const other = await buildFixture("other-org103");
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/strong-topics`).set(auth(other.adminToken, other.organizationId))).status).toBe(403);
    const self = await request(app).get("/api/student/strong-topics").set(auth(other.studentToken, other.organizationId));
    expect(self.body).toEqual({ strong_topics: [] });
  });

  it("handles invalid identifiers, unknown students, and empty data", async () => {
    const f = await buildFixture("edge103");
    expect((await request(app).get(`/api/organizations/nope/students/${f.studentId}/strong-topics`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/nope/strong-topics`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/00000000-0000-4000-8000-000000000000/strong-topics`).set(auth(f.adminToken, f.organizationId))).status).toBe(404);
    const empty = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(empty.body).toEqual({ strong_topics: [] });
  });

  it("returns deterministic repeated results", async () => {
    const f = await buildFixture("det103");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, f.topics.strong, "det", 10);
    await submitAttempt(f, p.practiceId, p.questionIds, 10);
    const first = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    const second = await request(app).get("/api/student/strong-topics").set(auth(f.studentToken, f.organizationId));
    expect(second.body).toEqual(first.body);
  });
});
