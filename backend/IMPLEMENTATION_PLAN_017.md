# Phase #017 Implementation Plan — Curriculum Data Configuration

## 1. Objective

Add a data/configuration and loading layer for official curriculum data for Tamil
Nadu State Board, CBSE, and ICSE while preserving the generic #014–#016
architecture. The first business use case remains TN State Board → CBSE
curriculum mapping. #017 does not perform gap analysis or AI processing.

The design must represent:

```text
Board
  → Curriculum Version
      → Syllabus / Syllabus Version
          → Structure (official syllabus or textbook)
              → Flexible Nodes
                  → Typed Learning Elements
                      → Knowledge / Competency mappings
```

Academic Year, Examination Year, Curriculum Version, Syllabus, and Syllabus
Version remain distinct records.

## 2. Existing implementation and schema to preserve

### Existing migrations

- `014_create_curriculum_foundation.sql`
  - `boards`
  - `mediums`
  - `syllabi`
  - `syllabus_versions`
  - existing class/organization ownership through `syllabi.class_id`
- `015_create_curriculum_architecture.sql`
  - `curriculum_node_types`
  - `curriculum_structures`
  - `curriculum_nodes`
  - `learning_element_types`
  - `learning_elements`
  - `knowledge_items`
  - prerequisite/problem-type/mapping tables
  - target pathway and mapping-profile tables
- `016_enforce_curriculum_relationship_integrity.sql`
  - same-structure curriculum parent composite foreign key
  - same-version pathway-stage composite foreign key

Do not edit migrations 014, 015, or 016. Migration 017 must be additive and
must preserve all existing routes, response shapes, authorization, and data.

### Existing code conventions

Continue the existing Express route → service → repository → typed input
pattern. Reuse `getClassForUser`, `resolveOrganizationContext`, existing
management roles, PostgreSQL UUIDs, parameterized queries, migration runner
ordering, and Vitest integration-test conventions.

## 3. Proposed migration 017 schema

Create `migrations/017_create_curriculum_data_configuration.sql`.

### 3.1 New tables

1. **`languages`** — global language reference catalog, separate from
   `mediums`; fields: `id`, unique normalized `code`, `name`, `status`,
   timestamps.
2. **`academic_years`** — global academic-period catalog; fields: `id`,
   `code`, `name`, `start_date`, `end_date`, `status`, metadata, timestamps.
   A year such as 2026–27 is not inferred from a syllabus version string.
3. **`examination_years`** — global examination-period catalog; fields: `id`,
   `code`, `name`, `year_value`, `status`, metadata, timestamps. Examination
   year is independent of academic year.
4. **`curriculum_versions`** — global/reference board curriculum releases;
   fields: `id`, `board_id`, `academic_year_id` nullable,
   `examination_year_id` nullable, `version`, `effective_from`,
   `effective_to`, `status`, source/reference metadata, timestamps.
   Add a uniqueness rule for `(board_id, normalized version)` and indexes for
   board/status/effective dates.
5. **`curriculum_reference_datasets`** — global immutable/importable official
   data packages; fields: `id`, `curriculum_version_id`, `dataset_code`,
   `dataset_version`, `source_name`, `source_uri` or citation metadata,
   `checksum`, `loaded_at`, `status` (`DRAFT`, `VALIDATED`, `PUBLISHED`,
   `RETIRED`), metadata, timestamps. Uniqueness must make a dataset release
   idempotent by curriculum version, dataset code, and dataset version.
6. **`syllabus_languages`** — explicit syllabus-to-language relationship;
   fields: `syllabus_id`, `language_id`, `language_role` (for example
   `PRIMARY`, `SECONDARY`, `CONTENT`), timestamps, and a composite primary
   key. This keeps `syllabi.medium_id` as medium of instruction rather than
   treating it as language.

### 3.2 Additive columns/constraints on existing tables

Add nullable foreign keys and indexes only where required:

