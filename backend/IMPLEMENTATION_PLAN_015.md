# #015 Implementation Plan

## Existing #014 foundation

Relevant existing tables:

- `boards` — source school-board catalog.
- `mediums` — medium of instruction, separate from subjects.
- `syllabi` — class, board, and medium association.
- `syllabus_versions` — versioned syllabus records.
- `classes`, `students_v2`, `teachers`, `student_enrollments`, and
  `class_teacher_assignments` — existing organization-scoped academic access.

Relevant files:

- `src/modules/curriculum/routes.ts`
- `src/modules/curriculum/service.ts`
- `src/modules/curriculum/repository.ts`
- `src/modules/curriculum/types.ts`
- `tests/academic/phase2-curriculum-foundation.test.ts`
- `migrations/014_create_curriculum_foundation.sql`

The existing route → service → repository → types pattern and authorization
checks will be reused. There are currently no curriculum nodes, knowledge
items, target pathways, or mapping profiles.

## Proposed #015 scope

Create one additive migration:

`migrations/015_create_curriculum_architecture.sql`

Do not modify migration 014 or change existing APIs/tables.

### Every proposed table

1. `curriculum_node_types` — configurable structural types such as
   `LEARNING_AREA`, `UNIT`, `THEME`, `MODULE`, `CHAPTER`, `SECTION`, `TOPIC`,
   `SUBTOPIC`, `TERM`, and `OTHER`.
2. `curriculum_structures` — lightweight containers distinguishing official
    syllabus structures from textbook structures, with `syllabus_version_id`
    nullable, `structure_kind` (`SYLLABUS` or `TEXTBOOK`), name,
    reference/version metadata, and status.
3. `curriculum_nodes` — structure-owned, self-referential hierarchy with
    `curriculum_structure_id`, `parent_node_id`, node type, title/name, code,
    sequence, description, metadata, and status. This supports separate
    syllabus and textbook trees without a fixed hierarchy or board-specific
    tables.
4. `learning_element_types` — configurable types such as example, activity,
    experiment, figure, reading, exercise, practice, project, and review.
5. `learning_elements` — typed learning/content elements associated with a
    curriculum or textbook node, while remaining separate from structural
    nodes.
6. `knowledge_items` — board-independent knowledge-layer records with a
    discriminating kind (`CONCEPT`, `SKILL`, `COMPETENCY`, or
    `LEARNING_OUTCOME`) and attributes for expected mastery, depth, complexity,
    difficulty, application level, and description.
7. `knowledge_item_prerequisites` — directed prerequisite relationships
    between independent knowledge items.
8. `knowledge_item_problem_types` — configurable problem/question-type
    associations for knowledge items.
9. `curriculum_node_knowledge_items` — explicit coverage/mapping from a
    curriculum node to a knowledge item, including coverage and depth metadata;
    it does not make knowledge items children of curriculum nodes.
10. `target_pathways` — generic destinations such as JEE, NEET, NID, or TNPSC;
    these are not rows in `boards`.
11. `target_pathway_versions` — versioned examination or transition definitions,
    distinct from academic and syllabus versions.
12. `target_pathway_stages` — optional, data-driven stages within a pathway
    version.
13. `target_pathway_requirements` — knowledge-item requirements attached to a
    pathway version or stage, including required mastery, depth, difficulty,
    application level, and problem/question type metadata.
14. `curriculum_mapping_profiles` — generic source-to-target profiles with:
    `source_syllabus_version_id`, nullable `target_syllabus_version_id`,
    nullable `target_pathway_version_id`, `target_type` (`CURRICULUM` or
    `PATHWAY`), status, and rules/configuration metadata. A database check
    constraint must enforce that exactly one target is selected and that it
    matches `target_type`.

    This supports both Source Curriculum → Target Curriculum and Source
    Curriculum → Target Pathway:

    - TN State Board → CBSE uses `target_syllabus_version_id`.
    - ICSE → JEE uses `target_pathway_version_id`.
    - CBSE → NEET uses `target_pathway_version_id`.
    - TN State Board → TNPSC Group I uses `target_pathway_version_id`.

    TN State Board → CBSE is the first real business mapping, but no mapping is
    hard-coded.

No exercise/question bank, assessment, examination schedule, student mastery,
gap result, or bridge-course tables are proposed in #015.

