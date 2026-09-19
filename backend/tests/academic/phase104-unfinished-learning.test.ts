import request from "supertest";
import { describe, expect, it, afterEach } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

// US-104: unfinished learning (Decision #18). Topic-level PUBLISHED practice
// coverage: COMPLETED iff completed === available, UNFINISHED iff
// completed < available, null when available === 0. No performance input.

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
  resources: [] as string[],
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
  if (created.resources.length) await pool.query("DELETE FROM learning_resources WHERE id = ANY($1::uuid[])", [created.resources]);
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
  const r = await pool.query(`INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`, [`${unique(`ep104_${label}`)}@example.com`, `Epic 104 ${label}`]);
  created.users.push(r.rows[0].id);
  return r.rows[0].id as string;
}

type Fixture = {
  organizationId: string;
  classId: string;
  adminId: string;
  adminToken: string;
  teacherToken: string;
  studentToken: string;
  studentId: string;
  otherStudentToken: string;
  topics: Record<string, string>;
  practices: Record<string, string>;
};

async function buildFixture(label: string, opts: { assignTeacher?: boolean } = {}): Promise<Fixture> {
  const adminId = await createUser(`${label}-admin`);
  const orgRes = await pool.query(`INSERT INTO organizations (name, slug, type, status, created_by_user_id) VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`, [`Epic 104 ${label}`, unique(`ep104_org_${label}`), adminId]);
  created.organizations.push(orgRes.rows[0].id);
  const organizationId = orgRes.rows[0].id as string;
  const addMember = async (userId: string, role: string) => {
    const roleRes = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [role]);
    await pool.query(`INSERT INTO organization_members (user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [userId, organizationId, roleRes.rows[0].id]);
  };
  await addMember(adminId, "SCHOOL_ADMIN");
  const teacherUserId = await createUser(`${label}-teacher`);
  await addMember(teacherUserId, "TEACHER");
  const classRes = await pool.query(`INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, `Epic 104 class ${label}`, adminId]);
  created.classes.push(classRes.rows[0].id);
  const classId = classRes.rows[0].id as string;
  const teacherRes = await pool.query(`INSERT INTO teachers (organization_id, user_id) VALUES ($1, $2) RETURNING id`, [organizationId, teacherUserId]);
  created.teachers.push(teacherRes.rows[0].id);
  if (opts.assignTeacher !== false) {
    await pool.query(`INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id) VALUES ($1, $2, $3)`, [organizationId, classId, teacherRes.rows[0].id]);
  }
  const subjectRes = await pool.query(`INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, `Epic 104 Subject ${label}`, unique(`ep104_s_${label}`)]);
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
  const syRes = await pool.query(`INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [classId, board.id, medium.id, `Epic 104 syllabus ${label}`, unique(`ep104_sy_${label}`)]);
  created.syllabi.push(syRes.rows[0].id);
  const svRes = await pool.query(`INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`, [syRes.rows[0].id]);
  created.syllabusVersions.push(svRes.rows[0].id);
  const stRes = await pool.query(`INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`, [svRes.rows[0].id, `Epic 104 structure ${label}`, subjectRes.rows[0].id]);
  created.structures.push(stRes.rows[0].id);
  const structureId = stRes.rows[0].id as string;
  const chapterType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'chapter' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const topicType = (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' AND status = 'ACTIVE' LIMIT 1")).rows[0].id;
  const chRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, node_type_id, title) VALUES ($1, $2, $3) RETURNING id`, [structureId, chapterType, `Chapter ${label}`]);
  created.nodes.push(chRes.rows[0].id);
  const topics: Record<string, string> = {};
  for (const tag of ["main", "mixed", "bare"]) {
    const tRes = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title) VALUES ($1, $2, $3, $4) RETURNING id`, [structureId, chRes.rows[0].id, topicType, `${tag} ${label}`]);
    created.nodes.push(tRes.rows[0].id);
    topics[tag] = tRes.rows[0].id as string;
  }

  const mkPractice = async (topicId: string, status: string, tag: string) => {
    const pRes = await pool.query(`INSERT INTO practices (organization_id, curriculum_node_id, title, practice_type, status, created_by_user_id) VALUES ($1, $2, $3, 'PRACTICE', $4, $5) RETURNING id`, [organizationId, topicId, `Epic 104 practice ${tag}`, status, adminId]);
    created.practices.push(pRes.rows[0].id);
    const practiceId = pRes.rows[0].id as string;
    await pool.query(`INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks) VALUES ($1, 0, 'MULTIPLE_CHOICE_SINGLE', $2, $3, 'A', 1)`, [practiceId, `Q ${tag}`, JSON.stringify([{ key: "A", text: "yes" }, { key: "B", text: "no" }])]);
    return practiceId;
  };
  const practices: Record<string, string> = {};
  practices.m1 = await mkPractice(topics.main, "PUBLISHED", `${label}-m1`);
  practices.m2 = await mkPractice(topics.main, "PUBLISHED", `${label}-m2`);
  practices.m3 = await mkPractice(topics.main, "PUBLISHED", `${label}-m3`);
  practices.x1 = await mkPractice(topics.mixed, "PUBLISHED", `${label}-x1`);
  practices.xDraft = await mkPractice(topics.mixed, "DRAFT", `${label}-xd`);
  practices.xArchived = await mkPractice(topics.mixed, "ARCHIVED", `${label}-xa`);

  return { organizationId, classId, adminId, adminToken: createAccessToken(adminId), teacherToken: createAccessToken(teacherUserId), studentToken: student.token, studentId: student.studentId, otherStudentToken: other.token, topics, practices };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

