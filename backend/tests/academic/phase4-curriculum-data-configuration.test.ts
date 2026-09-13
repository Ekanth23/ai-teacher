import { describe, expect, it } from "vitest";
import tn from "../../src/modules/curriculum/tn-state-board/configuration.js";
import cbse from "../../src/modules/curriculum/cbse/configuration.js";
import { validateConfiguration } from "../../src/modules/curriculum/config/validation.js";
import { loadConfiguration } from "../../src/modules/curriculum/config/loader.js";
import pool from "../../src/db.js";

describe("Phase 017 curriculum data configuration", () => {
  it("provides distinct representative board fixtures and flexible structures", () => {
    expect(tn.boardCode).toBe("TNSTATE");
    expect(cbse.boardCode).toBe("CBSE");
    expect(tn.structures.map(s => s.kind)).toEqual(["SYLLABUS", "TEXTBOOK"]);
    expect(tn.structures.flatMap(s => s.nodes).some(n => n.type === "TERM")).toBe(true);
    expect(cbse.structures.flatMap(s => s.nodes).some(n => n.type === "TERM")).toBe(false);
  });

  it("validates stable keys and same-structure parent references", () => {
    expect(() => validateConfiguration(tn)).not.toThrow();
    expect(() => validateConfiguration({ ...tn, structures: [{ ...tn.structures[0], nodes: [{ ...tn.structures[0].nodes[1], parentKey: "missing" }] }] })).toThrow("unknown parent");
  });

  it("rejects cycles, duplicate element keys, and invalid dates", () => {
    const cyclic = { ...tn, structures: [{ ...tn.structures[0], nodes: [{ key: "a", type: "UNIT", title: "A", parentKey: "b" }, { key: "b", type: "UNIT", title: "B", parentKey: "a" }] }] };
    expect(() => validateConfiguration(cyclic)).toThrow("cycle");
    const duplicate = { ...tn, structures: [{ ...tn.structures[0], nodes: [{ key: "a", type: "UNIT", title: "A", elements: [{ key: "x", type: "EXAMPLE", title: "one" }, { key: "x", type: "EXAMPLE", title: "two" }] }] }] };
    expect(() => validateConfiguration(duplicate)).toThrow("duplicate element");
    expect(() => validateConfiguration({ ...tn, academicYear: { ...tn.academicYear, endDate: "2020-01-01" } })).toThrow("academic year dates");
  });

  it("keeps medium and language declarations separate and preserves provenance metadata", () => {
    expect(tn.mediumCodes).toContain("TA");
    expect(tn.languages).toContain("TA");
    expect(tn.source.name).toMatch(/representative/i);
    expect(cbse.mediumCodes).not.toEqual(cbse.languages.filter(code => code !== "HI"));
  });

  it("uses stable dataset and structure identities for repeatable loads", () => {
    expect(tn.datasetCode).toBe("tnstate-math-8");
    expect(tn.datasetVersion).toBe("1.0.0");
    expect(new Set(tn.structures.map(s => s.key)).size).toBe(tn.structures.length);
    expect(new Set(cbse.structures.flatMap(s => s.nodes.map(n => n.key))).size).toBe(cbse.structures.flatMap(s => s.nodes.map(n => n.key)).length);
  });

  it("rejects direct insert, update, and delete of published and retired reference content", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const board = (await client.query("SELECT id FROM boards WHERE code = 'CBSE' LIMIT 1")).rows[0];
      const nodeType = (await client.query("SELECT id FROM curriculum_node_types WHERE code = 'UNIT' LIMIT 1")).rows[0];
      const elementType = (await client.query("SELECT id FROM learning_element_types WHERE code = 'EXAMPLE' LIMIT 1")).rows[0];
      const knowledge = (await client.query(
        "INSERT INTO knowledge_items (kind, code, name) VALUES ('CONCEPT', $1, $2) RETURNING id",
        [`phase017_immutability_${Date.now()}`, "Phase 017 immutability knowledge"]
      )).rows[0];
      const curriculumVersion = (await client.query(
        `INSERT INTO curriculum_versions (board_id, version)
         VALUES ($1, $2) RETURNING id`,
        [board.id, `phase017-immutability-${Date.now()}`]
      )).rows[0];
      const dataset = (await client.query(
        `INSERT INTO curriculum_reference_datasets
           (curriculum_version_id, dataset_code, dataset_version, source_name, checksum, status)
         VALUES ($1, $2, '1.0.0', 'Phase 017 test', 'phase017-checksum', 'DRAFT')
         RETURNING id`,
        [curriculumVersion.id, `phase017-immutability-${Date.now()}`]
      )).rows[0];
      const structure = (await client.query(
        `INSERT INTO curriculum_structures
           (reference_dataset_id, structure_key, structure_kind, name)
         VALUES ($1, 'root', 'SYLLABUS', 'Phase 017 test structure')
         RETURNING id`,
        [dataset.id]
      )).rows[0];
      const node = (await client.query(
        `INSERT INTO curriculum_nodes
           (curriculum_structure_id, node_key, node_type_id, title)
         VALUES ($1, 'root-node', $2, 'Phase 017 test node')
         RETURNING id`,
        [structure.id, nodeType.id]
      )).rows[0];
      const element = (await client.query(
        `INSERT INTO learning_elements
           (curriculum_node_id, element_key, element_type_id, title)
         VALUES ($1, 'example', $2, 'Phase 017 test element')
         RETURNING id`,
        [node.id, elementType.id]
      )).rows[0];
      await client.query(
        `INSERT INTO curriculum_node_knowledge_items
           (curriculum_node_id, knowledge_item_id)
         VALUES ($1, $2)`,
        [node.id, knowledge.id]
      );
      await client.query("UPDATE curriculum_reference_datasets SET status = 'VALIDATED' WHERE id = $1", [dataset.id]);
      await client.query("UPDATE curriculum_reference_datasets SET status = 'PUBLISHED' WHERE id = $1", [dataset.id]);
      const alternateVersion = (await client.query(
        `INSERT INTO curriculum_versions (board_id, version) VALUES ($1, $2) RETURNING id`,
        [board.id, `phase017-alternate-${Date.now()}`]
      )).rows[0];

      const expectImmutable = async (query: string, values: unknown[]) => {
        await client.query("SAVEPOINT immutable_attempt");
        await expect(client.query(query, values)).rejects.toThrow("immutable");
        await client.query("ROLLBACK TO SAVEPOINT immutable_attempt");
        await client.query("RELEASE SAVEPOINT immutable_attempt");
      };
      const expectLifecycleFailure = async (query: string, values: unknown[]) => {
        await client.query("SAVEPOINT lifecycle_attempt");
        await expect(client.query(query, values)).rejects.toThrow("lifecycle transition");
        await client.query("ROLLBACK TO SAVEPOINT lifecycle_attempt");
        await client.query("RELEASE SAVEPOINT lifecycle_attempt");
      };

      await expectLifecycleFailure(
        "UPDATE curriculum_reference_datasets SET status = 'DRAFT' WHERE id = $1",
        [dataset.id]
      );
      await expectLifecycleFailure(
        "UPDATE curriculum_reference_datasets SET status = 'VALIDATED' WHERE id = $1",
        [dataset.id]
      );

      await expectImmutable(
        `INSERT INTO curriculum_structures
           (reference_dataset_id, structure_key, structure_kind, name)
         VALUES ($1, 'inserted', 'SYLLABUS', 'Should fail')`,
        [dataset.id]
      );
      await expectImmutable(
        `INSERT INTO curriculum_nodes
           (curriculum_structure_id, node_key, node_type_id, title)
         VALUES ($1, 'inserted-node', $2, 'Should fail')`,
        [structure.id, nodeType.id]
      );
      await expectImmutable(
        `INSERT INTO learning_elements
           (curriculum_node_id, element_key, element_type_id, title)
         VALUES ($1, 'inserted-element', $2, 'Should fail')`,
        [node.id, elementType.id]
      );
      await expectImmutable(
        `INSERT INTO curriculum_node_knowledge_items
           (curriculum_node_id, knowledge_item_id)
         VALUES ($1, $2)`,
        [node.id, knowledge.id]
      );
      await expectImmutable("UPDATE curriculum_structures SET name = 'Should fail' WHERE id = $1", [structure.id]);
      await expectImmutable("UPDATE curriculum_nodes SET title = 'Should fail' WHERE id = $1", [node.id]);
      await expectImmutable("UPDATE learning_elements SET title = 'Should fail' WHERE id = $1", [element.id]);
      await expectImmutable(
        "UPDATE curriculum_node_knowledge_items SET depth = 2 WHERE curriculum_node_id = $1 AND knowledge_item_id = $2",
        [node.id, knowledge.id]
      );
      await expectImmutable("DELETE FROM learning_elements WHERE id = $1", [element.id]);
      await expectImmutable(
        "DELETE FROM curriculum_node_knowledge_items WHERE curriculum_node_id = $1 AND knowledge_item_id = $2",
        [node.id, knowledge.id]
      );
      await expectImmutable("DELETE FROM curriculum_nodes WHERE id = $1", [node.id]);
      await expectImmutable("DELETE FROM curriculum_structures WHERE id = $1", [structure.id]);

      await client.query("UPDATE curriculum_reference_datasets SET status = 'RETIRED' WHERE id = $1", [dataset.id]);
      await expectImmutable("UPDATE curriculum_structures SET status = 'INACTIVE' WHERE id = $1", [structure.id]);
      await expectImmutable("DELETE FROM curriculum_structures WHERE id = $1", [structure.id]);

      await expectImmutable(
        "UPDATE curriculum_reference_datasets SET curriculum_version_id = $2 WHERE id = $1",
        [dataset.id, alternateVersion.id]
      );
      await expectImmutable(
        "UPDATE curriculum_reference_datasets SET dataset_code = 'changed' WHERE id = $1",
        [dataset.id]
      );
      await expectImmutable(
        "UPDATE curriculum_reference_datasets SET dataset_version = '2.0.0' WHERE id = $1",
        [dataset.id]
      );
      await expectImmutable(
        "UPDATE curriculum_reference_datasets SET checksum = 'changed' WHERE id = $1",
        [dataset.id]
      );
      await expectImmutable(
        "UPDATE curriculum_reference_datasets SET source_name = 'changed' WHERE id = $1",
        [dataset.id]
      );
      await expectImmutable(
        "UPDATE curriculum_reference_datasets SET source_uri = 'https://changed.example' WHERE id = $1",
        [dataset.id]
      );
      await expectImmutable(
        "UPDATE curriculum_reference_datasets SET citation_metadata = '{\"changed\": true}'::jsonb WHERE id = $1",
        [dataset.id]
      );
      await expectImmutable(
        "UPDATE curriculum_reference_datasets SET metadata = '{\"changed\": true}'::jsonb WHERE id = $1",
        [dataset.id]
      );

      await client.query("UPDATE curriculum_reference_datasets SET status = 'RETIRED' WHERE id = $1", [dataset.id]);
      await expectImmutable(
        "UPDATE curriculum_reference_datasets SET metadata = '{\"retired\": true}'::jsonb WHERE id = $1",
        [dataset.id]
      );
      await expectLifecycleFailure(
        "UPDATE curriculum_reference_datasets SET status = 'PUBLISHED' WHERE id = $1",
        [dataset.id]
      );

      await client.query("ROLLBACK");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original test failure.
      }
      throw error;
    } finally {
      client.release();
    }
  });

  it("does not write published content when loading the same dataset checksum", async () => {
    const suffix = `${Date.now()}`;
    const configuration = {
      ...tn,
      version: `phase019-${suffix}`,
      datasetCode: `phase019-${suffix}`,
      source: { ...tn.source, name: `Phase 019 ${suffix}` },
    };

    const first = await loadConfiguration(configuration, { publish: true });
    const before = await pool.query(
      `SELECT s.id, s.updated_at, n.id AS node_id, n.updated_at AS node_updated_at,
              e.id AS element_id, e.updated_at AS element_updated_at
         FROM curriculum_structures s
         LEFT JOIN curriculum_nodes n ON n.curriculum_structure_id = s.id
         LEFT JOIN learning_elements e ON e.curriculum_node_id = n.id
        WHERE s.reference_dataset_id = $1
        ORDER BY s.id, n.id, e.id`,
      [first.dataset.id]
    );

    await expect(
      loadConfiguration(
        { ...configuration, source: { ...configuration.source, name: `Conflicting ${suffix}` } },
        { publish: true }
      )
    ).rejects.toThrow("conflicts");

    const second = await loadConfiguration(configuration, { publish: true });
    const after = await pool.query(
      `SELECT s.id, s.updated_at, n.id AS node_id, n.updated_at AS node_updated_at,
              e.id AS element_id, e.updated_at AS element_updated_at
         FROM curriculum_structures s
         LEFT JOIN curriculum_nodes n ON n.curriculum_structure_id = s.id
         LEFT JOIN learning_elements e ON e.curriculum_node_id = n.id
        WHERE s.reference_dataset_id = $1
        ORDER BY s.id, n.id, e.id`,
      [second.dataset.id]
    );

    expect(second.dataset.id).toBe(first.dataset.id);
    expect(after.rows).toEqual(before.rows);
  });
});
