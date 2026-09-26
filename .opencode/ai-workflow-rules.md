# AI Teacher — OpenCode Development Workflow Rules

Single source of truth for the `/ai-plan`, `/ai-build`, `/ai-test`, `/ai-review`, and
`/ai-verify` commands.

**This file is intentionally NOT inside `.opencode/commands/`.** Every Markdown file in
that directory is discovered by OpenCode as a command, which would register a phantom
`/ai-workflow-rules` command. Each command body instructs the agent to read this file
first.

This file defines process and governance only. It defines no product behavior, no
acceptance criteria, and no formula. Those come from the frozen Master Backlog and the
locked PO decision records listed below.

---

## 1. Authoritative source map

Read from the repository root. Do not assume these filenames — verify with a directory
listing if a path is missing.

| Purpose | Path |
|---|---|
| Master Backlog (FROZEN) | `AI_Teacher_16_Epic_Master_PO_User_Story_Backlog_Draft_2.0_FINAL_CONSOLIDATED.txt` |
| Project instructions | `AGENTS.md` |
| UI/UX design authority (frontend only) | `DESIGN.md` |
| Backend workspace instructions | `backend/.github/copilot-instructions.md` |
| Architecture reference | `backend/docs/AI_Teacher_Project_Architecture.docx.docx` (binary; do not parse as text) |
| Implementation-control records | `backend/IMPLEMENTATION_PLAN_015.md`, `backend/IMPLEMENTATION_PLAN_017.md` |
| PO decisions — Epic 12 | `Docs/AI_Teacher_Backend_Epic12_PO_Decisions_1-106_LOCKED.txt.txt` and the `…_107-115_…`, `…_116-118_…`, `…_119_…` addenda |
| PO decisions — Epic 10 | `Docs/Backend_Epic_10_PO_Decision_Sheet.txt` |

**Discover PO decision files dynamically.** Do not hardcode a filename list. List
`Docs/` and read every `*PO_Decisions*` file whose header names the resolved Epic. A new
addendum may be added at any time.

### Project skills (`.opencode/skills/`)

`ai-teacher-development`, `backend-development`, `database-migrations`, `frontend-design`,
`testing` — load the relevant skill when its domain applies.

### Project review subagents (`.opencode/agents/`)

All are `mode: subagent` and read-only.

`ai-reviewer`, `backend-reviewer`, `database-reviewer`, `frontend-reviewer`,
`integration-reviewer`, `planner`, `po-compliance-reviewer`, `security-reviewer`,
`test-reviewer`

---

## 2. Frozen Master Backlog

The Master Backlog is **FROZEN**. `SECTION G.3 — Freeze status` states:

> **IMPLEMENTATION BASELINE FROZEN.**

Binding rules:

1. Never modify the Master Backlog file.
2. Never invent a user story.
3. Never rewrite an existing user story, title, status, or Epic assignment.
4. Never change approved acceptance criteria without explicit PO approval.
5. Preserve existing Epic and user-story numbering.
6. Retired IDs are **permanent and must never be reused**: `US-037`–`US-041`,
   `US-042`–`US-046`, `US-084`.
7. New scope is introduced as a **new Epic**. Never silently widen an existing story.
8. Never replace an approved PO decision with an implementation preference.
9. Do not make architectural changes for convenience.
10. Inspect the existing implementation before writing new code. Prefer existing
    patterns, utilities, and module conventions over new ones.

### Section D is stale

`SECTION D — CURRENT IMPLEMENTATION STATUS` is historical. It records Epic 8 only and
claims `Epic 9–16 | NOT YET IMPLEMENTED BY THIS BASELINE`, which no longer reflects the
repository.

- Treat Section D as **historical context only**.
- Never attempt to update it. The backlog is frozen.
- Establish the current state of a story from the locked PO decision records and from
  `git log` / the working tree — never from Section D.

---

## 3. Story resolution procedure

### 3.1 Resolve against Section B only

`SECTION B — FINAL 16-EPIC MASTER BACKLOG` is the only authoritative story table. Its
columns are:

```
| Epic | US ID | Story Title | Status | Notes |
```

A story is valid only if its `US-###` appears in Section B.

### 3.2 Detect the Draft 1.0 / Draft 2.0 ID collision — ALWAYS REPORT IT

`SECTION F — DRAFT 1.0 → DRAFT 2.0 TRACEABILITY` reuses the same numeric IDs for
**different** stories. Known example: Draft 1.0 `US-123` is `AI revision assistance`
(merged to `US-126`), while Draft 2.0 `US-123` is `Explain concepts step-by-step`.

For every resolved story:

1. Check whether the same `US-###` also appears in Section F.
2. If it does, state the collision explicitly in the output and state which table the
   resolution came from.