async function submitPractice(f: Fixture, practiceId: string) {
  const started = await request(app).post(`/api/student/practices/${practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.attempts.push(started.body.attempt.id);
  const q = (started.body.questions as { id: string }[])[0];
  const saved = await request(app).put(`/api/student/attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId)).send({ answers: [{ question_id: q.id, selected_option: "A" }] });
  expect(saved.status).toBe(200);
  const submitted = await request(app).post(`/api/student/attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(200);
}

async function startOnly(f: Fixture, practiceId: string) {
  const started = await request(app).post(`/api/student/practices/${practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.attempts.push(started.body.attempt.id);
}

const byId = <T extends { id: string }>(items: T[], id: string) => items.find((i) => i.id === id);

describe("US-104 completion boundaries", () => {
  it.each([
    ["0/3", 0],
    ["1/3", 1],
    ["2/3", 2],
  ])("%s completed stays UNFINISHED", async (_label, count) => {
    const f = await buildFixture(`b${count}`);
    const ids = [f.practices.m1, f.practices.m2, f.practices.m3];
    for (let i = 0; i < count; i++) await submitPractice(f, ids[i]);
    const res = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    expect(byId(res.body.topics, f.topics.main)).toMatchObject({ completed: count, available: 3, status: "UNFINISHED" });
  });

  it("3/3 completed becomes COMPLETED", async () => {
    const f = await buildFixture("full");
    await submitPractice(f, f.practices.m1);
    await submitPractice(f, f.practices.m2);
    await submitPractice(f, f.practices.m3);
    const res = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.topics, f.topics.main)).toMatchObject({ completed: 3, available: 3, status: "COMPLETED" });
  });

  it("IN_PROGRESS-only practice remains unfinished", async () => {
    const f = await buildFixture("open");
    await startOnly(f, f.practices.m1);
    const res = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.topics, f.topics.main)).toMatchObject({ completed: 0, available: 3, status: "UNFINISHED" });
  });

  it("multiple submitted attempts for one practice count once", async () => {
    const f = await buildFixture("dup");
    await submitPractice(f, f.practices.m1);
    await submitPractice(f, f.practices.m1);
    const res = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.topics, f.topics.main)).toMatchObject({ completed: 1, available: 3, status: "UNFINISHED" });
  });
});

describe("US-104 content and isolation", () => {
  it("excludes DRAFT and ARCHIVED practices from available", async () => {
    const f = await buildFixture("states");
    const res = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.topics, f.topics.mixed)).toMatchObject({ completed: 0, available: 1, status: "UNFINISHED" });
  });

  it("represents zero-available topics with null status, never UNFINISHED", async () => {
    const f = await buildFixture("zero");
    const res = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.topics, f.topics.bare)).toMatchObject({ completed: 0, available: 0, status: null });
  });

  it("keeps topics isolated and response contract exact", async () => {
    const f = await buildFixture("iso");
    await submitPractice(f, f.practices.m1);
    await submitPractice(f, f.practices.x1);
    const res = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.topics, f.topics.main)).toMatchObject({ completed: 1, available: 3, status: "UNFINISHED" });
    expect(byId(res.body.topics, f.topics.mixed)).toMatchObject({ completed: 1, available: 1, status: "COMPLETED" });
    const titles = res.body.topics.map((t: { title: string }) => t.title);
    expect(titles).toEqual([...titles].sort((a: string, b: string) => a.localeCompare(b)));
    for (const t of res.body.topics) {
      expect(Object.keys(t).sort()).toEqual(["available", "chapter_id", "completed", "id", "status", "title"]);
      expect(["COMPLETED", "UNFINISHED", null]).toContain(t.status);
    }
  });

  it("ignores formal assessment submissions", async () => {
    const f = await buildFixture("formal104");
    const before = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    const yearRes = await pool.query(`INSERT INTO academic_years (code, name, start_date, end_date) VALUES ($1, $2, '2026-04-01', '2027-03-31') RETURNING id`, [`ep104y_${Date.now().toString(36)}`.slice(0, 32), "Epic 104 formal year"]);
    created.years.push(yearRes.rows[0].id);
    const evRes = await pool.query(`INSERT INTO assessment_events (organization_id, academic_year_id, class_id, title, scheduled_start, scheduled_end, status) VALUES ($1, $2, $3, 'Epic 104 formal', $4, $5, 'DRAFT') RETURNING id`, [f.organizationId, yearRes.rows[0].id, f.classId, new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString()]);
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
    const after = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(after.body).toEqual(before.body);
  });

  it("ignores learning resources", async () => {
    const f = await buildFixture("resource");
    const before = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    const r = await pool.query(`INSERT INTO learning_resources (organization_id, curriculum_node_id, class_id, resource_type, title, file_url, status, created_by_user_id) VALUES ($1, $2, $3, 'WORKSHEET', 'Epic 104 worksheet', 'https://example.test/w.pdf', 'PUBLISHED', $4) RETURNING id`, [f.organizationId, f.topics.main, f.classId, f.adminId]);
    created.resources.push(r.rows[0].id);
    const after = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(after.body).toEqual(before.body);
  });
});