- `syllabus_versions.curriculum_version_id` → `curriculum_versions.id`
  (nullable for backward compatibility).
- Add a composite uniqueness key on `curriculum_versions` such as
  `(id, board_id)` and a matching composite foreign key from
  `(syllabi.board_id, syllabus_versions.curriculum_version_id)` is not
  possible directly because `syllabus_versions` does not store `board_id`.
  Therefore migration 017 must add a nullable `board_id` to
  `syllabus_versions`, backfill it transactionally from `syllabi.board_id`,
  add a consistency check/FK for `syllabus_versions.board_id` →
  `syllabi(board_id)` only if the existing schema can support the required
  composite parent key, and add a composite FK
  `(curriculum_version_id, board_id)` →
  `curriculum_versions(id, board_id)`. Existing rows that cannot be
  deterministically backfilled must abort the migration rather than be
  guessed.
- The service must always validate that the syllabus board and curriculum
  version board match before linking or updating a syllabus version. This is
  required in addition to the database constraint for clear domain errors and
  for deployments where the legacy schema cannot accept the composite FK
  without a compatibility column. No API may accept a curriculum version from
  another board.
- `curriculum_structures.reference_dataset_id` →
  `curriculum_reference_datasets.id` (nullable).
- `syllabus_versions.source_reference_dataset_id` →
  `curriculum_reference_datasets.id` (nullable), recording the exact published
  release used for tenant materialization.
- `curriculum_structures.structure_key` — stable loader identity key, required
  for reference structures and nullable only for legacy/tenant rows.
- `curriculum_nodes.node_key` — stable loader identity key, required for
  reference nodes and nullable only for legacy/tenant rows.
- `learning_elements.element_key` — stable loader identity key, required for
  reference elements and nullable only for legacy/tenant rows.
- Add a scope check to `curriculum_structures` so a structure is either:
  - tenant-derived: `syllabus_version_id` populated and
    `reference_dataset_id` null; or
  - global/reference: `reference_dataset_id` populated and
    `syllabus_version_id` null.
- Add database uniqueness:
  - `curriculum_reference_datasets (curriculum_version_id, dataset_code,
   dataset_version)`;
  - `curriculum_structures (reference_dataset_id, structure_key)` for
   reference structures;
  - `curriculum_nodes (curriculum_structure_id, node_key)` for reference
   nodes;
  - `learning_elements (curriculum_node_id, element_key)` for reference
   elements.
  These are real columns and unique constraints/indexes, not JSON metadata.
  Partial unique indexes may be used so nullable legacy/tenant keys do not
  create collisions.

The migration must first report/stop on incompatible existing rows before
adding any check or constraint. Existing #015 rows with a syllabus version must
remain valid. No `organization_id` is added to official/reference tables.

### 3.3 Existing tables reused

- `boards` — official board catalog, including TN State Board, CBSE, and ICSE.
- `mediums` — medium of instruction only.
- `syllabi` — class/board/medium tenant syllabus records.
- `syllabus_versions` — tenant syllabus snapshots, optionally linked to the
  distinct global `curriculum_versions` record.
- `curriculum_structures` and `curriculum_nodes` — both official reference
  structures and tenant-derived structures, distinguished by the new scope
  relationship rather than node metadata.
- `curriculum_node_types`, `learning_element_types`, `learning_elements`,
  `knowledge_items`, prerequisite/problem-type tables, and
  `curriculum_node_knowledge_items`.
- Target pathway/version/stage/requirement and mapping-profile tables for
  future pathway use; #017 does not populate detailed JEE, NEET, NID, or TNPSC
  data.
- Existing `classes`, `organization_members`, teacher assignments, and student
  enrollments for tenant authorization.

Do not create board-specific database tables.

## 4. Ownership and authorization

### Global/reference data

The following remain global/shared and have no `organization_id`:

