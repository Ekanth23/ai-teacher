import request from "supertest";
import { describe, expect, it, afterEach } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

// US-106: learning profile as pure composition of US-097-105 getters.
// No new calculation, no persistence. Each section must equal its source.

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
  concepts: [] as string[],
  mappings: [] as { scope: string; question: string; item: string }[],
  practices: [] as string[],
  attempts: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
  assignments: [] as string[],
  submissions: [] as string[],
  events: [] as string[],
  questions: [] as string[],
  formalAttempts: [] as string[],
  years: [] as string[],
};

async function cleanup() {
  if (created.mappings.length) {
    for (const m of created.mappings) {
      await pool.query("DELETE FROM question_concepts WHERE question_scope = $1 AND question_id = $2 AND knowledge_item_id = $3", [m.scope, m.question, m.item]);
    }
  }
  if (created.submissions.length) await pool.query("DELETE FROM submissions WHERE id = ANY($1::uuid[])", [created.submissions]);
  if (created.assignments.length) await pool.query("DELETE FROM assignments WHERE id = ANY($1::uuid[])", [created.assignments]);
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
  if (created.concepts.length) await pool.query("DELETE FROM knowledge_items WHERE id = ANY($1::uuid[])", [created.concepts]);
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
  const r = await pool.query(`INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`, [`${unique(`ep106_${label}`)}@example.com`, `Epic 106 ${label}`]);
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
  topicId: string;
  conceptId: string;
  practiceId: string;
  questionIds: string[];
};

