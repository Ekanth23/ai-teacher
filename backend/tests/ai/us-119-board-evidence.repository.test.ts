import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { BoardEvidenceRepository } from "../../src/modules/ai/board-evidence.repository.js";
import { findActiveCurriculumNodes } from "../../src/modules/curriculum/repository.js";

const created = {
  users: [] as string[],
  organizations: [] as string[],
  students: [] as string[],
  classes: [] as string[],
  subjects: [] as string[],
  enrollments: [] as string[],
  syllabi: [] as string[],
};

async function cleanup() {
  if (created.organizations.length) {
    await pool.query(
      `DELETE FROM learning_resources WHERE organization_id = ANY($1::uuid[])`,
      [created.organizations]
    );
  }
  if (created.syllabi.length) {
    await pool.query(
      `DELETE FROM learning_elements
        WHERE curriculum_node_id IN (
          SELECT n.id
            FROM curriculum_nodes n
            JOIN curriculum_structures cs ON cs.id = n.curriculum_structure_id
            JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
           WHERE sv.syllabus_id = ANY($1::uuid[])
        )`,
      [created.syllabi]
    );
    await pool.query(
      `DELETE FROM curriculum_nodes
        WHERE curriculum_structure_id IN (
          SELECT cs.id
            FROM curriculum_structures cs
            JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
           WHERE sv.syllabus_id = ANY($1::uuid[])
        )`,
      [created.syllabi]
    );
    await pool.query(
      `DELETE FROM curriculum_structures
        WHERE syllabus_version_id IN (
          SELECT id FROM syllabus_versions WHERE syllabus_id = ANY($1::uuid[])
        )`,
      [created.syllabi]
    );
    await pool.query(`DELETE FROM syllabus_versions WHERE syllabus_id = ANY($1::uuid[])`, [
      created.syllabi,
    ]);
    await pool.query(`DELETE FROM syllabi WHERE id = ANY($1::uuid[])`, [created.syllabi]);
  }
  if (created.students.length) {
    await pool.query(
      `UPDATE students_v2 SET current_enrollment_id = NULL WHERE id = ANY($1::uuid[])`,
      [created.students]
    );
  }
  if (created.enrollments.length) {
    await pool.query(`DELETE FROM student_enrollments WHERE id = ANY($1::uuid[])`, [
      created.enrollments,
    ]);
  }
  if (created.classes.length) {
    await pool.query(`DELETE FROM class_subjects WHERE class_id = ANY($1::uuid[])`, [
      created.classes,
    ]);
  }
  if (created.subjects.length) {
    await pool.query(`DELETE FROM subjects WHERE id = ANY($1::uuid[])`, [created.subjects]);
  }
  if (created.students.length) {
    await pool.query(`DELETE FROM students_v2 WHERE id = ANY($1::uuid[])`, [created.students]);
  }
  if (created.classes.length) {
    await pool.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [created.classes]);
  }
  if (created.organizations.length) {
    await pool.query(
      `DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])`,
      [created.organizations]
    );
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [
      created.organizations,
    ]);
  }
  if (created.users.length) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.users]);
  }
  Object.values(created).forEach((items) => (items.length = 0));
}

afterEach(cleanup);

