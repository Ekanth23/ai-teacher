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
    [`${unique(`p041_${label}`)}@example.com`, `Phase 041 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 041 ${label}`, unique(`p041_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 041 class ${label}`, ownerUserId]
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
    [classId, board.id, medium.id, `Phase 041 syllabus ${label}`, unique(`p041s_${label}`)]
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
    [version.rows[0].id, `Phase 041 structure ${label}`]
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

type QuestionSpec = { text: string; options: { key: string; text: string }[]; correct: string; marks?: number };

const QUESTIONS: QuestionSpec[] = [
  { text: "5 x 5 = ?", options: [{ key: "A", text: "10" }, { key: "B", text: "20" }, { key: "C", text: "25" }, { key: "D", text: "30" }], correct: "C", marks: 1 },
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
      `INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks)
       VALUES ($1, $2, 'MULTIPLE_CHOICE_SINGLE', $3, $4, $5, $6) RETURNING *`,
      [p.rows[0].id, i, spec.text, JSON.stringify(spec.options), spec.correct, spec.marks ?? 1]
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

async function publishedPractice(fixture: { organizationId: string; topicId: string; adminId: string }) {
  return seedPractice(fixture.organizationId, fixture.topicId, fixture.adminId, "PUBLISHED", QUESTIONS);
}

describe("start attempt - auth and access", () => {
  it("rejects unauthenticated start", async () => {
    expect((await request(app).post("/api/student/practices/00000000-0000-4000-8000-000000000000/attempts")).status).toBe(401);
  });

  it("rejects a non-student role", async () => {
    const f = await adminFixture("admin-start");
    const published = await publishedPractice(f);
    const res = await request(app).post(`/api/student/practices/${published.practiceId}/attempts`)
      .set(auth(f.adminToken, f.organizationId));
    expect(res.status).toBe(403);
  });

  it("starts an attempt for a published practice", async () => {
    const f = await studentFixture("start");
    const published = await publishedPractice(f);
    const res = await request(app).post(`/api/student/practices/${published.practiceId}/attempts`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(201);
    expect(res.body.attempt.status).toBe("IN_PROGRESS");
    expect(res.body.attempt.practice_id).toBe(published.practiceId);
    expect(res.body.questions.length).toBe(QUESTIONS.length);
    created.attempts.push(res.body.attempt.id);
  });

  it("cannot start a DRAFT practice", async () => {
    const f = await studentFixture("draft");
    const seeded = await seedPractice(f.organizationId, f.topicId, f.adminId, "DRAFT", QUESTIONS);
    const res = await request(app).post(`/api/student/practices/${seeded.practiceId}/attempts`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("cannot start an ARCHIVED practice", async () => {
    const f = await studentFixture("archived");
    const seeded = await seedPractice(f.organizationId, f.topicId, f.adminId, "ARCHIVED", QUESTIONS);
    const res = await request(app).post(`/api/student/practices/${seeded.practiceId}/attempts`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("rejects an unenrolled student", async () => {
    const f = await adminFixture("unenrolled");
    const published = await publishedPractice(f);
    const studentUser = await createUser("unenrolled-student");
    await addMember(studentUser, f.organizationId, "STUDENT");
    await createStudent(f.organizationId, studentUser, "Unenrolled Student");
    const res = await request(app).post(`/api/student/practices/${published.practiceId}/attempts`)
      .set(auth(createAccessToken(studentUser), f.organizationId));
    expect(res.status).toBe(403);
  });

  it("rejects a cross-tenant practice", async () => {
    const a = await studentFixture("a");
    const b = await studentFixture("b");
    const published = await publishedPractice(a);
    const res = await request(app).post(`/api/student/practices/${published.practiceId}/attempts`)
      .set(auth(b.studentToken, b.organizationId));
    expect(res.status).toBe(403);
  });
});

describe("start attempt - correct-answer non-leakage", () => {
  it("never returns correct_option_key or explanation", async () => {
    const f = await studentFixture("no-leak");
    const published = await publishedPractice(f);
    const res = await request(app).post(`/api/student/practices/${published.practiceId}/attempts`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(201);
    created.attempts.push(res.body.attempt.id);

    for (const q of res.body.questions) {
      expect(q).not.toHaveProperty("correct_option_key");
      expect(q).not.toHaveProperty("explanation");
      expect(q.question_text).toBeTruthy();
      expect(Array.isArray(q.options)).toBe(true);
    }
  });
});

describe("attempt identity", () => {
  it("ignores client-supplied student_id and binds to the authenticated student", async () => {
    const f = await studentFixture("identity");
    const published = await publishedPractice(f);

    const otherUser = await createUser("other-student");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudentId = await createStudent(f.organizationId, otherUser, "Other Student");
    await enrollStudent(f.organizationId, otherStudentId, f.classId);

    const res = await request(app).post(`/api/student/practices/${published.practiceId}/attempts`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ student_id: otherStudentId });
    expect(res.status).toBe(201);
    created.attempts.push(res.body.attempt.id);

    const db = await pool.query("SELECT student_id FROM practice_attempts WHERE id = $1", [res.body.attempt.id]);
    expect(db.rows[0].student_id).toBe(f.studentId);
  });
});

async function startAttempt(f: { studentToken: string; organizationId: string }, practiceId: string) {
  const res = await request(app).post(`/api/student/practices/${practiceId}/attempts`)
    .set(auth(f.studentToken, f.organizationId));
  expect(res.status).toBe(201);
  created.attempts.push(res.body.attempt.id);
  return { attemptId: res.body.attempt.id as string, questions: res.body.questions as { id: string }[] };
}

describe("save answers", () => {
  it("rejects unauthenticated save", async () => {
    const res = await request(app).put("/api/student/attempts/00000000-0000-4000-8000-000000000000/answers").send({ answers: [] });
    expect(res.status).toBe(401);
  });

  it("saves and updates answers while IN_PROGRESS", async () => {
    const f = await studentFixture("save");
    const { practiceId, questions } = await publishedPractice(f);
    const { attemptId } = await startAttempt(f, practiceId);

    const first = await request(app).put(`/api/student/attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: questions[0].id, selected_option: "C" }] });
    expect(first.status).toBe(200);
    expect(first.body.answers[0].selected_option).toBe("C");

    const second = await request(app).put(`/api/student/attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: questions[0].id, selected_option: "B" }] });
    expect(second.status).toBe(200);

    const db = await pool.query("SELECT selected_option FROM practice_attempt_answers WHERE attempt_id = $1 AND question_id = $2", [attemptId, questions[0].id]);
    expect(db.rows[0].selected_option).toBe("B");
  });

  it("rejects an invalid option", async () => {
    const f = await studentFixture("bad-option");
    const { practiceId, questions } = await publishedPractice(f);
    const { attemptId } = await startAttempt(f, practiceId);

    const res = await request(app).put(`/api/student/attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: questions[0].id, selected_option: "Z" }] });
    expect(res.status).toBe(400);
  });

  it("rejects a question from another practice", async () => {
    const f = await studentFixture("foreign-question");
    const published = await publishedPractice(f);
    const other = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);
    const { attemptId } = await startAttempt(f, published.practiceId);

    const res = await request(app).put(`/api/student/attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: other.questions[0].id, selected_option: "C" }] });
    expect(res.status).toBe(400);
  });

  it("rejects answering a submitted attempt", async () => {
    const f = await studentFixture("submitted-save");
    const { practiceId, questions } = await publishedPractice(f);
    const { attemptId } = await startAttempt(f, practiceId);
    await request(app).post(`/api/student/attempts/${attemptId}/submit`).set(auth(f.studentToken, f.organizationId));

    const res = await request(app).put(`/api/student/attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: questions[0].id, selected_option: "C" }] });
    expect(res.status).toBe(400);
  });

  it("rejects a cross-student answer save (IDOR)", async () => {
    const f = await studentFixture("cross-student");
    const { practiceId } = await publishedPractice(f);
    const { attemptId } = await startAttempt(f, practiceId);

    const otherUser = await createUser("intruder");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudentId = await createStudent(f.organizationId, otherUser, "Intruder");
    await enrollStudent(f.organizationId, otherStudentId, f.classId);

    const res = await request(app).put(`/api/student/attempts/${attemptId}/answers`)
      .set(auth(createAccessToken(otherUser), f.organizationId))
      .send({ answers: [] });
    expect(res.status).toBe(404);
  });

  it("rejects a cross-tenant answer save", async () => {
    const a = await studentFixture("tenant-a");
    const b = await studentFixture("tenant-b");
    const { practiceId } = await publishedPractice(a);
    const { attemptId } = await startAttempt(a, practiceId);

    const res = await request(app).put(`/api/student/attempts/${attemptId}/answers`)
      .set(auth(b.studentToken, b.organizationId))
      .send({ answers: [] });
    expect(res.status).toBe(404);
  });
});

describe("submit attempt", () => {
  it("rejects unauthenticated submit", async () => {
    const res = await request(app).post("/api/student/attempts/00000000-0000-4000-8000-000000000000/submit");
    expect(res.status).toBe(401);
  });

  it("evaluates deterministically with correct/incorrect/unanswered", async () => {
    const f = await studentFixture("submit-mixed");
    const { practiceId, questions } = await publishedPractice(f);
    const { attemptId } = await startAttempt(f, practiceId);

    // Q0 correct, Q1 incorrect, Q2 unanswered
    await request(app).put(`/api/student/attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [
        { question_id: questions[0].id, selected_option: "C" },
        { question_id: questions[1].id, selected_option: "A" },
      ] });

    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUBMITTED");
    expect(res.body.score).toBe(1);
    expect(res.body.max_score).toBe(4);
    expect(res.body.percentage).toBe(25);
    expect(res.body.correct_count).toBe(1);
    expect(res.body.incorrect_count).toBe(1);
    expect(res.body.unanswered_count).toBe(1);

    const db = await pool.query("SELECT status, score, max_score, percentage, correct_count, incorrect_count, unanswered_count, submitted_at FROM practice_attempts WHERE id = $1", [attemptId]);
    expect(db.rows[0].status).toBe("SUBMITTED");
    expect(Number(db.rows[0].score)).toBe(1);
    expect(db.rows[0].submitted_at).not.toBeNull();
  });

  it("awards full marks for all-correct answers", async () => {
    const f = await studentFixture("submit-perfect");
    const { practiceId, questions } = await publishedPractice(f);
    const { attemptId } = await startAttempt(f, practiceId);

    await request(app).put(`/api/student/attempts/${attemptId}/answers`)
      .set(auth(f.studentToken, f.organizationId))
      .send({ answers: [
        { question_id: questions[0].id, selected_option: "C" },
        { question_id: questions[1].id, selected_option: "B" },
        { question_id: questions[2].id, selected_option: "A" },
      ] });

    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(4);
    expect(res.body.max_score).toBe(4);
    expect(res.body.percentage).toBe(100);
    expect(res.body.correct_count).toBe(3);
    expect(res.body.incorrect_count).toBe(0);
    expect(res.body.unanswered_count).toBe(0);
  });

  it("handles zero max-score (no questions) as percentage 0", async () => {
    const f = await studentFixture("submit-zero");
    const seeded = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", []);
    const { attemptId } = await startAttempt(f, seeded.practiceId);

    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(0);
    expect(res.body.max_score).toBe(0);
    expect(res.body.percentage).toBe(0);
    expect(res.body.unanswered_count).toBe(0);
  });

  it("rejects a second submission", async () => {
    const f = await studentFixture("submit-twice");
    const { practiceId } = await publishedPractice(f);
    const { attemptId } = await startAttempt(f, practiceId);

    await request(app).post(`/api/student/attempts/${attemptId}/submit`).set(auth(f.studentToken, f.organizationId));
    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(400);
  });

  it("rejects submitting another student's attempt (IDOR)", async () => {
    const f = await studentFixture("submit-idor");
    const { practiceId } = await publishedPractice(f);
    const { attemptId } = await startAttempt(f, practiceId);

    const otherUser = await createUser("submit-intruder");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudentId = await createStudent(f.organizationId, otherUser, "Submit Intruder");
    await enrollStudent(f.organizationId, otherStudentId, f.classId);

    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`)
      .set(auth(createAccessToken(otherUser), f.organizationId));
    expect(res.status).toBe(404);
  });

  it("rejects submitting a cross-tenant attempt", async () => {
    const a = await studentFixture("submit-tenant-a");
    const b = await studentFixture("submit-tenant-b");
    const { practiceId } = await publishedPractice(a);
    const { attemptId } = await startAttempt(a, practiceId);

    const res = await request(app).post(`/api/student/attempts/${attemptId}/submit`)
      .set(auth(b.studentToken, b.organizationId));
    expect(res.status).toBe(404);
  });
});





