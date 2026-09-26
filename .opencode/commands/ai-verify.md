---
description: Perform final verification of a user story — scope, acceptance criteria, tests, typecheck, build, regression, and git integrity
---

# Stage: VERIFY

Perform final verification of user story `$1` and produce a concise completion report.
This stage verifies and reports. It does not change product code to make a check pass.

Repository state at invocation:

!`git rev-parse --short HEAD; git log --oneline -5; git status --porcelain=v1; git diff --cached --stat; git diff --stat`

## 0. Load the shared rules first

Read `.opencode/ai-workflow-rules.md` and follow it for this entire stage. It is the
single source of truth for the frozen Master Backlog, PO decision handling, the Epic 10
rules, protected pre-existing work, the test command reference, the headed-E2E rule, and
reporting requirements.

## 1. Verify scope — every changed path

Enumerate every changed path from the git output above and account for each one:

- Is it authorized by the approved plan for `$1`?
- Is it inside the stated implementation boundary?
- Is it a completed-story file that the plan explicitly justified?

Any path that is **not** accounted for is an unauthorized change. Report it as a blocking
finding.

Confirm the following are untouched:

- Application source outside the approved boundary
- `backend/migrations/` — no new migration, no edit to an applied migration
- Tests outside the approved test files
- The Master Backlog
- `Docs/*PO_Decisions*`
- `frontend/`, when the story is backend-only
- Protected pre-existing work (see the shared rules)
- Existing agents and skills in `.opencode/`

## 2. Verify acceptance criteria against the governing PO documentation

Resolve `$1` from Master Backlog **Section B** only, and check Section F for a Draft 1.0 /
Draft 2.0 ID collision.

Take the acceptance criteria from the governing locked PO decision records in `Docs/`,
**not** from the Master Backlog.

For every criterion, state one of:

- **Met** — and name the test or evidence that proves it
- **Not met** — blocking
- **Not covered** — no test exists; blocking for a completed claim
- **Blocked by a missing PO decision** — report the exact gap; invent nothing

If the story touches Epic 10, explicitly confirm the Decision #14 topic-performance
formula is unaltered, that progress and performance remain separate concepts, and that no
new score, mastery value, or classification was introduced.

## 3. Verify tests, typecheck, and build

Run the checks, or confirm from `/ai-test` output that they were actually run. Do not
accept a claim of passing without evidence in this session.

```
cd backend; npm test
cd backend; npx tsc --noEmit
cd frontend; npm test
cd frontend; npm run typecheck
cd frontend; npm run build
cd frontend; npm run test:e2e:headed
```

Headed E2E is mandatory whenever E2E is applicable. A headless run is not a substitute.

## 4. Verify regression status

Confirm the completed-story suites that cover the touched contracts are green, and that no
existing test was weakened, skipped, or rewritten to accommodate the change.

Report exact counts: test files and tests, passed and failed.

## 5. Verify git integrity

- Every changed path is authorized.
- No protected pre-existing modification was altered, staged, reset, cleaned, stashed, or
  checked out.
- No unrelated file is staged.
- No commit contains unrelated work.
- If a commit was made, its file list contains only approved paths.

## 6. Completion verdict

The verdict must be **exactly one** of:

- **VERIFIED** — scope respected, every acceptance criterion met and covered, all required
  tests/typecheck/build/headed E2E passed, regression green, git integrity confirmed.
- **NOT VERIFIED** — anything failed, was skipped, was unavailable, or is unaccounted for.

**Never declare success if something failed.** Never report a skipped or unavailable check
as passing. Never claim a check passed without having run it or having direct evidence
from this session.

## 7. Concise completion report

Keep it short and factual:

1. Story, Epic, and governing PO decisions.
2. Files created and files modified.
3. Acceptance criteria: met / not met / not covered.
4. Exact commands run and exact results.
5. Regression status.
6. Git status and the commit hash if one exists.
7. Any deviation, contamination, or outstanding risk.
8. Final verdict: `VERIFIED` or `NOT VERIFIED`.

If the verdict is `NOT VERIFIED`, state exactly what is required to reach `VERIFIED`.
