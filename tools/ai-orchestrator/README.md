# AI Teacher Development Orchestrator

**Stage: 2A — architecture and skeleton only.**

The Development Orchestrator is the local control layer between the human / ChatGPT
Product Owner and OpenCode. It sequences work, prepares context, enforces human
approval gates, invokes OpenCode through an adapter, collects normalized results,
guards git safety, and reports status.

> **Stage 2A does NOT execute OpenCode.**
> **Stage 2A does NOT modify the AI Teacher application.**
> **Stage 2A does NOT automatically approve plans.**
> **Stage 2A does NOT call external APIs.**
> **Stage 2A does NOT mutate git.**

---

## 1. Purpose

The orchestrator is **development automation infrastructure**. It is not part of the
AI Teacher product.

It exists to make a human-in-the-loop, PO-governed development workflow reliable
and auditable:

- resolve a story against the frozen Master Backlog;
- prepare a context package that **references** existing governance;
- move a run through an explicit state machine;
- stop at a human approval gate;
- drive OpenCode through a narrow adapter;
- collect results into one normalized model;
- stop on unauthorized file changes or pre-existing work being disturbed;
- report exactly what happened.

### What it must never become

The orchestrator must remain a **control layer**. It must never become an
unrestricted autonomous coding agent. It never writes application code itself and
never invents product decisions.

---

## 2. Architecture

### Request path

```
Human / ChatGPT PO
        |
        v
Development Orchestrator      <- this package
        |
        v
OpenCode Adapter              <- src/opencode-client.ts
        |
        v
AI Teacher Repository         <- backend/, frontend/, migrations
```

### Result path

```
AI Teacher Repository
        |
        v
OpenCode
        |
        v
Development Orchestrator
        |
        v
Human / ChatGPT PO
```

### Component map

| File | Responsibility | Stage 2A status |
|---|---|---|
| `src/cli.ts` | CLI entry point | `help` + `status` work; all execution commands refuse |
| `src/orchestrator.ts` | High-level service and lifecycle model | Interface + run/event model; only `getStatus()` is live |
| `src/workflow.ts` | State machine, legal edges, verification gate | **Complete and pure** |
| `src/config.ts` | Configuration types and fail-safe defaults | **Complete and offline** |
| `src/opencode-client.ts` | OpenCode adapter boundary | Interface + failing stub |
| `src/context-builder.ts` | Context Package model | Types + unloaded stub |
| `src/story-resolver.ts` | Story resolution boundary | Types + `not-found` stub |
| `src/approval-gate.ts` | Human approval boundary | **Complete and pure** |
| `src/result-parser.ts` | Normalized result model | Types + refusing stub |
| `src/git-guard.ts` | Git safety boundary | Pure snapshot math + refusing git access |
| `src/reporters/console-reporter.ts` | Reporting abstraction | Complete; only `status()` exercised |
| `src/errors.ts` | Shared error taxonomy | Complete |

`src/errors.ts` is the one addition to the originally proposed file list. The
`NOT_IMPLEMENTED_IN_STAGE` signal is raised by six different modules; declaring it
once avoids five divergent copies and avoids a circular import between
`orchestrator.ts` and its own dependencies.

---

## 3. Workflow state machine

Defined in `src/workflow.ts` as an explicit, auditable graph.

```
REQUESTED
  -> PLANNING
  -> PLAN_READY
  -> WAITING_FOR_APPROVAL
  -> BUILDING
  -> TESTING
  -> REVIEWING
  -> VERIFYING
  -> VERIFIED            (only success terminal)
```

### Terminal / error states

| State | Meaning |
|---|---|
| `BLOCKED` | Cannot proceed. Needs information or a resolution. |
| `FAILED` | A step failed. Verification did not pass. |
| `REJECTED` | A human rejected the plan. |
| `SCOPE_VIOLATION` | Work went beyond the approved story. |
| `PO_DECISION_REQUIRED` | A locked decision is missing, ambiguous, or conflicting. |

All six are **sinks**: they have no outgoing transitions. A finished run is never
silently resumed.

### The approval edge is mandatory

`PLAN_READY -> BUILDING` **is not an edge in the graph.**

```
PLAN_READY            --[APPROVAL_REQUESTED]-->  WAITING_FOR_APPROVAL
WAITING_FOR_APPROVAL  --[APPROVAL_GRANTED]---->  BUILDING      <-- only route
WAITING_FOR_APPROVAL  --[APPROVAL_REJECTED]-->  REJECTED
```

`BUILDING` is reachable from exactly one state, via exactly one trigger. Every
attempt to advance without approval throws `InvalidTransitionError`.

### Failure paths never reach `VERIFIED`

`TESTING` and `REVIEWING` have no edge to `VERIFYING` other than
`TESTS_COMPLETED` / `REVIEW_COMPLETED`. `evaluateVerification()` independently
refuses `VERIFIED` when tests failed, review did not approve, typecheck failed, or
the git guard reported a violation.

---

## 4. Safety boundaries

### 4.1 Approval gate — `src/approval-gate.ts`

