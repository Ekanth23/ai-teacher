import request from "supertest";
import { describe, expect, it, afterEach } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";
import { assignQuestionConcept } from "../../src/modules/progress/service.js";

// US-105: repeated mistakes (Decisions #19-27). Same primary CONCEPT across
// >=3 incorrect responses, >=3 distinct questions, >=2 submitted attempts.
// Practice + formal evidence may combine. Read-only detection.

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
  const r = await pool.query(`INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`, [`${unique(`ep105_${label}`)}@example.com`, `Epic 105 ${label}`]);
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
  concepts: Record<string, { id: string; name: string; code: string }>;
};

async function buildFixture(label: string, opts: { assignTeacher?: boolean } = {}): Promise<Fixture> {
  const adminId = await createUser(`${label}-admin`);
  const orgRes = await pool.query(`INSERT INTO organizations (name, slug, type, status, created_by_user_id) VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`, [`Epic 105 ${label}`, unique(`ep105_org_${label}`), adminId]);
  created.organizations.push(orgRes.rows[0].id);
  const organizationId = orgRes.rows[0].id as string;
  const addMember = async (userId: string, role: string) => {
    const roleRes = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [role]);
    await pool.query(`INSERT INTO organization_members (user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [userId, organizationId, roleRes.rows[0].id]);
  };
  await addMember(adminId, "SCHOOL_ADMIN");
  const teacherUserId = await createUser(`${label}-teacher`);
  await addMember(teacherUserId, "TEACHER");
  const classRes = await pool.query(`INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, `Epic 105 class ${label}`, adminId]);
  created.classes.push(classRes.rows[0].id);
  const classId = classRes.rows[0].id as string;
  const teacherRes = await pool.query(`INSERT INTO teachers (organization_id, user_id) VALUES ($1, $2) RETURNING id`, [organizationId, teacherUserId]);
  created.teachers.push(teacherRes.rows[0].id);
  if (opts.assignTeacher !== false) {
    await pool.query(`INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id) VALUES ($1, $2, $3)`, [organizationId, classId, teacherRes.rows[0].id]);
  }
  const subjectRes = await pool.query(`INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, `Epic 105 Subject ${label}`, unique(`ep105_s_${label}`)]);
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
  const syRes = await pool.query(`INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [classId, board.id, medium.id, `Epic 105 syllabus ${label}`, unique(`ep105_sy_${label}`)]);
  created.syllabi.push(syRes.rows[0].id);
  const svRes = await pool.query(`INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`, [syRes.rows[0].id]);
  created.syllabusVersions.push(svRes.rows[0].id);
  const stRes = await pool.query(`INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`, [svRes.rows[0].id, `Epic 105 structure ${label}`, subjectRes.rows[0].id]);
  created.structures.push(stRes.rows[0].id);
  const structureId = stRes.rows[0].id as string;
  const chapterType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'chapter' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const topicType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const chRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, node_type_id, title) VALUES ($1, $2, $3) RETURNING id`, [structureId, chapterType, `Chapter ${label}`]);
  created.nodes.push(chRes.rows[0].id);
  const tRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title) VALUES ($1, $2, $3, $4) RETURNING id`, [structureId, chRes.rows[0].id, topicType, `Fractions ${label}`]);
  created.nodes.push(tRes.rows[0].id);
  const topicId = tRes.rows[0].id as string;

  const concepts: Record<string, { id: string; name: string; code: string }> = {};
  for (const [tag, name, code] of [["frac", "Equivalent Fractions", "EQUIV_FRAC"], ["dec", "Decimal Place Value", "DEC_PLACE"]] as const) {
    const cRes = await pool.query(`INSERT INTO knowledge_items (kind, code, name) VALUES ('CONCEPT', $1, $2) RETURNING id`, [`${unique(`ep105_${tag}_${label}`)}_${code}`, `${name} ${label}`]);
    created.concepts.push(cRes.rows[0].id);
    concepts[tag] = { id: cRes.rows[0].id as string, name: `${name} ${label}`, code: `${unique(`ep105_${tag}_${label}`)}_${code}` };
  }

  return { organizationId, classId, adminToken: createAccessToken(adminId), teacherToken: createAccessToken(teacherUserId), studentToken: student.token, studentId: student.studentId, otherStudentToken: other.token, topicId, concepts };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function adminIdFor(f: Fixture) {
  const r = await pool.query(`SELECT created_by_user_id FROM classes WHERE id = $1`, [f.classId]);
  return r.rows[0].created_by_user_id as string;
}

