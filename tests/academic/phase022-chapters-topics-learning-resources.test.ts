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
  learningResources: [] as string[],
};

async function cleanup() {
  if (created.learningResources.length) await pool.query("DELETE FROM learning_resources WHERE id = ANY($1::uuid[])", [created.learningResources]);
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
    await pool.query("DELETE FROM students_v2 WHERE organization_id = ANY($1::uuid[])", [created.organizations]);
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
    [`${unique(`p022_${label}`)}@example.com`, `Phase 022 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 022 ${label}`, unique(`p022_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 022 class ${label}`, ownerUserId]
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

async function enrollStudent(organizationId: string, classId: string, userId: string) {
  const student = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, status) VALUES ($1, $2, 'Student', 'ACTIVE') RETURNING id`,
    [userId, organizationId]
  );
  await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status) VALUES ($1, $2, $3, 'ACTIVE')`,
    [organizationId, student.rows[0].id, classId]
  );
}

async function createSubjectForClass(organizationId: string, classId: string, label: string) {
  const subject = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, `Phase 022 subject ${label}`, unique(`p022subj_${label}`)]
  );
  created.subjects.push(subject.rows[0].id);
  await pool.query(
    `INSERT INTO class_subjects (organization_id, class_id, subject_id) VALUES ($1, $2, $3)`,
    [organizationId, classId, subject.rows[0].id]
  );
  return subject.rows[0].id as string;
}

async function createOrgScopedStructure(organizationId: string, classId: string, label: string, subjectId: string | null = null) {
  const board = (await pool.query("SELECT id FROM boards WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE status = 'ACTIVE' ORDER BY id LIMIT 1")).rows[0];
  const syllabus = await pool.query(
    `INSERT INTO syllabi (class_id, board_id, medium_id, name, code) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [classId, board.id, medium.id, `Phase 022 syllabus ${label}`, unique(`p022s_${label}`)]
  );
  created.syllabi.push(syllabus.rows[0].id);
  const version = await pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`,
    [syllabus.rows[0].id]
  );
  created.syllabusVersions.push(version.rows[0].id);
  const structure = await pool.query(
    `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`,
    [version.rows[0].id, `Phase 022 structure ${label}`, subjectId]
  );
  created.structures.push(structure.rows[0].id);
  return structure.rows[0].id as string;
}

