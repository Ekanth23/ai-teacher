import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createAccessToken } from "../../src/auth/tokens.js";
import { createApp } from "../../src/server.js";
import { seedDevStudent } from "../../scripts/seed-dev-student.js";
import { seedCurriculumTnStd8Maths } from "../../scripts/seed-curriculum-tn-std8-maths.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";

const app = createApp();
const authScheme = "Bearer";

const unique = (prefix: string) => `${prefix.slice(0, 20)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const originalNodeEnv = process.env.NODE_ENV;

const EXPECTED_CHAPTERS: { title: string; topicCount: number }[] = [
  { title: "Numbers", topicCount: 9 },
  { title: "Measurements", topicCount: 4 },
  { title: "Algebra", topicCount: 10 },
  { title: "Life Mathematics", topicCount: 6 },
  { title: "Geometry", topicCount: 16 },
  { title: "Statistics", topicCount: 4 },
  { title: "Information Processing", topicCount: 9 },
];

const FIRST_CHAPTER_TOPIC_TITLES = [
  "Introduction",
  "Rational Numbers",
  "Basic Arithmetic Operations on Rational Numbers",
  "Word Problems on the basic operations",
  "Properties of Rational Numbers",
  "Introduction to Square Numbers",
  "Square Root",
  "Cubes and Cube Roots",
  "Exponents and Powers",
];

let activeFixture: { organizationId: string; userId: string } | null = null;

async function cleanupCurriculum(organizationId: string) {
  await pool.query(
    `DELETE FROM curriculum_nodes WHERE curriculum_structure_id IN (
       SELECT cs.id FROM curriculum_structures cs
       JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
       JOIN syllabi s ON s.id = sv.syllabus_id
       JOIN classes c ON c.id = s.class_id
       WHERE c.organization_id = $1
     )`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM curriculum_structures WHERE syllabus_version_id IN (
       SELECT sv.id FROM syllabus_versions sv
       JOIN syllabi s ON s.id = sv.syllabus_id
       JOIN classes c ON c.id = s.class_id
       WHERE c.organization_id = $1
     )`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM syllabus_versions WHERE syllabus_id IN (
       SELECT s.id FROM syllabi s JOIN classes c ON c.id = s.class_id WHERE c.organization_id = $1
     )`,
    [organizationId]
  );
  await pool.query(
    `DELETE FROM syllabi WHERE class_id IN (SELECT id FROM classes WHERE organization_id = $1)`,
    [organizationId]
  );
}

async function cleanupDevStudentFixture(organizationId: string, userId: string) {
  await pool.query("DELETE FROM student_enrollments WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM class_subjects WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM subjects WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM classes WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM students_v2 WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_members WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  if (activeFixture) {
    await cleanupCurriculum(activeFixture.organizationId);
    await cleanupDevStudentFixture(activeFixture.organizationId, activeFixture.userId);
    activeFixture = null;
  }
});

async function seedDevFixture() {
  process.env.NODE_ENV = "development";
  const email = `curr-${unique("user")}@example.com`;
  const password = "StrongSeededPassword123!";
  const slug = unique("currorg");

  const dev = await seedDevStudent({ email, password, organizationSlug: slug });
  activeFixture = { organizationId: dev.organizationId, userId: dev.userId };
  return { dev, organizationSlug: slug };
}

describe("curriculum seed: TN State Board / English Medium / Standard 8 / Mathematics", () => {
  it("is rejected when NODE_ENV is not development", async () => {
    process.env.NODE_ENV = "production";
    await expect(seedCurriculumTnStd8Maths({ organizationSlug: "does-not-matter" })).rejects.toThrow(
      /NODE_ENV=development/
    );
  });

  it("fails fast with a clear message when the dev student fixture is missing", async () => {
    process.env.NODE_ENV = "development";
    await expect(seedCurriculumTnStd8Maths({ organizationSlug: unique("missingorg") })).rejects.toThrow(
      /Run "npm run db:seed:dev"/
    );
  });

  it("seeds the board, medium, class, subject, structure, chapters and topics", async () => {
    const { organizationSlug, dev } = await seedDevFixture();

    const summary = await seedCurriculumTnStd8Maths({ organizationSlug });

    expect(summary.chapterCount).toBe(7);
    expect(summary.topicCount).toBe(58);

    // 3. Board exists.
    const board = await pool.query("SELECT id FROM boards WHERE lower(name) = lower($1)", ["Tamil Nadu State Board"]);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].id).toBe(summary.boardId);

    // 4. English medium exists.
    const medium = await pool.query("SELECT id FROM mediums WHERE lower(name) = 'english'");
    expect(medium.rows).toHaveLength(1);
    expect(medium.rows[0].id).toBe(summary.mediumId);

    // 5. Grade 8 class exists.
    const cls = await pool.query("SELECT id, name, section FROM classes WHERE id = $1", [summary.classId]);
    expect(cls.rows).toHaveLength(1);
    expect(cls.rows[0].name).toBe("Grade 8");
    expect(cls.rows[0].section).toBe("A");
    expect(summary.classId).toBe(dev.classId);

    // 6. Mathematics subject exists.
    const subject = await pool.query("SELECT id, name FROM subjects WHERE id = $1", [summary.subjectId]);
    expect(subject.rows).toHaveLength(1);
    expect(subject.rows[0].name).toBe("Mathematics");
    expect(summary.subjectId).toBe(dev.subjectId);

    // 7. Correct curriculum structure exists for Grade 8 + Mathematics.
    const structure = await pool.query(
      `SELECT cs.id, cs.subject_id, s.class_id
       FROM curriculum_structures cs
       JOIN syllabus_versions sv ON sv.id = cs.syllabus_version_id
       JOIN syllabi s ON s.id = sv.syllabus_id
       WHERE cs.id = $1`,
      [summary.curriculumStructureId]
    );
    expect(structure.rows).toHaveLength(1);
    expect(structure.rows[0].class_id).toBe(summary.classId);
    expect(structure.rows[0].subject_id).toBe(summary.subjectId);

    // 8, 9, 10. Exactly 7 chapters, correct sequence, correct titles.
    const chapters = await pool.query(
      `SELECT n.title, n.sequence_number, n.code
       FROM curriculum_nodes n
       JOIN curriculum_node_types t ON t.id = n.node_type_id
       WHERE n.curriculum_structure_id = $1 AND lower(t.code) = 'chapter' AND n.parent_node_id IS NULL
       ORDER BY n.sequence_number`,
      [summary.curriculumStructureId]
    );
    expect(chapters.rows).toHaveLength(7);
    chapters.rows.forEach((row, index) => {
      expect(row.sequence_number).toBe(index + 1);
      expect(row.title).toBe(EXPECTED_CHAPTERS[index].title);
      expect(row.code).toBe(String(index + 1));
    });

    // 11, 12, 13, 14. Correct topic count/sequence/titles per chapter, and parentage.
    for (let i = 0; i < chapters.rows.length; i += 1) {
      const chapterRow = await pool.query(
        `SELECT id FROM curriculum_nodes WHERE curriculum_structure_id = $1 AND title = $2 AND parent_node_id IS NULL`,
        [summary.curriculumStructureId, EXPECTED_CHAPTERS[i].title]
      );
      const chapterId = chapterRow.rows[0].id;

      const topics = await pool.query(
        `SELECT n.title, n.sequence_number, n.parent_node_id
         FROM curriculum_nodes n
         JOIN curriculum_node_types t ON t.id = n.node_type_id
         WHERE n.curriculum_structure_id = $1 AND lower(t.code) = 'topic' AND n.parent_node_id = $2
         ORDER BY n.sequence_number`,
        [summary.curriculumStructureId, chapterId]
      );

      expect(topics.rows).toHaveLength(EXPECTED_CHAPTERS[i].topicCount);
      topics.rows.forEach((row, index) => {
        expect(row.sequence_number).toBe(index + 1);
        expect(row.parent_node_id).toBe(chapterId);
      });

      if (i === 0) {
        expect(topics.rows.map((row) => row.title)).toEqual(FIRST_CHAPTER_TOPIC_TITLES);
      }
    }
  });

  it("is idempotent when run twice: no duplicate chapters, topics, structures, subjects, classes or organizations", async () => {
    const { organizationSlug } = await seedDevFixture();

    const first = await seedCurriculumTnStd8Maths({ organizationSlug });
    const second = await seedCurriculumTnStd8Maths({ organizationSlug });

    expect(second.curriculumStructureId).toBe(first.curriculumStructureId);
    expect(second.syllabusId).toBe(first.syllabusId);
    expect(second.syllabusVersionId).toBe(first.syllabusVersionId);
    expect(second.chapterCount).toBe(7);
    expect(second.topicCount).toBe(58);

    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM organizations WHERE id = $1) AS organizations,
         (SELECT COUNT(*)::int FROM classes WHERE id = $2) AS classes,
         (SELECT COUNT(*)::int FROM subjects WHERE id = $3) AS subjects,
         (SELECT COUNT(*)::int FROM syllabi WHERE id = $4) AS syllabi,
         (SELECT COUNT(*)::int FROM curriculum_structures WHERE id = $5) AS structures,
         (SELECT COUNT(*)::int FROM curriculum_nodes WHERE curriculum_structure_id = $5 AND parent_node_id IS NULL) AS chapters,
         (SELECT COUNT(*)::int FROM curriculum_nodes WHERE curriculum_structure_id = $5 AND parent_node_id IS NOT NULL) AS topics`,
      [first.organizationId, first.classId, first.subjectId, first.syllabusId, first.curriculumStructureId]
    );

    expect(counts.rows[0]).toEqual({
      organizations: 1,
      classes: 1,
      subjects: 1,
      syllabi: 1,
      structures: 1,
      chapters: 7,
      topics: 58,
    });
  });

  it("lets the existing dev student access the seeded curriculum through the canonical student APIs", async () => {
    const { organizationSlug, dev } = await seedDevFixture();
    const summary = await seedCurriculumTnStd8Maths({ organizationSlug });

    const token = createAccessToken(dev.userId);
    const authHeader = { Authorization: `${authScheme} ${token}`, "x-organization-id": dev.organizationId };

    const dashboard = await request(app).get("/api/student/dashboard").set(authHeader);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.curriculum_structures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: summary.curriculumStructureId,
          class_id: dev.classId,
          subject_id: dev.subjectId,
        }),
      ])
    );

    const chapters = await request(app)
      .get(`/api/curriculum/structures/${summary.curriculumStructureId}/chapters`)
      .set(authHeader);
    expect(chapters.status).toBe(200);
    expect(chapters.body.total).toBe(7);
    expect(chapters.body.chapters.map((c: { title: string }) => c.title)).toEqual(
      EXPECTED_CHAPTERS.map((c) => c.title)
    );

    const numbersChapter = chapters.body.chapters.find((c: { title: string }) => c.title === "Numbers");
    const topics = await request(app).get(`/api/curriculum/chapters/${numbersChapter.id}/topics`).set(authHeader);
    expect(topics.status).toBe(200);
    expect(topics.body.total).toBe(9);
    expect(topics.body.topics.map((t: { title: string }) => t.title)).toEqual(FIRST_CHAPTER_TOPIC_TITLES);
  });
});