- `boards`, `mediums`, `languages`
- `academic_years`, `examination_years`
- `curriculum_versions`
- `curriculum_reference_datasets`
- `curriculum_node_types`, `learning_element_types`
- published reference `curriculum_structures`, `curriculum_nodes`,
  `learning_elements`, and their knowledge mappings when linked through
  `reference_dataset_id`
- `knowledge_items` and focused knowledge relationships
- target pathway reference tables

Authenticated users may read published reference data where appropriate.
Creation, publication, replacement, and retirement require the existing
administrative role policy (`SCHOOL_ADMIN` or `COACHING_ADMIN`) or a future
explicitly approved system-admin mechanism. Ordinary teachers/students cannot
write global data.

### Tenant-owned data

The following remain tenant-derived through the existing class/syllabus chain:

- `syllabi`
- `syllabus_versions` and their tenant customizations
- structures linked to `syllabus_version_id`
- nodes, learning elements, and node-knowledge mappings under those structures
- tenant mapping profiles

For reads and writes, resolve the syllabus version/structure to its owning
class and call the existing `getClassForUser` authorization flow. Never trust a
client-supplied organization header without resolving the underlying resource.
Mapping-profile creation must authorize the source syllabus and, for
`CURRICULUM`, the target syllabus; listing must remain organization/resource
scoped. Reference pathway data remains global.

Tenant customization of official data is represented by copying/materializing a
published reference dataset into a tenant syllabus version and then editing
tenant-owned structures/nodes. The published reference rows are never updated
by tenant operations. The tenant version retains
`source_reference_dataset_id`, so provenance identifies the exact source
release without making tenant rows global or reference-owned.

## 5. Board/version consistency, dataset immutability, and provenance

### Board ↔ curriculum version ↔ syllabus

The canonical consistency rule is:

```text
syllabi.board_id
    ↓
syllabus_versions.curriculum_version_id
    ↓
curriculum_versions.board_id
```

A syllabus version may link only to a curriculum version whose `board_id`
matches the owning `syllabi.board_id`. Migration 017 must add the supporting
database keys without modifying 014–016: add a nullable compatibility
`board_id` column to `syllabus_versions`, backfill it only from the owning
syllabus, add a unique key on `(id, board_id)` to `curriculum_versions`, and
add a composite foreign key
`(curriculum_version_id, board_id)` →
`curriculum_versions(id, board_id)`. The migration must also enforce that the
version's compatibility board remains equal to its syllabus board, using a
safe composite key/FK arrangement where PostgreSQL permits it.

If inspection proves that a direct composite FK to `syllabi` cannot be added
without changing #014 semantics, the required enforcement is transactional:
the service must lock/read the syllabus version and owning syllabus, verify
`syllabi.board_id = curriculum_versions.board_id`, and perform the link in the
same transaction. The implementation must document this deviation and must
not rely on an unchecked client-provided board ID. In either path, an attempt
to attach a CBSE curriculum version to a Tamil Nadu syllabus is rejected before
the link is persisted.

The same validation applies when materializing a reference dataset: the
dataset's `curriculum_version.board_id` must match the tenant syllabus's
`syllabi.board_id`. A TN State Board dataset cannot be materialized into a CBSE
syllabus, and vice versa.

### Reference dataset release lifecycle

The lifecycle is for a dataset release, not mutable curriculum content:

```text
DRAFT → VALIDATED → PUBLISHED → RETIRED
```

- `DRAFT`: metadata/configuration may be assembled but is not usable as
  official published content.
- `VALIDATED`: the complete payload passed structural, relationship, source,
  and identity validation.
- `PUBLISHED`: the release is immutable curriculum content and is readable for
  authorized use.
- `RETIRED`: the historical release remains readable for historical references
  but is no longer selected for new materialization.

After publication:

- curriculum structures, nodes, learning elements, mappings, and other
  content-bearing rows must never be silently mutated;
- corrections require a new `dataset_version`/release with a new checksum and
  provenance;
- all historical published and retired releases remain readable;
- tenant operations can copy/materialize published content but can never update
  or delete the published reference rows.

