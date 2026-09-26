---
description: Plan implementation for a Master Backlog user story against locked PO decisions, then stop for human approval
agent: plan
---

# Stage: PLAN

Plan the implementation of user story `$1` for the AI Teacher project. Produce a plan
only. Do not write, modify, or delete any project file.

## 0. Load the shared rules first

Read `.opencode/ai-workflow-rules.md` and follow it for this entire stage. It is the
single source of truth for the frozen Master Backlog, story resolution, PO decision
handling, the Epic 10 rules, protected pre-existing work, test commands, and stop
conditions.

## 1. Validate the story argument

If `$1` is empty, malformed, or is not a `US-###` identifier, STOP and ask for a valid
story ID. Do not guess which story is meant.

## 2. Resolve the story against Master Backlog Section B only

Read `SECTION B — FINAL 16-EPIC MASTER BACKLOG` in
`AI_Teacher_16_Epic_Master_PO_User_Story_Backlog_Draft_2.0_FINAL_CONSOLIDATED.txt`.

Report the resolved row: Epic, US ID, Story Title, Status, Notes.

If the story is retired (`US-037`–`US-041`, `US-042`–`US-046`, `US-084`), STOP. Retired
IDs are permanent and are never reused.

### Always check the Draft 1.0 / Draft 2.0 ID collision

Also search `SECTION F — DRAFT 1.0 → DRAFT 2.0 TRACEABILITY` for the same `US-###`.

If it appears there, the same numeric ID denotes a **different** Draft 1.0 story. State
the collision explicitly in your output, show both entries, and confirm that resolution
came from Section B. Never reconcile the collision yourself — if the two entries imply
different work, STOP and ask the PO.

Do not resolve a story from a bare repo-wide grep; it will return Section F matches too.

### Establish current state correctly

`SECTION D — CURRENT IMPLEMENTATION STATUS` is **stale and historical**. Never use it to
determine what is implemented, and never attempt to update it. Use the locked PO
decision records plus `git log` and the working tree instead.

## 3. Load the governing PO decisions

Do not hardcode filenames. List `Docs/` and read every `*PO_Decisions*` file whose header
names the resolved Epic, plus any addendum in that directory that post-dates it.

Also read:

- `AGENTS.md` — project instructions
- `backend/.github/copilot-instructions.md` — backend conventions
- `DESIGN.md` — **only** if the story has frontend scope
- `SECTION E — CROSS-EPIC BOUNDARIES` and `SECTION G.1`/`G.2` of the Master Backlog

Load the relevant project skill(s) from `.opencode/skills/`:
`ai-teacher-development`, `backend-development`, `database-migrations`,
`frontend-design`, `testing`.

If the story touches Epic 10 signals, apply section 5 of the shared rules, including the
authoritative Decision #14 topic-performance formula, verbatim and unaltered.

If the story touches any of the five open `SECTION G.2` reconciliation items, STOP and
ask the PO.

## 4. Inspect the real existing implementation

This step is mandatory and must precede any proposal.

- Trace the actual live call graph and data flow. Name real functions and files.
- Read the existing production code, not just filenames, and do not rely on prior plans.
- Identify the existing patterns, utilities, module layout, and naming conventions in the
  area the story would touch.
- Identify existing tests that already cover the contracts in question.
- Identify the smallest additive seam that satisfies the story.

State explicitly whether the current context/contract is already sufficient or whether a
new field, module, migration, route, or persistence column is genuinely required. Do not
assume any of these are necessary — justify each one.

## 5. Classify the gap

Classify every finding into exactly one category:

- **A — already-authoritative structured context** (exists; consume it)
- **B — existing policy/prompt/convention behavior** (exists; do not duplicate it)
- **C — genuinely missing behavior** (the story's real gap)
- **D — would require a new PO decision** (out of scope; stop and ask)

## 6. Produce the plan

The plan must contain:

1. Executive summary.
2. Locked PO decision traceability — cite each governing decision by number and file.
3. Current implementation findings, with `file:line` evidence.
4. Current call chain / architecture, traced rather than inferred.
5. Gap analysis using the A/B/C/D classification.
6. Proposed implementation boundary — the smallest change that satisfies the story.
7. Exact production files to be created or modified.
8. Exact test files to be created.
9. Files explicitly forbidden from modification.
10. Whether migrations are required, and why.
11. Whether frontend changes are required, and why.
12. Whether any completed-story file must be modified. If yes, give the exact reason, why
    an additive seam is insufficient, the exact smallest change, the backward-compatibility
    argument, and the affected existing tests.
13. Test strategy — the minimum tests that prove the story.
14. Regression strategy — which existing suites must stay green.
15. Git contamination analysis — baseline `HEAD`, staged/unstaged/untracked paths, the
    previous story's commit boundary, and any file that could be accidentally
    contaminated.
16. PO decision gaps, if any.
17. Final readiness verdict.

## 7. Protect pre-existing work

Establish the git baseline (`git rev-parse HEAD`, `git status --porcelain=v1`,
`git diff --cached --name-only`) and record it. Identify pre-existing uncommitted
work and list it as protected. Never reset, clean, stash, or checkout anything.

## 8. STOP FOR HUMAN APPROVAL

End with a readiness verdict that is **exactly one** of:

- `READY FOR BUILD` — then give the exact bounded implementation plan.
- `BLOCKED` — then identify the exact missing PO or product decision, explain why the
  existing locked decisions do not determine the behavior, and invent nothing.

Do not begin implementation. Do not create or modify any project file. Wait for explicit
human approval.
