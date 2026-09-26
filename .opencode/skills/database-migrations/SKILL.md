---
name: database-migrations
description: Safely design and validate AI Teacher PostgreSQL schema changes using the repository's raw SQL migration and ledger-runner conventions.
---

# Database Migrations

## Use this skill for

Schema changes, constraints, indexes, seed/reference-data changes, and migration tests under `backend/migrations/` or their validation tests.

## Implementation agents SHOULD

- Use raw PostgreSQL SQL in `backend/migrations/`, following the existing naming, formatting, and schema conventions.
- Inspect the current migrations and relevant table definitions before designing a change. The repository currently has an established sequence through migration `046` (with later files also present); confirm the actual next number and dependencies from the directory rather than assuming.
- Use the existing ledger-based runner (`backend/scripts/run-migrations.js`, backed by `schema_migrations`) and its transaction/rollback behavior. Never bypass or replace that runner with a new migration framework.
- Choose a migration number that preserves lexical execution order and does not conflict with existing files. List prerequisites explicitly in the migration and verify they exist in the schema.
- Design relationships from the actual tables and foreign keys. Preserve organization/tenant integrity, student ownership, and `students_v2` as the canonical student identity.
- Use appropriate foreign keys, composite constraints, checks, indexes, and partial/unique indexes to enforce invariants in PostgreSQL rather than relying only on service code.
- Consider transaction and atomicity boundaries for multi-statement changes. Ensure a failed migration cannot leave a partially applied schema or a misleading ledger entry.
- Make changes safe for existing production data: use compatible types, deliberate nullability/defaults, non-destructive transitions, and an explicit remediation/preflight path when data must be reconciled.
- Add or update focused migration tests and validate the migration against both an existing schema and a fresh database. Check re-running the runner is idempotent through the ledger.

## Implementation agents MUST NOT

- Must not edit, rename, or renumber an already-applied migration.
- Must not use Drizzle or another ORM migration system; this repository uses raw SQL migrations.
- Must not invent table names, columns, foreign-key relationships, curriculum IDs, or organization ownership without inspecting the existing schema and migrations.
- Must not drop or rewrite production data, weaken tenant isolation, or remove constraints/indexes without explicit approval and a safe migration strategy.
- Must not rely on a service-layer check when the database can enforce a required relationship or invariant.
- Must not mark a migration successful without testing it on a fresh database and on a database at the preceding migration state.

## Verification

Review the SQL, migration ordering, ledger entry behavior, constraints/indexes, and data-safety path. Run the relevant migration tests and fresh-database migration validation; report any validation that could not be run.