Only non-content operational metadata may change after publication, such as
`status` for retirement, audit timestamps, publication actor/time, or an
administrative correction to provenance metadata that does not alter source
identity or curriculum meaning. Any source, checksum, identity-key, hierarchy,
node, element, knowledge mapping, or curriculum meaning change requires a new
release. Database/service write paths must reject content updates when the
dataset is `PUBLISHED` or `RETIRED`.

Immutability must not depend only on route authorization. Migration 017 must
add database enforcement, preferably trigger functions on
`curriculum_reference_datasets`, `curriculum_structures`, `curriculum_nodes`,
`learning_elements`, and reference mapping rows. The triggers reject
content-bearing UPDATE/DELETE operations when the owning dataset is
`PUBLISHED` or `RETIRED`; only the documented lifecycle/status and explicitly
non-content audit metadata may change. Services must perform the same status
check inside the load/publication transaction, so direct SQL and API paths
both preserve the invariant. A correction creates a new dataset release and
new content rows; the old release remains readable.

Materialization copies the published structures, nodes, elements, mappings, and
their stable keys into tenant-owned rows under the destination syllabus
version, writes `source_reference_dataset_id` to that tenant
`syllabus_versions` row, and validates that the dataset board equals the
destination syllabus board. Subsequent tenant edits use existing tenant
authorization and cannot update the source rows. Provenance remains available
for audit, comparison, and later rematerialization from a newer release.

## 6. Configuration and loading design

### Board modules

Add configuration-only modules:

```text
src/modules/curriculum/config/
src/modules/curriculum/tn-state-board/
src/modules/curriculum/cbse/
src/modules/curriculum/icse/
```

Each board module exports typed configuration/adapters only:

- board code and supported metadata
- supported academic/examination-year references
- language/medium declarations
- node-type sequences and validation rules
- official structure descriptors
- typed learning-element declarations
- source identifiers and dataset version

No module creates board-specific tables, hard-codes a universal hierarchy, or
assumes TN State Board always has three terms. TERM is a configured node type
and is emitted only when the source data declares it. A board/class may use
`UNIT → CHAPTER → SECTION`, `THEME → TOPIC → SUBTOPIC`, `CHAPTER → SECTION`,
or another validated hierarchy.

### Loader pipeline

Implement a deterministic synchronous loader service, not an autonomous job:

1. Parse typed board configuration.
2. Validate the board, years, curriculum version, language/medium references,
   structure descriptors, node types, parent references, sequence values,
   element types, and knowledge references.
3. Run in transaction with a dry-run/validation mode.
4. Upsert global catalog/version/dataset records using the real database
   identity columns and unique constraints described below.
5. Upsert reference structures, nodes, learning elements, and mappings scoped
   to the dataset using those identity keys.
6. Mark the dataset `VALIDATED` only after all checks pass; allow explicit
   publication to `PUBLISHED`.
7. Never delete rows during a re-run. Retire or supersede a prior dataset
   release explicitly.

Stable loader keys are real columns, not metadata-only values:

- `curriculum_reference_datasets`:
  `UNIQUE(curriculum_version_id, dataset_code, dataset_version)`;
- reference `curriculum_structures`: `UNIQUE(reference_dataset_id,
  structure_key)`;
- reference `curriculum_nodes`: `UNIQUE(curriculum_structure_id, node_key)`;
- reference `learning_elements`: `UNIQUE(curriculum_node_id, element_key)`;
- knowledge items continue to use their existing stable `code` uniqueness.

Use normalized case-insensitive unique indexes where the existing column types
permit and `ON CONFLICT` upserts against these keys. Existing official rows
must be checked for conflicting ownership/source metadata rather than silently
overwritten. A changed payload with the same published identity must fail and
require a new dataset release.

`dataset_code`, `dataset_version`, `structure_key`, `node_key`, and
`element_key` are persistent columns added by migration 017, not values hidden
in `reference_metadata` or node metadata. The loader resolves every upsert
through the corresponding database uniqueness key. `knowledge_items.code` is
the existing persistent stable knowledge identifier and remains globally unique
when present; missing knowledge codes are invalid for imported reference
mappings.

