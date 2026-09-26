---
name: frontend-design
description: Build and modify AI Teacher frontend UI consistently with the project's DESIGN.md, existing React components, accessibility requirements, and responsive behavior.
---

# AI Teacher Frontend Design

## Purpose

Use this skill for frontend UI development and modification in the AI Teacher project.

## Before changing UI

1. Read the root DESIGN.md.
2. Inspect existing components before creating new components.
3. Identify reusable components and existing UI patterns.
4. Check existing frontend tests and stable selectors.
5. Do not invent a new visual pattern when an existing pattern can be reused.

## Design rules

- Follow DESIGN.md.
- Preserve the existing AI Teacher visual language.
- Reuse existing components whenever possible.
- Do not introduce arbitrary colors.
- Do not introduce arbitrary spacing.
- Do not introduce arbitrary typography.
- Keep interaction patterns consistent.
- Maintain responsive behavior.
- Maintain accessibility.
- Preserve existing API behavior unless the requested change requires an API change.

## Implementation

- Prefer small, reusable React components.
- Keep component responsibilities clear.
- Follow existing TypeScript conventions.
- Follow existing Tailwind conventions.
- Avoid unnecessary dependencies.
- Do not rewrite unrelated components.

## Testing

For UI changes:

1. Run the relevant frontend unit tests.
2. Run frontend typecheck.
3. Run the relevant Playwright E2E test when applicable.
4. E2E tests must be run using the project's headed command.
5. Report any test that could not be executed and why.

## Scope

Do not invent product requirements.

Follow:

- AGENTS.md
- DESIGN.md
- frozen Master Backlog
- applicable locked PO decisions

If the requested UI behavior is unclear or conflicts with those sources, ask for clarification instead of guessing.