3. Never merge, reconcile, or resolve the collision yourself. If the two entries imply
   genuinely different work, stop and ask the PO.

A repo-wide grep for `US-###` is NOT sufficient — it will return Section F matches too.
Always disambiguate by section.

### 3.3 Other Master Backlog sections

| Section | Use |
|---|---|
| `SECTION C — FINAL NUMBERING MATRIX` | Cross-check numbering only |
| `SECTION E — CROSS-EPIC BOUNDARIES` | **Enforce** the owner/consumer boundaries before touching a domain |
| `SECTION G.1` | Binding ownership decisions |
| `SECTION G.2` | Five **open, non-blocking** PO reconciliation items — see 3.4 |
| `SECTION H.1` | Implementation order; confirms which Epic is the current step |
| `SECTION H.6` / `H.7` | Test and frontend contracts |

### 3.4 Open PO reconciliation items — do not silently resolve

`SECTION G.2` lists five explicitly open, non-blocking items. No implementation may invent
a resolution without explicit PO approval:

1. **Teacher Workspace** — seven Draft 1.0 stories with no dedicated Epic.
2. **Epic 2 `US-020` vs `US-022`** — overlapping curriculum structure management.
3. **Epic 2 `US-023` vs `US-024`** — overlapping curriculum-structure/subject association.
4. **Epic 2 `US-017`/`US-018`** — manage vs read-only for boards/mediums.
5. **Draft 1.0 `US-030`/`US-035`/`US-036`** — admin profile / active enrollment /
   enrollment history subsumption.

If a story's scope touches one of these, stop and ask the PO.

### 3.5 Acceptance criteria are NOT in the Master Backlog

Section B has no acceptance-criteria column. For backend Epic 12 the governing criteria
live in the `Docs/AI_Teacher_Backend_Epic12_PO_Decisions_*` records. Always cite the
governing PO document when stating or checking acceptance criteria. Never present a
Master Backlog row as if it contained acceptance criteria.

---

## 4. PO decision handling

1. Existing locked PO decisions are **authoritative**.
2. Never reinterpret, extend, weaken, or "improve" a locked decision.
3. Never invent a missing PO decision, threshold, formula, or classification.
4. If a locked decision is ambiguous, incomplete, or conflicts with another locked
   decision, **STOP and ask the PO**. Report the exact conflict with citations.