## 7. Validation rules

Validate before persistence and again through database constraints where
possible:

- referenced board, medium, language, academic year, examination year, and
  curriculum version exist and are active;
- academic and examination date/value formats are valid;
- curriculum version belongs to the declared board;
- syllabus medium and syllabus language are separate valid references;
- structure kind is `SYLLABUS` or `TEXTBOOK`;
- a dataset structure has exactly one reference scope;
- node keys are unique within a structure/dataset;
- parent nodes exist in the same structure, with #016 composite integrity
  preserved;
- no cycles, self-parenting, or duplicate sequence conflicts where the
  configuration disallows them;
- TERM is optional and configurable;
- node types and learning-element types are active and known;
- learning elements remain separate from structural nodes;
- knowledge item codes resolve to global knowledge records;
- prerequisite graphs remain non-self-referential and use the existing focused
  relationship table;
- imported mappings do not cross datasets accidentally;
- re-running the same dataset is idempotent;
- invalid or conflicting data fails the transaction and leaves prior published
  data unchanged.

Questions, exercises, solutions, assessment records, and schedules remain
outside structural configuration even when a learning element is labelled
`EXERCISE` or `PRACTICE`.

## 8. APIs and module structure

Add only protected configuration APIs; preserve all #014 endpoint contracts.

### Reference/configuration APIs

- `GET /api/curriculum/languages`
- `GET /api/curriculum/academic-years`
- `GET /api/curriculum/examination-years`
- `GET /api/curriculum/versions?board_id=...`
- `GET /api/curriculum/reference-datasets`
- `GET /api/curriculum/reference-datasets/:id`
- `POST /api/curriculum/reference-datasets/validate` — admin only, dry-run
- `POST /api/curriculum/reference-datasets/load` — admin only, transactional
- `POST /api/curriculum/reference-datasets/:id/publish` — admin only

Reference listing must expose only published/authorized states as appropriate.
Loader endpoints must not accept arbitrary SQL or unvalidated executable
configuration.

### Tenant configuration APIs

Reuse existing syllabus/version/structure/node/learning-element routes, adding
only the minimum endpoints needed to:

- attach a tenant syllabus version to a `curriculum_version`;
- list published reference datasets available for a board/version;
- materialize a selected official dataset into an authorized tenant syllabus;
- manage tenant syllabus languages.

All tenant operations resolve ownership through the existing curriculum service
authorization flow. Keep `src/server.ts` limited to router registration.

Suggested new modules:

```text
src/modules/curriculum/config/
  types.ts
  validation.ts
  repository.ts
  service.ts
  loader.ts
src/modules/curriculum/tn-state-board/
  configuration.ts
src/modules/curriculum/cbse/
  configuration.ts
src/modules/curriculum/icse/
  configuration.ts
```

## 9. Seed/reference-data strategy

Migration 017 may seed only small, stable reference catalogs needed by the
loader (languages and any missing generic configuration values), using
case-insensitive idempotent upserts. It must not seed detailed board
curricula or hard-code TN State Board term counts.

Official curriculum data should be supplied as versioned TypeScript
configuration fixtures or validated import payloads under the board modules.
#017 must not become a full official syllabus ingestion project. Use only small
representative fixtures:

- Tamil Nadu State Board: representative Class 8 Mathematics data;
- CBSE: representative Class 9 Mathematics data.

The fixtures must be large enough to prove flexible hierarchy, optional TERM,
medium/language separation, separate syllabus/textbook structures, typed
learning elements, knowledge mappings, dataset versioning, validation,
idempotent loading, publication lifecycle, tenant materialization, and
readiness for the future TN State Board → CBSE mapping. They must not attempt
to reproduce either board's complete official curriculum.

ICSE, JEE, NEET, and TNPSC adapters remain extension points only; no detailed
future pathway content is loaded in #017.

