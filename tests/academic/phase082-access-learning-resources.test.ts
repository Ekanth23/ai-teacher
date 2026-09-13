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
    [`${unique(`p082_${label}`)}@example.com`, `Phase 082 ${label}`]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerUserId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [`Phase 082 ${label}`, unique(`p082_org_${label}`), ownerUserId]
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
    [organizationId, `Phase 082 class ${label}`, ownerUserId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
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
    [organizationId, `Phase 082 subject ${label}`, unique(`p082subj_${label}`)]
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
    [classId, board.id, medium.id, `Phase 082 syllabus ${label}`, unique(`p082s_${label}`)]
  );
  created.syllabi.push(syllabus.rows[0].id);
  const version = await pool.query(
    `INSERT INTO syllabus_versions (syllabus_id, version, status) VALUES ($1, '1', 'ACTIVE') RETURNING id`,
    [syllabus.rows[0].id]
  );
  created.syllabusVersions.push(version.rows[0].id);
  const structure = await pool.query(
    `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id) VALUES ($1, 'SYLLABUS', $2, $3) RETURNING id`,
    [version.rows[0].id, `Phase 082 structure ${label}`, subjectId]
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

async function createTopicNode(chapterId: string, title: string) {
  const type = await pool.query("SELECT id FROM curriculum_node_types WHERE lower(code) = 'topic' LIMIT 1");
  const chapter = await pool.query("SELECT curriculum_structure_id FROM curriculum_nodes WHERE id = $1", [chapterId]);
  const node = await pool.query(
    `INSERT INTO curriculum_nodes (curriculum_structure_id, parent_node_id, node_type_id, title)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [chapter.rows[0].curriculum_structure_id, chapterId, type.rows[0].id, title]
  );
  created.nodes.push(node.rows[0].id);
  return node.rows[0].id as string;
}

async function createLearningResource(
  organizationId: string,
  createdByUserId: string,
  opts: { title?: string; status?: string; visibility?: string; curriculumNodeId?: string | null; classId?: string | null } = {}
) {
  const result = await pool.query(
    `INSERT INTO learning_resources (organization_id, created_by_user_id, curriculum_node_id, class_id, resource_type, title, file_url, status, visibility)
     VALUES ($1, $2, $3, $4, 'WORKSHEET', $5, 'https://example.com/x.pdf', $6, $7) RETURNING id`,
    [organizationId, createdByUserId, opts.curriculumNodeId ?? null, opts.classId ?? null, opts.title ?? unique("resource"), opts.status ?? "DRAFT", opts.visibility ?? "ORGANIZATION"]
  );
  created.learningResources.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function fixture() {
  const adminId = await createUser("admin");
  const studentId = await createUser("student");
  const organizationId = await createOrganization(adminId, "org");
  await addMember(adminId, organizationId, "SCHOOL_ADMIN");
  await addMember(studentId, organizationId, "STUDENT");

  const classId = await createClass(organizationId, adminId, "a");
  await enrollStudent(organizationId, classId, studentId);

  const subjectId = await createSubjectForClass(organizationId, classId, "math");
  const structureId = await createOrgScopedStructure(organizationId, classId, "a", subjectId);
  const chapterId = await createChapterNode(structureId, "Chapter 1: Number Systems");
  const topicId = await createTopicNode(chapterId, "Topic 1.1: Integers");

  return {
    organizationId,
    adminId,
    classId,
    subjectId,
    structureId,
    chapterId,
    topicId,
    studentToken: createAccessToken(studentId),
  };
}

function auth(token: string, organizationId: string) {
  return { Authorization: `Bearer ${token}`, "x-organization-id": organizationId };
}

function listResources(token: string, organizationId: string, query: Record<string, string> = {}) {
  return request(app).get(`/api/organizations/${organizationId}/learning-resources`).set(auth(token, organizationId)).query(query);
}

function getResource(token: string, organizationId: string, resourceId: string) {
  return request(app).get(`/api/learning-resources/${resourceId}`).set(auth(token, organizationId));
}

function getDashboard(token: string, organizationId: string) {
  return request(app).get("/api/student/dashboard").set(auth(token, organizationId));
}

describe("US-082 access approved learning resources", () => {
  it("lets a student discover a published resource for an authorized topic", async () => {
    const f = await fixture();
    await createLearningResource(f.organizationId, f.adminId, {
      curriculumNodeId: f.topicId, status: "PUBLISHED", visibility: "ORGANIZATION", title: "Topic Worksheet",
    });

    const res = await listResources(f.studentToken, f.organizationId, { curriculum_node_id: f.topicId });
    expect(res.status).toBe(200);
    expect(res.body.learningResources.map((r: { title: string }) => r.title)).toContain("Topic Worksheet");
  });

  it("excludes draft resources from students", async () => {
    const f = await fixture();
    const draftId = await createLearningResource(f.organizationId, f.adminId, {
      curriculumNodeId: f.topicId, status: "DRAFT", visibility: "ORGANIZATION", title: "Draft Worksheet",
    });

    const list = await listResources(f.studentToken, f.organizationId, { curriculum_node_id: f.topicId });
    expect(list.status).toBe(200);
    expect(list.body.learningResources.map((r: { title: string }) => r.title)).not.toContain("Draft Worksheet");

    const get = await getResource(f.studentToken, f.organizationId, draftId);
    expect(get.status).toBe(403);
  });

  it("excludes pending-approval resources from students", async () => {
    const f = await fixture();
    const pendingId = await createLearningResource(f.organizationId, f.adminId, {
      curriculumNodeId: f.topicId, status: "PENDING_APPROVAL", visibility: "ORGANIZATION", title: "Pending Worksheet",
    });

    const list = await listResources(f.studentToken, f.organizationId, { curriculum_node_id: f.topicId });
    expect(list.body.learningResources.map((r: { title: string }) => r.title)).not.toContain("Pending Worksheet");

    const get = await getResource(f.studentToken, f.organizationId, pendingId);
    expect(get.status).toBe(403);
  });

  it("excludes archived resources from students", async () => {
    const f = await fixture();
    const archivedId = await createLearningResource(f.organizationId, f.adminId, {
      curriculumNodeId: f.topicId, status: "ARCHIVED", visibility: "ORGANIZATION", title: "Archived Worksheet",
    });

    const list = await listResources(f.studentToken, f.organizationId, { curriculum_node_id: f.topicId });
    expect(list.body.learningResources.map((r: { title: string }) => r.title)).not.toContain("Archived Worksheet");

    const get = await getResource(f.studentToken, f.organizationId, archivedId);
    expect(get.status).toBe(403);
  });

  it("does not expose another user's private resource to a student", async () => {
    const f = await fixture();
    const privateId = await createLearningResource(f.organizationId, f.adminId, {
      curriculumNodeId: f.topicId, status: "PUBLISHED", visibility: "PRIVATE", title: "Private Worksheet",
    });

    const list = await listResources(f.studentToken, f.organizationId, { curriculum_node_id: f.topicId });
    expect(list.body.learningResources.map((r: { title: string }) => r.title)).not.toContain("Private Worksheet");

    const get = await getResource(f.studentToken, f.organizationId, privateId);
    expect(get.status).toBe(403);
  });

  it("lets an enrolled student access a class-visible resource", async () => {
    const f = await fixture();
    const classResourceId = await createLearningResource(f.organizationId, f.adminId, {
      classId: f.classId, status: "PUBLISHED", visibility: "CLASS", title: "Class Worksheet",
    });

    const list = await listResources(f.studentToken, f.organizationId);
    expect(list.status).toBe(200);
    expect(list.body.learningResources.map((r: { title: string }) => r.title)).toContain("Class Worksheet");

    const get = await getResource(f.studentToken, f.organizationId, classResourceId);
    expect(get.status).toBe(200);
  });

  it("lets a student access a published organization-visible resource", async () => {
    const f = await fixture();
    const orgResourceId = await createLearningResource(f.organizationId, f.adminId, {
      status: "PUBLISHED", visibility: "ORGANIZATION", title: "Org Worksheet",
    });

    const list = await listResources(f.studentToken, f.organizationId);
    expect(list.body.learningResources.map((r: { title: string }) => r.title)).toContain("Org Worksheet");

    const get = await getResource(f.studentToken, f.organizationId, orgResourceId);
    expect(get.status).toBe(200);
  });

  it("isolates resources belonging to another class", async () => {
    const f = await fixture();

    const class2Id = await createClass(f.organizationId, f.adminId, "b");
    const class2ResourceId = await createLearningResource(f.organizationId, f.adminId, {
      classId: class2Id, status: "PUBLISHED", visibility: "CLASS", title: "Other class worksheet",
    });

    const list = await listResources(f.studentToken, f.organizationId);
    expect(list.body.learningResources.map((r: { title: string }) => r.title)).not.toContain("Other class worksheet");

    const get = await getResource(f.studentToken, f.organizationId, class2ResourceId);
    expect(get.status).toBe(403);
  });

  it("prevents cross-tenant resource access", async () => {
    const f = await fixture();

    const otherAdminId = await createUser("other-admin");
    const otherOrgId = await createOrganization(otherAdminId, "other");
    await addMember(otherAdminId, otherOrgId, "SCHOOL_ADMIN");
    const otherResourceId = await createLearningResource(otherOrgId, otherAdminId, {
      status: "PUBLISHED", visibility: "ORGANIZATION", title: "Other org worksheet",
    });

    const list = await listResources(f.studentToken, otherOrgId);
    expect(list.status).toBe(403);

    const get = await getResource(f.studentToken, f.organizationId, otherResourceId);
    expect(get.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const f = await fixture();

    expect((await request(app).get(`/api/organizations/${f.organizationId}/learning-resources`)).status).toBe(401);
    expect((await request(app).get("/api/learning-resources/00000000-0000-4000-8000-000000000000")).status).toBe(401);
  });

  it("does not trust client-supplied identity fields", async () => {
    const f = await fixture();
    const resourceId = await createLearningResource(f.organizationId, f.adminId, {
      curriculumNodeId: f.topicId, status: "PUBLISHED", visibility: "ORGANIZATION", title: "Protected Worksheet",
    });

    const list = await listResources(f.studentToken, f.organizationId, {
      curriculum_node_id: f.topicId,
      student_id: "00000000-0000-4000-8000-000000000001",
      organization_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(list.status).toBe(200);
    expect(list.body.learningResources.map((r: { title: string }) => r.title)).toContain("Protected Worksheet");

    const get = await request(app)
      .get(`/api/learning-resources/${resourceId}`)
      .set(auth(f.studentToken, f.organizationId))
      .query({ student_id: "00000000-0000-4000-8000-000000000001" });
    expect(get.status).toBe(200);
  });

  it("returns an empty list for a topic with no eligible resources", async () => {
    const f = await fixture();
    const emptyTopicId = await createTopicNode(f.chapterId, "Topic 1.9: Empty");

    const res = await listResources(f.studentToken, f.organizationId, { curriculum_node_id: emptyTopicId });
    expect(res.status).toBe(200);
    expect(res.body.learningResources).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("keeps resources scoped to their curriculum topic", async () => {
    const f = await fixture();
    const topic2Id = await createTopicNode(f.chapterId, "Topic 1.2: Equations");
    await createLearningResource(f.organizationId, f.adminId, {
      curriculumNodeId: f.topicId, status: "PUBLISHED", visibility: "ORGANIZATION", title: "Topic A Worksheet",
    });

    const a = await listResources(f.studentToken, f.organizationId, { curriculum_node_id: f.topicId });
    expect(a.body.learningResources.map((r: { title: string }) => r.title)).toContain("Topic A Worksheet");

    const b = await listResources(f.studentToken, f.organizationId, { curriculum_node_id: topic2Id });
    expect(b.body.learningResources.map((r: { title: string }) => r.title)).not.toContain("Topic A Worksheet");
  });

  it("does not introduce a student-specific resource endpoint", async () => {
    const f = await fixture();

    const res = await request(app).get("/api/student/resources").set(auth(f.studentToken, f.organizationId));
    expect(res.status).toBe(404);
  });

  it("keeps the student dashboard learning-resource projection functional and safe", async () => {
    const f = await fixture();
    await createLearningResource(f.organizationId, f.adminId, {
      status: "PUBLISHED", visibility: "ORGANIZATION", title: "Dashboard Worksheet",
    });

    const dash = await getDashboard(f.studentToken, f.organizationId);
    expect(dash.status).toBe(200);
    const titles = dash.body.learning_resources.map((r: { title: string }) => r.title);
    expect(titles).toContain("Dashboard Worksheet");

    const resource = dash.body.learning_resources.find((r: { title: string }) => r.title === "Dashboard Worksheet");
    expect(resource.organization_id).toBeUndefined();
    expect(resource.created_by_user_id).toBeUndefined();
    expect(resource.metadata).toBeUndefined();
  });
});


