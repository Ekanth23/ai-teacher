import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { AuthorizationError } from "../../src/auth/organization.js";
import * as architectureService from "../../src/modules/curriculum/architecture/service.js";

describe("Phase 3 curriculum architecture", () => {
  const createdIds: { users: string[]; organizations: string[]; knowledgeItems: string[] } = {
    users: [], organizations: [], knowledgeItems: [],
  };

  afterEach(async () => {
    if (createdIds.knowledgeItems.length) {
      await pool.query("DELETE FROM knowledge_items WHERE id = ANY($1::uuid[])", [createdIds.knowledgeItems]);
      createdIds.knowledgeItems = [];
    }
    if (createdIds.organizations.length) {
      await pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [createdIds.organizations]);
      await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [createdIds.organizations]);
      createdIds.organizations = [];
    }
    if (createdIds.users.length) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdIds.users]);
      createdIds.users = [];
    }
  });

  it("creates independent knowledge items and focused relationships", async () => {
    const concept = await pool.query(
      `INSERT INTO knowledge_items (kind, name, expected_mastery, depth, complexity, difficulty, application_level)
       VALUES ('CONCEPT', 'Phase 3 test concept', 0.8, 2, 2, 1, 2) RETURNING id`
    );
    const prerequisite = await pool.query(
      `INSERT INTO knowledge_items (kind, name) VALUES ('SKILL', 'Phase 3 test prerequisite') RETURNING id`
    );
    const conceptId = concept.rows[0].id as string;
    const prerequisiteId = prerequisite.rows[0].id as string;

    try {
      await pool.query(
        `INSERT INTO knowledge_item_prerequisites (knowledge_item_id, prerequisite_knowledge_item_id)
         VALUES ($1, $2)`,
        [conceptId, prerequisiteId]
      );
      await pool.query(
        `INSERT INTO knowledge_item_problem_types (knowledge_item_id, problem_type)
         VALUES ($1, 'MULTI_STEP')`,
        [conceptId]
      );

      const result = await pool.query(
        `SELECT k.kind, k.expected_mastery, p.prerequisite_knowledge_item_id, t.problem_type
         FROM knowledge_items k
         JOIN knowledge_item_prerequisites p ON p.knowledge_item_id = k.id
         JOIN knowledge_item_problem_types t ON t.knowledge_item_id = k.id
         WHERE k.id = $1`,
        [conceptId]
      );
      expect(result.rows[0]).toMatchObject({
        kind: "CONCEPT",
        expected_mastery: "0.8",
        prerequisite_knowledge_item_id: prerequisiteId,
        problem_type: "MULTI_STEP",
      });
    } finally {
      await pool.query(`DELETE FROM knowledge_items WHERE id = ANY($1::uuid[])`, [[conceptId, prerequisiteId]]);
    }
  });

  it("enforces exactly one mapping target at the database level", async () => {
    const result = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'curriculum_mapping_profiles'::regclass
         AND conname = 'curriculum_mapping_profiles_target_type_check'`
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].definition).toContain("CURRICULUM");
    expect(result.rows[0].definition).toContain("PATHWAY");
    expect(result.rows[0].definition).toContain("target_syllabus_version_id");
    expect(result.rows[0].definition).toContain("target_pathway_version_id");
  });

  it("keeps syllabus and textbook structures as separate containers", async () => {
    const versions = await pool.query("SELECT id FROM syllabus_versions ORDER BY created_at LIMIT 1");
    if (versions.rows.length === 0) return;

    const syllabus = await pool.query(
      `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name)
       VALUES ($1, 'SYLLABUS', 'Phase 3 syllabus structure') RETURNING id`,
      [versions.rows[0].id]
    );
    const textbook = await pool.query(
      `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name)
       VALUES ($1, 'TEXTBOOK', 'Phase 3 textbook structure') RETURNING id`,
      [versions.rows[0].id]
    );
    try {
      const result = await pool.query(
        `SELECT structure_kind FROM curriculum_structures
         WHERE id = ANY($1::uuid[]) ORDER BY structure_kind`,
        [[syllabus.rows[0].id, textbook.rows[0].id]]
      );
      expect(result.rows.map((row) => row.structure_kind)).toEqual(["SYLLABUS", "TEXTBOOK"]);
    } finally {
      await pool.query(`DELETE FROM curriculum_structures WHERE id = ANY($1::uuid[])`, [[syllabus.rows[0].id, textbook.rows[0].id]]);
    }
  });

  it("enforces curriculum parent structure integrity", async () => {
    const result = await pool.query(
      `SELECT conname
       FROM pg_constraint
       WHERE conname = 'curriculum_nodes_parent_same_structure_fk'`
    );
    expect(result.rows).toHaveLength(1);
  });

  it("enforces pathway requirement stage version integrity", async () => {
    const result = await pool.query(
      `SELECT conname
       FROM pg_constraint
       WHERE conname = 'target_pathway_requirements_stage_same_version_fk'`
    );
    expect(result.rows).toHaveLength(1);
  });

  it("authorizes knowledge relationship mutations by management role", async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const users: Record<string, any> = {};
    for (const role of ["SCHOOL_ADMIN", "COACHING_ADMIN", "TEACHER", "STUDENT"]) {
      const user = (await pool.query(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         RETURNING id, full_name, email, phone, status, created_at`,
        [`phase3_${role.toLowerCase()}_${suffix}@example.com`, await bcrypt.hash("password", 4), role]
      )).rows[0];
      users[role] = user;
      createdIds.users.push(user.id);
    }

    const organization = (await pool.query(
      `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
       VALUES ($1, $2, 'SCHOOL', 'ACTIVE', $3) RETURNING id`,
      [`Phase 3 ${suffix}`, `phase3_${suffix}`, users.SCHOOL_ADMIN.id]
    )).rows[0];
    createdIds.organizations.push(organization.id);

    for (const role of Object.keys(users)) {
      const roleId = (await pool.query("SELECT id FROM roles WHERE name = $1", [role])).rows[0].id;
      await pool.query(
        "INSERT INTO organization_members (user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')",
        [users[role].id, organization.id, roleId]
      );
    }

    const items = await pool.query(
      `INSERT INTO knowledge_items (kind, name) VALUES ('CONCEPT', $1), ('SKILL', $2), ('SKILL', $3) RETURNING id`,
      [`Phase 3 target ${suffix}`, `Phase 3 prerequisite ${suffix}`, `Phase 3 second prerequisite ${suffix}`]
    );
    const itemId = items.rows[0].id;
    const prerequisiteId = items.rows[1].id;
    const secondPrerequisiteId = items.rows[2].id;
    createdIds.knowledgeItems.push(itemId, prerequisiteId, secondPrerequisiteId);
    const req = { headers: { "x-organization-id": organization.id } } as any;

    await expect(architectureService.addPrerequisite(req, users.SCHOOL_ADMIN, itemId, prerequisiteId)).resolves.toBeDefined();
    await expect(architectureService.addPrerequisite(req, users.COACHING_ADMIN, itemId, secondPrerequisiteId)).resolves.toBeDefined();
    await expect(architectureService.addPrerequisite(req, users.TEACHER, itemId, prerequisiteId)).rejects.toMatchObject({ code: "ROLE_REQUIRED" });
    await expect(architectureService.addPrerequisite(req, users.STUDENT, itemId, prerequisiteId)).rejects.toMatchObject({ code: "ROLE_REQUIRED" });
    await expect(architectureService.addProblemType(req, users.SCHOOL_ADMIN, itemId, "MULTI_STEP")).resolves.toBeDefined();
    await expect(architectureService.addProblemType(req, users.TEACHER, itemId, "SHORT_ANSWER")).rejects.toBeInstanceOf(AuthorizationError);
  });
});
