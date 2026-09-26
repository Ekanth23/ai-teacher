# AI Teacher Development Orchestrator

**Stage: 2B — OpenCode CLI adapter.**

The Development Orchestrator is the local control layer between the human / ChatGPT
Product Owner and OpenCode. It sequences work, prepares context, enforces human
approval gates, invokes OpenCode through an adapter, collects normalized results,
guards git safety, and reports status.

Stage 2A (commit `3cf89b2`) delivered the architecture and skeleton.
Stage 2B adds a **real `opencode run` CLI adapter** behind the existing
`OpenCodeClient` interface, and proves the orchestrator can drive the locally
installed OpenCode CLI and capture structured execution results.

> **Stage 2B does NOT implement autonomous `/ai-*` execution.** Workflow execution
> is Stage 2C and is still refused.
> **Stage 2B does NOT modify the AI Teacher application.**
> **Stage 2B does NOT automatically approve plans.** The approval gate is unchanged.
> **Stage 2B does NOT use a shell, a server, HTTP, or any network integration.**
> **Stage 2B does NOT mutate git.**

Stage 2B is an **adapter/integration milestone, not the autonomous workflow.**

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
OpenCode CLI Adapter          <- src/opencode-client.ts (OpenCodeCliClient)
        |
        v
opencode run                  <- src/opencode-process.ts (the only spawn site)
        |
        v
OpenCode (local process)
        |
        v
