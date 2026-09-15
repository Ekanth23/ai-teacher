import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../src/db.js";
import * as chaptersRepository from "../src/modules/curriculum/chapters/repository.js";

// Development-only curriculum seed for:
//   Tamil Nadu State Board -> English Medium -> Standard 8 -> Mathematics
// Source: Government of Tamil Nadu, Standard 8 Mathematics, English Medium, 2025 Revised Edition.
//
// This seed reuses the canonical curriculum schema (boards, mediums, syllabi,
// syllabus_versions, curriculum_structures, curriculum_nodes) introduced by
// migrations 014-019 and 023. It does NOT invent a new schema.
//
// It is intentionally dependent on the existing development student fixture
// created by scripts/seed-dev-student.ts (organization, Grade 8 / Section A
// class, and Mathematics subject). If that fixture is missing, this seed
// fails fast with a clear message instead of silently recreating it.

const DEFAULT_ORGANIZATION_SLUG = "dev-student-academy";
const CLASS_NAME = "Grade 8";
const CLASS_SECTION = "A";
const SUBJECT_NAME = "Mathematics";

const BOARD_NAME = "Tamil Nadu State Board";
const MEDIUM_NAME = "English";

const SYLLABUS_NAME = "Tamil Nadu State Board Grade 8 Mathematics";
const SYLLABUS_CODE = "TN-STD8-MATHS";
const SYLLABUS_VERSION = "2025-revised";

const STRUCTURE_KIND = "TEXTBOOK";
const STRUCTURE_NAME = "Standard 8 Mathematics (English Medium, 2025 Revised Edition)";

interface TopicSeed {
  code: string;
  title: string;
  sequence: number;
}

interface ChapterSeed {
  code: string;
  title: string;
  sequence: number;
  topics: TopicSeed[];
}

