import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";

// Backend Epic 10 Slice A (US-097/US-098/US-099): derived practice-completion
// progress. Verifies the approved PO formula (completed published practices /
// available published practices x 100) with no score influence, no migration,
// and read-only Epic 8 consumption.

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
  assignments: [] as string[],
  structures: [] as string[],
  nodes: [] as string[],
  practices: [] as string[],
  attempts: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
  curriculumVersions: [] as string[],
  datasets: [] as string[],
};

async function cleanup() {
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
  if (created.datasets.length) await pool.query("DELETE FROM curriculum_reference_datasets WHERE id = ANY($1::uuid[])", [created.datasets]);
  if (created.syllabusVersions.length) await pool.query("DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])", [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
  if (created.curriculumVersions.length) await pool.query("DELETE FROM curriculum_versions WHERE id = ANY($1::uuid[])", [created.curriculumVersions]);
  if (created.assignments.length) await pool.query("DELETE FROM class_teacher_assignments WHERE id = ANY($1::uuid[])", [created.assignments]);
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
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${unique(`ep10_${label}`)}@example.com`, `Epic 10 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id) VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Epic 10 ${label}`, unique(`ep10_org_${label}`), ownerUserId]
  );
  created.organizations.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function addMember(userId: string, organizationId: string, roleName: string) {
  const role = await pool.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [roleName]);
  await pool.query(`INSERT INTO organization_members (user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [userId, organizationId, role.rows[0].id]);
}

type Fixture = {
  organizationId: string;
  classId: string;
  adminToken: string;
  teacherToken: string;
  teacherUserId: string;
  studentToken: string;
  studentId: string;
  otherStudentToken: string;
  otherStudentId: string;
  mathsId: string;
  scienceId: string;
  chapter1Id: string;
  chapter2Id: string;
  chapter3Id: string;
  topic1Id: string;
  topic2Id: string;
  topic3Id: string;
  topic4Id: string;
  topic5Id: string;
  practices: Record<string, string>;
};

async function buildFixture(label: string, opts: { withTeacher?: boolean } = {}): Promise<Fixture> {
  const adminId = await createUser(`${label}-admin`);
  const organizationId = await createOrganization(adminId, `${label}-org`);
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  const teacherUserId = await createUser(`${label}-teacher`);
  await addMember(teacherUserId, organizationId, "TEACHER");
  const classRes = await pool.query(`INSERT INTO classes (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, `Epic 10 class ${label}`, adminId]);
  created.classes.push(classRes.rows[0].id);
  const classId = classRes.rows[0].id as string;

  const teacherRes = await pool.query(`INSERT INTO teachers (organization_id, user_id) VALUES ($1, $2) RETURNING id`, [organizationId, teacherUserId]);
  created.teachers.push(teacherRes.rows[0].id);
  if (opts.withTeacher !== false) {
    const aRes = await pool.query(`INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, classId, teacherRes.rows[0].id]);
    created.assignments.push(aRes.rows[0].id);
  }

  const mkStudent = async (suffix: string) => {
    const userId = await createUser(`${label}-${suffix}`);
    await addMember(userId, organizationId, "STUDENT");
    const sRes = await pool.query(`INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status) VALUES ($1, $2, $3, '8', 'ACTIVE') RETURNING id`, [userId, organizationId, `${label} ${suffix}`]);
    created.students.push(sRes.rows[0].id);
    const eRes = await pool.query(`INSERT INTO student_enrollments (organization_id, student_id, class_id, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, sRes.rows[0].id, classId]);
    created.enrollments.push(eRes.rows[0].id);
    return { userId, studentId: sRes.rows[0].id as string, token: createAccessToken(userId) };
  };
  const student = await mkStudent("student");
  const other = await mkStudent("other");

  const mkSubject = async (name: string) => {
    const sRes = await pool.query(`INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [organizationId, name, unique(`ep10_${name}`)]);
    created.subjects.push(sRes.rows[0].id);
    const csRes = await pool.query(`INSERT INTO class_subjects (organization_id, class_id, subject_id) VALUES ($1, $2, $3) RETURNING id`, [organizationId, classId, sRes.rows[0].id]);
    created.classSubjects.push(csRes.rows[0].id);
    return sRes.rows[0].id as string;
  };
  const mathsId = await mkSubject(`Maths ${label}`);
  const scienceId = await mkSubject(`Science ${label}`);

  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];

  const mkStructure = async (subjectId: string, tag: string) => {
    const syRes = await pool.query(`INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [classId, board.id, medium.id, `Epic 10 syllabus ${tag}`, unique(`ep10_sy_${tag}`)]);
    created.syllabi.push(syRes.rows[0].id);
    const svRes = await pool.query(`INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`, [syRes.rows[0].id]);
    created.syllabusVersions.push(svRes.rows[0].id);
    const stRes = await pool.query(`INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`, [svRes.rows[0].id, `Epic 10 structure ${tag}`, subjectId]);
    created.structures.push(stRes.rows[0].id);
    return stRes.rows[0].id as string;
  };
  const mathsStructure = await mkStructure(mathsId, `${label}-maths`);
  const scienceStructure = await mkStructure(scienceId, `${label}-science`);

  const nodeType = async (code: string) =>
    (await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = lower($1) AND status = 'ACTIVE' LIMIT 1", [code])).rows[0].id as string;
  const chapterType = await nodeType("CHAPTER");
  const topicType = await nodeType("TOPIC");

  const mkChapter = async (structureId: string, title: string) => {
    const r = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, node_type_id, title) VALUES ($1, $2, $3) RETURNING id`, [structureId, chapterType, title]);
    created.nodes.push(r.rows[0].id);
    return r.rows[0].id as string;
  };
  const mkTopic = async (structureId: string, chapterId: string, title: string) => {
    const r = await pool.query(`INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title) VALUES ($1, $2, $3, $4) RETURNING id`, [structureId, chapterId, topicType, title]);
    created.nodes.push(r.rows[0].id);
    return r.rows[0].id as string;
  };
  const chapter1Id = await mkChapter(mathsStructure, `Algebra ${label}`);
  const chapter2Id = await mkChapter(mathsStructure, `Geometry ${label}`);
  const chapter3Id = await mkChapter(scienceStructure, `Physics ${label}`);
  const topic1Id = await mkTopic(mathsStructure, chapter1Id, `Fractions ${label}`);
  const topic2Id = await mkTopic(mathsStructure, chapter1Id, `Decimals ${label}`);
  const topic3Id = await mkTopic(mathsStructure, chapter2Id, `Shapes ${label}`);
  const topic4Id = await mkTopic(scienceStructure, chapter3Id, `Motion ${label}`);
  const topic5Id = await mkTopic(mathsStructure, chapter2Id, `Angles ${label}`);

  const mkPractice = async (topicId: string, status: string, tag: string) => {
    const r = await pool.query(
      `INSERT INTO practices (organization_id, curriculum_node_id, title, practice_type, status, created_by_user_id) VALUES ($1, $2, $3, 'PRACTICE', $4, $5) RETURNING id`,
      [organizationId, topicId, `Epic 10 practice ${tag}`, status, adminId]
    );
    created.practices.push(r.rows[0].id);
    const practiceId = r.rows[0].id as string;
    await pool.query(
      `INSERT INTO practice_questions (practice_id, sequence_number, question_type, question_text, options, correct_option_key, marks) VALUES ($1, 0, 'MULTIPLE_CHOICE_SINGLE', $2, $3, 'A', 1)`,
      [practiceId, `Q ${tag}`, JSON.stringify([{ key: "A", text: "yes" }, { key: "B", text: "no" }])]
    );
    return practiceId;
  };

  const practices: Record<string, string> = {};
  practices.p1 = await mkPractice(topic1Id, "PUBLISHED", `${label}-p1`);
  practices.p2 = await mkPractice(topic1Id, "PUBLISHED", `${label}-p2`);
  practices.p3 = await mkPractice(topic2Id, "PUBLISHED", `${label}-p3`);
  practices.p4 = await mkPractice(topic2Id, "DRAFT", `${label}-p4`);
  practices.p5 = await mkPractice(topic3Id, "ARCHIVED", `${label}-p5`);
  practices.p6 = await mkPractice(topic4Id, "PUBLISHED", `${label}-p6`);
  practices.p7 = await mkPractice(topic4Id, "PUBLISHED", `${label}-p7`);
  practices.p8 = await mkPractice(topic5Id, "PUBLISHED", `${label}-p8`);
  practices.p9 = await mkPractice(topic5Id, "PUBLISHED", `${label}-p9`);
  practices.p10 = await mkPractice(topic5Id, "PUBLISHED", `${label}-p10`);

  return {
    organizationId, classId,
    adminToken: createAccessToken(adminId), teacherToken: createAccessToken(teacherUserId), teacherUserId,
    studentToken: student.token, studentId: student.studentId,
    otherStudentToken: other.token, otherStudentId: other.studentId,
    mathsId, scienceId, chapter1Id, chapter2Id, chapter3Id,
    topic1Id, topic2Id, topic3Id, topic4Id, topic5Id, practices,
  };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

