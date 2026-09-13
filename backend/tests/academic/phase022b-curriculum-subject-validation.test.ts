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
  classes: [] as string[],
  subjects: [] as string[],
  syllabi: [] as string[],
  syllabusVersions: [] as string[],
  structures: [] as string[],
  nodes: [] as string[],
};

async function cleanup() {
  if (created.nodes.length) await pool.query("DELETE FROM curriculum_nodes WHERE id = ANY($1::uuid[])", [created.nodes]);
  if (created.structures.length) await pool.query("DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])", [created.structures]);
  if (created.syllabusVersions.length) await pool.query("DELETE FROM syllabus_versions WHERE id = ANY($1::uuid[])", [created.syllabusVersions]);
  if (created.syllabi.length) await pool.query("DELETE FROM syllabi WHERE id = ANY($1::uuid[])", [created.syllabi]);
  if (created.classes.length) {
    await pool.query("DELETE FROM student_enrollments WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM class_teacher_assignments WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])", [created.classes]);
    await pool.query("DELETE FROM classes WHERE id = ANY($1::uuid[])", [created.classes]);
  }
  if (created.subjects.length) await pool.query("DELETE FROM subjects WHERE id = ANY($1::uuid[])", [created.subjects]);
  if (created.organizations.length) {
    await pool.query("DELETE FROM teachers WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
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
    [`${unique(`p022b_${label}`)}@example.com`, `Phase 022B ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 022B ${label}`, unique(`p022b_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 022B class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function assignTeacher(organizationId: string, classId: string, userId: string) {
  const teacher = await pool.query(
    `INSERT INTO teachers (user_id, organization_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [userId, organizationId]
  );
  await pool.query(
    `INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id) VALUES ($1, $2, $3)`,
    [organizationId, classId, teacher.rows[0].id]
  );
}

async function createSubject(organizationId: string, label: string) {
  const subject = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 022B subject ${label}`, unique(`p022bsub_${label}`)]
  );
  created.subjects.push(subject.rows[0].id);
  return subject.rows[0].id as string;
}

async function assignSubjectToClass(organizationId: string, classId: string, subjectId: string) {
  await pool.query(
    `INSERT INTO class_subjects (organization_id, class_id, subject_id) VALUES ($1, $2, $3)`,
    [organizationId, classId, subjectId]
  );
}

async function createSyllabusVersion(classId: string, label: string) {
  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const syllabus = await pool.query(
    `INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [classId, board.id, medium.id, `Phase 022B syllabus ${label}`, unique(`p022bs_${label}`)]
  );
  created.syllabi.push(syllabus.rows[0].id);
  const version = await pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`,
    [syllabus.rows[0].id]
  );
  created.syllabusVersions.push(version.rows[0].id);
  return version.rows[0].id as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function fixture() {
  const adminId = await createUser("admin");
  const teacherId = await createUser("teacher");
  const unassignedTeacherId = await createUser("unassigned_teacher");

  const organizationId = await createOrganization(adminId, "org");
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  await addMember(teacherId, organizationId, "TEACHER");
  await addMember(unassignedTeacherId, organizationId, "TEACHER");

  const classId = await createClass(organizationId, adminId, "1");
  await assignTeacher(organizationId, classId, teacherId);
  // unassignedTeacherId is a TEACHER in the organization but is NOT assigned to this class.

  const subjectId = await createSubject(organizationId, "math");
  await assignSubjectToClass(organizationId, classId, subjectId);

  const otherClassId = await createClass(organizationId, adminId, "2");
  const otherSubjectId = await createSubject(organizationId, "science");
  await assignSubjectToClass(organizationId, otherClassId, otherSubjectId);

  const syllabusVersionId = await createSyllabusVersion(classId, "1");

  return {
    tokens: {
      admin: createAccessToken(adminId),
      teacher: createAccessToken(teacherId),
      unassignedTeacher: createAccessToken(unassignedTeacherId),
    },
    organizationId,
    classId,
    subjectId,
    otherSubjectId,
    syllabusVersionId,
  };
}

describe("Phase 022 requirement A: subject-linked curriculum structures", () => {
  it("rejects a structure subject that is not assigned to the structure's class via class_subjects", async () => {
    const f = await fixture();
    const agent = request(app);
    const response = await agent
      .post(`/api/syllabus-versions/${f.syllabusVersionId}/structures`)
      .set(auth(f.tokens.admin))
      .send({ structure_kind: "SYLLABUS", name: "Structure with foreign subject", subject_id: f.otherSubjectId });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates a structure with a subject assigned to its class and exposes subject_id on read", async () => {
    const f = await fixture();
    const agent = request(app);
    const create = await agent
      .post(`/api/syllabus-versions/${f.syllabusVersionId}/structures`)
      .set(auth(f.tokens.admin))
      .send({ structure_kind: "SYLLABUS", name: "Structure with valid subject", subject_id: f.subjectId });
    expect(create.status).toBe(201);
    expect(create.body.structure.subject_id).toBe(f.subjectId);
    created.structures.push(create.body.structure.id);
  });

  it("blocks chapter/topic creation on a structure with no linked subject, and allows it once linked", async () => {
    const f = await fixture();
    const agent = request(app);

    const create = await agent
      .post(`/api/syllabus-versions/${f.syllabusVersionId}/structures`)
      .set(auth(f.tokens.admin))
      .send({ structure_kind: "SYLLABUS", name: "Structure without subject" });
    expect(create.status).toBe(201);
    expect(create.body.structure.subject_id).toBeNull();
    const structureId = create.body.structure.id as string;
    created.structures.push(structureId);

    const blockedChapter = await agent
      .post(`/api/curriculum/structures/${structureId}/chapters`)
      .set(auth(f.tokens.admin))
      .send({ title: "Chapter without subject" });
    expect(blockedChapter.status).toBe(400);
    expect(blockedChapter.body.error.code).toBe("VALIDATION_ERROR");
    expect(blockedChapter.body.error.message).toContain("subject");

    // Reject linking a subject that isn't assigned to this structure's class.
    const badLink = await agent
      .patch(`/api/curriculum/structures/${structureId}/subject`)
      .set(auth(f.tokens.admin))
      .send({ subject_id: f.otherSubjectId });
    expect(badLink.status).toBe(400);

    const linkSubject = await agent
      .patch(`/api/curriculum/structures/${structureId}/subject`)
      .set(auth(f.tokens.admin))
      .send({ subject_id: f.subjectId });
    expect(linkSubject.status).toBe(200);
    expect(linkSubject.body.structure.subject_id).toBe(f.subjectId);

    const allowedChapter = await agent
      .post(`/api/curriculum/structures/${structureId}/chapters`)
      .set(auth(f.tokens.admin))
      .send({ title: "Chapter with subject" });
    expect(allowedChapter.status).toBe(201);
    const chapterId = allowedChapter.body.chapter.id as string;
    created.nodes.push(chapterId);
    expect(allowedChapter.body.chapter.subject_id).toBe(f.subjectId);

    const allowedTopic = await agent
      .post(`/api/curriculum/chapters/${chapterId}/topics`)
      .set(auth(f.tokens.teacher))
      .send({ title: "Topic under subject-linked chapter" });
    expect(allowedTopic.status).toBe(201);
    created.nodes.push(allowedTopic.body.topic.id);
    expect(allowedTopic.body.topic.subject_id).toBe(f.subjectId);
  });

  it("preserves teacher class-assignment authorization: assigned teachers may manage, unassigned teachers may not", async () => {
    const f = await fixture();
    const agent = request(app);

    // A teacher assigned to the class (via class_teacher_assignments) can manage its curriculum structures.
    const asAssignedTeacher = await agent
      .post(`/api/syllabus-versions/${f.syllabusVersionId}/structures`)
      .set(auth(f.tokens.teacher))
      .send({ structure_kind: "SYLLABUS", name: "Structure by assigned teacher", subject_id: f.subjectId });
    expect(asAssignedTeacher.status).toBe(201);
    created.structures.push(asAssignedTeacher.body.structure.id);

    // A teacher in the same organization who is NOT assigned to the class must be forbidden.
    const asUnassignedTeacher = await agent
      .post(`/api/syllabus-versions/${f.syllabusVersionId}/structures`)
      .set(auth(f.tokens.unassignedTeacher))
      .send({ structure_kind: "SYLLABUS", name: "Structure by unassigned teacher", subject_id: f.subjectId });
    expect(asUnassignedTeacher.status).toBe(403);

    const chapterByAssigned = await agent
      .post(`/api/curriculum/structures/${asAssignedTeacher.body.structure.id}/chapters`)
      .set(auth(f.tokens.teacher))
      .send({ title: "Chapter by assigned teacher" });
    expect(chapterByAssigned.status).toBe(201);
    created.nodes.push(chapterByAssigned.body.chapter.id);

    const chapterByUnassigned = await agent
      .post(`/api/curriculum/structures/${asAssignedTeacher.body.structure.id}/chapters`)
      .set(auth(f.tokens.unassignedTeacher))
      .send({ title: "Should be forbidden" });
    expect(chapterByUnassigned.status).toBe(403);
  });
});