async function createUser(label: string) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'test-hash', $2, 'ACTIVE') RETURNING id`,
    [`${label}-${randomUUID()}@example.com`, label]
  );
  created.users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createOrganization(ownerId: string, label: string) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
    [label, `${label}-${randomUUID()}`, ownerId]
  );
  created.organizations.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createStudent(organizationId: string, userId: string) {
  const result = await pool.query(
    `INSERT INTO students_v2 (user_id, organization_id, full_name, grade_level, status)
     VALUES ($1, $2, 'US-119 Student', '8', 'ACTIVE') RETURNING id`,
    [userId, organizationId]
  );
  created.students.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createClass(organizationId: string, ownerId: string, name: string) {
  const result = await pool.query(
    `INSERT INTO classes (organization_id, name, created_by_user_id, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, name, ownerId]
  );
  created.classes.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createSubject(organizationId: string, classId: string, name: string) {
  const subject = await pool.query(
    `INSERT INTO subjects (organization_id, name, code, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, name, `US119-${randomUUID()}`]
  );
  created.subjects.push(subject.rows[0].id);
  await pool.query(
    `INSERT INTO class_subjects (organization_id, class_id, subject_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [organizationId, classId, subject.rows[0].id]
  );
  return subject.rows[0].id as string;
}

async function createSyllabus(input: {
  classId: string;
  boardId: string;
  mediumId: string;
  authoritative: boolean;
}) {
  const result = await pool.query(
    `INSERT INTO syllabi
       (class_id, board_id, medium_id, name, code, status, is_authoritative)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6) RETURNING id`,
    [
      input.classId,
      input.boardId,
      input.mediumId,
      `US-119 syllabus ${randomUUID()}`,
      `US119-${randomUUID()}`,
      input.authoritative,
    ]
  );
  created.syllabi.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function createVersion(
  syllabusId: string,
  options: { status?: string; effectiveFrom?: string; effectiveTo?: string } = {}
) {
  const result = await pool.query(
    `INSERT INTO syllabus_versions
       (syllabus_id, version, status, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      syllabusId,
      `v-${randomUUID()}`,
      options.status ?? "ACTIVE",
      options.effectiveFrom ?? null,
      options.effectiveTo ?? null,
    ]
  );
  return result.rows[0].id as string;
}

async function createStructure(versionId: string, subjectId: string, name: string) {
  const result = await pool.query(
    `INSERT INTO curriculum_structures
       (syllabus_version_id, structure_kind, name, subject_id, status)
     VALUES ($1, 'SYLLABUS', $2, $3, 'ACTIVE') RETURNING id`,
    [versionId, name, subjectId]
  );
  return result.rows[0].id as string;
}

async function createNode(input: {
  structureId: string;
  type: "CHAPTER" | "TOPIC";
  title: string;
  description?: string | null;
  parentId?: string | null;
  status?: string;
}) {
  const type = await pool.query(
    `SELECT id FROM curriculum_node_types WHERE code = $1 AND status = 'ACTIVE' LIMIT 1`,
    [input.type]
  );
  const result = await pool.query(
    `INSERT INTO curriculum_nodes
       (curriculum_structure_id, parent_node_id, node_type_id, title, description, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.structureId,
      input.parentId ?? null,
      type.rows[0].id,
      input.title,
      input.description ?? null,
      input.status ?? "ACTIVE",
    ]
  );
  return result.rows[0].id as string;
}

async function createResource(input: {
  organizationId: string;
  creatorId: string;
  classId?: string | null;
  nodeId?: string | null;
  title: string;
  description?: string | null;
  status?: string;
  visibility?: string;
  approved?: boolean;
  fileUrl?: string;
  resourceType?: string;
}) {
  await pool.query(
    `INSERT INTO learning_resources
       (organization_id, curriculum_node_id, class_id, resource_type, title, description,
        file_url, visibility, status, metadata, created_by_user_id, approved_by_user_id, approved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10::uuid,
             CASE WHEN $11::boolean THEN $10::uuid ELSE NULL END,
             CASE WHEN $11::boolean THEN NOW() ELSE NULL END)`,
    [
      input.organizationId,
      input.nodeId ?? null,
      input.classId ?? null,
      input.resourceType ?? "TEACHER_NOTES",
      input.title,
      input.description ?? null,
      input.fileUrl ?? "https://internal.example/should-not-be-read.pdf",
      input.visibility ?? "ORGANIZATION",
      input.status ?? "PUBLISHED",
      input.creatorId,
      input.approved ?? true,
    ]
  );
}

async function fixture() {
  const adminId = await createUser("us119-evidence-admin");
  const studentUserId = await createUser("us119-evidence-student");
  const organizationId = await createOrganization(adminId, "US-119 evidence organization");
  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     SELECT $1, $2, id, 'ACTIVE' FROM roles WHERE name = 'SCHOOL_ADMIN'`,
    [adminId, organizationId]
  );
  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     SELECT $1, $2, id, 'ACTIVE' FROM roles WHERE name = 'STUDENT'`,
    [studentUserId, organizationId]
  );
  const studentId = await createStudent(organizationId, studentUserId);
  const classId = await createClass(organizationId, adminId, "US-119 Class 8");
  const enrollment = await pool.query(
    `INSERT INTO student_enrollments (organization_id, student_id, class_id, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [organizationId, studentId, classId]
  );
  created.enrollments.push(enrollment.rows[0].id);
  await pool.query(
    `UPDATE students_v2 SET current_enrollment_id = $1 WHERE id = $2`,
    [enrollment.rows[0].id, studentId]
  );
  const subjectId = await createSubject(organizationId, classId, "US-119 Mathematics");
  const board = (await pool.query("SELECT id FROM boards WHERE code = 'CBSE' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  const medium = (await pool.query("SELECT id FROM mediums WHERE code = 'EN' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  const syllabusId = await createSyllabus({
    classId,
    boardId: board.id,
    mediumId: medium.id,
    authoritative: true,
  });
  const versionId = await createVersion(syllabusId);
  const structureId = await createStructure(versionId, subjectId, "US-119 authoritative structure");
  const chapterId = await createNode({
    structureId,
    type: "CHAPTER",
    title: "Fractions",
    description: "The authoritative chapter description.",
  });
  const topicId = await createNode({
    structureId,
    type: "TOPIC",
    parentId: chapterId,
    title: "Equivalent Fractions",
    description: "Equivalent fractions represent the same quantity.",
  });
  return {
    adminId,
    studentUserId,
    organizationId,
    studentId,
    classId,
    subjectId,
    boardId: board.id as string,
    mediumId: medium.id as string,
    syllabusId,
    versionId,
    structureId,
    chapterId,
    topicId,
  };
}

function lookup(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    organizationId: f.organizationId,
    studentId: f.studentId,
    classId: f.classId,
    syllabusId: f.syllabusId,
    subjectId: f.subjectId,
    chapterId: f.chapterId,
    topicId: f.topicId,
  };
}

describe("US-119 authoritative curriculum evidence boundary", () => {
  it("contains no RAG, OCR, upload, file-fetch, or broad-select side effect", async () => {
    const source = await readFile(
      new URL("../../src/modules/ai/board-evidence.repository.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/SELECT\s+\*/i);
    expect(source).not.toMatch(/\bfetch\s*\(/i);
    expect(source).not.toMatch(/\b(?:rag|ocr|embedding|vector)\b/i);
    expect(source).not.toContain("file_url");
    expect(source).not.toContain("source_uri");
  });

  it("returns only allowlisted authoritative content and approved visible resource descriptions", async () => {
    const f = await fixture();
    await createResource({
      organizationId: f.organizationId,
      creatorId: f.adminId,
      nodeId: f.topicId,
      title: "Approved fractions notes",
      description: "Approved supporting explanation.",
      fileUrl: "https://internal.example/secret-source.pdf",
    });
    await createResource({
      organizationId: f.organizationId,
      creatorId: f.adminId,
      classId: f.classId,
      title: "Approved class resource",
      description: "Visible supporting class explanation.",
      visibility: "CLASS",
    });

    const repository = new BoardEvidenceRepository();
    const bundle = await repository.getEvidence(lookup(f));
    const serialized = JSON.stringify(bundle);

    expect(bundle.primarySourceCount).toBe(1);
    expect(bundle.sources.some((source) => source.content.includes("authoritative chapter"))).toBe(true);
    expect(bundle.sources.some((source) => source.content.includes("Approved supporting"))).toBe(true);
    expect(serialized).not.toContain("internal.example");
    expect(serialized).not.toContain("file_url");
    expect(serialized).not.toContain("source_uri");
    expect(serialized).not.toContain(f.classId);
    expect(serialized).not.toContain(f.studentId);
    expect(serialized).not.toContain(f.organizationId);
  });

  it("excludes file-only, unapproved, draft, pending, archived, private, and unrelated resources", async () => {
    const f = await fixture();
    const base = {
      organizationId: f.organizationId,
      creatorId: f.adminId,
      classId: f.classId,
    };
    await createResource({ ...base, title: "File only", description: null });
    await createResource({ ...base, title: "Unapproved", description: "Must exclude", approved: false });
    await createResource({ ...base, title: "Draft", description: "Must exclude", status: "DRAFT" });
    await createResource({
      ...base,
      title: "Pending",
      description: "Must exclude",
      status: "PENDING_APPROVAL",
    });
    await createResource({
      ...base,
      title: "Archived",
      description: "Must exclude",
      status: "ARCHIVED",
    });
    await createResource({
      ...base,
      title: "Private",
      description: "Must exclude",
      visibility: "PRIVATE",
    });
    await createResource({
      ...base,
      title: "Unverified type",
      description: "Must exclude",
      resourceType: "OTHER",
    });

    const bundle = await new BoardEvidenceRepository().getEvidence(lookup(f));
    expect(JSON.stringify(bundle)).not.toContain("Must exclude");
    expect(bundle.sources.some((source) => source.sourceKind === "LEARNING_RESOURCE")).toBe(false);
  });

  it("excludes archived nodes and future or past syllabus versions", async () => {
    const f = await fixture();
    await pool.query(`UPDATE curriculum_nodes SET status = 'ARCHIVED' WHERE id = $1`, [
      f.topicId,
    ]);
    const futureVersion = await createVersion(f.syllabusId, {
      effectiveFrom: "2999-01-01",
    });
    const futureStructure = await createStructure(
      futureVersion,
      f.subjectId,
      "Future structure"
    );
    await createNode({
      structureId: futureStructure,
      type: "CHAPTER",
      title: "Future chapter",
      description: "Future content must be excluded.",
    });
    const pastVersion = await createVersion(f.syllabusId, {
      effectiveTo: "2000-01-01",
    });
    const pastStructure = await createStructure(pastVersion, f.subjectId, "Past structure");
    await createNode({
      structureId: pastStructure,
      type: "CHAPTER",
      title: "Past chapter",
      description: "Past content must be excluded.",
    });

    const bundle = await new BoardEvidenceRepository().getEvidence(lookup(f));
    const futureNode = await findActiveCurriculumNodes(
      f.organizationId,
      f.classId,
      f.syllabusId,
      f.subjectId,
      "CHAPTER",
      "Future chapter"
    );
    const pastNode = await findActiveCurriculumNodes(
      f.organizationId,
      f.classId,
      f.syllabusId,
      f.subjectId,
      "CHAPTER",
      "Past chapter"
    );
    expect(bundle.primarySourceCount).toBe(1);
    expect(futureNode.rows).toHaveLength(0);
    expect(pastNode.rows).toHaveLength(0);
    expect(JSON.stringify(bundle)).not.toContain("Equivalent fractions represent");
    expect(JSON.stringify(bundle)).not.toContain("must be excluded");
  });

  it("reports multiple same-authority structures as a conflict candidate", async () => {
    const f = await fixture();
    await createStructure(f.versionId, f.subjectId, "Second authoritative structure");
    const bundle = await new BoardEvidenceRepository().getEvidence(lookup(f));
    expect(bundle.primarySourceCount).toBe(2);
  });

  it("resolves exactly one designated active context and ignores active-but-not-designated rows", async () => {
    const f = await fixture();
    await createSyllabus({
      classId: f.classId,
      boardId: f.boardId,
      mediumId: f.mediumId,
      authoritative: false,
    });
    const contexts = await new BoardEvidenceRepository().getAuthoritativeBoardContexts(
      f.organizationId,
      f.studentId,
      f.boardId
    );
    expect(contexts.rows).toHaveLength(1);
    expect(contexts.rows[0]).toMatchObject({
      class_id: f.classId,
      board_id: f.boardId,
      syllabus_id: f.syllabusId,
    });
  });

  it("does not expose another tenant, class, or similarly labelled curriculum", async () => {
    const f = await fixture();
    const otherClass = await createClass(
      f.organizationId,
      f.adminId,
      "US-119 Other Class 8"
    );
    const otherSubject = await createSubject(
      f.organizationId,
      otherClass,
      "Equivalent Fractions"
    );
    const otherSyllabus = await createSyllabus({
      classId: otherClass,
      boardId: f.boardId,
      mediumId: f.mediumId,
      authoritative: true,
    });
    const otherVersion = await createVersion(otherSyllabus);
    const otherStructure = await createStructure(otherVersion, otherSubject, "Similar structure");
    const otherNode = await createNode({
      structureId: otherStructure,
      type: "CHAPTER",
      title: "Equivalent Fractions",
      description: "Similar label from another class must be excluded.",
    });
    await createResource({
      organizationId: f.organizationId,
      creatorId: f.adminId,
      classId: otherClass,
      nodeId: otherNode,
      title: "Similar resource",
      description: "Another class resource must be excluded.",
    });

    const otherTenantOwner = await createUser("us119-other-owner");
    const otherOrganizationId = await createOrganization(
      otherTenantOwner,
      "US-119 foreign organization"
    );
    const otherTenantClass = await createClass(
      otherOrganizationId,
      otherTenantOwner,
      "Foreign Class 8"
    );
    const otherTenantSubject = await createSubject(
      otherOrganizationId,
      otherTenantClass,
      "Foreign Mathematics"
    );
    const foreignSyllabus = await createSyllabus({
      classId: otherTenantClass,
      boardId: f.boardId,
      mediumId: f.mediumId,
      authoritative: true,
    });
    const foreignVersion = await createVersion(foreignSyllabus);
    const foreignStructure = await createStructure(
      foreignVersion,
      otherTenantSubject,
      "Foreign structure"
    );
    const foreignNode = await createNode({
      structureId: foreignStructure,
      type: "CHAPTER",
      title: "Equivalent Fractions",
      description: "Foreign tenant content must be excluded.",
    });
    await createResource({
      organizationId: otherOrganizationId,
      creatorId: otherTenantOwner,
      classId: otherTenantClass,
      nodeId: foreignNode,
      title: "Foreign resource",
      description: "Foreign resource must be excluded.",
    });

    const bundle = await new BoardEvidenceRepository().getEvidence(lookup(f));
    const contexts = await new BoardEvidenceRepository().getAuthoritativeBoardContexts(
      f.organizationId,
      f.studentId,
      f.boardId
    );
    expect(JSON.stringify(bundle)).not.toContain("must be excluded");
    expect(contexts.rows).toHaveLength(1);
    expect(contexts.rows[0].class_id).toBe(f.classId);
  });
});