async function mkPractice(f: Fixture, adminId: string, tag: string, numQuestions: number) {
  const pRes = await pool.query(`INSERT INTO practices (organization_id, curriculum_node_id, title, practice_type, status, created_by_user_id) VALUES ($1, $2, $3, 'PRACTICE', 'PUBLISHED', $4) RETURNING id`, [f.organizationId, f.topicId, `Epic 105 practice ${tag}`, adminId]);
  created.practices.push(pRes.rows[0].id);
  const practiceId = pRes.rows[0].id as string;
  const questionIds: string[] = [];
  for (let i = 0; i < numQuestions; i++) {
    const qRes = await pool.query(`INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks) VALUES ($1, $2, 'MULTIPLE_CHOICE_SINGLE', $3, $4, 'A', 1) RETURNING id`, [practiceId, i, `Q ${tag} ${i}`, JSON.stringify([{ key: "A", text: "yes" }, { key: "B", text: "no" }])]);
    questionIds.push(qRes.rows[0].id as string);
  }
  return { practiceId, questionIds };
}

async function mapAll(f: Fixture, scope: "PRACTICE" | "FORMAL", questionIds: string[], conceptId: string, primary: boolean) {
  for (const qid of questionIds) {
    await assignQuestionConcept(f.organizationId, scope, qid, conceptId, primary);
    created.mappings.push({ scope, question: qid, item: conceptId });
  }
}