### Source → Knowledge → Target separation

- Source curriculum is represented by existing `boards`, `syllabi`,
  `syllabus_versions`, and the new `curriculum_structures` and
  `curriculum_nodes`.
- Knowledge/competency is represented independently by `knowledge_items`,
  `knowledge_item_prerequisites`, and `knowledge_item_problem_types`.
  The separate relationships are:
  - `curriculum_node` → `knowledge_item` through
    `curriculum_node_knowledge_items`;
  - `target_pathway_requirement` → `knowledge_item` through
    `target_pathway_requirements`;
  - `knowledge_item` → prerequisite `knowledge_item` through
    `knowledge_item_prerequisites`.
- Target preparation is represented by `target_pathways`,
  `target_pathway_versions`, `target_pathway_stages`, and
  `target_pathway_requirements`.
- A mapping profile connects a source syllabus/version to exactly one target
  syllabus/version or pathway/version; it does not merge those domains.
- No generic `knowledge_item_relationships` table is proposed; prerequisite
  relationships remain focused in `knowledge_item_prerequisites`.

The future analytical flow remains:

```text
Source Curriculum
    ↓
Knowledge / Competency
    ↓
Target Curriculum / Target Pathway
    ↓
Curriculum Gap
    ↓
Student Mastery
    ↓
Student Mastery Gap
    ↓
Bridge Learning
```

`Curriculum Gap` will mean the difference between source coverage and target
requirements. `Student Mastery Gap` will mean the difference between what a
student has mastered and what the target requires. They are separate future
concepts and are not implemented or conflated in #015.

## Proposed code organization

Add small, typed modules following existing conventions:

```text
src/modules/curriculum/
  nodes/
  learning-elements/
  knowledge/
  config/
  tn-state-board/
  cbse/
  icse/
src/modules/pathways/
  jee/
  neet/
  nid/
  tnpsc/
```

The board directories contain configuration/rule adapters only; they do not
create board-specific tables. Future pathway directories remain extension
points and do not import detailed JEE, NEET, NID, or TNPSC curricula in #015.

Board configuration will be data-driven and version-aware. It will permit
optional terms and structures such as:

- UNIT → CHAPTER → SECTION
- THEME → TOPIC → SUBTOPIC
- CHAPTER → SECTION

Official syllabus and textbook structures will be distinguished by the
`curriculum_structures` container, with nodes referencing the appropriate
container rather than relying only on metadata.

## API and tests

Add only the minimum protected APIs needed to create/read structure- and
version-owned nodes, learning elements, knowledge items/mappings, target
curriculum/pathway metadata, and mapping profiles. Preserve all #014 routes and
response conventions. Enforce existing
organization authorization for class-owned syllabus data; shared reference and
pathway data must not become tenant-owned accidentally.

Add `tests/academic/phase3-curriculum-architecture.test.ts` covering:

- configurable node types and parent-child trees, including all three example
  hierarchies and optional TERM;
- separate medium and language-subject concepts;
- coexistence of syllabus versions and separate textbook structures;
- learning-element association without making elements structural nodes;
- independent concepts, skills, competencies, outcomes, prerequisites,
  mastery/depth/difficulty metadata, and problem types;
- independent source curriculum, target curriculum, and target pathway records;
- pathway versions/stages and TNPSC variants without board duplication;
- generic mapping profiles for TN → CBSE (target curriculum), ICSE → JEE,
  CBSE → NEET, and TN → TNPSC Group I (target pathways);
- tenant authorization and preservation of all #014 behavior.

## Explicit non-scope and risks

Do not implement detailed JEE, NEET, NID, or TNPSC curricula; AI gap analysis,
student mastery tracking or mastery-gap calculation, bridge-learning
generation, RAG, embeddings, PDF ingestion, OCR, question/exercise engines,
assessment scheduling engines, frontend, Android, billing, coaching
management, or business/delivery-channel tables.

Primary risks are over-constraining the hierarchy and accidentally coupling
shared reference data to an organization. The migration will therefore be
additive, use explicit foreign keys/indexes, keep versions immutable/coexistent,
and leave curriculum-vs-mastery analysis to later phases.

After approval: implement the migration/modules/tests, then run targeted tests
and `npx tsc --noEmit`. No commit or push is planned.