// Drive a real SUBMITTED practice attempt through existing Epic 8 APIs.
async function completePractice(f: Fixture, practiceId: string, correct: boolean, expectedSubmit = 200) {
  const started = await request(app).post(`/api/student/practices/${practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.attempts.push(started.body.attempt.id);
  const questions = started.body.questions as { id: string }[];
  if (questions.length > 0) {
    const saved = await request(app).put(`/api/student/attempts/${started.body.attempt.id}/answers`).set(auth(f.studentToken, f.organizationId))
      .send({ answers: [{ question_id: questions[0].id, selected_option: correct ? "A" : "B" }] });
    expect(saved.status).toBe(200);
  }
  const submitted = await request(app).post(`/api/student/attempts/${started.body.attempt.id}/submit`).set(auth(f.studentToken, f.organizationId));
  expect(submitted.status).toBe(expectedSubmit);
  return submitted;
}

async function startOnly(f: Fixture, practiceId: string) {
  const started = await request(app).post(`/api/student/practices/${practiceId}/attempts`).set(auth(f.studentToken, f.organizationId));
  expect(started.status).toBe(201);
  created.attempts.push(started.body.attempt.id);
  return started;
}

const byId = <T extends { id: string }>(items: T[], id: string) => items.find((i) => i.id === id);

describe("US-099 topic progress", () => {
  it("derives topic progress from completed published practices", async () => {
    const f = await buildFixture("topic");
    await completePractice(f, f.practices.p1, true);
    await completePractice(f, f.practices.p2, false);
    await completePractice(f, f.practices.p8, true);
    await startOnly(f, f.practices.p6);

    const res = await request(app).get("/api/student/progress").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(200);
    const t1 = byId(res.body.topics, f.topic1Id)!;
    expect(t1).toMatchObject({ completed: 2, available: 2, percentage: 100 });
    const t2 = byId(res.body.topics, f.topic2Id)!;
    expect(t2).toMatchObject({ completed: 0, available: 1, percentage: 0 });
    const t4 = byId(res.body.topics, f.topic4Id)!;
    expect(t4).toMatchObject({ completed: 0, available: 2, percentage: 0 });
    const t5 = byId(res.body.topics, f.topic5Id)!;
    expect(t5).toMatchObject({ completed: 1, available: 3, percentage: 33.33 });
    // Topic with only an ARCHIVED practice has no available content: no-progress-data, never 0%.
    expect(byId(res.body.topics, f.topic3Id)).toMatchObject({ completed: 0, available: 0, percentage: null });
  });

  it("counts multiple submissions for one practice only once", async () => {
    const f = await buildFixture("dup");
    await completePractice(f, f.practices.p3, true);
    await completePractice(f, f.practices.p3, false);
    const res = await request(app).get("/api/student/progress").set(auth(f.studentToken, f.organizationId));
    expect(byId(res.body.topics, f.topic2Id)).toMatchObject({ completed: 1, available: 1, percentage: 100 });
  });

  it("excludes DRAFT and ARCHIVED practices from available", async () => {
    const f = await buildFixture("status");
    const res = await request(app).get("/api/student/progress").set(auth(f.studentToken, f.organizationId));
    // T2 has one PUBLISHED + one DRAFT practice; T3 has only an ARCHIVED practice.
    expect(byId(res.body.topics, f.topic2Id)).toMatchObject({ available: 1 });
    // Zero available: present as no-progress-data, never 0%.
    expect(byId(res.body.topics, f.topic3Id)).toMatchObject({ completed: 0, available: 0, percentage: null });
  });

  it("returns empty progress for a student with no completions", async () => {
    const f = await buildFixture("empty");
    const res = await request(app).get("/api/student/progress").set(auth(f.otherStudentToken, f.organizationId));
    expect(res.status).toBe(200);
    for (const topic of res.body.topics) {
      expect(topic.completed).toBe(0);
      // Available content measures 0%; nothing available measures null. Neither is fabricated.
      expect(topic.available === 0 ? topic.percentage : 0).toBe(topic.available === 0 ? null : 0);
    }
    const t1 = byId(res.body.topics, f.topic1Id)!;
    expect(t1).toMatchObject({ completed: 0, available: 2, percentage: 0 });
    expect(byId(res.body.topics, f.topic3Id)).toMatchObject({ completed: 0, available: 0, percentage: null });
  });
});

describe("US-098 chapter progress", () => {
  it("aggregates topic practices within each chapter", async () => {
    const f = await buildFixture("chapter");
    await completePractice(f, f.practices.p1, true);
    await completePractice(f, f.practices.p2, true);
    await completePractice(f, f.practices.p3, true);
    await completePractice(f, f.practices.p8, true);

    const res = await request(app).get("/api/student/progress").set(auth(f.studentToken, f.organizationId));
    const c1 = byId(res.body.chapters, f.chapter1Id)!;
    expect(c1).toMatchObject({ completed: 3, available: 3, percentage: 100 });
    const c2 = byId(res.body.chapters, f.chapter2Id)!;
    expect(c2).toMatchObject({ completed: 1, available: 3, percentage: 33.33 });
    // Chapter 3 (Science) untouched: present with 0 completed, never null.
    const c3 = byId(res.body.chapters, f.chapter3Id)!;
    expect(c3).toMatchObject({ completed: 0, available: 2, percentage: 0 });
  });
});

describe("US-097 subject progress", () => {
  it("aggregates chapters and topics within each subject separately", async () => {
    const f = await buildFixture("subject");
    await completePractice(f, f.practices.p1, true);
    await completePractice(f, f.practices.p2, true);
    await completePractice(f, f.practices.p3, true);
    await completePractice(f, f.practices.p8, true);
    await completePractice(f, f.practices.p7, true);

    const res = await request(app).get("/api/student/progress").set(auth(f.studentToken, f.organizationId));
    // Maths: P1,P2,P3 + P8,P9,P10 = 6 available, 4 completed.
    const maths = byId(res.body.subjects, f.mathsId)!;
    expect(maths).toMatchObject({ completed: 4, available: 6, percentage: 66.67 });
    // Science: P6,P7 = 2 available, 1 completed.
    const science = byId(res.body.subjects, f.scienceId)!;
    expect(science).toMatchObject({ completed: 1, available: 2, percentage: 50 });
  });

  it("does not let score or percentage affect progress", async () => {
    const f = await buildFixture("score");
    const perfect = await completePractice(f, f.practices.p1, true);
    const failed = await completePractice(f, f.practices.p2, false);
    expect(perfect.body.percentage).toBe(100);
    expect(failed.body.percentage).toBe(0);
    const res = await request(app).get("/api/student/progress").set(auth(f.studentToken, f.organizationId));
    // One 100% and one 0% practice: coverage is still 2/2.
    expect(byId(res.body.topics, f.topic1Id)).toMatchObject({ completed: 2, available: 2, percentage: 100 });
  });
});

describe("Slice A security and tenancy", () => {
  it("rejects unauthenticated progress reads", async () => {
    expect((await request(app).get("/api/student/progress")).status).toBe(401);
    expect((await request(app).get("/api/organizations/00000000-0000-4000-8000-000000000000/students/00000000-0000-4000-8000-000000000000/progress")).status).toBe(401);
  });

  it("prevents a student from reading another student's progress", async () => {
    const f = await buildFixture("ownership");
    await completePractice(f, f.practices.p1, true);
    // Other student: staff endpoint forbidden for STUDENT role, self view shows only own (empty) data.
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/progress`).set(auth(f.otherStudentToken, f.organizationId))).status).toBe(403);
    const self = await request(app).get("/api/student/progress").set(auth(f.otherStudentToken, f.organizationId));
    expect(self.status).toBe(200);
    expect(byId(self.body.topics, f.topic1Id)).toMatchObject({ completed: 0, available: 2 });
  });

  it("isolates progress by organization", async () => {
    const a = await buildFixture("tenant-a");
    const b = await buildFixture("tenant-b");
    await completePractice(a, a.practices.p1, true);
    // Cross-tenant staff read fails closed (non-member of the organization).
    expect((await request(app).get(`/api/organizations/${a.organizationId}/students/${a.studentId}/progress`).set(auth(b.adminToken, b.organizationId))).status).toBe(403);
    // Org B's own student sees none of org A's content.
    const self = await request(app).get("/api/student/progress").set(auth(b.studentToken, b.organizationId));
    expect(self.status).toBe(200);
    expect(JSON.stringify(self.body)).not.toContain(a.organizationId);
    expect(byId(self.body.topics, a.topic1Id)).toBeUndefined();
  });

  it("serves authorized staff and rejects unauthorized roles", async () => {
    const f = await buildFixture("staff");
    await completePractice(f, f.practices.p1, true);
    const admin = await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/progress`).set(auth(f.adminToken, f.organizationId));
    expect(admin.status).toBe(200);
    expect(admin.body.student.id).toBe(f.studentId);
    expect(byId(admin.body.topics, f.topic1Id)).toMatchObject({ completed: 1, available: 2, percentage: 50 });
    const teacher = await request(app).get(`/api/organizations/${f.organizationId}/students/${f.studentId}/progress`).set(auth(f.teacherToken, f.organizationId));
    expect(teacher.status).toBe(200);
    // Non-staff study: teacher without class assignment cannot read.
    const unassigned = await buildFixture("staff-unassigned", { withTeacher: false });
    const denied = await request(app).get(`/api/organizations/${unassigned.organizationId}/students/${unassigned.studentId}/progress`).set(auth(unassigned.teacherToken, unassigned.organizationId));
    expect(denied.status).toBe(403);
  });

  it("rejects invalid identifiers and unknown students", async () => {
    const f = await buildFixture("invalid");
    expect((await request(app).get(`/api/organizations/not-a-uuid/students/${f.studentId}/progress`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/not-a-uuid/progress`).set(auth(f.adminToken, f.organizationId))).status).toBe(400);
    expect((await request(app).get(`/api/organizations/${f.organizationId}/students/00000000-0000-4000-8000-000000000000/progress`).set(auth(f.adminToken, f.organizationId))).status).toBe(404);
  });

  it("returns deterministic repeated results", async () => {
    const f = await buildFixture("deterministic");
    await completePractice(f, f.practices.p1, true);
    await completePractice(f, f.practices.p7, false);
    const first = await request(app).get("/api/student/progress").set(auth(f.studentToken, f.organizationId));
    const second = await request(app).get("/api/student/progress").set(auth(f.studentToken, f.organizationId));
    expect(second.body).toEqual(first.body);
  });
});