5. A missing decision is a `BLOCKED` outcome, not an implementation opportunity.
6. Distinguish clearly between:
   - **A — already-authoritative structured context** (exists and is authoritative)
   - **B — existing prompt/policy/convention behavior** (exists; do not duplicate)
   - **C — genuinely missing behavior** (the story's actual gap)
   - **D — would require a new PO decision** (out of scope; stop and ask)

---

## 5. Epic 10 protected rules

Epic 10 derived learning signals are authoritative. When a story touches progress,
performance, mastery, weak/strong topics, unfinished learning, or repeated mistakes:

### 5.1 Progress and performance are separate concepts

Verbatim from `Docs/Backend_Epic_10_PO_Decision_Sheet.txt`:

> Agreed: Progress and Performance are separate concepts.

Never merge them. Never compute one from the other.

### 5.2 Topic Performance formula — Decision #14, authoritative

Verbatim:

> **14. Topic Performance Formula**
> - Individual submitted-attempt performance =
>   Correct Answered Questions / Total Answered Questions x 100.
> - Only answered questions are included.
> - Unanswered questions do not count.

Do not alter, reinterpret, round differently, reweight, or replace this formula.

### 5.3 Multiple submitted attempts — Decision #15

> Topic Performance % = average of the performance percentages of all submitted attempts
> for practices belonging to that topic. Do not combine raw answer rows across attempts.

### 5.4 Parameters that must NOT be invented

The decision sheet states these are **NOT to be invented**:

- Strong-topic performance threshold → Decision #3
- Strong-topic minimum evidence
- Exact definition of expected available learning/practice coverage
- Mechanism for identifying conceptual errors
- Mastery threshold
- Minimum evidence for Mastery
- Any other formula or threshold not explicitly approved

Implementation principle, verbatim:

> AGREED CONCEPT → may be implemented.
> UNDEFINED PARAMETER → identify and stop for PO clarification.
> DO NOT GUESS.
> DO NOT INVENT.
> DO NOT MODIFY THE FROZEN MASTER BACKLOG.

### 5.5 Epic 10 consumption rules

- Consume existing Epic 10 output; never recalculate it.
- Never create a new score, understanding score, mastery score, step score, or
  classification.
- Never modify an Epic 10 formula.
- Never persist new derived mastery/weakness/strength data.

---

## 6. Project principles

1. The Master Backlog is frozen.
2. Do not invent or rewrite existing user stories.
3. New scope must be treated as a new Epic, never a silent widening of existing scope.
4. Backend and frontend Epic numbering must not be confused. Backend Epic 12 story
   numbering and frontend Epic 12 story numbering are distinct namespaces.
5. Existing PO decisions are authoritative.
6. Do not replace an approved PO decision with an implementation preference.
7. Do not make architectural changes merely for convenience.
8. Inspect the existing implementation before creating new code.
9. Prefer existing project patterns and utilities over new ones.
10. Do not declare a story complete merely because code was written.
11. Tests and verification are required.
12. Clearly report failures rather than hiding or bypassing them.

---

## 7. Protected pre-existing work

This repository routinely carries **uncommitted, unrelated work**. Treat it as untouchable.

**Never** reset, clean, stash, checkout, restore, overwrite, or otherwise alter
pre-existing modifications. Never stage them. Never use `git add .` or `git add -A`.

Always establish the baseline first:

```
git rev-parse HEAD
git status --porcelain=v1
git diff --cached --name-only
```

Currently known protected paths in this repository — confirm against live `git status`
rather than relying on this list alone:

- `AGENTS.md` (tracked, modified)
- `backend/src/server.ts` (tracked, modified)
- `backend/tests/academic/roster-security.test.ts` (untracked)
- `.kilo/` (untracked — plans and worktrees)
- `DESIGN.md` (untracked)
- `Docs/AI_Teacher_Backend_Epic12_PO_Decisions_*` (untracked)
- `.opencode/` (untracked)

**Important consequence:** several Epic 12 integration test suites import `createApp`
from `backend/src/server.ts`, which is uncommitted. Test results that depend on those
suites reflect the working tree, not `HEAD` alone. Disclose this when reporting
integration results.

### Staging discipline

Stage explicit paths only, one at a time:

```
git add <exact/path/one.ts> <exact/path/two.ts>
```

Never `git add .`, never `git add -A`, never `git commit -a`. Before committing, verify
that the staged set contains only authorized files:

```
git diff --cached --name-only
```

---

## 8. Test command reference

Use these exact discovered commands. Do not invent scripts.

### Backend

| Purpose | Command |
|---|---|
| Test suite | `cd backend; npm test` |
| Typecheck | `cd backend; npx tsc --noEmit` |
| Focused tests | `cd backend; npx vitest run <path>` |

`backend/package.json` has **no** `typecheck` script. Do not add one. Use
`npx tsc --noEmit`.

### Frontend

| Purpose | Command |
|---|---|
| Test suite | `cd frontend; npm test` |
| Typecheck | `cd frontend; npm run typecheck` |
| Build | `cd frontend; npm run build` |
| E2E (headless) | `cd frontend; npm run test:e2e` |
| **E2E (HEADED — required for verification)** | `cd frontend; npm run test:e2e:headed` |
| Focused tests | `cd frontend; npx vitest run <path>` |

### Headed E2E rule

Frontend browser/E2E verification **must run headed** whenever E2E is requested or
applicable. `npm run test:e2e:headed` is mandatory. A headless run is **not** a substitute
and must never be reported as satisfying an E2E requirement.

`frontend/playwright.config.ts` defines projects `chromium` and `mobile-chromium`, uses
`baseURL: http://localhost:5173`, and auto-starts the Vite dev server.

### Database

Backend integration tests are PostgreSQL-backed and require a reachable database. If the
environment prevents a required check, **stop and report the reason**. Never report an
unrun check as passing, and never substitute an in-memory double for a real
tenant/constraint test.

---

## 9. Stop conditions

STOP and ask the PO when any of these occur. Never guess.

- Requirements are ambiguous or conflicting.
- An approved PO decision would have to change.
- A missing PO decision would have to be invented.
- An existing API contract must change unexpectedly.
- An already-applied migration would have to be edited.
- A destructive database change appears necessary.
- Tenant isolation may be affected.
- Implementation requires out-of-scope functionality.
- A `SECTION G.2` open reconciliation item is touched.
- A Draft 1.0 / Draft 2.0 ID collision implies different work.
- The intended behavior cannot be determined confidently.
- A required test, typecheck, or headed E2E run cannot be performed.

---

## 10. Reporting requirements

Every stage must report **exact** results:

- Exact commands run, verbatim.
- Exact pass/fail counts (files and tests).
- Failures reported as failures. Never hide, skip, weaken, or bypass a failure.
- Distinguish **passed** from **skipped**, **unavailable**, and **failed**.
- List every file created and every file modified, with paths.
- Show `git status` output when git state is relevant.
- State any deviation from the approved plan explicitly.

Never declare a story complete when verification has failed. Never claim work is complete
without having actually run the verification.