Source citation, source version, checksum, approval/publication status, and
load timestamp must be retained for provenance and future PDF/OCR/RAG
integration.

Representative fixtures are the only curriculum content loaded in #017:
separate Tamil Nadu State Board and CBSE datasets with enough Class 8
Mathematics / Class 9 Mathematics data to exercise the complete loader,
publication, materialization, and future TN State Board → CBSE readiness.
They are not full official syllabus imports.

## 10. Migration and rollout safety

1. Confirm migrations 014–016 are recorded and unchanged.
2. Inspect existing rows before adding scope checks or foreign keys.
3. Abort with a clear report if any existing structure/version relationship is
   incompatible; do not delete or silently rewrite data.
4. Apply one additive migration 017 transactionally through the existing runner.
5. Backfill only nullable links that can be derived deterministically; leave
   ambiguous links null for explicit configuration.
6. Load and publish reference datasets only after validation succeeds.
7. Keep prior dataset releases and syllabus versions readable for historical
   records; use status/effective dates for future selection.

## 11. Automated tests

Extend the existing academic test suite with coverage for:

- migration 017 tables, columns, foreign keys, indexes, and scope checks;
- distinct academic year and examination year records;
- curriculum version belonging to a board;
- separate medium and language relationships;
- optional TERM and multiple configurable hierarchy shapes;
- official syllabus and textbook structures coexisting as separate reference
  structures;
- tenant-derived structures remaining class/organization scoped;
- published reference data being readable without cross-tenant leakage;
- unauthorized global write rejection and authorized administrative writes;
- loader validation failures for unknown references, duplicate keys, invalid
  parents, cycles, invalid element types, and broken knowledge mappings;
- idempotent re-running of the same dataset;
- conflicting dataset/version detection without destructive cleanup;
- publish/retire lifecycle and historical version coexistence;
- published reference content cannot be updated or deleted in place, while a
  corrected new dataset release coexists with the previous release;
- loading the exact same dataset twice creates no duplicate reference
  structures, nodes, or learning elements;
- conflicting source/version/checksum identity is rejected rather than
  silently overwritten;
- attaching a curriculum version from a different board is rejected by the
  database or transactional service validation;
- materialization records the exact `source_reference_dataset_id`, preserves
  source immutability, and allows independent tenant edits;
- TN State Board and CBSE datasets remaining separate and usable for the
  future TN State Board → CBSE mapping;
- representative fixture scope only: TN State Board Class 8 Mathematics and
  CBSE Class 9 Mathematics, with no full-board import;
- board/version/syllabus mismatch rejection at both service and database
  levels;
- published dataset content immutability, correction through a new release,
  historical readability, and tenant inability to mutate reference rows;
- no detailed JEE/NEET/NID/TNPSC curriculum being loaded;
- regression coverage for all #014 routes, authorization, onboarding, and
  existing #015/#016 integrity behavior.

## 12. Explicitly out of scope

- AI gap analysis or curriculum-gap calculation
- student mastery, mastery-gap calculation, or adaptive learning
- bridge-learning generation
- RAG, embeddings, PDF ingestion, OCR, or document extraction
- question banks, exercise engines, solution engines, scoring, assessments, or
  examination scheduling
- detailed JEE, NEET, NID, or TNPSC curriculum/pathway data
- billing, subscriptions, usage charging, coaching management, frontend, or
  Android
- background job infrastructure, workflow/agent frameworks, or a new tenant
  model
- changing or rewriting migrations 014, 015, or 016
- board-specific database tables

## 13. Definition of done

After approval, implement only migration 017, the configuration/loader modules,
minimal APIs, and tests described here. Run the targeted and full existing test
suite, `npx tsc --noEmit`, and the migration runner. Verify that #014–#016
behavior remains intact, no cross-tenant reference is possible, repeated loads
are idempotent, and no unrelated files are changed. Do not commit or push
without separate approval.