async function submitPractice(f: Fixture, practiceId: string, answers: { qid: string; correct: boolean }[]) {
  const started = await request(app).post(`/api/student/practices/${practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.attempts.push(started.body.attempt.id);
  const saved = await request(app).put(`/api/student/attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId))
    .send({ answers: answers.map((a) => ({ question_id: a.qid, selected_option: a.correct ? "A" : "B" })) });
  expect(saved.status).toBe(200);
  const submitted = await request(app).post(`/api/student/attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(200);
}

async function submitFormal(f: Fixture, tag: string, answers: { qid: string; correct: boolean }[] | null, questionCount = 1) {
  const yearRes = await pool.query(`INSERT INTO academic_years (code, name, start_date, end_date) VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`, [`ep105y_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 32), `Epic 105 year ${tag}`]);
  created.years.push(yearRes.rows[0].id);
  const evRes = await pool.query(`INSERT INTO assessment_events (organization_id, academic_year_id, class_id, title, scheduled_start, scheduled_end, status) VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT') RETURNING id`, [f.organizationId, yearRes.rows[0].id, f.classId, `Epic 105 exam ${tag}`, new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString()]);
  created.events.push(evRes.rows[0].id);
  const eventId = evRes.rows[0].id as string;
  const qids: string[] = [];
  for (let i = 0; i < questionCount; i++) {
    const q = await request(app).post(`/api/assessment-events/${eventId}/questions`).set(auth(f.adminToken, f.organizationId))
      .send({ question_text: `FQ ${tag} ${i}`, question_type: "MULTIPLE_CHOICE_SINGLE", options: [{ key: "A", text: "yes" }, { key: "B", text: "no" }], correct_option_key: "A", marks: 5 });
    expect(q.status).toBe(201);
    created.questions.push(q.body.question.id);
    qids.push(q.body.question.id as string);
  }
  await pool.query("UPDATE assessment_events SET status = 'SCHEDULED' WHERE id = $1", [eventId]);
  const started = await request(app).post(`/api/student/assessment-events/${eventId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.formalAttempts.push(started.body.attempt.id);
  if (answers) {
    const saved = await request(app).put(`/api/student/assessment-attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId))
      .send({ answers: answers.map((a) => ({ question_id: a.qid, selected_option: a.correct ? "A" : "B" })) });
    expect(saved.status).toBe(200);
  }
  const submitted = await request(app).post(`/api/student/assessment-attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(200);
  return { eventId, qids };
}

const mistakeIds = (body: { repeated_mistakes: { concept: { id: string } }[] }) => body.repeated_mistakes.map((m) => m.concept.id);
const byConcept = <T extends { concept: { id: string } }>(items: T[], id: string) => items.find((i) => i.concept.id === id);

describe("US-105 detection", () => {
  it("detects 3 wrong / 3 questions / 2 attempts on one concept", async () => {
    const f = await buildFixture("detect");
    const adminId = await adminIdFor(f);
    const p1 = await mkPractice(f, adminId, "d1", 2);
    await mapAll(f, "PRACTICE", p1.questionIds, f.concepts.frac.id, true);
    const p2 = await mkPractice(f, adminId, "d2", 2);
    await mapAll(f, "PRACTICE", p2.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, p1.practiceId, p1.questionIds.map((qid) => ({ qid, correct: false })));
    await submitPractice(f, p2.practiceId, p2.questionIds.slice(0, 1).map((qid) => ({ qid, correct: false })));
    const res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(byConcept(res.body.repeated_mistakes, f.concepts.frac.id)).toMatchObject({ incorrect_responses: 3, distinct_questions: 3, distinct_attempts: 2 });
  });

  it("does not flag 2 wrong responses", async () => {
    const f = await buildFixture("two");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "two", 3);
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, p.practiceId, p.questionIds.slice(0, 2).map((qid) => ({ qid, correct: false })));
    const res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toEqual({ repeated_mistakes: [] });
  });

  it("does not flag 3 wrong responses on the same question", async () => {
    const f = await buildFixture("sameq");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "sameq", 3);
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.frac.id, true);
    for (let i = 0; i < 3; i++) {
      await submitPractice(f, p.practiceId, [{ qid: p.questionIds[0], correct: false }]);
    }
    const res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    // 3 responses but 1 distinct question (and evidence spans 3 attempts): no detection.
    expect(res.body).toEqual({ repeated_mistakes: [] });
  });

  it("does not flag 3 questions wrong in a single attempt", async () => {
    const f = await buildFixture("oneatt");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "oneatt", 3);
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, p.practiceId, p.questionIds.map((qid) => ({ qid, correct: false })));
    const res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toEqual({ repeated_mistakes: [] });
  });

  it("excludes correct, unanswered, and IN_PROGRESS answers", async () => {
    const f = await buildFixture("excl");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "excl", 4);
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.frac.id, true);
    // 1 wrong + 1 correct + 2 unanswered -> only 1 incorrect response.
    await submitPractice(f, p.practiceId, [{ qid: p.questionIds[0], correct: false }, { qid: p.questionIds[1], correct: true }]);
    const started = await request(app).post(`/api/student/practices/${p.practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
    created.attempts.push(started.body.attempt.id);
    await request(app).put(`/api/student/attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId))
      .send({ answers: p.questionIds.map((qid) => ({ question_id: qid, selected_option: "B" })) });
    const res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toEqual({ repeated_mistakes: [] });
  });

  it("ignores secondary-only mappings and counts only primary", async () => {
    const f = await buildFixture("sec");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "sec", 3);
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.dec.id, false);
    await submitPractice(f, p.practiceId, p.questionIds.map((qid) => ({ qid, correct: false })));
    // Wrong on 3 dec-mapped questions across 1 attempt: secondary never counts + single attempt anyway.
    let res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    expect(res.body).toEqual({ repeated_mistakes: [] });
    // Add primary mapping for frac on the same questions + one more attempt: frac counts, dec stays silent.
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, p.practiceId, p.questionIds.map((qid) => ({ qid, correct: false })));
    res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    expect(mistakeIds(res.body)).toEqual([f.concepts.frac.id]);
  });

  it("combines practice and formal evidence for one concept", async () => {
    const f = await buildFixture("combined");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "comb", 2);
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, p.practiceId, p.questionIds.map((qid) => ({ qid, correct: false })));
    const formal = await submitFormal(f, "comb", null);
    await mapAll(f, "FORMAL", formal.qids, f.concepts.frac.id, true);
    // Formal attempt submitted with no answers; answer it wrong in a second attempt.
    const started = await request(app).post(`/api/student/assessment-events/${formal.eventId}/attempts`).set(auth(f.studentToken, f.organizationId));
    created.formalAttempts.push(started.body.attempt.id);
    await request(app).put(`/api/student/assessment-attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers: [{ question_id: formal.qids[0], selected_option: "B" }] });
    await request(app).post(`/api/student/assessment-attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
    const res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    // 2 practice + 1 formal wrong = 3 responses, 3 questions, 2 attempts -> detected.
    expect(byConcept(res.body.repeated_mistakes, f.concepts.frac.id)).toMatchObject({ incorrect_responses: 3, distinct_questions: 3, distinct_attempts: 2 });
  });

  it("detects formal-only evidence", async () => {
    const f = await buildFixture("formalonly");
    const e1 = await submitFormal(f, "fo1", null);
    await mapAll(f, "FORMAL", e1.qids, f.concepts.frac.id, true);
    const e2 = await submitFormal(f, "fo2", null, 2);
    await mapAll(f, "FORMAL", e2.qids, f.concepts.frac.id, true);
    for (const [ev, q] of [[e1, e1.qids[0]], [e2, e2.qids[0]]] as const) {
      const started = await request(app).post(`/api/student/assessment-events/${ev.eventId}/attempts`).set(auth(f.studentToken, f.organizationId));
      created.formalAttempts.push(started.body.attempt.id);
      await request(app).put(`/api/student/assessment-attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers: [{ question_id: q, selected_option: "B" }] });
      await request(app).post(`/api/student/assessment-attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
    }
    // 1 (empty first submits contribute nothing) + ... only 2 wrong so far on 2 questions -> add third.
    const e3 = await submitFormal(f, "fo3", null);
    await mapAll(f, "FORMAL", e3.qids, f.concepts.frac.id, true);
    const s3 = await request(app).post(`/api/student/assessment-events/${e3.eventId}/attempts`).set(auth(f.studentToken, f.organizationId));
    created.formalAttempts.push(s3.body.attempt.id);
    await request(app).put(`/api/student/assessment-attempts/${s3.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers: [{ question_id: e3.qids[0], selected_option: "B" }] });
    await request(app).post(`/api/student/assessment-attempts/${s3.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
    const res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    // e2 has 2 questions but only first answered wrong; e1/e3 one each -> 3 wrong, 3 questions, attempts: e1x2? e1 first submit unanswered + second wrong = 2 attempts on e1... total attempts >= 2 -> detected.
    expect(mistakeIds(res.body)).toContain(f.concepts.frac.id);
    expect(byConcept(res.body.repeated_mistakes, f.concepts.frac.id)!.distinct_questions).toBe(3);
  });

  it("treats the same question UUID across scopes as different questions", async () => {
    const f = await buildFixture("scopeid");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "scopeid", 1);
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, p.practiceId, [{ qid: p.questionIds[0], correct: false }]);
    // Formal question reusing the SAME UUID.
    const yearRes = await pool.query(`INSERT INTO academic_years (code, name, start_date, end_date) VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`, [`ep105y_${Date.now().toString(36)}x`.slice(0, 32), "Epic 105 scope year"]);
    created.years.push(yearRes.rows[0].id);
    const evRes = await pool.query(`INSERT INTO assessment_events (organization_id, academic_year_id, class_id, title, scheduled_start, scheduled_end, status) VALUES ($1, $2, $3, 'Epic 105 scope', $4, $5, 'SCHEDULED') RETURNING id`, [f.organizationId, yearRes.rows[0].id, f.classId, new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString()]);
    created.events.push(evRes.rows[0].id);
    const eventId = evRes.rows[0].id as string;
    await pool.query(`INSERT INTO assessment_questions (id, organization_id, assessment_event_id, sequence_number, question_type, question_text, options, correct_option_key, marks) VALUES ($1, $2, $3, 0, 'MULTIPLE_CHOICE_SINGLE', 'FQ scope', $4, 'A', 5)`, [p.questionIds[0], f.organizationId, eventId, JSON.stringify([{ key: "A", text: "yes" }, { key: "B", text: "no" }])]);
    created.questions.push(p.questionIds[0]);
    await assignQuestionConcept(f.organizationId, "FORMAL", p.questionIds[0], f.concepts.frac.id, true);
    created.mappings.push({ scope: "FORMAL", question: p.questionIds[0], item: f.concepts.frac.id });
    const started = await request(app).post(`/api/student/assessment-events/${eventId}/attempts`).set(auth(f.studentToken, f.organizationId));
    created.formalAttempts.push(started.body.attempt.id);
    await request(app).put(`/api/student/assessment-attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers: [{ question_id: p.questionIds[0], selected_option: "B" }] });
    await request(app).post(`/api/student/assessment-attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
    const res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    // 2 wrong responses on 2 scope-distinct questions in 2 attempts: responses < 3 -> absent, but questions must read 2.
    expect(res.body).toEqual({ repeated_mistakes: [] });
    const db = await pool.query(
      `SELECT COUNT(DISTINCT (qc.question_scope, qc.question_id))::int AS c FROM question_concepts qc WHERE qc.knowledge_item_id = $1`,
      [f.concepts.frac.id]
    );
    expect(db.rows[0].c).toBe(2);
  });
});

describe("US-105 mapping integrity", () => {
  it("rejects duplicate mappings, second primaries, and non-CONCEPT items", async () => {
    const f = await buildFixture("integrity");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "integ", 1);
    await assignQuestionConcept(f.organizationId, "PRACTICE", p.questionIds[0], f.concepts.frac.id, true);
    created.mappings.push({ scope: "PRACTICE", question: p.questionIds[0], item: f.concepts.frac.id });
    await expect(assignQuestionConcept(f.organizationId, "PRACTICE", p.questionIds[0], f.concepts.frac.id, true)).rejects.toMatchObject({ code: "23505" });
    const skillRes = await pool.query(`INSERT INTO knowledge_items (kind, code, name) VALUES ('SKILL', $1, 'Epic 105 skill') RETURNING id`, [unique("ep105_skill")]);
    created.concepts.push(skillRes.rows[0].id);
    await expect(assignQuestionConcept(f.organizationId, "PRACTICE", p.questionIds[0], f.concepts.dec.id, true)).rejects.toMatchObject({ code: "23505" });
    await expect(assignQuestionConcept(f.organizationId, "PRACTICE", p.questionIds[0], skillRes.rows[0].id, false)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(assignQuestionConcept(f.organizationId, "PRACTICE", "00000000-0000-4000-8000-000000000000", f.concepts.frac.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("US-105 authorization and tenancy", () => {
  it("rejects unauthenticated reads", async () => {
    expect((await request(app).get("/api/student/repeated-mistakes")).status).toBe(401);
    expect((await request(app).get("/api/organizations/00000000-0000-4000-8000-000000000000/students/00000000-0000-4000-8000-000000000000/repeated-mistakes")).status).toBe(401);
  });

  it("restricts students to their own mistakes", async () => {
    const f = await buildFixture("ownership105");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "own", 3);
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, p.practiceId, p.questionIds.map((qid) => ({ qid, correct: false })));
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/repeated-mistakes`).set(auth(f.studentToken, f.organizationId))).status).toBe(403);
    const other = await request(app).get("/api/student/repeated-mistakes").set(auth(f.otherStudentToken, f.organizationId));
    expect(other.body).toEqual({ repeated_mistakes: [] });
  });

  it("serves assigned teachers and admins with student identity and exact contract", async () => {
    const f = await buildFixture("staff105");
    const adminId = await adminIdFor(f);
    const p1 = await mkPractice(f, adminId, "stf1", 2);
    await mapAll(f, "PRACTICE", p1.questionIds, f.concepts.frac.id, true);
    const p2 = await mkPractice(f, adminId, "stf2", 1);
    await mapAll(f, "PRACTICE", p2.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, p1.practiceId, p1.questionIds.map((qid) => ({ qid, correct: false })));
    await submitPractice(f, p2.practiceId, p2.questionIds.map((qid) => ({ qid, correct: false })));
    for (const token of [f.teacherToken, f.adminToken]) {
      const res = await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/repeated-mistakes`).set(auth(token, f.organizationId));
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(f.studentId);
      const m = byConcept(res.body.repeated_mistakes, f.concepts.frac.id)!;
      expect(m).toMatchObject({ incorrect_responses: 3, distinct_questions: 3, distinct_attempts: 2 });
      expect(Object.keys(m).sort()).toEqual(["answered_responses", "concept", "distinct_attempts", "distinct_questions", "incorrect_responses"].filter((k) => k !== "answered_responses"));
      expect(Object.keys(m.concept).sort()).toEqual(["code", "id", "name"]);
    }
  });

  it("rejects unassigned teachers and isolates tenants", async () => {
    const f = await buildFixture("unassigned105", { assignTeacher: false });
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/repeated-mistakes`).set(auth(f.teacherToken, f.organizationId))).status).toBe(403);
    const other = await buildFixture("other-org105");
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/repeated-mistakes`).set(auth(other.adminToken, other.organizationId))).status).toBe(403);
    const self = await request(app).get("/api/student/repeated-mistakes").set(auth(other.studentToken, other.organizationId));
    expect(self.body).toEqual({ repeated_mistakes: [] });
  });

  it("handles invalid identifiers, unknown students, and ordering", async () => {
    const f = await buildFixture("edge105");
    expect((await request(app).get(`/api/organizations/nope/students/${f.studentId}/repeated-mistakes`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/nope/repeated-mistakes`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/00000000-0000-4000-8000-000000000000/repeated-mistakes`).set(auth(f.adminToken, f.organizationId))).status).toBe(404);
    const adminId = await adminIdFor(f);
    // Two concepts qualifying: ordered by concept.name ascending.
    const pa = await mkPractice(f, adminId, "ord-a", 3);
    await mapAll(f, "PRACTICE", pa.questionIds, f.concepts.dec.id, true);
    await submitPractice(f, pa.practiceId, pa.questionIds.map((qid) => ({ qid, correct: false })));
    const pb = await mkPractice(f, adminId, "ord-b", 3);
    await mapAll(f, "PRACTICE", pb.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, pb.practiceId, pb.questionIds.map((qid) => ({ qid, correct: false })));
    // Single attempt each -> need a second attempt per concept for attempt diversity.
    await submitPractice(f, pa.practiceId, [{ qid: pa.questionIds[0], correct: false }]);
    await submitPractice(f, pb.practiceId, [{ qid: pb.questionIds[0], correct: false }]);
    const res = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    const names = res.body.repeated_mistakes.map((m: { concept: { name: string } }) => m.concept.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    expect(names).toHaveLength(2);
    const flat = JSON.stringify(res.body);
    for (const key of ["score", "percentage", "severity", "mastery", "recommendation", "ranking", "explanation", "selected_option", "correct_option"]) {
      expect(flat).not.toContain(`"${key}"`);
    }
  });

  it("returns deterministic repeated results", async () => {
    const f = await buildFixture("det105");
    const adminId = await adminIdFor(f);
    const p = await mkPractice(f, adminId, "det", 3);
    await mapAll(f, "PRACTICE", p.questionIds, f.concepts.frac.id, true);
    await submitPractice(f, p.practiceId, p.questionIds.map((qid) => ({ qid, correct: false })));
    const first = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    const second = await request(app).get("/api/student/repeated-mistakes").set(auth(f.studentToken, f.organizationId));
    expect(second.body).toEqual(first.body);
  });
});
