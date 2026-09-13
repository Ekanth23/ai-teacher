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
  teachers: [] as string[],
  students: [] as string[],
  enrollments: [] as string[],
  classes: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
  structures: [] as string[],
  nodes: [] as string[],
  practices: [] as string[],
  attempts: [] as string[],
};

async function cleanup() {
  if (created.attempts.length) await pool.query("DELETE FROM practice_attempts WHERE id = ANY($1::uuid[])", [created.attempts]);
  if (created.practices.length) await pool.query("DELETE FROM practices WHERE id = ANY($1::uuid[])", [created.practices]);
  if (created.enrollments.length) await pool.query("DELETE FROM student_enrollments WHERE id = ANY($1::uuid[])", [created.enrollments]);
  if (created.nodes.length) await pool.query("DELETE FROM curriculum_nodes WHERE id = ANY($1::uuid[])", [created.nodes]);
  if (created.structures.length) await pool.query("DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])", [created.structures]);
  if (created.syllabusVersions.length) await pool.query("DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])", [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
  if (created.classes.length) {
    await pool.query("DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  }
  if (created.students.length) await pool.query("DELETE FROM students_v2 WHERE id = ANY($1::uuid[])", [created.students]);
  if (created.teachers.length) {
    await pool.query("DELETE FROM class_teacher_assignments WHERE teacher_id = ANY($1::uuid[])", [created.teachers]);
    await pool.query("DELETE FROM teachers WHERE id = ANY($1::uuid[])", [created.teachers]);
  }
  if (created.organizations.length) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
    await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [created.organizations]);
  }
  if (created.users.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
  Object.values(created).forEach((ids) => { ids.length = 0; });
}

afterEach(cleanup);

async function createUser(label: string) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${unique(`p085_${label}`)}@example.com`, `Phase 085 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 085 ${label}`, unique(`p085_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 085 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
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

async function createOrgScopedStructure(organizationId: string, classId: string, label: string) {
  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const syllabus = await pool.query(
    `INSERT INTO syllabi (class_id, board_id, medium_id, name, code)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [classId, board.id, medium.id, `Phase 085 syllabus ${label}`, unique(`p085s_${label}`)]
  );
  created.syllabi.push(syllabus.rows[0].id);
  const version = await pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`,
    [syllabus.rows[0].id]
  );
  created.syllabusVersions.push(version.rows[0].id);
  const structure = await pool.query(
    `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name)
     VALUES ($1, 'SYLLABUS', $2) RETURNING id`,
    [version.rows[0].id, `Phase 085 structure ${label}`]
  );
  created.structures.push(structure.rows[0].id);
  return structure.rows[0].id as string;
}

async function createChapterNode(structureId: string, title: string) {
  const type = await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'chapter' LIMIT 1");
  const node = await pool.query(
    `INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title)
     VALUES ($1, NULL, $2, $3) RETURNING id`,
    [structureId, type.rows[0].id, title]
  );
  created.nodes.push(node.rows[0].id);
  return node.rows[0].id as string;
}

async function createTopicNode(structureId: string, chapterId: string, title: string) {
  const type = await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' LIMIT 1");
  const node = await pool.query(
    `INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [structureId, chapterId, type.rows[0].id, title]
  );
  created.nodes.push(node.rows[0].id);
  return node.rows[0].id as string;
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

type QuestionSpec = { text: string; options: { key: string; text: string }[]; correct: string; marks?: number; explanation?: string | null };

const QUESTIONS: QuestionSpec[] = [
  { text: "5 x 5 = ?", options: [{ key: "A", text: "10" }, { key: "B", text: "20" }, { key: "C", text: "25" }, { key: "D", text: "30" }], correct: "C", marks: 1, explanation: "Five times five is twenty-five." },
  { text: "2 + 2 = ?", options: [{ key: "A", text: "3" }, { key: "B", text: "4" }, { key: "C", text: "5" }], correct: "B", marks: 1 },
  { text: "10 - 3 = ?", options: [{ key: "A", text: "7" }, { key: "B", text: "6" }, { key: "C", text: "13" }], correct: "A", marks: 2 },
];

async function seedPractice(organizationId: string, topicId: string, createdByUserId: string, status: string, specs: QuestionSpec[]) {
  const p = await pool.query(
    `INSERT INTO practices (organization_id, curriculum_node_id, title, practice_type, status, created_by_user_id)
     VALUES ($1, $2, 'Mixed fractions', 'PRACTICE', $3, $4) RETURNING *`,
    [organizationId, topicId, status, createdByUserId]
  );
  created.practices.push(p.rows[0].id);
  const questions = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const q = await pool.query(
      `INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks, explanation)
       VALUES ($1, $2, 'MULTIPLE_CHOICE_SINGLE', $3, $4, $5, $6, $7) RETURNING *`,
      [p.rows[0].id, i, spec.text, JSON.stringify(spec.options), spec.correct, spec.marks ?? 1, spec.explanation ?? null]
    );
    questions.push(q.rows[0]);
  }
  return { practiceId: p.rows[0].id, questions };
}

async function adminFixture(label: string) {
  const adminId = await createUser(`${label}-admin`);
  const organizationId = await createOrganization(adminId, `${label}-org`);
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  const classId = await createClass(organizationId, adminId, label);
  const structureId = await createOrgScopedStructure(organizationId, classId, label);
  const chapterId = await createChapterNode(structureId, `${label} chapter`);
  const topicId = await createTopicNode(structureId, chapterId, `${label} topic`);
  return { organizationId, classId, structureId, chapterId, topicId, adminId, adminToken: createAccessToken(adminId) };
}

async function studentFixture(label: string) {
  const base = await adminFixture(label);
  const studentUserId = await createUser(`${label}-student`);
  await addMember(studentUserId, base.organizationId, "STUDENT");
  const studentId = await createStudent(base.organizationId, studentUserId, `${label} Student`);
  await enrollStudent(base.organizationId, studentId, base.classId);
  return { ...base, studentUserId, studentId, studentToken: createAccessToken(studentUserId) };
}

async function startAttempt(f: { studentToken: string; organizationId: string }, practiceId: string) {
  const res = await request(app).post(`/api/student/practices/${practiceId}/attempts`)
    .set(auth(f.studentToken, f.organizationId));
  expect(res.status).toBe(201);
  created.attempts.push(res.body.attempt.id);
  return { attemptId: res.body.attempt.id as string, questions: res.body.questions as { id: string }[] };
}

// Starts, answers (Q0 correct, Q1 incorrect, Q2 unanswered) and submits, one fixture.
async function submittedAttempt(f: { studentToken: string; organizationId: string; topicId: string; adminId: string }) {
  const { practiceId, questions } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);
  const { attemptId } = await startAttempt(f, practiceId);
  await request(app).put(`/api/student/attempts/${attemptId}/answers`)
    .set(auth(f.studentToken, f.organizationId))
    .send({ answers: [
      { question_id: questions[0].id, selected_option: "C" },
      { question_id: questions[1].id, selected_option: "A" },
    ] });
  const submit = await request(app).post(`/api/student/attempts/${attemptId}/submit`)
    .set(auth(f.studentToken, f.organizationId));
  expect(submit.status).toBe(200);
  return { practiceId, attemptId, questions, result: submit.body };
}

describe("US-085 single result", () => {
  it("rejects unauthenticated single-result request", async () => {
    expect((await request(app).get("/api/student/attempts/00000000-0000-4000-8000-000000000000/result")).status).toBe(401);
  });

  it("returns a submitted result with the full summary and practice info", async () => {
    const f = await studentFixture("single");
    const { attemptId } = await submittedAttempt(f);

    const res = await request(app).get(`/api/student/attempts/${attemptId}/result`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(attemptId);
    expect(res.body.status).toBe("SUBMITTED");
    expect(res.body.score).toBe(1);
    expect(res.body.max_score).toBe(4);
    expect(res.body.percentage).toBe(25);
    expect(res.body.correct_count).toBe(1);
    expect(res.body.incorrect_count).toBe(1);
    expect(res.body.unanswered_count).toBe(1);
    expect(res.body.submitted_at).toBeTruthy();
    expect(res.body.practice.title).toBe("Mixed fractions");
    expect(res.body.practice.practice_type).toBe("PRACTICE");
  });

  it("returns per-question review after submission", async () => {
    const f = await studentFixture("review");
    const { attemptId, questions } = await submittedAttempt(f);

    const res = await request(app).get(`/api/student/attempts/${attemptId}/result`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBe(3);

    const q0 = res.body.questions[0];
    expect(q0.question_id).toBe(questions[0].id);
    expect(q0.selected_option).toBe("C");
    expect(q0.correct_option).toBe("C");
    expect(q0.is_correct).toBe(true);
    expect(q0.awarded_marks).toBe(1);
    expect(q0.marks).toBe(1);
    expect(q0.explanation).toBe("Five times five is twenty-five.");

    const q1 = res.body.questions[1];
    expect(q1.selected_option).toBe("A");
    expect(q1.correct_option).toBe("B");
    expect(q1.is_correct).toBe(false);
    expect(q1.awarded_marks).toBe(0);

    const q2 = res.body.questions[2];
    expect(q2.selected_option).toBeNull();
    expect(q2.is_correct).toBe(false);
    expect(q2.awarded_marks).toBe(0);
  });

  it("does not return an IN_PROGRESS attempt as a result", async () => {
    const f = await studentFixture("in-progress");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);
    const { attemptId } = await startAttempt(f, practiceId);

    const res = await request(app).get(`/api/student/attempts/${attemptId}/result`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a missing attempt", async () => {
    const f = await studentFixture("missing");
    const res = await request(app).get("/api/student/attempts/00000000-0000-4000-8000-000000000000/result")
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(404);
  });

  it("cannot retrieve another student's result (IDOR)", async () => {
    const f = await studentFixture("idor");
    const { attemptId } = await submittedAttempt(f);

    const otherUser = await createUser("other");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudentId = await createStudent(f.organizationId, otherUser, "Other");
    await enrollStudent(f.organizationId, otherStudentId, f.classId);

    const res = await request(app).get(`/api/student/attempts/${attemptId}/result`)
      .set(auth(createAccessToken(otherUser), f.organizationId));
    expect(res.status).toBe(404);
  });

  it("cannot retrieve a cross-tenant result", async () => {
    const a = await studentFixture("a");
    const b = await studentFixture("b");
    const { attemptId } = await submittedAttempt(a);

    const res = await request(app).get(`/api/student/attempts/${attemptId}/result`)
      .set(auth(b.studentToken, b.organizationId));
    expect(res.status).toBe(404);
  });
});

describe("US-085 result history", () => {
  it("rejects unauthenticated history request", async () => {
    expect((await request(app).get("/api/student/results")).status).toBe(401);
  });

  it("returns multiple submitted results newest-first and excludes IN_PROGRESS", async () => {
    const f = await studentFixture("history");
    const first = await submittedAttempt(f);
    await new Promise((r) => setTimeout(r, 15));
    const second = await submittedAttempt(f);

    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);
    const inProgress = await startAttempt(f, practiceId);

    const res = await request(app).get("/api/student/results").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: { id: string }) => r.id);
    expect(ids).toContain(first.attemptId);
    expect(ids).toContain(second.attemptId);
    expect(ids).not.toContain(inProgress.attemptId);
    expect(ids[0]).toBe(second.attemptId);
    expect(ids[1]).toBe(first.attemptId);
    expect(res.body.total).toBe(2);
  });

  it("returns an empty history with no fabricated results", async () => {
    const f = await studentFixture("empty");
    const res = await request(app).get("/api/student/results").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("returns only the authenticated student's results (client student_id ignored)", async () => {
    const f = await studentFixture("identity");
    const { attemptId } = await submittedAttempt(f);

    const otherUser = await createUser("identity-b");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudentId = await createStudent(f.organizationId, otherUser, "B");
    await enrollStudent(f.organizationId, otherStudentId, f.classId);
    const otherSubmitted = await submittedAttempt({ ...f, studentToken: createAccessToken(otherUser) });

    const res = await request(app).get(`/api/student/results?student_id=${otherStudentId}`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: { id: string }) => r.id);
    expect(ids).toContain(attemptId);
    expect(ids).not.toContain(otherSubmitted.attemptId);
  });
});

describe("US-085 immutability, lifecycle and non-leakage", () => {
  it("viewing a result does not mutate the attempt or its answers", async () => {
    const f = await studentFixture("immutability");
    const { attemptId } = await submittedAttempt(f);

    const before = await pool.query(
      "SELECT score, max_score, percentage, correct_count, incorrect_count, unanswered_count, status FROM practice_attempts WHERE id = $1",
      [attemptId]
    );
    const beforeAnswers = await pool.query("SELECT count(*)::int AS c FROM practice_attempt_answers WHERE attempt_id = $1", [attemptId]);

    const res = await request(app).get(`/api/student/attempts/${attemptId}/result`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);

    const after = await pool.query(
      "SELECT score, max_score, percentage, correct_count, incorrect_count, unanswered_count, status FROM practice_attempts WHERE id = $1",
      [attemptId]
    );
    const afterAnswers = await pool.query("SELECT count(*)::int AS c FROM practice_attempt_answers WHERE attempt_id = $1", [attemptId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(afterAnswers.rows[0].c).toBe(beforeAnswers.rows[0].c);
  });

  it("keeps a historical result viewable after the practice is archived", async () => {
    const f = await studentFixture("archived-view");
    const { practiceId, attemptId } = await submittedAttempt(f);
    await pool.query("UPDATE practices SET status = 'ARCHIVED' WHERE id = $1", [practiceId]);

    const res = await request(app).get(`/api/student/attempts/${attemptId}/result`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUBMITTED");
  });

  it("start attempt still does not leak correct answers or explanation", async () => {
    const f = await studentFixture("non-leak");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);
    const res = await request(app).post(`/api/student/practices/${practiceId}/attempts`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(201);
    created.attempts.push(res.body.attempt.id);
    for (const q of res.body.questions) {
      expect(q).not.toHaveProperty("correct_option_key");
      expect(q).not.toHaveProperty("explanation");
    }
  });
});




