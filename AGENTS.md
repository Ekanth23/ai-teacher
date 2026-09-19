# AGENTS.md

## Layout
- `/frontend` — React 18 + TypeScript 5 + Vite 5 + Tailwind 3 SPA
- `/backend` — Express 5 + TypeScript 7 + PostgreSQL REST API
- Independent `package.json`, `package-lock.json`, `tsconfig.json` in each
- No root-level `package.json`, no monorepo tooling (Turborepo/Nx/pnpm workspaces)
- Both packages use `"type": "module"` (ESM)

## Commands
All commands run from the respective package directory.

### Frontend (`/frontend`)
- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — tsc --noEmit && vite build
- `npm run typecheck` — tsc --noEmit
- `npm run test` — vitest run (unit tests)
- `npm run test:e2e` — playwright test (auto-starts Vite)

### Backend (`/backend`)
- `npm run dev` — tsx watch src/server.ts (port 3000)
- `npm run test` — vitest run
- `npm run db:seed:dev` — seed dev student
- `npm run db:seed:curriculum:tn-std8-maths` — seed Tamil Nadu std8 maths curriculum

## Verification order
Run from the package you changed:
1. `npm run typecheck` (frontend only; backend has no separate typecheck script)
2. `npm run test`

No linter or formatter is configured. The copilot-instructions.md mentions "Follow the project's configured formatter/linter" but none exists — do not add one without explicit request.

## Testing
- Frontend: Vitest + Testing Library (jsdom). 20 unit test files in `src/__tests__/`. Playwright for E2E (3 specs in `e2e/`).
- Backend: Vitest + Supertest. 54+ test files in `tests/` (academic: 41, AI: 7, auth: 6).
- Backend tests require a running PostgreSQL instance.
- Playwright config auto-starts Vite dev server against `http://localhost:5173`.

## Key facts
- Express 5 (`^5.2.1`) and TypeScript 7 (`^7.0.2`) — both are recent major versions with breaking changes from their predecessors
- 42 SQL migration files in `backend/migrations/` (001–042)
- AI providers: ollama (local), deepseek (API), mock — select via `AI_PROVIDER` env var
- No README exists anywhere in the repo
- No CI/CD workflows (no `.github/workflows/`)
- No pre-commit hooks
- `backend/.vscode/settings.json` contains a hardcoded API key — do not commit secrets

## Database safety
- `students` is a legacy table and must not be used for new academic-system features.
- `students_v2` is the canonical tenant-safe student table for current development.
- Before changing database code, inspect the relevant migrations and existing foreign-key relationships.
- Do not modify or remove legacy tables/migrations unless explicitly requested.

## Migration safety
- Never edit an existing migration that has already been applied.
- Create a new migration for schema changes.
- Preserve existing migration numbering and conventions.
- Verify affected backend tests after database changes.

## Development rule
- Prefer extending existing services, routes, utilities, and patterns before creating duplicates.
- Do not remove or rewrite working functionality to simplify an implementation.
- Before implementing a feature, inspect existing code and tests for related functionality.
- Keep changes scoped to the requested story/task.

## Existing instruction file
`backend/.github/copilot-instructions.md` (392 lines) covers product vision, architecture, roles, multi-tenancy, security, testing philosophy, git conventions, and development priorities. Reference it for architectural context rather than duplicating here.

## Environment
- Frontend: `.env.local` with `VITE_API_BASE_URL` (default `http://localhost:3000`)
- Backend: `.env` with PostgreSQL, JWT, AI provider config (see `.env.example` in each package)
- Never commit `.env` files or credentials
## Frontend Testability & Stable Selectors

For all new frontend implementation:

1. Prefer accessible semantic selectors first:
   - role
   - accessible name
   - label
   - heading
   - semantic HTML

2. Add stable `data-testid` attributes to important interactive
   elements when semantic selectors alone are insufficient.

3. Use deterministic selectors for dynamic/repeated elements.

4. Form controls must have proper label/input associations using
   `htmlFor`/`id` where applicable.

5. Do not add test IDs or IDs to every DOM element.

6. Do not use fragile selectors based on:
   - Tailwind/CSS classes
   - generated class names
   - DOM position
   - `nth-child`
   - deeply nested CSS selectors

7. Important user actions should have stable selectors, including
   where applicable:
   - navigation controls
   - primary buttons
   - forms
   - inputs
   - submit actions
   - practice/question controls
   - result actions
   - AI Teacher controls
   - dialogs/modals
   - error/retry actions

8. Dynamic entities should use deterministic selectors derived
   from their stable domain ID when appropriate.

9. Frontend E2E tests must use the same stable/semantic selectors
   rather than fragile DOM selectors.

10. Do not change unrelated completed frontend features merely to
    add selectors. Apply this requirement to new frontend work,
    and only fix existing selector gaps when a concrete
    testability or accessibility issue is identified.

11. Frontend tests must always be run HEADED.

12. Before reporting a frontend story as complete, verify that
    important interactive elements introduced by the story are
    testable using stable selectors.