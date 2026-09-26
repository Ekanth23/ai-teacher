---
name: ai-teacher-development
description: Build curriculum-aware, tenant-safe AI Teacher features for the first release, including private student conversations, RAG, controlled usage, and Epic 10 learning semantics.
---

# AI Teacher Development

## Product boundary

AI Teacher is a curriculum-aware SaaS product. Phase 1 targets TN State Board Classes 6–10. RAG is required in the first release, not an optional later enhancement. Keep the implementation within the current approved story and preserve the frozen PO decisions.

## Implementation agents SHOULD

- Resolve the student's authoritative current enrollment and current class explicitly before constructing curriculum or AI context. Do not infer it from a stale label, client input, or conversation text when a server-side source exists.
- Designate the authoritative syllabus explicitly (including the correct board, class, medium, and relevant version) before retrieval or prompt use. Check existing curriculum records and relationships rather than guessing identifiers.
- Make RAG tenant-safe and curriculum-scoped: filter retrieval by the student's organization and the resolved authoritative curriculum scope. Do not retrieve another tenant's or another class/board's material.
- Preserve provenance for retrieved curriculum content, including the source/reference needed to audit or cite what informed an answer. Keep provenance server-side and available to the product without exposing internal identifiers to the provider.
- Send only minimum-necessary, provider-safe context. Project internal records into the existing model context shape, redact secrets and unnecessary personal data, and avoid sending internal database IDs, ownership records, or lookup identifiers unless the approved provider contract genuinely requires one.
- Keep AI conversations student-private. Enforce authentication, organization scope, conversation ownership, and appropriate role access on every read/write; do not rely on the UI to hide another student's conversation.
- Make AI usage measurable and controllable through the existing provider/usage boundary. Track usage by tenant/organization, student, feature, and model/provider as applicable, preserve required durable usage records, and respect existing plan/credit/usage limits.
- Reuse the existing AI provider abstraction, context resolver, prompt projection, and usage tracker. Keep provider calls out of routes and repositories.
- Keep Epic 10 learning-profile concepts distinct: progress describes learning/coverage state, while performance describes correctness/results. Use only the approved learning-profile fields and source data for the current story.
- Use the locked Epic 10 topic-performance formula exactly: `(correct answered questions / total answered questions) × 100`. Preserve the denominator, answered-only meaning, and existing threshold semantics.
- When a story is ambiguous, inspect the backlog, migrations, and existing implementation; ask before adding scope.

## Implementation agents MUST NOT

- Must not invent curriculum IDs, syllabus identifiers, subject mappings, class levels, or relationships. Verify them against the existing curriculum schema and data.
- Must not treat progress and performance as interchangeable or merge their APIs, metrics, labels, or calculations.
- Must not change, approximate, reinterpret, or replace the locked topic-performance formula.
- Must not send unfiltered, cross-tenant, cross-curriculum, or otherwise overbroad RAG results.
- Must not discard retrieved-content provenance or fabricate curriculum facts when retrieval is unavailable or inconclusive.
- Must not send unnecessary internal identifiers, credentials, secrets, or unrelated student data to an AI provider.
- Must not expose or reuse another student's private conversation without an approved, authorized flow.
- Must not introduce uncontrolled background AI calls, untracked provider usage, or provider-specific logic that bypasses existing limits.
- Must not silently pull future functionality or future-story behavior into the current implementation. If additional scope seems useful, stop and request explicit approval.

## Verification

For AI changes, verify tenant/student authorization, authoritative context resolution, curriculum-scoped retrieval and provenance, provider-safe projection, usage accounting/limits, and the exact current-story acceptance criteria. Add focused tests before running the appropriate regression suite.