```
NO APPROVAL  ->  NO BUILD
```

- Three states: `ApprovalRequired`, `ApprovalGranted`, `ApprovalRejected`.
- `evaluateBuildPermission()` is a **pure** authorization function.
- Only a `human`, `po`, or `chatgpt-po` actor may decide.
- The interface deliberately has **no** `autoApprove`, `approveOnTimeout`,
  `defaultToApproved`, or non-interactive bypass member. Adding one is a breaking
  change to this architecture.
- `SafetyConfig.approvalRequired` and `SafetyConfig.explicitApprovalOnly` are typed
  as the literals `true`, and are not env-driven. They cannot be switched off.

### 4.2 Git guard — `src/git-guard.ts`

```
UNAUTHORIZED FILE      ->  STOP
PRE-EXISTING CHANGE    ->  PROTECTED
```

- Deny-list: `add, am, checkout, clean, commit, merge, mv, pull, push, rebase,
  reset, restore, revert, rm, stash, switch`.
- Allow-list (read-only): `diff, log, rev-parse, status, ls-files`.
- `isReadOnlyGitInvocation()` / `assertReadOnlyGitInvocation()` are pure and are
  the required pre-check for any future `git` call.
- A baseline is captured before any workflow action and is never rewritten.
- **No baseline means unsafe by default**: nothing is treated as authorized.
- A pre-existing path the workflow left untouched produces no change entry. A
  pre-existing path the workflow *did* modify is surfaced for human review and is
  never auto-reverted.
- Pure snapshot math (`diffSnapshots`, `evaluateGuard`, `toChangedPaths`) is
  implemented now because it needs no repository access and is the part a reviewer
  most needs to audit. Everything that reads the repository throws.

### 4.3 Orchestrator safety configuration

```ts
export const SAFETY_LITERALS = {
  gitMutationEnabled: false,
  networkEnabled: false,
  approvalRequired: true,
  explicitApprovalOnly: true,
} as const;
```

These are literals, not defaults that configuration can override. `loadConfig()`
calls `assertConfigIsSafe()`, which refuses a config that violates any of them —
including any attempt to select `executionMode: "live"` while in Stage 2A.

### 4.4 No secrets

The orchestrator never reads, stores, or accepts credentials, API keys, tokens, or
connection secrets — for OpenCode or anything else.

---

## 5. Relationship to `.opencode/`

**`.opencode/ai-workflow-rules.md` remains the single authoritative source for
OpenCode workflow rules.** The orchestrator references it; it does not restate it.

- The orchestrator does **not** copy, paraphrase, or compete with Stage 1 rules.
- `config.ts` records the path to the Stage 1 rules as a read-only reference
  (`governance.stage1OpenCodeRulesPath`) and nothing more.
- The OpenCode adapter is a **transport**, not a second rule set. Stage 2B
  implements the adapter so that the existing `/ai-plan`, `/ai-build`, `/ai-test`,
  `/ai-review`, and `/ai-verify` commands remain the rules that govern a run.
- Nothing in `.opencode/` is modified, duplicated, or shadowed by this package.
  Agents, skills, and commands in `.opencode/` are untouched.

Likewise, the frozen Master Backlog and the locked `Docs/*PO_Decisions*` records
stay authoritative. `context-builder.ts` and `story-resolver.ts` hold **references
and models only** — no acceptance criteria, no PO decision text, no Epic formula.

---

## 6. Relationship to the AI Teacher backend and frontend

There is none, in Stage 2A.

- The orchestrator imports nothing from `backend/` or `frontend/`.
- It has no dependency on Express, PostgreSQL, React, Vite, Playwright, or any
  AI Teacher module.
- It has **zero runtime dependencies** (`"dependencies": {}`).
- It never reads or writes `backend/`, `frontend/`, or any database migration.
- It is a standalone Node/TypeScript CLI with its own `tsconfig.json`, isolated
  from the root, backend, and frontend TypeScript configurations.
- When it eventually operates on the repository, the repository remains the
  **target** of OpenCode's work, never the orchestrator's own code.

---

## 7. Stage 2A scope

### Implemented

- Strict, isolated TypeScript configuration and build.
- Offline configuration loader with fail-safe defaults.
- Complete, pure workflow state machine with an explicit graph.
- Pure verification gate (`evaluateVerification`).
- Human approval boundary with no auto-approval path.
- Pure git snapshot diffing and scope evaluation.
- Context Package, story resolution, and normalized result **models** with stubs.
- OpenCode adapter **interface** with a failing stub.
- Console reporter and `orchestrator help` / `orchestrator status`.

### Intentionally NOT implemented

Every one of these is a real gap on purpose.

- OpenCode session creation, continuation, command execution, result collection.
- Starting or contacting an OpenCode server.
- Any network request of any kind.
- Reading the Master Backlog, PO decisions, `AGENTS.md`, `DESIGN.md`, or
  `.opencode/ai-workflow-rules.md`.