// Chapter/topic titles and numbering are taken verbatim from the textbook's
// table of contents. Each numbered unit (1-7) is a CHAPTER node and each
// numbered section (e.g. 1.1) is a TOPIC node under its chapter, matching the
// mapping rule for this first curriculum seed.
const CHAPTERS: ChapterSeed[] = [
  {
    code: "1",
    title: "Numbers",
    sequence: 1,
    topics: [
      { code: "1.1", title: "Introduction", sequence: 1 },
      { code: "1.2", title: "Rational Numbers", sequence: 2 },
      { code: "1.3", title: "Basic Arithmetic Operations on Rational Numbers", sequence: 3 },
      { code: "1.4", title: "Word Problems on the basic operations", sequence: 4 },
      { code: "1.5", title: "Properties of Rational Numbers", sequence: 5 },
      { code: "1.6", title: "Introduction to Square Numbers", sequence: 6 },
      { code: "1.7", title: "Square Root", sequence: 7 },
      { code: "1.8", title: "Cubes and Cube Roots", sequence: 8 },
      { code: "1.9", title: "Exponents and Powers", sequence: 9 },
    ],
  },
  {
    code: "2",
    title: "Measurements",
    sequence: 2,
    topics: [
      { code: "2.1", title: "Introduction", sequence: 1 },
      { code: "2.2", title: "Parts of a Circle", sequence: 2 },
      { code: "2.3", title: "Combined Shapes", sequence: 3 },
      { code: "2.4", title: "Three Dimensional (3-D) Shapes", sequence: 4 },
    ],
  },
  {
    code: "3",
    title: "Algebra",
    sequence: 3,
    topics: [
      { code: "3.1", title: "Introduction", sequence: 1 },
      { code: "3.2", title: "Multiplication of Algebraic Expressions", sequence: 2 },
      { code: "3.3", title: "Division of Algebraic Expressions", sequence: 3 },
      { code: "3.4", title: "Avoid some Common Errors", sequence: 4 },
      { code: "3.5", title: "Identities", sequence: 5 },
      { code: "3.6", title: "Cubic Identities", sequence: 6 },
      { code: "3.7", title: "Factorisation", sequence: 7 },
      { code: "3.8", title: "Linear Equation in One Variable", sequence: 8 },
      { code: "3.9", title: "Graph", sequence: 9 },
      { code: "3.10", title: "Linear Graph", sequence: 10 },
    ],
  },
  {
    code: "4",
    title: "Life Mathematics",
    sequence: 4,
    topics: [
      { code: "4.1", title: "Introduction", sequence: 1 },
      { code: "4.2", title: "Applications of Percentage in Word Problems", sequence: 2 },
      { code: "4.3", title: "Profit, Loss, Discount, Overhead Expenses and GST", sequence: 3 },
      { code: "4.4", title: "Compound Interest", sequence: 4 },
      { code: "4.5", title: "Compound Variation", sequence: 5 },
      { code: "4.6", title: "Time and Work", sequence: 6 },
    ],
  },
  {
    code: "5",
    title: "Geometry",
    sequence: 5,
    topics: [
      { code: "5.1", title: "Introduction", sequence: 1 },
      { code: "5.2", title: "Congruent and Similar Shapes", sequence: 2 },
      { code: "5.3", title: "The Pythagoras Theorem", sequence: 3 },
      { code: "5.4", title: "Converse of Pythagoras Theorem", sequence: 4 },
      { code: "5.5", title: "Point of Concurrency", sequence: 5 },
      { code: "5.6", title: "Medians of a Triangle", sequence: 6 },
      { code: "5.7", title: "Altitude of a Triangle", sequence: 7 },
      { code: "5.8", title: "Perpendicular Bisectors of a Triangle", sequence: 8 },
      { code: "5.9", title: "Angle Bisectors of a Triangle", sequence: 9 },
      { code: "5.10", title: "Construction of Quadrilaterals", sequence: 10 },
      { code: "5.11", title: "Construction of Trapeziums", sequence: 11 },
      { code: "5.12", title: "Construction of Special Quadrilaterals", sequence: 12 },
      { code: "5.13", title: "Construction of a Parallelogram", sequence: 13 },
      { code: "5.14", title: "Construction of a Rhombus", sequence: 14 },
      { code: "5.15", title: "Construction of a Rectangle", sequence: 15 },
      { code: "5.16", title: "Construction of a Square", sequence: 16 },
    ],
  },
  {
    code: "6",
    title: "Statistics",
    sequence: 6,
    topics: [
      { code: "6.1", title: "Introduction", sequence: 1 },
      { code: "6.2", title: "Frequency Distribution Table", sequence: 2 },
      { code: "6.3", title: "Graphical Representation of the Frequency Distribution for Ungrouped Data", sequence: 3 },
      { code: "6.4", title: "Graphical Representation of the Frequency Distribution for Grouped Data", sequence: 4 },
    ],
  },
  {
    code: "7",
    title: "Information Processing",
    sequence: 7,
    topics: [
      { code: "7.1", title: "Introduction", sequence: 1 },
      { code: "7.2", title: "Principles of Counting", sequence: 2 },
      { code: "7.3", title: "SET - Game", sequence: 3 },
      { code: "7.4", title: "Map Colouring", sequence: 4 },
      { code: "7.5", title: "Fibonacci Numbers", sequence: 5 },
      { code: "7.6", title: "Highest Common Factor", sequence: 6 },
      { code: "7.7", title: "Cryptology", sequence: 7 },
      { code: "7.8", title: "Shopping Comparison", sequence: 8 },
      { code: "7.9", title: "Packing", sequence: 9 },
    ],
  },
];

export interface SeedCurriculumInput {
  organizationSlug?: string;
}

export interface SeedCurriculumSummary {
  organizationId: string;
  classId: string;
  subjectId: string;
  boardId: string;
  mediumId: string;
  syllabusId: string;
  syllabusVersionId: string;
  curriculumStructureId: string;
  chapterCount: number;
  topicCount: number;
}

function assertDevelopmentMode() {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== "development") {
    throw new Error(
      `Development curriculum seed requires NODE_ENV=development (current: ${nodeEnv ?? "<unset>"}). Refusing to run.`
    );
  }
}

class MissingDevFixtureError extends Error {}

