---
name: testing
description: Verify AI Teacher behavior with the repository's backend and frontend test stacks, focused tests, regression coverage, and real headed browser E2E checks.
---

# Testing

## Use this skill for

Any change that needs verification, especially backend APIs, database behavior, frontend behavior, authentication, tenant boundaries, and AI flows.

## Test stack

- Backend unit and integration tests use Vitest; HTTP behavior uses Supertest.
- Tests that exercise persistence, constraints, or real query behavior must use PostgreSQL-backed integration coverage where the story requires it.
- Frontend unit/component tests use Vitest with the existing test setup.
- Browser E2E tests use Playwright.
- Frontend E2E verification is mandatory in headed mode. Run `npm run test:e2e:headed`; do not substitute a headless run for that verification.
- Run the relevant package typecheck (`backend` TypeScript checks and/or frontend `typecheck`) for the code being changed.

## Implementation agents SHOULD

- Start with the smallest focused test that exercises the changed behavior, then run the appropriate regression suite for the affected package or feature.
- Test the actual acceptance criteria and observable API/UI behavior, including success, validation failure, authorization failure, and important edge cases.
- Cover authentication, organization/tenant isolation, and resource ownership with tests that prove both allowed and denied access.
- Use real PostgreSQL-backed tests when schema, tenant constraints, transactions, or cross-repository behavior are part of the acceptance criteria. Do not replace them with an in-memory substitute that changes the risk being tested.
- For frontend work, run frontend unit tests, typecheck, and relevant Playwright E2E. Use stable accessible selectors and the existing E2E setup.
- Treat a frontend test that mocks the API as evidence of frontend behavior only. It is not proof that the backend contract or PostgreSQL integration works; add backend/integration coverage for that boundary.
- Report the exact commands run and distinguish skipped, unavailable, or failed checks from passing checks.

## Implementation agents MUST NOT

- Must not claim a change is verified solely because unit tests or mocked E2E tests pass.
- Must not run frontend E2E only headless when the task requires E2E verification; headed execution is mandatory.
- Must not weaken authentication, authorization, tenant, or ownership checks to make a test easier.
- Must not broaden the test scope into unrelated product behavior or rewrite tests merely to match an unapproved implementation.
- Must not add a new test framework or assert undocumented API behavior instead of the approved acceptance criteria.

## Completion check

Confirm focused tests, the relevant regression suite, typecheck, and headed E2E (where applicable) were actually run. Stop and report the reason if the environment prevents a required check.