AI Teacher Repository         <- backend/, frontend/, migrations
```

OpenCode is **subordinate** to the orchestrator. The orchestrator owns workflow
state and approval. The adapter only transports commands and results. There is no
path by which OpenCode returns an approval decision or a workflow transition.

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

| File | Responsibility | Stage 2B status |
|---|---|---|
| `src/cli.ts` | CLI entry point | `help`, `status`, `opencode-ping` work; all workflow commands refuse |
| `src/orchestrator.ts` | High-level service and lifecycle model | Unchanged ownership; workflow methods still refuse (Stage 2C) |
| `src/workflow.ts` | State machine, legal edges, verification gate | **Unchanged from Stage 2A** |
| `src/config.ts` | Configuration types and fail-safe defaults | Extended with `OPENCODE_BIN`, `OPENCODE_TIMEOUT_MS` |
| `src/opencode-client.ts` | OpenCode adapter | **Real `opencode run` CLI adapter** + retained Stage 2A stub |
| `src/opencode-executable.ts` | Native executable resolution, no shell | **New in Stage 2B** |
| `src/opencode-process.ts` | Process execution, capture, timeout | **New in Stage 2B — the only `spawn` site** |
| `src/context-builder.ts` | Context Package model | Types + unloaded stub (unchanged) |
| `src/story-resolver.ts` | Story resolution boundary | Types + `not-found` stub (unchanged) |
| `src/approval-gate.ts` | Human approval boundary | **Unchanged from Stage 2A** |
| `src/result-parser.ts` | Normalized result model | Stub **preserved on purpose** across Stage 2B |
| `src/git-guard.ts` | Git safety boundary | Unchanged; still refuses repository access |
| `src/reporters/console-reporter.ts` | Reporting abstraction | Complete |
| `src/errors.ts` | Shared error taxonomy | Two codes added for Stage 2B |
| `src/errors.ts` | Shared error taxonomy | Complete |

`src/errors.ts` is the one addition to the originally proposed file list. The
`NOT_IMPLEMENTED_IN_STAGE` signal is raised by six different modules; declaring it
once avoids five divergent copies and avoids a circular import between
`orchestrator.ts` and its own dependencies.

### Stage 2B additions

| File | Why it was added |
|---|---|
| `src/opencode-process.ts` | Owns the **only** `spawn()` call in the codebase. Keeps process concerns out of the adapter and makes them independently testable. |
| `src/opencode-executable.ts` | Resolves `opencode` to a **natively spawnable** executable. Needed because a `.cmd` shim cannot be run without a shell. |
| `test/opencode-adapter.test.ts` | Stage 2B adapter tests (fake process layer). |
| `test/safety-invariants.test.ts` | Stage 2A invariants, preserved in-repo and re-run every build. |
| `vitest.config.ts` | Offline test runner config. |
| `tsconfig.test.json` | Typechecks `src/` **and** `test/`; `tsconfig.json` still builds `src/` only. |

### Stage 2B minimal compatible extensions to the Stage 2A interface

The `OpenCodeClient` interface is **unchanged**. Four additive changes were required:

| Change | Why it was required |
|---|---|
| `OpenCodeAdapterConfig.bin` | `OPENCODE_BIN` needs a field to land in. Additive, nullable. |
| `OpenCodeAdapterConfig.maxOutputBytes`, `killGraceMs` | Bounded output and a kill grace period. |
| `CreateSessionRequest.message` | `opencode run` is message-driven; a session cannot be created without one. |
| `ContinueSessionRequest.sessionId` | Lets a caller continue when the session reference carries no provider id. Optional. |
| `OpenCodeSessionRef.providerSessionId: string \| null` | Widened from `string`. OpenCode may not report one, and the adapter **never invents** an id. |
| `OpenCodeTurnResult.process` | Carries the authoritative four-way process outcome. The pre-existing scalars are kept as convenience mirrors so Stage 2A consumers keep working. |

---

## 2B. The OpenCode CLI adapter

### Transport

```
opencode run --format json [flags] <message>
```

Invoked through `node:child_process.spawn` with **`shell: false`**, an absolute
executable path, and an **argument array**. There is no command string, no shell
interpolation, and no `exec()` anywhere in the codebase.

### Why executable resolution is necessary

`opencode` is normally installed through npm, which places a **shell shim** on PATH.
That shim cannot be used safely:

| Attempt | Result |
|---|---|
| `spawn("opencode", { shell: false })` | `ENOENT` — Node does no `PATHEXT` resolution |
| `spawn(".../opencode.cmd", { shell: false })` | `EINVAL` — Node refuses a batch shim without a shell |
| `spawn(".../opencode.exe", { shell: false })` | **works** |
| `spawn("opencode.cmd", { shell: true })` | works, but **forbidden** — reinterprets argument content as shell syntax |

`resolveOpenCodeExecutable()` therefore resolves, in order:

1. an explicit `OPENCODE_BIN` path;
2. `<name>.exe` / `<name>.com` on `PATH`;
3. `<name>` with no extension on `PATH` (POSIX);
4. if only a `.cmd`/`.bat` shim exists, a **bounded, depth-limited filename probe**
   for the native `<name>.exe` beneath that shim's `node_modules`. Shim file
   *contents* are never read, parsed, or executed — only filenames are matched;
5. otherwise it fails with a structured reason and an actionable hint.

It never falls back to a shell.

### Process result semantics

`ProcessExecutionOutcome` is a discriminated union of exactly four cases:

| `status` | Meaning | `exitCode` |
|---|---|---|
| `success` | The process ran to completion and exited 0 | `0` |
| `failure` | The process ran and exited non-zero, **or** died by signal | non-zero or `null` |
| `timeout` | `timeoutMs` elapsed; termination was attempted (`SIGTERM`, then `SIGKILL`) | `null` |
| `spawn-error` | The executable could not be started (`ENOENT`, `EACCES`, ...) | `null` |

Every case also carries `stdout`, `stderr`, `durationMs`, `timedOut`, `truncated`,
and `signal`. stdout and stderr are captured **separately** and never merged.
Output is bounded by `maxOutputBytes` per stream, while the child keeps being
drained so it can never block on a full pipe.

A non-zero exit is **never** converted into success.

### Timeout behaviour

A timeout is always armed. When it fires the child is sent `SIGTERM`, and after
`killGraceMs` a forced `SIGKILL` follows. The result records `timedOut: true` and
`terminationAttempted: true` together with the signals that were sent. On Windows
`child.kill()` maps to `TerminateProcess`.

Verified for real: with `OPENCODE_TIMEOUT_MS=1` against the actual OpenCode binary,
the adapter returned `status: timeout` and exit code `1`.

### Process result vs workflow result

This is the most important distinction in Stage 2B.

```
process result  : "the OpenCode process exited 0"   -> success
workflow result : "US-### satisfies its criteria"    -> NOT derivable
```

`opencode run` exiting 0 means **the process completed**. It does **not** mean
tests passed, review passed, or the story is `VERIFIED`. `result-parser.ts` is
therefore **still stubbed on purpose**, and `PROCESS_VS_WORKFLOW_INVARIANTS`
restates the rule as data. A transport detail must never masquerade as a
PO-governed outcome.

### Forbidden OpenCode flags

`--auto`, `--server`, and `--standalone` are refused by `assertNoForbiddenFlags()`
and covered by tests:

- `--auto` would make OpenCode auto-approve permissions. The orchestrator owns
  approval; delegating it to the child process would break `NO APPROVAL -> NO BUILD`.
- `--server` / `--standalone` would introduce server or network behaviour. Stage 2B
  is a local CLI adapter only.

### Approval gate preservation

Stage 2B changed **nothing** about approval. The adapter has no `approve`,
`grantApproval`, `decide`, `transition`, `advance`, `setState`, `commit`, or
`stage` member — asserted by a test that reflects over the class prototype.
`PLAN_READY -> BUILDING` remains unreachable, and `BUILDING` still has exactly one
legal entry via `APPROVAL_GRANTED`.

### Session handling

`createSession` runs the first `opencode run` turn and extracts a provider session
id from `--format json` output **only if OpenCode actually reports one**. A parse
problem degrades to `null`, never to a guess. Continuing a session with no real id
throws `OpenCodeSessionUnavailableError` rather than continuing the wrong session.

### Read-only connectivity probe

```bash
npm run opencode-ping
```

Runs `opencode --version` through the real adapter. No model call, no network
request, no file modification, and no `/ai-*` command. The argument vector is
hardcoded inside the adapter and cannot be influenced by a caller.

---

## 3. Workflow state machine

Defined in `src/workflow.ts` as an explicit, auditable graph. **Unchanged by
Stage 2B.**

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

All five are **sinks**: they have no outgoing transitions. A finished run is never
silently resumed.

`VERIFIED` is a **sixth sink but not a sixth error state**. It is the only *success*
terminal (`SUCCESS_PHASES`), it sits in `ACTIVE_PHASES` rather than
`TERMINAL_PHASES`, and it is reachable from exactly one edge:

```
VERIFYING  --[VERIFICATION_COMPLETED]-->  VERIFIED
```

So the graph has **5 error terminals** and **1 success terminal**, and **6 phases
with no outgoing edges**. `TERMINAL_PHASES` still contains exactly five entries.

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
including any attempt to select `executionMode: "live"` while in Stage 2A, and any
attempt to enable `live` with the approval gate switched off.

### 4.4 No secrets

The orchestrator never reads, stores, or accepts credentials, API keys, tokens, or
connection secrets — for OpenCode or anything else. The Stage 2B child process
inherits the operator's own environment so that OpenCode's existing authentication
keeps working; the orchestrator neither reads nor injects any credential of its own.

### 4.5 Process safety — `src/opencode-process.ts`

- `shell: false`, always. There is exactly **one** `spawn()` call in the codebase.
- The executable is an absolute path resolved before spawning. `command` is never
  a user, story, or prompt string.
- Arguments are an array. A message body is exactly one argv element, so its
  content can never be re-parsed as a flag or shell syntax. Covered by a test that
  passes `US-101 && rm -rf / ; echo $(whoami) | tee x` and asserts it survives as
  a single inert element.
- stdout and stderr are captured separately and never merged.
- A timeout is always armed, and the child is terminated when it fires.
- A non-zero exit is a failure. A spawn failure is a distinct outcome. Neither is
  ever reported as success.

---

## 5. Relationship to `.opencode/`

**`.opencode/ai-workflow-rules.md` remains the single authoritative source for
OpenCode workflow rules.** The orchestrator references it; it does not restate it.

- The orchestrator does **not** copy, paraphrase, or compete with Stage 1 rules.
- `config.ts` records the path to the Stage 1 rules as a read-only reference
  (`governance.stage1OpenCodeRulesPath`) and nothing more.
- The OpenCode adapter is a **transport**, not a second rule set. Stage 2B
  implements the adapter precisely so that the existing `/ai-plan`, `/ai-build`,
  `/ai-test`, `/ai-review`, and `/ai-verify` commands remain the rules that govern a
  run.
- Nothing in `.opencode/` is modified, duplicated, or shadowed by this package.
  Agents, skills, and commands in `.opencode/` are untouched, and Stage 2B
  modified nothing there.

Likewise, the frozen Master Backlog and the locked `Docs/*PO_Decisions*` records
stay authoritative. `context-builder.ts` and `story-resolver.ts` hold **references
and models only** — no acceptance criteria, no PO decision text, no Epic formula.

---

## 6. Relationship to the AI Teacher backend and frontend

There is none, in Stage 2A or Stage 2B.

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

## 7. Current scope

### Implemented in Stage 2B

- Native OpenCode executable resolution with no shell fallback.
- A real `opencode run` CLI adapter with stdout/stderr/exit-code capture.
- Enforced per-invocation timeout with child termination.
- Structured process outcomes: `success` / `failure` / `timeout` / `spawn-error`.
- Session create/continue/collect/dispose over the Stage 2A interface.
- A read-only `opencode --version` connectivity probe.
- A 54-test offline suite covering the adapter and every Stage 2A invariant.

### Intentionally NOT implemented

Every one of these is a real gap on purpose.

- **Automatic `/ai-plan`, `/ai-build`, `/ai-test`, `/ai-review`, `/ai-verify`
  execution.** Workflow execution is Stage 2C; all `OrchestratorService` workflow
  methods still refuse with `NotImplementedInStageError`.
- Automatic multi-story execution and autonomous story selection.
- Automatic approval of any kind.
- Automatic git commits, staging, or rollback.
- OpenCode server mode, HTTP integration, webhooks, or MCP integration.
- Background daemon, browser automation, or VS Code UI automation.
- ChatGPT API integration.
- Reading the Master Backlog, PO decisions, `AGENTS.md`, `DESIGN.md`, or
  `.opencode/ai-workflow-rules.md`.
- Story resolution by scanning the frozen Master Backlog.
- Context Package document loading.
- **Parsing real OpenCode output into workflow results.** `result-parser.ts` is
  still a stub on purpose, so no process output can become a workflow verdict.
- Git baseline capture and live `git status` reads.
- Any git mutation.
- Persisting workflow state to `state/`.

Stubs fail loudly with `NotImplementedInStageError` and exit code `3`. A silent
no-op would let a caller believe a workflow ran when nothing happened.

---

## 8. Running

Requires Node `>= 20.11` (developed and validated on Node `v24.15.0`).

```bash
cd tools/ai-orchestrator
npm install          # devDependencies only: typescript, @types/node, vitest
npm run typecheck    # tsc --noEmit over src/ AND test/
npm run build        # tsc -> dist/  (src/ only)
npm test             # 54 offline tests
npm run test:safety  # Stage 2A invariants only
npm run test:adapter # Stage 2B adapter only
npm run help
npm run status
npm run opencode-ping # real, read-only OpenCode CLI probe
```

Direct invocation:

```bash
node dist/cli.js help
node dist/cli.js status
node dist/cli.js status --json
node dist/cli.js opencode-ping
node dist/cli.js opencode-ping --json
```

Commands that exist but refuse in Stage 2B (exit code `3`):

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
| `OPENCODE_BIN` | *(unset — resolved on PATH)* |
| `OPENCODE_TIMEOUT_MS` | *(unset — falls back to the above)* |
| `OPENCODE_MAX_OUTPUT_BYTES` | `4194304` |

`executionMode` is `disabled | dry-run | live`. `live` is refused while in
Stage 2A, and Stage 2B keeps the default at `disabled` — the CLI adapter exists and
is exercised, but no workflow command runs.

`OPENCODE_BIN` must be a **native executable path**, not a command string. A
`.cmd`/`.bat` shim is refused with an actionable error rather than silently run
through a shell.

---

## 9. Stage 2B / 2C / 2D responsibilities

### Stage 2B — OpenCode CLI adapter (DELIVERED)

- Native executable resolution with no shell fallback.
- `opencode run` CLI adapter with stdout/stderr/exit-code capture.
- Enforced timeout with child termination.
- Structured process outcomes: success / failure / timeout / spawn-error.
- Session create/continue/collect/dispose over the Stage 2A interface.
- A read-only `opencode --version` connectivity probe.
- An offline test suite covering the adapter and every Stage 2A invariant.

### Stage 2B+ — remaining adapter work

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
- The orchestrator stages and commits nothing. The human operator decides what
  enters git.
- Never use `git add .` or `git add -A`. Stage explicit paths.
