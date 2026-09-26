---
name: backend-development
description: Implement and maintain the AI Teacher Express 5 TypeScript backend using its ESM, route-service-repository, PostgreSQL, and tenant-safe conventions.
---

# Backend Development

## Use this skill for

Changes under `backend/`, including API routes, services, repositories, authentication, and backend integration points.

## Implementation agents SHOULD

- Treat `backend/` as an independent package: inspect its `package.json`, `tsconfig.json`, scripts, and module structure before changing it.
- Use the existing Express 5 + TypeScript + PostgreSQL stack and its NodeNext ESM conventions, including `.js` import specifiers where the existing modules use them.
- Follow the established `route → service → repository` boundary. Keep HTTP/auth/validation concerns in routes, business rules in services, and parameterized SQL in repositories.
- Reuse the existing organization resolver, authentication middleware, error payloads, and module patterns before adding a new abstraction.
- Require authentication and authorization for protected data. Resolve the caller's organization and role server-side, and verify student/resource ownership for every access.
- Scope PostgreSQL reads and writes by `organization_id` and use parameterized queries. Use `students_v2` as the canonical student identity; do not use the legacy `students` table for new academic features.
- Inspect existing API routes, types, callers, and tests before changing a contract. Preserve method, path, parameters, status codes, and response shapes unless an approved change requires otherwise.
- Return the project's established public error shape and safe client-facing messages. Keep diagnostics, stack traces, secrets, and provider details out of responses.
- Keep AI features behind the existing provider abstraction/factory and usage-tracking boundary. Services and repositories should not call a vendor SDK directly or hardcode credentials.

## Implementation agents MUST NOT

- Must not introduce a second backend architecture, CommonJS path, or unrelated dependency when the existing ESM structure suffices.
- Must not rely on client-supplied organization, role, or student ownership without server-side checks.
- Must not query the legacy `students` table for new academic behavior; use `students_v2` and its tenant-safe relationships.
- Must not silently change an API contract, authentication boundary, or error format.
- Must not expose internal database/provider errors, prompts, API keys, or cross-tenant data to clients.
- Must not bypass the AI provider abstraction or add uncontrolled provider calls outside the existing usage controls.
- Must not invent product behavior, stories, or database relationships; stop and ask when the requested scope is unclear or conflicts with the frozen PO.

## Verification

Inspect the affected route, service, repository, and tests. Verify authorization, tenant isolation, ownership, and preserved API behavior before reporting completion.
