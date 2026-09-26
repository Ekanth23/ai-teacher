---
description: Implement an already-approved plan for a user story, within the approved scope only
---

# Stage: BUILD

Implement user story `$1`. This stage **executes an approved plan only**. It never plans.

## 0. Load the shared rules first

Read `.opencode/ai-workflow-rules.md` and follow it for this entire stage. It is the
single source of truth for the frozen Master Backlog, PO decision handling, the Epic 10
rules, protected pre-existing work, test commands, and stop conditions.

## 1. Require an approved plan in this session

An approved `/ai-plan` output for `$1` must already exist in the current OpenCode
session.

If no approved plan is present in this session, **STOP and ask the user to run
`/ai-plan $1` first.** Do not plan and build in one step. Do not reconstruct a plan from
memory, from git history, or from an unrelated story's plan.

If the plan's readiness verdict was `BLOCKED`, you may not build. The blocking PO
decision must be resolved first.

## 2. Restate the approved scope and boundaries

Before editing anything, state:

- The exact files the approved plan says to create and modify.
- The exact files the approved plan forbids modifying.
- The locked PO decisions that govern the change.
- The focused tests the plan requires.

If implementation appears to require anything outside that list, **STOP** and report the
deviation instead of widening scope.

## 3. Establish the git baseline BEFORE any edit

Run and record:

```
git rev-parse HEAD
git status --porcelain=v1
git diff --cached --name-only
git diff --stat
```

Classify every pre-existing modification as **protected pre-existing work**.

Never run `git reset`, `git clean`, `git stash`, `git checkout --`, `git restore`, or any
other command that would alter pre-existing modifications. Never overwrite a protected
file. Never use `git add .`, `git add -A`, or `git commit -a`.

## 4. Implement only the approved scope

- Implement exactly what the approved plan specifies.
- Do not invent additional scope, modules, fields, routes, migrations, endpoints, or
  abstractions.
- Do not add a migration unless the approved plan explicitly requires one.
- Do not add persistence, a new AI context field, or a new dependency unless the plan
  approved it.
- Prefer extending an existing additive seam over creating a duplicate mechanism.
- Match the surrounding code's naming, structure, comment density, and style.
- Preserve every locked PO decision, including the Epic 10 Decision #14 topic-performance
  formula, exactly as written.
- Do not redesign, refactor, or "clean up" unrelated code or completed-story files.

### If you must touch a completed-story file

Only with an explicit reason from the approved plan. Make the smallest additive change,
preserve backward compatibility, and state which existing tests cover it. A
completed-story test may be modified only when an interface assertion necessarily
requires an audited additive-contract update — and that must be called out explicitly.

### Stop immediately if

- A locked PO decision would have to change.
- A missing PO decision would have to be invented.
- An already-applied migration would have to be edited.
- A destructive database change appears necessary.
- Tenant isolation may be affected.
- The story's scope turns out to require out-of-scope functionality.

Report the blocker. Invent nothing.

## 5. Run the focused tests

Run the focused tests named in the approved plan:

```
cd backend; npx vitest run <path>
```

Then run the typecheck for the package you changed:

```
cd backend; npx tsc --noEmit
cd frontend; npm run typecheck
cd frontend; npm run build
```

Do not add a `typecheck` script to `backend/package.json`. Use `npx tsc --noEmit`.

Run **headed** frontend E2E when the plan makes E2E applicable:

```
cd frontend; npm run test:e2e:headed
```

A headless run is never a substitute for required E2E verification.

## 6. Report the implementation result

Report exactly:

- Files created, with paths.
- Files modified, with paths.
- The exact test commands run, verbatim.
- The exact results: test files and test counts, pass and fail.
- Typecheck and build results.
- Any deviation from the approved plan, stated explicitly.
- Any pre-existing contamination you observed but did not touch.

Never hide, skip, weaken, or bypass a failure. Distinguish passed from skipped,
unavailable, and failed. If a required check could not run, say so and give the reason.

## 7. Do not commit

Do not create a commit. Do not stage files unless the user explicitly asks.

When staging is requested, stage **explicit paths only** and verify before committing:

```
git add <exact/path/one.ts> <exact/path/two.ts>
git diff --cached --name-only
```

Never use `git add .` or `git add -A`. Never stage a protected or unrelated file.

Leave the working tree for `/ai-test`, `/ai-review`, and `/ai-verify`.