export async function seedCurriculumTnStd8Maths(
  input: SeedCurriculumInput = {}
): Promise<SeedCurriculumSummary> {
  assertDevelopmentMode();

  const organizationSlug = input.organizationSlug ?? DEFAULT_ORGANIZATION_SLUG;

  // 1. Locate the existing development organization/class/subject. This seed
  // never creates these — they belong to scripts/seed-dev-student.ts.
  const orgResult = await pool.query(`SELECT id FROM organizations WHERE slug = $1 LIMIT 1`, [organizationSlug]);
  if (orgResult.rows.length === 0) {
    throw new MissingDevFixtureError(
      `Organization with slug "${organizationSlug}" was not found. Run "npm run db:seed:dev" before seeding the curriculum.`
    );
  }
  const organizationId: string = orgResult.rows[0].id;

  const classResult = await pool.query(
    `SELECT id FROM classes
     WHERE organization_id = $1 AND lower(name) = lower($2) AND COALESCE(section, '') = COALESCE($3, '')
     LIMIT 1`,
    [organizationId, CLASS_NAME, CLASS_SECTION]
  );
  if (classResult.rows.length === 0) {
    throw new MissingDevFixtureError(
      `Class "${CLASS_NAME} / Section ${CLASS_SECTION}" was not found for organization "${organizationSlug}". Run "npm run db:seed:dev" before seeding the curriculum.`
    );
  }
  const classId: string = classResult.rows[0].id;

  const subjectResult = await pool.query(
    `SELECT id FROM subjects WHERE organization_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [organizationId, SUBJECT_NAME]
  );
  if (subjectResult.rows.length === 0) {
    throw new MissingDevFixtureError(
      `Subject "${SUBJECT_NAME}" was not found for organization "${organizationSlug}". Run "npm run db:seed:dev" before seeding the curriculum.`
    );
  }
  const subjectId: string = subjectResult.rows[0].id;

  const classSubjectResult = await pool.query(
    `SELECT 1 FROM class_subjects WHERE organization_id = $1 AND class_id = $2 AND subject_id = $3 LIMIT 1`,
    [organizationId, classId, subjectId]
  );
  if (classSubjectResult.rows.length === 0) {
    throw new MissingDevFixtureError(
      `Subject "${SUBJECT_NAME}" is not linked to class "${CLASS_NAME} / Section ${CLASS_SECTION}" via class_subjects. Run "npm run db:seed:dev" before seeding the curriculum.`
    );
  }

  // 2. Locate the existing reference data seeded by migration 014 (boards, mediums).
  const boardResult = await pool.query(`SELECT id FROM boards WHERE lower(name) = lower($1) LIMIT 1`, [BOARD_NAME]);
  if (boardResult.rows.length === 0) {
    throw new Error(`Board "${BOARD_NAME}" was not found. Run database migrations before seeding the curriculum.`);
  }
  const boardId: string = boardResult.rows[0].id;

  const mediumResult = await pool.query(`SELECT id FROM mediums WHERE lower(name) = lower($1) LIMIT 1`, [MEDIUM_NAME]);
  if (mediumResult.rows.length === 0) {
    throw new Error(`Medium "${MEDIUM_NAME}" was not found. Run database migrations before seeding the curriculum.`);
  }
  const mediumId: string = mediumResult.rows[0].id;

  // 3. Find-or-create the syllabus / syllabus version / curriculum structure
  // that anchor the Grade 8 Mathematics chapter tree to this class.
  let syllabusId: string;
  const syllabusLookup = await pool.query(
    `SELECT id FROM syllabi WHERE class_id = $1 AND board_id = $2 AND medium_id = $3 AND lower(code) = lower($4) LIMIT 1`,
    [classId, boardId, mediumId, SYLLABUS_CODE]
  );
  if (syllabusLookup.rows.length > 0) {
    syllabusId = syllabusLookup.rows[0].id;
  } else {
    const inserted = await pool.query(
      `INSERT INTO syllabi (class_id, board_id, medium_id, name, code, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
       RETURNING id`,
      [classId, boardId, mediumId, SYLLABUS_NAME, SYLLABUS_CODE]
    );
    syllabusId = inserted.rows[0].id;
  }

  let syllabusVersionId: string;
  const versionLookup = await pool.query(
    `SELECT id FROM syllabus_versions WHERE syllabus_id = $1 AND lower(version) = lower($2) LIMIT 1`,
    [syllabusId, SYLLABUS_VERSION]
  );
  if (versionLookup.rows.length > 0) {
    syllabusVersionId = versionLookup.rows[0].id;
  } else {
    const inserted = await pool.query(
      `INSERT INTO syllabus_versions (syllabus_id, version, status)
       VALUES ($1, $2, 'ACTIVE')
       RETURNING id`,
      [syllabusId, SYLLABUS_VERSION]
    );
    syllabusVersionId = inserted.rows[0].id;
  }

  let curriculumStructureId: string;
  const structureLookup = await pool.query(
    `SELECT id, subject_id FROM curriculum_structures
     WHERE syllabus_version_id = $1 AND structure_kind = $2 AND lower(name) = lower($3)
     LIMIT 1`,
    [syllabusVersionId, STRUCTURE_KIND, STRUCTURE_NAME]
  );
  if (structureLookup.rows.length > 0) {
    curriculumStructureId = structureLookup.rows[0].id;
    if (structureLookup.rows[0].subject_id !== subjectId) {
      await pool.query(`UPDATE curriculum_structures SET subject_id = $2, updated_at = NOW() WHERE id = $1`, [
        curriculumStructureId,
        subjectId,
      ]);
    }
  } else {
    const inserted = await pool.query(
      `INSERT INTO curriculum_structures (syllabus_version_id, structure_kind, name, subject_id, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       RETURNING id`,
      [syllabusVersionId, STRUCTURE_KIND, STRUCTURE_NAME, subjectId]
    );
    curriculumStructureId = inserted.rows[0].id;
  }

  // 4. Resolve the canonical CHAPTER / TOPIC node types (seeded by migration 015).
  const chapterTypeResult = await chaptersRepository.getNodeTypeIdByCode("CHAPTER");
  if (chapterTypeResult.rows.length === 0) {
    throw new Error('The "CHAPTER" curriculum node type was not found. Run database migrations before seeding the curriculum.');
  }
  const chapterTypeId: string = chapterTypeResult.rows[0].id;

  const topicTypeResult = await chaptersRepository.getNodeTypeIdByCode("TOPIC");
  if (topicTypeResult.rows.length === 0) {
    throw new Error('The "TOPIC" curriculum node type was not found. Run database migrations before seeding the curriculum.');
  }
  const topicTypeId: string = topicTypeResult.rows[0].id;

  // 5. Find-or-create each chapter node and its topic nodes, using the same
  // repository helpers the chapters/topics API uses for lookups and inserts.
  let topicCount = 0;
  for (const chapter of CHAPTERS) {
    let chapterNodeId: string;
    const existingChapter = await chaptersRepository.findChapterByTitle(curriculumStructureId, chapter.title);
    if (existingChapter.rows.length > 0) {
      chapterNodeId = existingChapter.rows[0].id;
      await pool.query(
        `UPDATE curriculum_nodes SET code = $2, sequence_number = $3, status = 'ACTIVE', updated_at = NOW() WHERE id = $1`,
        [chapterNodeId, chapter.code, chapter.sequence]
      );
    } else {
      const created = await chaptersRepository.createNode({
        curriculumStructureId,
        parentNodeId: null,
        nodeTypeId: chapterTypeId,
        title: chapter.title,
        code: chapter.code,
        sequenceNumber: chapter.sequence,
      });
      chapterNodeId = created.rows[0].id;
    }

    for (const topic of chapter.topics) {
      const existingTopic = await chaptersRepository.findTopicByTitle(chapterNodeId, topic.title);
      if (existingTopic.rows.length > 0) {
        await pool.query(
          `UPDATE curriculum_nodes SET code = $2, sequence_number = $3, status = 'ACTIVE', updated_at = NOW() WHERE id = $1`,
          [existingTopic.rows[0].id, topic.code, topic.sequence]
        );
      } else {
        await chaptersRepository.createNode({
          curriculumStructureId,
          parentNodeId: chapterNodeId,
          nodeTypeId: topicTypeId,
          title: topic.title,
          code: topic.code,
          sequenceNumber: topic.sequence,
        });
      }
      topicCount += 1;
    }
  }

  return {
    organizationId,
    classId,
    subjectId,
    boardId,
    mediumId,
    syllabusId,
    syllabusVersionId,
    curriculumStructureId,
    chapterCount: CHAPTERS.length,
    topicCount,
  };
}

function printSummary(summary: SeedCurriculumSummary) {
  console.log("Curriculum seed complete: Tamil Nadu State Board / English Medium / Standard 8 / Mathematics.");
  console.log(`  Organization ID:          ${summary.organizationId}`);
  console.log(`  Class ID:                 ${summary.classId}`);
  console.log(`  Subject ID:               ${summary.subjectId}`);
  console.log(`  Curriculum structure ID:  ${summary.curriculumStructureId}`);
  console.log(`  Chapters seeded:          ${summary.chapterCount}`);
  console.log(`  Topics seeded:            ${summary.topicCount}`);
}

async function main() {
  try {
    assertDevelopmentMode();
    const summary = await seedCurriculumTnStd8Maths({
      organizationSlug: process.env.DEV_ORGANIZATION_SLUG,
    });
    printSummary(summary);
  } catch (error) {
    console.error("Curriculum seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const thisPath = fileURLToPath(import.meta.url);
const isDirectRun = invokedPath !== "" && thisPath.toLowerCase() === invokedPath.toLowerCase();

if (isDirectRun) {
  void main();
}
