---
description: Run focused tests, regression suites, typecheck, build, and headed frontend E2E for a user story
---

# Stage: TEST

Verify user story `$1` by running the project's real test stacks and reporting exact
results. This stage runs checks and reports evidence. It does not change product code to
make a check pass.

## 0. Load the shared rules first

Read `.opencode/ai-workflow-rules.md` and follow it for this entire stage. It is the
single source of truth for the test command reference, the headed-E2E rule, protected
pre-existing work, and reporting requirements.

Load the `testing` skill from `.opencode/skills/`.

## 1. Determine the scope under test

Identify what `$1` actually changed, from the working tree and `git status`:

```
git status --porcelain=v1
git diff --stat
```

Decide which packages are in scope — backend, frontend, or both. Do not assume. If
nothing appears changed, say so and ask whether to test an already-committed state.

Never reset, clean, stash, or checkout pre-existing modifications to get a clean tree.

## 2. Focused tests first

Start with the smallest tests that exercise the changed behavior.

```
cd backend; npx vitest run <path>
cd frontend; npx vitest run <path>
```

Run the story's new tests individually so a failure is attributable.

## 3. Relevant regression suites

Then run the regression suites for the affected package or feature — every existing suite
that covers the touched contracts, including the completed stories immediately preceding
this one.

```
cd backend; npm test
cd frontend; npm test
```

Do not broaden the test scope into unrelated product behavior.

## 4. Typecheck and build

```
cd backend; npx tsc --noEmit
cd frontend; npm run typecheck
cd frontend; npm run build
```

`backend/package.json` has no `typecheck` script. Do not add one.

## 5. Frontend E2E — headed is mandatory

If E2E is requested or applicable to `$1`, run:

```
cd frontend; npm run test:e2e:headed
```

**A headless `npm run test:e2e` run is not a substitute.** It must never be reported as
satisfying an E2E requirement. If headed E2E cannot run, report that it did not run and
why.

Use the existing Playwright setup and stable accessible selectors. Do not add a test
framework.

## 6. Tenant, security, and persistence coverage

Where the acceptance criteria involve schema, tenant constraints, transactions, or
cross-repository behavior, real PostgreSQL-backed coverage is required. Do not substitute
an in-memory double that changes the risk being tested.

Confirm tests prove both allowed and denied access for authentication, organization
isolation, and resource ownership.

## 7. Report exact results — never hide a failure

Report:

- Every exact command run, verbatim, in order.
- Exact counts: test files and tests, passed and failed.
- For each failure: the test name, the assertion, and the reason. A failure is a
  **failure**, not a note.
- Explicitly distinguish **passed**, **failed**, **skipped**, and **unavailable**.
- Typecheck and build results.
- Headed E2E result, or a clear statement that it did not run and why.
- Any contamination disclosure — for example, suites that import
  `backend/src/server.ts` exercise the uncommitted working tree rather than `HEAD`.

Never hide, skip, weaken, or bypass a failure. Never weaken an authentication,
authorization, tenant, or ownership check to make a test pass. Never rewrite an existing
test merely to match an unapproved implementation.

If a required check could not be performed, **stop and report the reason**. Do not claim
verification that did not happen.

If anything failed, the story is **not verified**. Say so plainly.