async function fixture() {
  const adminId = await createUser("admin");
  const teacherId = await createUser("teacher");
  const studentId = await createUser("student");
  const outsiderId = await createUser("outsider");

  const organizationId = await createOrganization(adminId, "org1");
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  await addMember(teacherId, organizationId, "TEACHER");
  await addMember(studentId, organizationId, "STUDENT");

  const otherOrgOwnerId = await createUser("other_admin");
  const otherOrganizationId = await createOrganization(otherOrgOwnerId, "org2");
  await addMember(otherOrgOwnerId, otherOrganizationId, "SCHOOL_ADMIN");
  await addMember(outsiderId, otherOrganizationId, "SCHOOL_ADMIN");

  const classId = await createClass(organizationId, adminId, "1");
  await assignTeacher(organizationId, classId, teacherId);
  await enrollStudent(organizationId, classId, studentId);

  const subjectId = await createSubjectForClass(organizationId, classId, "1");
  const structureId = await createOrgScopedStructure(organizationId, classId, "1", subjectId);

  return {
    tokens: {
      admin: createAccessToken(adminId),
      teacher: createAccessToken(teacherId),
      student: createAccessToken(studentId),
      outsider: createAccessToken(outsiderId),
    },
    organizationId,
    otherOrganizationId,
    classId,
    subjectId,
    structureId,
  };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("Phase 022 chapter/topic and learning-resource APIs", () => {
  it("requires authentication for chapter and learning-resource endpoints", async () => {
    const chapters = await request(app).get("/api/curriculum/structures/00000000-0000-4000-8000-000000000000/chapters");
    expect(chapters.status).toBe(401);
    const resources = await request(app).get("/api/organizations/00000000-0000-4000-8000-000000000000/learning-resources");
    expect(resources.status).toBe(401);
  });

  it("manages chapters and topics backed by curriculum_nodes/curriculum_node_types", async () => {
    const f = await fixture();
    const agent = request(app);

    const createChapter = await agent
      .post(`/api/curriculum/structures/${f.structureId}/chapters`)
      .set(auth(f.tokens.admin))
      .send({ title: "Chapter 1: Motion", sequence_number: 1 });
    expect(createChapter.status).toBe(201);
    expect(createChapter.body.chapter.title).toBe("Chapter 1: Motion");
    const chapterId = createChapter.body.chapter.id as string;
    created.nodes.push(chapterId);

    const forbiddenCreate = await agent
      .post(`/api/curriculum/structures/${f.structureId}/chapters`)
      .set(auth(f.tokens.student))
      .send({ title: "Should fail" });
    expect(forbiddenCreate.status).toBe(403);

    const listChapters = await agent.get(`/api/curriculum/structures/${f.structureId}/chapters`).set(auth(f.tokens.student));
    expect(listChapters.status).toBe(200);
    expect(listChapters.body.chapters).toHaveLength(1);

    const getChapter = await agent.get(`/api/curriculum/chapters/${chapterId}`).set(auth(f.tokens.student));
    expect(getChapter.status).toBe(200);
    expect(getChapter.body.chapter.node_type_code).toBe("CHAPTER");

    const updateChapter = await agent
      .patch(`/api/curriculum/chapters/${chapterId}`)
      .set(auth(f.tokens.admin))
      .send({ title: "Chapter 1: Motion (Revised)" });
    expect(updateChapter.status).toBe(200);
    expect(updateChapter.body.chapter.title).toBe("Chapter 1: Motion (Revised)");

    const createTopic = await agent
      .post(`/api/curriculum/chapters/${chapterId}/topics`)
      .set(auth(f.tokens.teacher))
      .send({ title: "Topic 1.1: Speed and Velocity", sequence_number: 1 });
    expect(createTopic.status).toBe(201);
    expect(createTopic.body.topic.parent_node_id).toBe(chapterId);
    const topicId = createTopic.body.topic.id as string;
    created.nodes.push(topicId);

    const listTopics = await agent.get(`/api/curriculum/chapters/${chapterId}/topics`).set(auth(f.tokens.admin));
    expect(listTopics.status).toBe(200);
    expect(listTopics.body.topics).toHaveLength(1);

    const getTopic = await agent.get(`/api/curriculum/topics/${topicId}`).set(auth(f.tokens.teacher));
    expect(getTopic.status).toBe(200);
    expect(getTopic.body.topic.node_type_code).toBe("TOPIC");

    const updateTopic = await agent
      .patch(`/api/curriculum/topics/${topicId}`)
      .set(auth(f.tokens.teacher))
      .send({ description: "Covers scalar and vector quantities." });
    expect(updateTopic.status).toBe(200);
    expect(updateTopic.body.topic.description).toBe("Covers scalar and vector quantities.");

    // Tenant isolation: an outsider from another organization cannot read or manage these nodes.
    const outsiderGet = await agent.get(`/api/curriculum/chapters/${chapterId}`).set(auth(f.tokens.outsider));
    expect(outsiderGet.status).toBe(403);
    const outsiderCreateTopic = await agent
      .post(`/api/curriculum/chapters/${chapterId}/topics`)
      .set(auth(f.tokens.outsider))
      .send({ title: "Should fail" });
    expect(outsiderCreateTopic.status).toBe(403);
  });

  it("rejects invalid chapter/topic input", async () => {
    const f = await fixture();
    const agent = request(app);
    const blankTitle = await agent
      .post(`/api/curriculum/structures/${f.structureId}/chapters`)
      .set(auth(f.tokens.admin))
      .send({ title: "   " });
    expect(blankTitle.status).toBe(400);
    expect(blankTitle.body.error.code).toBe("VALIDATION_ERROR");

    const badStructure = await agent
      .get(`/api/curriculum/structures/not-a-uuid/chapters`)
      .set(auth(f.tokens.admin));
    expect(badStructure.status).toBe(400);
  });

  it("creates, publishes, and archives organization-owned learning resources with tenant isolation", async () => {
    const f = await fixture();
    const agent = request(app);

    const chapter = await agent
      .post(`/api/curriculum/structures/${f.structureId}/chapters`)
      .set(auth(f.tokens.admin))
      .send({ title: "Chapter for resources" });
    const chapterId = chapter.body.chapter.id as string;
    created.nodes.push(chapterId);

    const createOrgResource = await agent
      .post(`/api/organizations/${f.organizationId}/learning-resources`)
      .set(auth(f.tokens.teacher))
      .send({
        curriculum_node_id: chapterId,
        resource_type: "TEACHER_NOTES",
        title: "Motion notes",
        file_url: "https://cdn.example.com/motion-notes.pdf",
        visibility: "ORGANIZATION",
      });
    expect(createOrgResource.status).toBe(201);
    expect(createOrgResource.body.learningResource.status).toBe("DRAFT");
    const orgResourceId = createOrgResource.body.learningResource.id as string;
    created.learningResources.push(orgResourceId);

    const createClassResource = await agent
      .post(`/api/organizations/${f.organizationId}/learning-resources`)
      .set(auth(f.tokens.teacher))
      .send({
        resource_type: "WORKSHEET",
        title: "Class worksheet",
        file_url: "https://cdn.example.com/worksheet.pdf",
        visibility: "CLASS",
        class_id: f.classId,
      });
    expect(createClassResource.status).toBe(201);
    const classResourceId = createClassResource.body.learningResource.id as string;
    created.learningResources.push(classResourceId);

    // Students cannot see draft resources.
    const studentListDraft = await agent
      .get(`/api/organizations/${f.organizationId}/learning-resources`)
      .set(auth(f.tokens.student));
    expect(studentListDraft.status).toBe(200);
    expect(studentListDraft.body.learningResources).toHaveLength(0);

    const studentDirectGet = await agent.get(`/api/learning-resources/${orgResourceId}`).set(auth(f.tokens.student));
    expect(studentDirectGet.status).toBe(403);

    // Teachers may create but not approve/publish.
    const teacherPublishAttempt = await agent
      .post(`/api/learning-resources/${orgResourceId}/publish`)
      .set(auth(f.tokens.teacher));
    expect(teacherPublishAttempt.status).toBe(403);

    const publishOrgResource = await agent
      .post(`/api/learning-resources/${orgResourceId}/publish`)
      .set(auth(f.tokens.admin));
    expect(publishOrgResource.status).toBe(200);
    expect(publishOrgResource.body.learningResource.status).toBe("PUBLISHED");

    const publishClassResource = await agent
      .post(`/api/learning-resources/${classResourceId}/publish`)
      .set(auth(f.tokens.admin));
    expect(publishClassResource.status).toBe(200);

    // Students now see the ORGANIZATION and CLASS visible resources since they are enrolled in the class.
    const studentListPublished = await agent
      .get(`/api/organizations/${f.organizationId}/learning-resources`)
      .set(auth(f.tokens.student));
    expect(studentListPublished.status).toBe(200);
    expect(studentListPublished.body.learningResources).toHaveLength(2);

    const studentDirectGetPublished = await agent.get(`/api/learning-resources/${orgResourceId}`).set(auth(f.tokens.student));
    expect(studentDirectGetPublished.status).toBe(200);

    // Archive lifecycle.
    const archiveResource = await agent
      .post(`/api/learning-resources/${orgResourceId}/archive`)
      .set(auth(f.tokens.admin));
    expect(archiveResource.status).toBe(200);
    expect(archiveResource.body.learningResource.status).toBe("ARCHIVED");

    const editArchived = await agent
      .patch(`/api/learning-resources/${orgResourceId}`)
      .set(auth(f.tokens.admin))
      .send({ title: "Should fail" });
    expect(editArchived.status).toBe(400);
    expect(editArchived.body.error.code).toBe("VALIDATION_ERROR");

    // Cross-tenant isolation.
    const outsiderList = await agent
      .get(`/api/organizations/${f.organizationId}/learning-resources`)
      .set(auth(f.tokens.outsider));
    expect(outsiderList.status).toBe(403);

    const outsiderGetResource = await agent.get(`/api/learning-resources/${classResourceId}`).set(auth(f.tokens.outsider));
    expect(outsiderGetResource.status).toBe(403);

    const outsiderCreate = await agent
      .post(`/api/organizations/${f.organizationId}/learning-resources`)
      .set(auth(f.tokens.outsider))
      .send({ resource_type: "OTHER", title: "Should fail", file_url: "https://cdn.example.com/x.pdf" });
    expect(outsiderCreate.status).toBe(403);

    // Curriculum node from an unrelated organization cannot be linked.
    const crossOrgLink = await agent
      .post(`/api/organizations/${f.otherOrganizationId}/learning-resources`)
      .set(auth(f.tokens.outsider))
      .send({
        curriculum_node_id: chapterId,
        resource_type: "OTHER",
        title: "Should fail",
        file_url: "https://cdn.example.com/x.pdf",
      });
    expect(crossOrgLink.status).toBe(400);
    expect(crossOrgLink.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates learning resource input", async () => {
    const f = await fixture();
    const agent = request(app);
    const missingTitle = await agent
      .post(`/api/organizations/${f.organizationId}/learning-resources`)
      .set(auth(f.tokens.admin))
      .send({ resource_type: "OTHER", file_url: "https://cdn.example.com/x.pdf" });
    expect(missingTitle.status).toBe(400);

    const invalidType = await agent
      .post(`/api/organizations/${f.organizationId}/learning-resources`)
      .set(auth(f.tokens.admin))
      .send({ resource_type: "NOT_A_TYPE", title: "Bad type", file_url: "https://cdn.example.com/x.pdf" });
    expect(invalidType.status).toBe(400);

    const classVisibilityWithoutClass = await agent
      .post(`/api/organizations/${f.organizationId}/learning-resources`)
      .set(auth(f.tokens.admin))
      .send({ resource_type: "OTHER", title: "Needs class", file_url: "https://cdn.example.com/x.pdf", visibility: "CLASS" });
    expect(classVisibilityWithoutClass.status).toBe(400);
  });
});