- Story resolution by scanning the frozen Master Backlog.
- Context Package document loading.
- Parsing real OpenCode output.
- Git baseline capture and live `git status` reads.
- Any git mutation.
- Persisting workflow state to `state/`.
- Executing `/ai-plan`, `/ai-build`, `/ai-test`, `/ai-review`, `/ai-verify`.
- Any automated test framework wiring (Stage 2B).

Stubs fail loudly with `NotImplementedInStageError` and a non-zero exit code. A
silent no-op would let a caller believe a workflow ran when nothing happened.

---

## 8. Running the skeleton

Requires Node `>= 20.11` (developed and validated on Node `v24.15.0`).

```bash
cd tools/ai-orchestrator
npm install          # devDependencies only: typescript, @types/node
npm run typecheck    # tsc --noEmit
npm run build        # tsc -> dist/
npm run help         # orchestrator help
npm run status       # orchestrator status
```

Direct invocation:

```bash
node dist/cli.js help
node dist/cli.js status
node dist/cli.js status --json
```

Commands that exist but refuse in Stage 2A (exit code `3`):

```bash
node dist/cli.js plan  US-101     # NOT_IMPLEMENTED_IN_STAGE
node dist/cli.js approve wf-1 grant
node dist/cli.js build  wf-1
node dist/cli.js test   wf-1
node dist/cli.js review wf-1
node dist/cli.js verify wf-1
node dist/cli.js run    US-101
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Orchestrator error |
| `2` | Usage error |
| `3` | `NOT_IMPLEMENTED_IN_STAGE` |

### Configuration

Optional, all fail-safe. No secrets are read.

| Variable | Default |
|---|---|
| `AI_ORCHESTRATOR_REPOSITORY_ROOT` | `<repo>/..` resolved from the package location |
| `AI_ORCHESTRATOR_STATE_DIR` | `tools/ai-orchestrator/state` |
| `AI_ORCHESTRATOR_STAGE` | `2A` |
| `AI_ORCHESTRATOR_EXECUTION_MODE` | `disabled` |
| `AI_ORCHESTRATOR_LOG_LEVEL` | `info` |
| `AI_ORCHESTRATOR_OPENCODE_COMMAND` | `opencode` |
| `AI_ORCHESTRATOR_OPENCODE_SERVER_URL` | *(unset)* |
| `AI_ORCHESTRATOR_OPENCODE_TIMEOUT_MS` | `600000` |

`executionMode` is `disabled | dry-run | live`. `live` is refused while in
Stage 2A.

---

## 9. Stage 2B / 2C / 2D responsibilities

### Stage 2B — real adapters behind the existing interfaces

- Implement `OpenCodeClient` (CLI or local server transport).
- Implement `StoryResolver` against the frozen Master Backlog: resolve only from
  the authoritative story table, always cross-check the Draft 1.0 / Draft 2.0
  traceability table, and report collisions rather than resolving them.
- Implement `ContextBuilder` document loading, reading from source paths only.
- Implement `ResultParser` for real OpenCode output.
- Implement `GitGuard` baseline capture using read-only git invocations only.
- Persist workflow runs under `state/`.
- Add a real test suite for the state machine, the approval gate, and the guard.

### Stage 2C — orchestration and the end-to-end run

- Implement `OrchestratorService`: `start`, `plan`, `requestApproval`,
  `decideApproval`, `build`, `test`, `review`, `verify`, `report`.
- Wire every transition through `assertWorkflowMayAdvance()`.
- Implement `orchestrator run <US-###>`.
- Scope resolution per story, feeding the git guard's authorized prefixes.
- Add structured/JSON reporting for CI consumption.

### Stage 2D — hardening and PO reporting

- Durable, auditable run history.
- PO-facing verification report that cites the governing PO decision record for
  every acceptance criterion checked.
- Human-in-the-loop review checkpoints and re-work loops.
- Explicit PO-decision surfacing for open reconciliation items.

---

## 10. Governance invariants

The orchestrator is a tool, not a second source of product truth. These are
asserted in code as exported string constants so a reviewer sees the omissions.

- The frozen Master Backlog is read-only and is never written by the orchestrator.
- No acceptance criteria are embedded in the orchestrator.
- No PO decision is duplicated or paraphrased in the orchestrator.
- No Epic formula is copied into the orchestrator.
- The orchestrator never rewrites, widens, or re-statuses a user story.
- A Draft 1.0 / Draft 2.0 ID collision is reported, never merged.
- A retired story ID is permanent and never reused.
- A missing PO decision is a `BLOCKED` / `PO_DECISION_REQUIRED` outcome, never an
  implementation opportunity.
- Progress and performance remain separate concepts; the orchestrator computes
  neither.

`orchestrator status` prints the full invariant list at runtime.

---

## 11. Git safety for this package

This package is development tooling and follows the same discipline as the rest of
the repository:

- `state/` holds a `.gitkeep` placeholder only. No workflow state, no
  user-specific state.
- `node_modules/` and `dist/` are gitignored (`.gitignore` in this directory).
- Stage 2A stages and commits nothing. The human operator decides what enters git.
- Never use `git add .` or `git add -A`. Stage explicit paths.
