---
description: Review an implementation against its story, acceptance criteria, locked PO decisions, architecture, and project conventions, read-only
agent: plan
---

# Stage: REVIEW

Review the implementation of user story `$1`. This stage is **read-only**. It reports
findings and changes nothing.

Repository state at invocation:

!`git rev-parse --short HEAD; git status --porcelain=v1; git diff --stat`

## 0. Load the shared rules first

Read `.opencode/ai-workflow-rules.md` and follow it for this entire stage. It is the
single source of truth for the frozen Master Backlog, story resolution, PO decision
handling, the Epic 10 rules, and protected pre-existing work.

## 1. Read-only guarantee

- Do **not** create, modify, delete, stage, commit, reset, clean, stash, or checkout any
  file.
- Do not "fix" anything you find. Report it.
- Do not run migrations or any command that mutates the database or the repository.

## 2. Establish the review baseline

From the git output above, identify:

- The current `HEAD`.
- Which changes belong to `$1` and which are pre-existing unrelated work.
- Any protected pre-existing modification that must be excluded from the review scope.

Do not attribute pre-existing contamination to this story.

## 3. Review criteria

Review the implementation against **all** of the following:

1. **The user story** — resolved from Master Backlog **Section B** only. Check Section F
   for a Draft 1.0 / Draft 2.0 ID collision and report it if present.
2. **Acceptance criteria** — taken from the governing locked PO decision records in
   `Docs/`, **not** from the Master Backlog, which has no acceptance-criteria column.
3. **Locked PO decisions** — every governing decision, cited by number and file. Flag any
   reinterpretation, weakening, or replacement of an approved decision by an
   implementation preference.
4. **Epic 10 rules** — if progress, performance, mastery, weak/strong topics, unfinished
   learning, or repeated mistakes are touched. Verify the Decision #14 topic-performance
   formula is unaltered, that progress and performance remain separate, and that no new
   score or classification was introduced.
5. **Architecture and conventions** — `AGENTS.md`,
   `backend/.github/copilot-instructions.md`, `DESIGN.md` for frontend, the module layout,
   and the existing patterns and utilities in the touched area.
6. **Scope discipline** — no unapproved scope, no silent widening, no invented PO
   decision, no opportunistic refactor of completed-story code.
7. **Database safety** — no edit to an already-applied migration, migration numbering
   preserved, tenant isolation preserved, no destructive change.
8. **Security** — authentication, authorization, ownership, and tenant isolation intact.
   Nothing weakened for testability.
9. **Tests** — acceptance criteria actually covered; regression risk to completed stories
   identified; no test weakened or rewritten to match an unapproved implementation.

## 4. Use the existing review subagents

All agents in `.opencode/agents/` are read-only `mode: subagent` agents. Spawn the ones
that fit the change, in parallel where independent:

- `backend-reviewer` — routes, services, repositories, auth, business logic
- `frontend-reviewer` — React, routing, API integration, `DESIGN.md`, accessibility
- `database-reviewer` — schema safety, tenant isolation, migration correctness
- `ai-reviewer` — AI conversation, student context, RAG, prompt construction, usage
- `integration-reviewer` — cross-layer contract mismatches
- `security-reviewer` — authn/authz, ownership, IDOR, privacy, AI data exposure
- `test-reviewer` — coverage, acceptance criteria, regression and reliability
- `po-compliance-reviewer` — frozen Master Backlog and locked PO decision compliance
- `planner` — use only if a re-plan is genuinely required to judge the change

Do not modify these agents. Do not create new agents.

## 5. Report findings

Classify every finding and give `file:line` evidence:

- **Scope violation** — work outside the approved story
- **PO violation** — a locked decision is reinterpreted, weakened, or replaced
- **Missing PO decision** — a required rule that does not exist; must not be invented
- **Defect** — incorrect behavior
- **Regression risk** — an existing contract or test that may break
- **Contract break** — an API, type, or provider-boundary change
- **Convention drift** — departure from established project patterns
- **Missing test** — an acceptance criterion with no coverage
- **Contamination** — unrelated or pre-existing work mixed into the change

Order findings by severity. State clearly which are blocking.

Also state explicitly what you checked and found **correct**, so the review is not read as
a blanket rejection.

Do not change any source code. If a fix is needed, describe it and let the human decide
whether to run `/ai-build` again.