async function buildFixture(label: string, opts: { assignTeacher?: boolean } = {}): Promise<Fixture> {
  const adminId = await createUser(`${label}-admin`);
  const orgRes = await pool.query(`INSERT INTO organizations (name, slug, type, status, created_by_user_id) VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`, [`Epic 106 ${label}`, unique(`ep106_org_${label}`), adminId]);
  created.organizations.push(orgRes.rows[0].id);
  const organizationId = orgRes.rows[0].id as string;
  const addMember = async (userId: string, role: string) => {
    const roleRes = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [role]);
    await pool.query(`INSERT INTO organization_members (user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [userId, organizationId, roleRes.rows[0].id]);
  };
  await addMember(adminId, "SCHOOL_ADMIN");
  const teacherUserId = await createUser(`${label}-teacher`);
  await addMember(teacherUserId, "TEACHER");
  const classRes = await pool.query(`INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, `Epic 106 class ${label}`, adminId]);
  created.classes.push(classRes.rows[0].id);
  const classId = classRes.rows[0].id as string;
  const teacherRes = await pool.query(`INSERT INTO teachers (organization_id, user_id) VALUES ($1, $2) RETURNING id`, [organizationId, teacherUserId]);
  created.teachers.push(teacherRes.rows[0].id);
  if (opts.assignTeacher !== false) {
    await pool.query(`INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id) VALUES ($1, $2, $3)`, [organizationId, classId, teacherRes.rows[0].id]);
  }
  const subjectRes = await pool.query(`INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, `Epic 106 Subject ${label}`, unique(`ep106_s_${label}`)]);
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
  const syRes = await pool.query(`INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [classId, board.id, medium.id, `Epic 106 syllabus ${label}`, unique(`ep106_sy_${label}`)]);
  created.syllabi.push(syRes.rows[0].id);
  const svRes = await pool.query(`INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`, [syRes.rows[0].id]);
  created.syllabusVersions.push(svRes.rows[0].id);
  const stRes = await pool.query(`INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`, [svRes.rows[0].id, `Epic 106 structure ${label}`, subjectId]);
  created.structures.push(stRes.rows[0].id);
  const structureId = stRes.rows[0].id as string;
  const chapterType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'chapter' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const topicType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const chRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, node_type_id, title) VALUES ($1, $2, $3) RETURNING id`, [structureId, chapterType, `Chapter ${label}`]);
  created.nodes.push(chRes.rows[0].id);
  const tRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title) VALUES ($1, $2, $3, $4) RETURNING id`, [structureId, chRes.rows[0].id, topicType, `Fractions ${label}`]);
  created.nodes.push(tRes.rows[0].id);
  const topicId = tRes.rows[0].id as string;

  const cRes = await pool.query(`INSERT INTO knowledge_items (kind, code, name) VALUES ('CONCEPT', $1, $2) RETURNING id`, [unique(`ep106_con_${label}`), `Equivalent Fractions ${label}`]);
  created.concepts.push(cRes.rows[0].id);
  const conceptId = cRes.rows[0].id as string;

  const teacherRow = await pool.query(`SELECT id FROM teachers WHERE organization_id = $1 LIMIT 1`, [organizationId]);
  void teacherRow;
  const pRes = await pool.query(`INSERT INTO practices (organization_id, curriculum_node_id, title, practice_type, status, created_by_user_id) VALUES ($1, $2, $3, 'PRACTICE', 'PUBLISHED', $4) RETURNING id`, [organizationId, topicId, `Epic 106 practice ${label}`, adminId]);
  created.practices.push(pRes.rows[0].id);
  const practiceId = pRes.rows[0].id as string;
  const questionIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const qRes = await pool.query(`INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks) VALUES ($1, $2, 'MULTIPLE_CHOICE_SINGLE', $3, $4, 'A', 1) RETURNING id`, [practiceId, i, `Q ${label} ${i}`, JSON.stringify([{ key: "A", text: "yes" }, { key: "B", text: "no" }])]);
    questionIds.push(qRes.rows[0].id as string);
  }
  for (const qid of questionIds) {
    await pool.query(`INSERT INTO question_concepts (question_scope, question_id, knowledge_item_id, is_primary) VALUES ('PRACTICE', $1, $2, true)`, [qid, conceptId]);
    created.mappings.push({ scope: "PRACTICE", question: qid, item: conceptId });
  }

  return { organizationId, classId, adminToken: createAccessToken(adminId), teacherToken: createAccessToken(teacherUserId), studentToken: student.token, studentId: student.studentId, otherStudentToken: other.token, topicId, conceptId, practiceId, questionIds };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function submitPracticeWrong(f: Fixture, count: number) {
  const started = await request(app).post(`/api/student/practices/${f.practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.attempts.push(started.body.attempt.id);
  const saved = await request(app).put(`/api/student/attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId))
    .send({ answers: f.questionIds.slice(0, count).map((qid) => ({ question_id: qid, selected_option: "B" })) });
  expect(saved.status).toBe(200);
  const submitted = await request(app).post(`/api/student/attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(200);
}

async function submitHomework(f: Fixture) {
  const teacherRow = await pool.query(`SELECT id FROM teachers WHERE organization_id = $1 LIMIT 1`, [f.organizationId]);
  const subjectRow = await pool.query(`SELECT id FROM subjects WHERE organization_id = $1 LIMIT 1`, [f.organizationId]);
  const aRes = await pool.query(`INSERT INTO assignments (organization_id, teacher_id, class_id, subject_id, title, due_at, status) VALUES ($1, $2, $3, $4, 'Epic 106 hw', $5, 'OPEN') RETURNING id`, [f.organizationId, teacherRow.rows[0].id, f.classId, subjectRow.rows[0].id, new Date(Date.now() + 86400_000).toISOString()]);
  created.assignments.push(aRes.rows[0].id);
  const sub = await request(app).post(`/api/student/assignments/${aRes.rows[0].id}/submissions`).set(auth(f.studentToken, f.organizationId)).send({ content: "done" });
  expect(sub.status).toBe(201);
  created.submissions.push(sub.body.submission.id);
}

async function submitFormalWrong(f: Fixture) {
  const yearRes = await pool.query(`INSERT INTO academic_years (code, name, start_date, end_date) VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`, [`ep106y_${Date.now().toString(36)}`.slice(0, 32), "Epic 106 year"]);
  created.years.push(yearRes.rows[0].id);
  const evRes = await pool.query(`INSERT INTO assessment_events (organization_id, academic_year_id, class_id, title, scheduled_start, scheduled_end, status) VALUES ($1, $2, $3, 'Epic 106 formal', $4, $5, 'DRAFT') RETURNING id`, [f.organizationId, yearRes.rows[0].id, f.classId, new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString()]);
  created.events.push(evRes.rows[0].id);
  const eventId = evRes.rows[0].id as string;
  const q = await request(app).post(`/api/assessment-events/${eventId}/questions`).set(auth(f.adminToken, f.organizationId))
    .send({ question_text: "FQ", question_type: "MULTIPLE_CHOICE_SINGLE", options: [{ key: "A", text: "yes" }, { key: "B", text: "no" }], correct_option_key: "A", marks: 5 });
  expect(q.status).toBe(201);
  created.questions.push(q.body.question.id);
  await pool.query(`INSERT INTO question_concepts (question_scope, question_id, knowledge_item_id, is_primary) VALUES ('FORMAL', $1, $2, true)`, [q.body.question.id, f.conceptId]);
  created.mappings.push({ scope: "FORMAL", question: q.body.question.id, item: f.conceptId });
  await pool.query("UPDATE assessment_events SET status = 'SCHEDULED' WHERE id = $1", [eventId]);
  const started = await request(app).post(`/api/student/assessment-events/${eventId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.formalAttempts.push(started.body.attempt.id);
  await request(app).put(`/api/student/assessment-attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers: [{ question_id: q.body.question.id, selected_option: "B" }] });
  const submitted = await request(app).post(`/api/student/assessment-attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(200);
}

async function seedActivity(f: Fixture) {
  // 4 attempts x 3 wrong answers = 12 responses, 0% mean -> weak topic + repeated mistake on the concept.
  await submitPracticeWrong(f, 3);
  await submitPracticeWrong(f, 3);
  await submitPracticeWrong(f, 3);
  await submitPracticeWrong(f, 3);
  await submitHomework(f);
  await submitFormalWrong(f);
}

const SELF_SOURCES: [string, string][] = [
  ["subject_progress", "/api/student/progress"],
  ["homework", "/api/student/homework-performance"],
  ["assessment", "/api/student/assessment-performance"],
  ["weak", "/api/student/weak-topics"],
  ["strong", "/api/student/strong-topics"],
  ["unfinished", "/api/student/unfinished-learning"],
  ["mistakes", "/api/student/repeated-mistakes"],
];
void SELF_SOURCES;

async function getSource(f: Fixture, path: string) {
  const res = await request(app).get(path).set(auth(f.studentToken, f.organizationId));
  expect(res.status).toBe(200);
  return res.body;
}

describe("US-106 learning profile composition", () => {
  it("contains all ten approved sections", async () => {
    const f = await buildFixture("sections");
    await seedActivity(f);
    const res = await request(app).get("/api/student/learning-profile").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["chapter_progress", "formal_assessment_performance", "homework_performance", "practice_performance", "repeated_mistakes", "strong_topics", "subject_progress", "topic_progress", "unfinished_learning", "weak_topics"]);
  });

  it("matches every section to its source getter output", async () => {
    const f = await buildFixture("fidelity");
    await seedActivity(f);
    const h = auth(f.studentToken, f.organizationId);
    const [progress, homework, assessment, weak, strong, unfinished, mistakes] = await Promise.all([
      getSource(f, "/api/student/progress"),
      getSource(f, "/api/student/homework-performance"),
      getSource(f, "/api/student/assessment-performance"),
      getSource(f, "/api/student/weak-topics"),
      getSource(f, "/api/student/strong-topics"),
      getSource(f, "/api/student/unfinished-learning"),
      getSource(f, "/api/student/repeated-mistakes"),
    ]);
    const res = await request(app).get("/api/student/learning-profile").set(h);
    expect(res.body.subject_progress).toEqual({ subjects: progress.subjects });
    expect(res.body.chapter_progress).toEqual({ chapters: progress.chapters });
    expect(res.body.topic_progress).toEqual({ topics: progress.topics });
    expect(res.body.homework_performance).toEqual(homework);
    expect(res.body.practice_performance).toEqual({ practice_results: assessment.practice_results });
    expect(res.body.formal_assessment_performance).toEqual({ formal_assessment_results: assessment.formal_assessment_results });
    expect(res.body.strong_topics).toEqual(strong);
    expect(res.body.weak_topics).toEqual(weak);
    expect(res.body.unfinished_learning).toEqual(unfinished);
    expect(res.body.repeated_mistakes).toEqual(mistakes);
    // Weak + mistake evidence present from seeded wrong answers.
    expect(res.body.weak_topics.weak_topics).toHaveLength(1);
    expect(res.body.repeated_mistakes.repeated_mistakes).toHaveLength(1);
  });

  it("preserves empty states from underlying getters", async () => {
    const f = await buildFixture("empty106");
    const res = await request(app).get("/api/student/learning-profile").set(auth(f.otherStudentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.homework_performance).toMatchObject({ total: 0 });
    expect(res.body.practice_performance).toEqual({ practice_results: [] });
    expect(res.body.formal_assessment_performance).toEqual({ formal_assessment_results: [] });
    expect(res.body.weak_topics).toEqual({ weak_topics: [] });
    expect(res.body.strong_topics).toEqual({ strong_topics: [] });
    expect(res.body.repeated_mistakes).toEqual({ repeated_mistakes: [] });
    for (const t of [...res.body.subject_progress.subjects, ...res.body.chapter_progress.chapters, ...res.body.topic_progress.topics]) {
      expect(t.completed).toBe(0);
    }
  });

  it("exposes no forbidden mastery/score/recommendation fields", async () => {
    const f = await buildFixture("forbidden");
    await seedActivity(f);
    const res = await request(app).get("/api/student/learning-profile").set(auth(f.studentToken, f.organizationId));
    const flat = JSON.stringify(res.body);
    for (const key of ["mastery", "ranking", "recommendation", "trend", "history", "snapshot", "selected_option", "correct_option"]) {
      expect(flat).not.toContain(`"${key}"`);
    }
  });
});

describe("US-106 authorization and tenancy", () => {
  it("rejects unauthenticated reads", async () => {
    expect((await request(app).get("/api/student/learning-profile")).status).toBe(401);
    expect((await request(app).get("/api/organizations/00000000-0000-4000-8000-000000000000/students/00000000-0000-4000-8000-000000000000/learning-profile")).status).toBe(401);
  });

  it("restricts students to their own profile", async () => {
    const f = await buildFixture("ownership106");
    await seedActivity(f);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/learning-profile`).set(auth(f.studentToken, f.organizationId))).status).toBe(403);
    const other = await request(app).get("/api/student/learning-profile").set(auth(f.otherStudentToken, f.organizationId));
    expect(other.status).toBe(200);
    expect(other.body.practice_performance).toEqual({ practice_results: [] });
  });

  it("serves assigned teachers and admins with student identity", async () => {
    const f = await buildFixture("staff106");
    await seedActivity(f);
    for (const token of [f.teacherToken, f.adminToken]) {
      const res = await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/learning-profile`).set(auth(token, f.organizationId));
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(f.studentId);
      expect(Object.keys(res.body).sort()).toEqual(["chapter_progress", "formal_assessment_performance", "homework_performance", "practice_performance", "repeated_mistakes", "strong_topics", "student", "subject_progress", "topic_progress", "unfinished_learning", "weak_topics"]);
      const self = await request(app).get("/api/student/learning-profile").set(auth(f.studentToken, f.organizationId));
      const { student: _ignored, ...staffProfile } = res.body;
      void _ignored;
      expect(staffProfile).toEqual(self.body);
    }
  });

  it("rejects unassigned teachers and isolates tenants", async () => {
    const f = await buildFixture("unassigned106", { assignTeacher: false });
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/learning-profile`).set(auth(f.teacherToken, f.organizationId))).status).toBe(403);
    const other = await buildFixture("other-org106");
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/learning-profile`).set(auth(other.adminToken, other.organizationId))).status).toBe(403);
    const self = await request(app).get("/api/student/learning-profile").set(auth(other.studentToken, other.organizationId));
    expect(JSON.stringify(self.body)).not.toContain(f.organizationId);
  });

  it("handles invalid identifiers and unknown students", async () => {
    const f = await buildFixture("edge106");
    expect((await request(app).get(`/api/organizations/nope/students/${f.studentId}/learning-profile`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/nope/learning-profile`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/00000000-0000-4000-8000-000000000000/learning-profile`).set(auth(f.adminToken, f.organizationId))).status).toBe(404);
  });

  it("returns deterministic repeated results", async () => {
    const f = await buildFixture("det106");
    await seedActivity(f);
    const first = await request(app).get("/api/student/learning-profile").set(auth(f.studentToken, f.organizationId));
    const second = await request(app).get("/api/student/learning-profile").set(auth(f.studentToken, f.organizationId));
    expect(second.body).toEqual(first.body);
  });
});
