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
    [`${unique(`p085d_${label}`)}@example.com`, `Phase 085d ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 085d ${label}`, unique(`p085d_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 085d class ${label}`, ownerUserId]
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
    [classId, board.id, medium.id, `Phase 085d syllabus ${label}`, unique(`p085ds_${label}`)]
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
    [version.rows[0].id, `Phase 085d structure ${label}`]
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
     VALUES ($1, $2, 'Mixed fractions', 'PRACTICE', $3, $4) RETURNING id`,
    [organizationId, topicId, status, createdByUserId]
  );
  created.practices.push(p.rows[0].id);
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    await pool.query(
      `INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks, explanation)
       VALUES ($1, $2, 'MULTIPLE_CHOICE_SINGLE', $3, $4, $5, $6, $7)`,
      [p.rows[0].id, i, spec.text, JSON.stringify(spec.options), spec.correct, spec.marks ?? 1, spec.explanation ?? null]
    );
  }
  return { practiceId: p.rows[0].id as string };
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

describe("student practice discovery (GET /api/student/practices)", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/student/practices")).status).toBe(401);
  });

  it("rejects a non-student role", async () => {
    const f = await adminFixture("disc-admin");
    const res = await request(app).get("/api/student/practices").set(auth(f.adminToken, f.organizationId));
    expect(res.status).toBe(403);
  });

  it("lists published practices for an enrolled student", async () => {
    const f = await studentFixture("disc-pub");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);

    const res = await request(app).get("/api/student/practices").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.practices[0].id).toBe(practiceId);
    expect(res.body.practices[0].title).toBe("Mixed fractions");
    expect(res.body.practices[0].practice_type).toBe("PRACTICE");
    expect(res.body.practices[0].topic.id).toBe(f.topicId);
    expect(res.body.practices[0].topic.name).toBeTruthy();
  });

  it("excludes DRAFT and ARCHIVED practices", async () => {
    const f = await studentFixture("disc-hidden");
    await seedPractice(f.organizationId, f.topicId, f.adminId, "DRAFT", QUESTIONS);
    await seedPractice(f.organizationId, f.topicId, f.adminId, "ARCHIVED", QUESTIONS);

    const res = await request(app).get("/api/student/practices").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.practices).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("returns an empty list when no practices are available", async () => {
    const f = await studentFixture("disc-empty");
    const res = await request(app).get("/api/student/practices").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.practices).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("excludes cross-tenant practices", async () => {
    const a = await studentFixture("disc-a");
    const b = await studentFixture("disc-b");
    await seedPractice(b.organizationId, b.topicId, b.adminId, "PUBLISHED", QUESTIONS);

    const res = await request(app).get("/api/student/practices").set(auth(a.studentToken, a.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.practices).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("enforces active enrollment (unenrolled student sees nothing)", async () => {
    const f = await studentFixture("disc-unenrolled");
    await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);

    const unenrolledUser = await createUser("disc-unenrolled-student");
    await addMember(unenrolledUser, f.organizationId, "STUDENT");
    await createStudent(f.organizationId, unenrolledUser, "Unenrolled");

    const res = await request(app).get("/api/student/practices").set(auth(createAccessToken(unenrolledUser), f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.practices).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("ignores client-supplied student_id (identity override)", async () => {
    const f = await studentFixture("disc-identity");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);

    const otherUser = await createUser("disc-identity-other");
    await addMember(otherUser, f.organizationId, "STUDENT");
    const otherStudentId = await createStudent(f.organizationId, otherUser, "Other");
    await enrollStudent(f.organizationId, otherStudentId, f.classId);

    const res = await request(app).get(`/api/student/practices?student_id=${otherStudentId}`)
      .set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.practices[0].id).toBe(practiceId);
  });

  it("does not leak correct answers or result fields", async () => {
    const f = await studentFixture("disc-no-leak");
    await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);

    const res = await request(app).get("/api/student/practices").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    for (const p of res.body.practices) {
      expect(p).not.toHaveProperty("correct_option_key");
      expect(p).not.toHaveProperty("explanation");
      expect(p).not.toHaveProperty("score");
      expect(p).not.toHaveProperty("percentage");
      expect(p).not.toHaveProperty("created_by_user_id");
    }
  });
});

describe("student practice detail (GET /api/student/practices/:practiceId)", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/student/practices/00000000-0000-4000-8000-000000000000")).status).toBe(401);
  });

  it("rejects a non-student role", async () => {
    const f = await adminFixture("det-admin");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);
    const res = await request(app).get(`/api/student/practices/${practiceId}`).set(auth(f.adminToken, f.organizationId));
    expect(res.status).toBe(403);
  });

  it("returns a published practice with safe metadata and questions", async () => {
    const f = await studentFixture("det-pub");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);

    const res = await request(app).get(`/api/student/practices/${practiceId}`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.practice.id).toBe(practiceId);
    expect(res.body.practice.title).toBe("Mixed fractions");
    expect(res.body.practice.practice_type).toBe("PRACTICE");
    expect(res.body.practice.topic.id).toBe(f.topicId);
    expect(res.body.practice.question_count).toBe(3);
    expect(res.body.practice.questions.length).toBe(3);
  });

  it("does not expose correct answers, explanation, or result fields", async () => {
    const f = await studentFixture("det-no-leak");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);

    const res = await request(app).get(`/api/student/practices/${practiceId}`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(res.body.practice).not.toHaveProperty("correct_option_key");
    expect(res.body.practice).not.toHaveProperty("score");
    expect(res.body.practice).not.toHaveProperty("percentage");
    for (const q of res.body.practice.questions) {
      expect(q).not.toHaveProperty("correct_option_key");
      expect(q).not.toHaveProperty("explanation");
    }
  });

  it("returns 404 for a DRAFT practice", async () => {
    const f = await studentFixture("det-draft");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "DRAFT", QUESTIONS);
    const res = await request(app).get(`/api/student/practices/${practiceId}`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(404);
  });

  it("returns 404 for an ARCHIVED practice", async () => {
    const f = await studentFixture("det-archived");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "ARCHIVED", QUESTIONS);
    const res = await request(app).get(`/api/student/practices/${practiceId}`).set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a cross-tenant practice", async () => {
    const a = await studentFixture("det-a");
    const b = await studentFixture("det-b");
    const { practiceId } = await seedPractice(b.organizationId, b.topicId, b.adminId, "PUBLISHED", QUESTIONS);
    const res = await request(app).get(`/api/student/practices/${practiceId}`).set(auth(a.studentToken, a.organizationId));
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unenrolled student", async () => {
    const f = await studentFixture("det-unenrolled");
    const { practiceId } = await seedPractice(f.organizationId, f.topicId, f.adminId, "PUBLISHED", QUESTIONS);

    const unenrolledUser = await createUser("det-unenrolled-student");
    await addMember(unenrolledUser, f.organizationId, "STUDENT");
    await createStudent(f.organizationId, unenrolledUser, "Unenrolled");

    const res = await request(app).get(`/api/student/practices/${practiceId}`).set(auth(createAccessToken(unenrolledUser), f.organizationId));
    expect(res.status).toBe(404);
  });
});