describe("US-104 authorization and tenancy", () => {
  it("rejects unauthenticated reads", async () => {
    expect((await request(app).get("/api/student/unfinished-learning")).status).toBe(401);
    expect((await request(app).get("/api/organizations/00000000-0000-4000-8000-000000000000/students/00000000-0000-4000-8000-000000000000/unfinished-learning")).status).toBe(401);
  });

  it("restricts students to their own coverage", async () => {
    const f = await buildFixture("ownership104");
    await submitPractice(f, f.practices.m1);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/unfinished-learning`).set(auth(f.studentToken, f.organizationId))).status).toBe(403);
    const other = await request(app).get("/api/student/unfinished-learning").set(auth(f.otherStudentToken, f.organizationId));
    expect(byId(other.body.topics, f.topics.main)).toMatchObject({ completed: 0, available: 3, status: "UNFINISHED" });
  });

  it("serves assigned teachers and admins with student identity", async () => {
    const f = await buildFixture("staff104");
    await submitPractice(f, f.practices.m1);
    for (const token of [f.teacherToken, f.adminToken]) {
      const res = await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/unfinished-learning`).set(auth(token, f.organizationId));
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(f.studentId);
      expect(byId(res.body.topics, f.topics.main)).toMatchObject({ completed: 1, available: 3, status: "UNFINISHED" });
    }
  });

  it("rejects unassigned teachers and isolates tenants", async () => {
    const f = await buildFixture("unassigned104", { assignTeacher: false });
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/unfinished-learning`).set(auth(f.teacherToken, f.organizationId))).status).toBe(403);
    const other = await buildFixture("other-org104");
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/unfinished-learning`).set(auth(other.adminToken, other.organizationId))).status).toBe(403);
    const self = await request(app).get("/api/student/unfinished-learning").set(auth(other.studentToken, other.organizationId));
    expect(JSON.stringify(self.body)).not.toContain(f.organizationId);
    expect(byId(self.body.topics, f.topics.main)).toBeUndefined();
  });

  it("handles invalid identifiers and unknown students", async () => {
    const f = await buildFixture("edge104");
    expect((await request(app).get(`/api/organizations/nope/students/${f.studentId}/unfinished-learning`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/nope/unfinished-learning`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/00000000-0000-4000-8000-000000000000/unfinished-learning`).set(auth(f.adminToken, f.organizationId))).status).toBe(404);
  });

  it("returns no topics when the organization has no curriculum topics", async () => {
    const f = await buildFixture("notopics");
    const topicIds = [f.topics.main, f.topics.mixed, f.topics.bare];
    await pool.query("DELETE FROM practice_attempt_answers WHERE attempt_id IN (SELECT id FROM practice_attempts WHERE student_id = $1)", [f.studentId]);
    await pool.query("DELETE FROM practice_attempts WHERE student_id = $1", [f.studentId]);
    created.attempts = [];
    await pool.query("DELETE FROM practice_questions WHERE practice_id IN (SELECT id FROM practices WHERE organization_id = $1)", [f.organizationId]);
    await pool.query("DELETE FROM practices WHERE organization_id = $1", [f.organizationId]);
    created.practices = [];
    await pool.query("DELETE FROM curriculum_nodes WHERE id = ANY($1::uuid[])", [topicIds]);
    created.nodes = created.nodes.filter((id) => !topicIds.includes(id));
    const empty = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(empty.body).toEqual({ topics: [] });
  });

  it("returns deterministic repeated results", async () => {
    const f = await buildFixture("det104");
    await submitPractice(f, f.practices.m1);
    const first = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    const second = await request(app).get("/api/student/unfinished-learning").set(auth(f.studentToken, f.organizationId));
    expect(second.body).toEqual(first.body);
  });
});
