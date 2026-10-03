# Stage 2C Contract Design

**Status: APPROVED**

**Approval Date:** 2026-09-29

**Approved By:** Product Owner (PO)

---

## 1. Document Control and Revision History

| Revision | Date | Description |
|---|---|---|
| Rev 1 | — | Initial design |
| Rev 2 | — | C-1 through C-8: State transitions, check states, Git baseline, independent verification, idempotency, approval identity, file permissions, document selection |
| Rev 3 | — | C-9 through C-15: BUILDING/TESTING contradiction, check/waiver policy, Git content hashes, verification schema, approval expiration, document selection, execution behavior |
| Rev 4 | — | C-16 through C-22: Approval rejection after BUILDING, Git content-hash contract, explicit file operations, approval identity, independent verification boundaries, BUILDING/TESTING evidence distinction, context integrity |
| Rev 5 | — | C-1 through C-10: Git snapshot attribution, waiver policy, E2E trust, verification evidence model, state machine accuracy, approval rejection/revocation, scope authorization, verification command matrix, context limits, approval actor identity |
| Rev 6 | — | C1–C9: Approval/cancellation mechanism, E2E evidence distinction, Git attribution rules, waiver policy resolution (PD-2/PD-7/PD-9/PD-10), evidence schema reconciliation, state-machine count correction (19 triggers, 39 edges, 58 triples), scope authorization precedence, context limit fail-closed behavior, consistency audit |
| Rev 7 | — | PO Decision 1 (headed E2E evidence — APPROVED), PO Decision 2 (PD-7 cancellation after BUILDING — APPROVED), Consistency Fix 1 (cancellation/failure precedence), Consistency Fix 2 (evidence schema/VERIFIED derivation), Consistency Fix 3 (git attribution/guard behavior) |
| Rev 8 | — | PO decisions preserved (headed E2E evidence, cancellation after BUILDING), pending PO decisions kept pending (PD-2/PD-8/PD-9/PD-10), Git attribution contradiction resolved, headed E2E exception reconciled with orchestrator-only rule, VERIFIED derivation clarified, cancellation behavior expanded (before/between/during phases), PLANNING transition ambiguity kept blocked pending PO decision, protected-file human review defined, final consistency audit re-run |
| Rev 9 | — | PD-2 contradiction resolved (Section 8.6 now consistent with pending status), VERIFIED derivation made fully consistent (mandatory/non-mandatory checks, all-not_applicable case), PD-9/PD-10 wording corrected to avoid implicit defaults, Git attribution expanded (added/deleted/renamed files, baseline gaps), protected-file review clarified (review ≠ authorization), final consistency audit updated |
| Rev 10 | — | Waiver rules clarified (blocked where dependent on PD-9/PD-10), VERIFIED derivation corrected (minimum evidence required, all-not_applicable does not auto-produce VERIFIED), Git attribution expanded (complete change detection, rename handling), cancellation boundary clarified (must not grant/revoke approval), final audit corrected (contract consistency vs implementation verification separated) |
| Rev 11 | — | Waiver recording vs scope distinguished (PD-10 not assumed), VERIFIED derivation corrected (waiver validity blocked when dependent on PD-9/PD-10), Git attribution reconciled with authorization rules, cancellation blocks outstanding approval, final audit separates contract/source/test/planned validation |
| **Rev 12** | — | Git attribution strengthened (complete path set comparison, deleted files cannot bypass checks), waiver validity fail-closed (recording ≠ validity), cancellation four-case distinction (rejection/cancellation/late approval/resume), audit accuracy improved (historical counts marked as historical) |
| **Rev 13** | — | Git attribution algorithm corrected (complete baseline/current path set union, deleted files explicitly evaluated, authorization precedence defined, fail-closed on undeterminable authorization), waiver validity clarified (PD-9/PD-10 dependency blocks all waivers, waived checks cannot contribute to VERIFIED), historical audit accuracy corrected (Verified labels qualified as historical, internal-consistency claim qualified) |
| **Rev 14** | — | Authorization model reconciled (effective authorization resolution before path evaluation, fallback representation applied consistently, operation-level restrictions preserved), waiver wording reconciled (all references consistent with unresolved PD-9/PD-10), audit updated (Revision 14 entry added, consistency claims qualified) |
| **Rev 15** | — | PLANNING PO_DECISION_REQUIRED ambiguity resolved (PO decision: Alternative B — transition to PO_DECISION_REQUIRED, not BLOCKED), ambiguity removed from state machine and transition table, implementation blocker removed |
| **Rev 16** | — | PD-9 resolved (waiver expiration — APPROVED: Option A, waivers do not expire), waiver revocation semantics defined, PD-9 implementation blocker removed, PD-10 preserved as pending |
| **Rev 17** | — | PD-10 resolved (waiver scope — APPROVED: Option A, phase-specific single-check waiver), waiver scope policy defined, PD-10 implementation blocker removed, all waiver decisions now resolved |
| **Rev 18** | — | PD-2 resolved (approval expiration — APPROVED: 48-hour validity, checked before BUILDING transition), approval expiration semantics defined, PD-2 implementation blocker removed, all PO decisions now resolved |
| **Rev 19 (this document)** | — | Stage 2C-6 Step 5 audit decisions APPROVED: (1) acceptance-criteria/PO-decision verification fails closed when evidence is missing, (2) scope verification fails closed when approved plan scope is unavailable, (3) WorkflowEvent extended for auditable waiver grants/revocations, (4) Git HEAD change during verification results in BLOCKED, (5) VERIFIED requires at least one executed mandatory check |

**Revision 18 is superseded by Revision 19.** Revisions 1–18 are retained above as historical context only. All requirements in this document are Revision 19 requirements.

---

## 2. Purpose and Scope

This document defines the contract for Stage 2C — Orchestrated `/ai-*` Workflow Execution. It specifies how the orchestrator safely executes `/ai-plan`, `/ai-build`, `/ai-test`, `/ai-review`, and `/ai-verify` while preserving the existing safety architecture.

**Stage 2C delivers:**
- Real `OrchestratorService` workflow methods (`start`, `plan`, `requestApproval`, `decideApproval`, `build`, `test`, `review`, `verify`, `report`)
- Real `StoryResolver` (Master Backlog Section B scanning)
- Real `ContextBuilder` (document loading from source paths only)
- Real `ResultParser` (OpenCode output parsing)
- Real `GitGuard` (read-only baseline capture with content hashes)
- In-memory workflow state
- `orchestrator run <US-###>` end-to-end
- `IndependentValidator` (orchestrator-executed verification checks)

**Stage 2C does NOT change:**
- The state machine graph (no new edges, no removed edges)
- The approval gate (no auto-approve, no new actor kinds)
- The git deny-list (no mutating subcommands)
- The `SAFETY_LITERALS` (no env-driven safety weakening)
- The `PROCESS_VS_WORKFLOW_INVARIANTS`
- Any `.opencode/` governance file

---

## 3. Current Architecture Assessment

### 3.1 Implemented Components

| Component | File | Status |
|---|---|---|
| State machine | `workflow.ts` | Pure, complete. 9 active phases, 5 terminal phases, 1 success terminal. **19 triggers, 39 edges, 58 triples.** |
| Approval gate | `approval-gate.ts` | In-memory, complete. No auto-approve. Only `human`/`po`/`chatgpt-po` actors. |
| Git guard | `git-guard.ts` | Pure snapshot math. `GitSnapshot` has `stagedPaths`, `modifiedPaths`, `untrackedPaths`, `headCommit`. No content hashes. Repo-access methods throw. |
| Config | `config.ts` | Complete. `SAFETY_LITERALS` are type-level. `DEFAULT_STAGE` is `"2B"`. |
| OpenCode adapter | `opencode-client.ts` | Real `opencode run` CLI adapter. |
| Process layer | `opencode-process.ts` | The only `spawn` site. `ProcessRunner` interface is generic. `shell: false`. |
| Executable resolver | `opencode-executable.ts` | Native binary resolution, no shell fallback. |
| CLI | `cli.ts` | `help`, `status`, `opencode-ping` work. Workflow commands refuse. |

### 3.2 Stubbed Components

| Component | File | Stub behavior |
|---|---|---|
| Story resolver | `story-resolver.ts` | `resolve()` always returns `not-found` |
| Context builder | `context-builder.ts` | `build()` returns unloaded skeleton |
| Result parser | `result-parser.ts` | `parse()` throws `NotImplementedInStageError` |
| Git guard | `git-guard.ts` | `captureBaseline()` / `captureCurrentState()` throw |
| Orchestrator | `orchestrator.ts` | All workflow methods refuse |

### 3.3 State Machine (authoritative, from `workflow.ts`)

**Active phases (9):** `REQUESTED`, `PLANNING`, `PLAN_READY`, `WAITING_FOR_APPROVAL`, `BUILDING`, `TESTING`, `REVIEWING`, `VERIFYING`, `VERIFIED`

**Terminal phases (5):** `BLOCKED`, `FAILED`, `REJECTED`, `SCOPE_VIOLATION`, `PO_DECISION_REQUIRED`

**Success terminal (1):** `VERIFIED`

**Total phases:** 14 (9 active + 5 terminal). `VERIFIED` is in `ACTIVE_PHASES` but has no outgoing edges. This is correct: `VERIFIED` is a success sink, not a failure terminal.

**Transition triggers (19):** `PLAN_REQUESTED`, `PLAN_PRODUCED`, `APPROVAL_REQUESTED`, `APPROVAL_GRANTED`, `BUILD_PRODUCED`, `TESTS_COMPLETED`, `REVIEW_COMPLETED`, `VERIFICATION_COMPLETED`, `APPROVAL_REJECTED`, `STORY_AMBIGUOUS`, `DRAFT_ID_COLLISION`, `SCOPE_VIOLATION_DETECTED`, `PO_DECISION_REQUIRED`, `EXTERNAL_BLOCK`, `GUARD_VIOLATION`, `HARD_FAILURE`, `TESTS_FAILED`, `REVIEW_FAILED`, `VERIFICATION_FAILED`

**Total edges:** 39 (distinct from-to pairs)

**Total triples:** 58 (distinct from-trigger-to combinations)

**Counting methodology:** This document uses **edges** as the primary transition count. A triple is one specific (from, trigger, to) combination. Multiple triggers may share the same from-to edge.

**Key invariant:** `PLAN_READY -> BUILDING` is NOT an edge. The only edge to `BUILDING` is `WAITING_FOR_APPROVAL -> BUILDING` via `APPROVAL_GRANTED`.

**Resolved (PO Decision 3 — APPROVED):** From `PLANNING`, the trigger `PO_DECISION_REQUIRED` transitions to `PO_DECISION_REQUIRED` (not `BLOCKED`). This resolves the previous code-level ambiguity where the trigger appeared in both the `BLOCKED` edge and the `PO_DECISION_REQUIRED` edge. The orchestrator MUST route `PO_DECISION_REQUIRED` from `PLANNING` to `PO_DECISION_REQUIRED`. This is consistent with the `PLAN_READY` behavior.

---

## 4. Command Contract

### 4.1 Phase Responsibilities

| Phase | Command | Responsibility | Does NOT do |
|---|---|---|---|
| `PLANNING` | `/ai-plan` | Resolve story, load governance, inspect implementation, produce plan | Write code, run tests |
| `BUILDING` | `/ai-build` | Implement approved plan, immediate scope validation. OpenCode self-reported test results are parsed but NOT authoritative evidence. | Run full test suites, typecheck, build (these are TESTING responsibilities) |
| `TESTING` | `/ai-test` | Run focused tests, regression suites, typecheck, build, headed E2E; collect evidence | Write product code, review code |
| `REVIEWING` | `/ai-review` | Read-only review | Write code, run tests |
| `VERIFYING` | `/ai-verify` | Final verification using collected evidence | Write code, run new tests |

### 4.2 `/ai-plan US-XXX`

| Attribute | Value |
|---|---|
| **Purpose** | Resolve story, load governance, inspect implementation, classify gaps, produce a bounded plan. Stop for approval. |
| **Allowed phase** | `PLANNING` |
| **Required inputs** | `storyId` (non-null, matches `US-\d+`) |
| **Context supplied** | Context Package with Master Backlog Section B row, PO decision references, architecture, project instructions, Stage 1 rules reference |
| **Expected output** | Plan document with readiness verdict (`READY FOR BUILD` or `BLOCKED`), PO decision citations, gap analysis, proposed boundary, exact files, test strategy, regression strategy, git contamination analysis |
| **Failure conditions** | Story not found, story retired, ID collision implying different work, missing PO decision, ambiguous requirements, OpenCode process failure |
| **Evidence required** | Plan text with readiness verdict; story resolution provenance (Section B); PO decision citations |
| **Permitted transition** | `PLANNING -> PLAN_READY` (`PLAN_PRODUCED`) or `PLANNING -> PO_DECISION_REQUIRED` (`PO_DECISION_REQUIRED`) or `PLANNING -> BLOCKED` (`EXTERNAL_BLOCK`, `STORY_AMBIGUOUS`, `DRAFT_ID_COLLISION`) |

### 4.3 `/ai-build US-XXX`

| Attribute | Value |
|---|---|
| **Purpose** | Implement an approved plan within the approved scope only. |
| **Allowed phase** | `BUILDING` |
| **Required inputs** | `storyId`, approved plan reference, authorized file scope |
| **Context supplied** | Approved plan, authorized paths + operations, forbidden paths, locked PO decision references, focused test list |
| **Expected output** | Files created/modified within scope; OpenCode self-reported test results (if any); deviation report |
| **Failure conditions** | Scope deviation, PO decision conflict, migration edit required, destructive DB change, tenant isolation risk, OpenCode process failure, OpenCode self-reported test failure |
| **Evidence required** | Git diff showing only authorized paths changed; no scope deviation. OpenCode self-reported test results are parsed but NOT treated as independent evidence. |
| **Permitted transition** | `BUILDING -> TESTING` (`BUILD_PRODUCED`) or `BUILDING -> SCOPE_VIOLATION` (`SCOPE_VIOLATION_DETECTED`) or `BUILDING -> PO_DECISION_REQUIRED` (`PO_DECISION_REQUIRED`) or `BUILDING -> FAILED` (`HARD_FAILURE`, `GUARD_VIOLATION`, `TESTS_FAILED`) |

**Note on `TESTS_FAILED` from BUILDING:** The `/ai-build` command MAY report test outcomes as part of its output. If OpenCode's build output reports test failures, the orchestrator transitions `BUILDING -> FAILED` via `TESTS_FAILED`. This is NOT the same as the TESTING phase's independent test execution.

### 4.4 `/ai-test US-XXX`

| Attribute | Value |
|---|---|
| **Purpose** | Run focused tests, regression suites, typecheck, build, and headed frontend E2E. Collect test evidence. |
| **Allowed phase** | `TESTING` |
| **Required inputs** | `storyId`, changed file list |
| **Context supplied** | Test command reference (from `.opencode/ai-workflow-rules.md` Section 8), changed paths, package scope |
| **Expected output** | Exact commands run, exact pass/fail counts, typecheck/build results, headed E2E result or explicit non-run with reason |
| **Failure conditions** | Any mandatory check fails or is unavailable without PO waiver |
| **Evidence required** | All mandatory checks executed and passed (see Section 7 for check-state taxonomy) |
| **Permitted transition** | `TESTING -> REVIEWING` (`TESTS_COMPLETED`) or `TESTING -> FAILED` (`TESTS_FAILED`, `HARD_FAILURE`, `GUARD_VIOLATION`) |

### 4.5 `/ai-review US-XXX`

| Attribute | Value |
|---|---|
| **Purpose** | Read-only review against story, acceptance criteria, PO decisions, architecture, conventions, scope, DB safety, security, tests. |
| **Allowed phase** | `REVIEWING` |
| **Required inputs** | `storyId`, changed file list, approved plan reference |
| **Context supplied** | Story resolution, acceptance criteria, approved plan, review subagent roster |
| **Expected output** | Findings classified by severity with `file:line` evidence; explicit blocking vs non-blocking |
| **Failure conditions** | Scope violation, PO violation, missing PO decision, defect, regression risk, contract break, convention drift, missing test, contamination |
| **Evidence required** | Review report with findings list; explicit `blockingFindings: []` for approval |
| **Permitted transition** | `REVIEWING -> VERIFYING` (`REVIEW_COMPLETED`) or `REVIEWING -> FAILED` (`REVIEW_FAILED`, `HARD_FAILURE`, `GUARD_VIOLATION`) |

### 4.6 `/ai-verify US-XXX`

| Attribute | Value |
|---|---|
| **Purpose** | Final verification: scope, acceptance criteria, all evidence, git integrity. Produce completion verdict. |
| **Allowed phase** | `VERIFYING` |
| **Required inputs** | `storyId`, all prior phase evidence |
| **Context supplied** | All prior phase results, acceptance criteria, approved plan, git baseline |
| **Expected output** | Concise completion report with verdict `VERIFIED` or `NOT VERIFIED` |
| **Failure conditions** | Any acceptance criterion not met, any mandatory check failed or unavailable without waiver, scope violation, git integrity failure, missing acceptance-criteria/PO-decision evidence (fail closed), Git HEAD change during verification (BLOCKED via `EXTERNAL_BLOCK` — Rev 19) |
| **Evidence required** | All mandatory evidence green (see Section 13) |
| **Permitted transition** | `VERIFYING -> VERIFIED` (`VERIFICATION_COMPLETED`) or `VERIFYING -> FAILED` (`VERIFICATION_FAILED`, `HARD_FAILURE`, `GUARD_VIOLATION`) or `VERIFYING -> BLOCKED` (`EXTERNAL_BLOCK`, including a Git HEAD change during verification — Rev 19) |

---

## 5. Input Contract

### 5.1 AUTHORITATIVE INPUT (read from governance documents, never invented)

| Input | Source | How obtained |
|---|---|---|
| Story ID | CLI argument | Validated `US-\d+` |
| Story text, title, status, notes | Master Backlog Section B | `StoryResolver.resolve()` |
| Epic assignment | Master Backlog Section B | `StoryResolver.resolve()` |
| Acceptance criteria | `Docs/*PO_Decisions*` files | `ContextBuilder` |
| PO decision citations | `Docs/*PO_Decisions*` files | `ContextBuilder` |
| Stage 1 workflow rules | `.opencode/ai-workflow-rules.md` | `ContextBuilder` (reference) |
| Test command reference | `.opencode/ai-workflow-rules.md` Section 8 | `ContextBuilder` |
| Approved plan | PLAN phase output | Stored in workflow run state |
| Authorized file scope | Approved plan | Stored in workflow run state |
| Git baseline | `GitGuard.captureBaseline()` | Read-only git snapshot |

### 5.2 DERIVED CONTEXT (computed by the orchestrator, clearly marked as derived)

| Input | How derived |
|---|---|
| Current workflow phase | From `WorkflowRun.phase` |
| Previous phase result | From stored `NormalizedResult` |
| Changed file list | From `GitGuard` diff against baseline |
| Pre-existing protected paths | From `GitGuard` baseline analysis |
| Session ID | From `OpenCodeSessionRef` |

### 5.3 Authoritative Document Selection

**Discovery procedure (from `.opencode/ai-workflow-rules.md` Section 1):**

1. List `Docs/` directory. Do not hardcode a filename list.
2. Filter by Epic. Read every `*PO_Decisions*` file whose header names the resolved Epic.
3. Detect duplicates/ambiguity. If multiple files match and headers indicate different decision sets, transition to `PO_DECISION_REQUIRED`.
4. Detect conflicts. If two PO decisions contradict, transition to `PO_DECISION_REQUIRED`.
5. Detect staleness. If a file is marked "superseded" or "deprecated," exclude it and note the exclusion.
6. Validate paths: exists, readable, within expected directory, non-empty, parseable as text.

**Conflict handling:**

| Conflict type | Behavior |
|---|---|
| Two PO decisions contradict | Transition to `PO_DECISION_REQUIRED` with both citations |
| PO decision contradicts Master Backlog | Transition to `PO_DECISION_REQUIRED` with both sources |
| Master Backlog Section B vs Section F collision | Transition to `BLOCKED` (collision is always reported, never merged) |
| Approved plan contradicts PO decision | Transition to `PO_DECISION_REQUIRED` with plan reference and PO citation |
| Document missing | Transition to `BLOCKED` with reason "Required document not found: `<path>`" |
| Document unreadable | Transition to `BLOCKED` with reason "Required document unreadable: `<path>`" |
| Document empty | Transition to `BLOCKED` with reason "Required document is empty: `<path>`" |
| Document outside expected directory | Transition to `BLOCKED` with reason "Document outside expected directory: `<path>`" |
| Document is binary | Transition to `BLOCKED` with reason "Document is binary, not text: `<path>`" |
| Multiple ambiguous candidates | Transition to `PO_DECISION_REQUIRED` with candidate list |

---

## 6. Output Contract

### 6.1 Base Fields (every phase)

```typescript
interface NormalizedResult {
  status: ResultStatus;
  storyId: string | null;
  phase: WorkflowPhase;
  changedFiles: readonly string[];
  tests: CheckResult;
  typecheck: CheckResult;
  build: CheckResult;
  errors: readonly Diagnostic[];
  warnings: readonly Diagnostic[];
  git: GitResultSummary;
  nextRecommendedState: WorkflowPhase;
  summary: string;
  raw: unknown;
}
```

### 6.2 Phase-Specific Required Fields

| Phase | `tests` | `typecheck` | `build` | `changedFiles` | `summary` must contain |
|---|---|---|---|---|---|
| PLAN | `skippedCheck` | `skippedCheck` | `skippedCheck` | `[]` | Readiness verdict |
| BUILD | OpenCode self-reported (parsed, not trusted) | OpenCode self-reported (parsed, not trusted) | OpenCode self-reported (parsed, not trusted) | authorized paths only | Files created/modified, scope validation result |
| TEST | real result (mandatory) | real result (mandatory) | real result (mandatory) | from git diff | Exact pass/fail counts, E2E status |
| REVIEW | `skippedCheck` | `skippedCheck` | `skippedCheck` | from git diff | Findings list, blocking findings count |
| VERIFY | real result (mandatory) | real result (mandatory) | real result (mandatory) | from git diff | Verdict |

### 6.3 Process Outcome vs Workflow Result

The `raw` field carries the `ProcessExecutionOutcome`. The orchestrator MUST NOT derive `status: "success"` from `process.status === "success"` alone. The `ResultParser` independently evaluates phase-specific evidence.

---

## 7. Evidence Contract

### 7.1 Unified Check-State Taxonomy

Every check MUST be classified into exactly one of four logical states. The `CheckStatus` type adds a fifth value `waived` to represent a specific sub-case of `unavailable`.

**Logical states (4):**

| State | Meaning | Blocks `VERIFIED`? | Can be waived? |
|---|---|---|---|
| `passed` | The check ran and passed | No | N/A |
| `failed` | The check ran and did not pass | Yes | No |
| `not_applicable` | The check does not apply to this story | No | N/A |
| `unavailable` | The check could not run | Yes | Only by explicit PO waiver |

**CheckStatus values (5):**

| CheckStatus | Equivalent logical state | Meaning |
|---|---|---|
| `passed` | `passed` | The check ran and passed |
| `failed` | `failed` | The check ran and did not pass |
| `not_applicable` | `not_applicable` | The check does not apply to this story |
| `unavailable` | `unavailable` | The check could not run, no waiver granted |
| `waived` | `unavailable` (with waiver) | The check could not run, and a PO waiver was granted |

**Reconciliation rule:** `waived` is a sub-state of `unavailable`. A check with `status: "waived"` is logically `unavailable` but has a valid PO waiver attached. The `unavailable` status without a waiver is the "bare" unavailable state.

### 7.2 Derived Fields (never contradictory)

The `CheckEvidence` interface includes fields that are **derived from `status`** and MUST NOT be set independently. This prevents contradictory combinations.

```typescript
type CheckStatus = "passed" | "failed" | "not_applicable" | "unavailable" | "waived";

interface CheckEvidence {
  readonly checkId: string;
  readonly status: CheckStatus;
  readonly phase: WorkflowPhase;
  // Derived fields — computed from status, never set independently:
  readonly applicable: boolean;      // false iff status === "not_applicable"
  readonly mandatory: boolean;      // from check definition, not from status
  readonly executed: boolean;        // true iff status === "passed" || status === "failed"
  readonly passed: boolean;         // true iff status === "passed"
  // Execution details:
  readonly exitCode: number | null;
  readonly command: string | null;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly durationMs: number | null;
  readonly total: number | null;
  readonly failed: number | null;
  readonly skipped: number | null;
  readonly evidence: string | null;
  readonly executedAt: string | null;
  readonly waiver: {
    readonly actor: string;
    readonly reason: string;
    readonly grantedAt: string;
  } | null;
  readonly notes: readonly string[];
}
```

**Derivation rules:**

| Status | `applicable` | `executed` | `passed` | `waiver` |
|---|---|---|---|---|
| `passed` | `true` | `true` | `true` | `null` |
| `failed` | `true` | `true` | `false` | `null` |
| `not_applicable` | `false` | `false` | `false` | `null` |
| `unavailable` | `true` | `false` | `false` | `null` |
| `waived` | `true` | `false` | `false` | `{ actor, reason, grantedAt }` |

**Contradiction prevention:** The orchestrator MUST NOT construct a `CheckEvidence` where, for example, `status: "passed"` but `passed: false`, or `status: "not_applicable"` but `applicable: true`. These fields are derived, not independent.

### 7.3 Explicit Examples

**Example 1 — Applicable check that passed:**
```json
{
  "checkId": "backend-typecheck",
  "status": "passed",
  "phase": "TESTING",
  "applicable": true,
  "mandatory": true,
  "executed": true,
  "passed": true,
  "exitCode": 0,
  "command": "npx",
  "args": ["tsc", "--noEmit"],
  "cwd": "<repo>/backend",
  "durationMs": 12500,
  "waiver": null
}
```

**Example 2 — Not-applicable check:**
```json
{
  "checkId": "frontend-build",
  "status": "not_applicable",
  "phase": "TESTING",
  "applicable": false,
  "mandatory": false,
  "executed": false,
  "passed": false,
  "exitCode": null,
  "command": null,
  "args": [],
  "cwd": null,
  "durationMs": null,
  "waiver": null,
  "notes": ["Story does not touch frontend code"]
}
```

**Example 3 — Failed check:**
```json
{
  "checkId": "backend-focused-tests",
  "status": "failed",
  "phase": "TESTING",
  "applicable": true,
  "mandatory": true,
  "executed": true,
  "passed": false,
  "exitCode": 1,
  "command": "npx",
  "args": ["vitest", "run", "src/foo.test.ts"],
  "cwd": "<repo>/backend",
  "durationMs": 3200,
  "total": 10,
  "failed": 2,
  "skipped": 0,
  "waiver": null
}
```

**Example 4 — Waived check:**
```json
{
  "checkId": "headed-e2e",
  "status": "waived",
  "phase": "TESTING",
  "applicable": true,
  "mandatory": true,
  "executed": false,
  "passed": false,
  "exitCode": null,
  "command": null,
  "args": [],
  "cwd": null,
  "durationMs": null,
  "waiver": {
    "actor": "po",
    "reason": "Browser environment not available in CI",
    "grantedAt": "2026-09-28T10:00:00Z"
  }
}
```

### 7.4 Waiver Policy

**Approved waiver behavior (not blocked):**

| Rule | Value |
|---|---|
| Can a check be waived? | Only `unavailable` checks. `failed` checks can NEVER be waived. |
| Who can grant a waiver? | Only a human PO. The orchestrator cannot self-waive. OpenCode cannot grant a waiver. |
| How is a waiver recorded? | `orchestrator waive <workflow-id> <check-name> --actor <id> --reason <text>` |
| What evidence is retained? | The waiver record: check name, actor, reason, timestamp. |
| Is an automatic waiver possible? | **No.** There is no automatic waiver path. |
| Can a waiver be revoked? | Yes, by the same actor who granted it. Revocation is recorded as a `WorkflowEvent`. A revoked waiver reverts the check to `unavailable`. |
| Waiver authority | Only `human`, `po`, or `chatgpt-po` actors. The orchestrator cannot self-waive. |

**Resolved waiver behavior (PO decisions):**

| Rule | Status |
|---|---|
| Does a waiver expire? | **APPROVED (PD-9) — Option A: Waivers do not expire.** A waiver remains valid until explicitly revoked or its workflow run ends. No time-based expiration. No expiry timestamps, timers, or expiry-related transitions. |
| Can a waiver cover multiple checks? | **APPROVED (PD-10) — Option A: Phase-specific, single-check waiver.** A waiver applies to exactly one explicitly identified check within a phase. Multiple checks require separate waivers. |
| Can a waived check satisfy a transition requirement? | **Yes, with valid waiver.** A waiver can satisfy a transition requirement only if the check was `unavailable` (not `failed`) and a valid PO waiver exists. PD-9 (expiration) is resolved — waivers do not expire. PD-10 (scope) is resolved — phase-specific, single-check waiver. A waived check CAN satisfy a transition requirement when the waiver is valid. |

**Waiver recording vs waiver scope:**

| Concept | Description |
|---|---|
| **Waiver recording** | The data model represents a waiver as associated with a specific check name. This is a representation choice, not a policy decision. |
| **Waiver scope policy** | **APPROVED (PD-10) — Option A: Phase-specific, single-check waiver.** A waiver applies to exactly one explicitly identified check within a phase. Multiple checks require separate waivers. |

**Waiver validity:** A waiver is valid only if:
1. It was granted by a human PO (`human`, `po`, or `chatgpt-po` actor)
2. It has not been revoked
3. It applies to exactly one explicitly identified check within a phase (PD-10 — APPROVED)
4. The workflow run is still active (waivers become invalid when the workflow run ends)

**PD-9 resolved (APPROVED):** Waivers do not expire. A waiver remains valid until explicitly revoked or its workflow run ends. No time-based expiration is implemented.

**PD-10 resolved (APPROVED):** Phase-specific, single-check waiver. A waiver applies to exactly one explicitly identified check within a phase. Multiple checks require separate waivers.

### 7.5 E2E-Specific Rules

| Scenario | E2E state | Blocks `VERIFIED`? | Can be waived? |
|---|---|---|---|
| Story is backend-only | `not_applicable` | No | N/A |
| Story is frontend-only, E2E applicable | `mandatory` | Yes — must pass | No |
| E2E applicable but browser unavailable | `unavailable` | Yes | Only by explicit PO waiver (phase-specific, single-check per PD-10) |
| E2E ran headless only | `failed` | Yes | No — headless is never a substitute |
| E2E ran headed and passed | `passed` | No | N/A |
| E2E reported passed but headed execution not explicitly confirmed | `failed` | Yes | No — headed status must be proven, not inferred |

**Headed evidence requirement (PO Decision 1 — APPROVED):** A passed E2E result is accepted only when explicit evidence confirms headed execution. The orchestrator MUST NOT infer headed execution from a generic pass result, a successful process exit code, or an unverified assertion. A reported passed E2E result without explicit headed-execution evidence MUST be classified as `failed`.

### 7.6 Transition Evidence Requirements

| Transition | Trigger | Required evidence |
|---|---|---|
| `PLANNING -> PLAN_READY` | `PLAN_PRODUCED` | Story resolved from Section B; plan contains `READY FOR BUILD`; PO decision citations present; OpenCode process completed |
| `PLAN_READY -> WAITING_FOR_APPROVAL` | `APPROVAL_REQUESTED` | Plan stored; approval request recorded |
| `WAITING_FOR_APPROVAL -> BUILDING` | `APPROVAL_GRANTED` | Human approval recorded; actor is `human`/`po`/`chatgpt-pro`; plan hash matches approved plan |
| `BUILDING -> TESTING` | `BUILD_PRODUCED` | Git diff shows only authorized paths; no scope deviation. OpenCode self-reported test results are parsed but NOT required to pass. |
| `TESTING -> REVIEWING` | `TESTS_COMPLETED` | All `mandatory` checks passed; all `mandatory` typechecks passed; all `mandatory` builds passed; E2E `mandatory` -> passed, or `not_applicable`, or `waived` with valid waiver (phase-specific, single-check per PD-10); no test weakened or skipped |
| `REVIEWING -> VERIFYING` | `REVIEW_COMPLETED` | Review completed; `blockingFindings: []`; all findings have `file:line` evidence |
| `VERIFYING -> VERIFIED` | `VERIFICATION_COMPLETED` | All acceptance criteria evidence `Met` (missing evidence -> NOT VERIFIED); all `mandatory` checks passed or validly waived; at least one mandatory check executed and passed (Rev 19); scope clean (scope unavailable -> fail closed, Rev 19); git integrity confirmed (HEAD change -> BLOCKED, Rev 19); no unresolved blockers; no `unavailable` checks without valid waiver (phase-specific, single-check per PD-10) |

---

## 8. Approval Contract

### 8.1 Representation

```typescript
type ApprovalDecision = "ApprovalRequired" | "ApprovalGranted" | "ApprovalRejected";
```

### 8.2 Who Can Grant Approval

| Actor kind | Can grant? | Notes |
|---|---|---|
| `human` | Yes | The operator running the CLI |
| `po` | Yes | The Product Owner |
| `chatgpt-po` | Yes | ChatGPT acting as PO |
| `agent` | **No** | Not a valid `ApprovalActorKind` |
| `orchestrator` | **No** | Never self-approves |
| `opencode` | **No** | Executor, not authority |

### 8.3 Approval Identity and Human Attestation (C-10)

The `--actor` value is an **asserted actor identifier**, not a verified identity.

| Aspect | What the orchestrator does | What the orchestrator does NOT do |
|---|---|---|
| `--actor <id>` value | Records the string verbatim as `actor.id` | Does NOT cryptographically verify the identity |
| `actor.kind` | Validates it is one of `human`, `po`, `chatgpt-po` | Does NOT verify the actor is actually human |
| Human attestation | The act of running `orchestrator approve ... grant` from the CLI IS the human attestation | Does NOT claim the CLI verifies user identity |
| What `human`, `po`, `chatgpt-po` represent | **Actor classifications** declared by the operator | NOT verified identities |
| Invalid/missing actor | `decide()` throws `ApprovalRequiredError` if `actor.kind` is invalid. Empty `actor.id` is accepted (recorded as `""`). | Does NOT reject empty actor IDs (known limitation) |
| What the orchestrator claims | "Approval was explicitly granted by a human" (meaning: a human ran the CLI command) | Does NOT claim "identity was cryptographically verified" |

**The orchestrator does not invent an authentication system.** An AI-generated plan, recommendation, or self-reported approval is NOT treated as human authorization. Only a human running the CLI command can produce `ApprovalGranted`.

**Additional authentication mechanism:** This is **future scope** and would require a PO decision. It is NOT part of Stage 2C.

### 8.4 What Is Being Approved

The approval is **plan-specific** and **workflow-run-specific**. It approves a specific plan document (identified by plan hash) for a specific workflow run.

### 8.5 Plan Change Invalidates Approval (PD-3 — preserved)

The approval record stores a plan hash. If the plan changes (different hash), the approval no longer matches. The orchestrator MUST detect this mismatch and refuse to advance. This decision is NOT reopened.

### 8.6 Approval Expiration (PD-2 — APPROVED)

**PD-2 is APPROVED.** Approval validity is 48 hours from the recorded approval timestamp.

**Approved expiration semantics:**
- Approval validity is 48 hours from the recorded approval timestamp.
- Check expiration immediately before the transition to BUILDING.
- If approval has expired before BUILDING, reject the transition, invalidate the approval, record an expiration event, and remain in `WAITING_FOR_APPROVAL`.
- Require fresh approval before proceeding.
- Once BUILDING has started, approval expiration must not interrupt the active build.

**Expiration check procedure:**
1. Immediately before the `WAITING_FOR_APPROVAL -> BUILDING` transition, the orchestrator checks whether the approval has expired.
2. If the approval timestamp is more than 48 hours old, the approval is expired.
3. If expired: reject the transition, invalidate the approval, record an `APPROVAL_EXPIRED` `WorkflowEvent`, and remain in `WAITING_FOR_APPROVAL`.
4. If not expired: proceed with the transition to `BUILDING`.

**Behaviors preserved (not affected by PD-2):**
- Plan change invalidates approval (PD-3 — approved, see 8.5)
- Approval revocation only from `WAITING_FOR_APPROVAL` (see 8.8)
- Cancellation as operational stop (PO Decision 2 — approved, see 8.10)

**Waiver authority:** Only a human PO can grant an approval. The orchestrator cannot self-approve.

**Revocation:** An approval can be revoked only from `WAITING_FOR_APPROVAL` (see 8.8). Once `BUILDING` starts, the approval cannot be revoked through the approval mechanism. The human can request cancellation (see 8.10).

### 8.7 Can Approval Be Reused?

**No.** Each workflow run creates a new approval request.

### 8.8 Approval Rejection and Revocation (C-6)

**State machine constraint:** `APPROVAL_REJECTED` is only permitted from `WAITING_FOR_APPROVAL` (line 134 of `workflow.ts`). There is no `APPROVAL_REJECTED` trigger from `BUILDING`, `TESTING`, `REVIEWING`, or `VERIFYING`.

| Question | Answer |
|---|---|
| Can approval be revoked after BUILDING starts? | **No.** The state machine does not permit `APPROVAL_REJECTED` from any phase other than `WAITING_FOR_APPROVAL`. |
| Which workflow states permit rejection? | Only `WAITING_FOR_APPROVAL`. |
| What happens when a human runs `orchestrator approve <workflow-id> reject` after BUILDING starts? | The orchestrator records the rejection attempt but CANNOT transition the workflow. The workflow continues in its current phase. The rejection is logged as an event but has no state transition effect. |
| What happens when a rejection arrives while a process is running? | The orchestrator does NOT terminate the running process. The process continues to completion. The rejection is recorded but has no effect on the current phase. |
| How are partial modifications handled? | If the workflow is in `BUILDING` when a rejection is attempted, the orchestrator completes the current phase, evaluates scope, and transitions normally. The rejection is surfaced to the human as a warning. |
| How does the orchestrator record the resulting state? | The rejection attempt is recorded as a `WorkflowEvent` with `note: "Rejection attempted but not permitted from phase <X>"`. The workflow state is unchanged. |
| Can the human stop a running workflow? | **Yes, via cancellation** (see 8.10). Cancellation is not the same as rejection. |

**Fail-closed behavior:** If a rejection is attempted from a phase other than `WAITING_FOR_APPROVAL`, the orchestrator:
1. Records the attempt as a `WorkflowEvent`
2. Logs a warning: "Rejection not permitted from phase `<X>`. Workflow continues."
3. Does NOT change the workflow state
4. Does NOT terminate any running process
5. Surfaces the warning to the human

**No new transitions are introduced.** The existing state machine is preserved.

### 8.9 Execution Behavior After Approval (PD-5 — clarified)

After a human grants approval:
1. The orchestrator transitions `WAITING_FOR_APPROVAL -> BUILDING` via `APPROVAL_GRANTED`.
2. The orchestrator MAY continue automatically through the permitted implementation workflow (`BUILDING -> TESTING -> REVIEWING -> VERIFYING`) without additional human confirmation between phases.
3. The human CAN intervene at any point by running `orchestrator approve <workflow-id> reject` (which is logged but does not transition the state) or by requesting cancellation (see 8.10).
4. The orchestrator does NOT require additional human confirmation between phases after approval is granted.
5. The approval gate is preserved: the initial `PLAN_READY -> BUILDING` transition always requires explicit approval.

### 8.10 Cancellation Contract (C1 — new in Revision 6)

**Definition:** Cancellation is a human-requested **operational stop** of the workflow after the current phase completes. Cancellation is NOT the same as approval revocation. Revocation is a state-machine transition (`APPROVAL_REJECTED`) only available from `WAITING_FOR_APPROVAL`. Cancellation is a flag checked between phases and does not revoke or withdraw previously granted approval. (PO Decision 2 — APPROVED)

**Cancellation and approval boundary:**

| Rule | Value |
|---|---|
| Can cancellation grant approval? | **No.** Cancellation MUST NOT grant approval. |
| Can cancellation revoke approval? | **No.** Cancellation MUST NOT revoke approval. |
| Can cancellation permit reuse of an earlier approval? | **No.** Cancellation MUST NOT automatically permit reuse of an earlier approval. |
| Does cancellation affect the approval record? | **No.** Cancellation does not affect the approval record. |
| Can cancellation bypass pending PO decisions? | **No.** Cancellation MUST NOT introduce an approval-expiration or non-expiration default. PD-2 is resolved (48-hour validity). |

**Cancellation while waiting for approval — four cases:**

| Case | Scenario | Behavior |
|---|---|---|
| **1. Rejection before cancellation** | Human runs `orchestrator approve <workflow-id> reject` while in `WAITING_FOR_APPROVAL`, before any cancellation request | Workflow transitions to `REJECTED` via `APPROVAL_REJECTED`. This is the preferred outcome when the human wants to stop the workflow. |
| **2. Cancellation while awaiting approval** | Human requests cancellation while in `WAITING_FOR_APPROVAL`, before any approval response | Workflow transitions to `BLOCKED` via `EXTERNAL_BLOCK` (operational stop). The approval request remains in place but is not acted upon. |
| **3. Approval received after cancellation** | Human granted approval after cancellation was requested (while workflow was in `BLOCKED`) | The approval response is recorded as a `WorkflowEvent` but MUST NOT restart or advance the cancelled workflow. The workflow remains in `BLOCKED`. |
| **4. Subsequent resume attempt** | Human attempts to resume or continue a cancelled workflow | The orchestrator MUST NOT resume a cancelled workflow. A new workflow run must be started. The cancelled workflow remains in `BLOCKED` (terminal state). |

**Rules for all cases:**
- Cancellation does NOT grant approval
- Cancellation does NOT revoke approval
- A cancelled workflow MUST NOT advance using an outstanding approval request
- An approval response received for a cancelled workflow MUST NOT restart or advance that workflow
- The workflow remains in `BLOCKED` (terminal state) until a new workflow run is started
- Approval expiration is defined (PD-2 — APPROVED: 48-hour validity, checked before BUILDING transition)

**Deterministic cancellation behavior:**
1. The human requests cancellation via the CLI.
2. The orchestrator sets a `cancelRequested` flag on the workflow run.
3. If the workflow is in `WAITING_FOR_APPROVAL`, the orchestrator transitions to `BLOCKED` via `EXTERNAL_BLOCK`.
4. If the workflow is in an active phase, the current phase completes normally, then the orchestrator checks the flag and transitions to `BLOCKED` if cancellation was requested.
5. The approval record is unchanged.
6. Approval expiration is defined (PD-2 — APPROVED: 48-hour validity, checked before BUILDING transition).

**Which phases allow cancellation:**

| Phase | Cancellation permitted? | Behavior |
|---|---|---|
| `WAITING_FOR_APPROVAL` | Yes | Rejection via `APPROVAL_REJECTED` (preferred) or cancellation flag |
| `BUILDING` | Yes | Cancel flag set. Current phase completes. No new phase started. |
| `TESTING` | Yes | Cancel flag set. Current phase completes. No new phase started. |
| `REVIEWING` | Yes | Cancel flag set. Current phase completes. No new phase started. |
| `VERIFYING` | Yes | Cancel flag set. Current phase completes. No new phase started. |
| `PLANNING` | Yes | Cancel flag set. Current phase completes. No new phase started. |
| `PLAN_READY` | Yes | Cancel flag set. No approval requested. |
| `REQUESTED` | Yes | Cancel flag set. No planning started. |

**Cancellation scenarios:**

| Scenario | Description | Behavior |
|---|---|---|
| **Before a phase starts** | Cancel requested while the workflow is in a phase that has not yet started its primary work (e.g., `REQUESTED`, `PLAN_READY`) | Cancel flag set. The workflow transitions to `BLOCKED` before the next phase begins. No new phase is started. |
| **Between phases** | Cancel requested after a phase completes but before the next phase starts | Cancel flag set. The orchestrator checks the flag before evaluating the next transition. Workflow transitions to `BLOCKED` instead of advancing. |
| **During a running phase** | Cancel requested while a phase is actively executing (e.g., `BUILDING`, `TESTING`) | Cancel flag set. The current phase completes normally. The orchestrator checks the flag after the phase completes. Workflow transitions to `BLOCKED` instead of advancing. |

**Does cancellation terminate the executing process?**

**No.** The orchestrator does NOT terminate a running OpenCode process. Terminating a process mid-operation could leave the repository in an inconsistent state (partial file writes, locked files, etc.). Instead:

1. The orchestrator sets a `cancelRequested` flag on the workflow run.
2. The current phase completes normally.
3. Before starting the next phase, the orchestrator checks the flag.
4. If `cancelRequested` is true, the orchestrator transitions to `BLOCKED` with reason "Cancellation requested by human."

**Cancellation and failure precedence (Consistency Fix 1):**

Failure transitions take precedence over cancellation. The orchestrator evaluates cancellation **only after a phase completes successfully** and before advancing to the next phase. If a phase fails, the appropriate failure transition is applied — cancellation does not replace or mask a failure.

| Phase outcome | Cancel flag set? | Behavior |
|---|---|---|
| Phase completes successfully | Yes | Transition to `BLOCKED` (cancellation) |
| Phase completes successfully | No | Evaluate normal transition to next phase |
| Phase fails (any failure trigger) | Yes | Apply failure transition; cancel flag is ignored |
| Phase fails (any failure trigger) | No | Apply failure transition |

**Cancellation cannot hide a scope violation, test failure, guard violation, or any other failure.** The failure transition is always evaluated first.

**How cancellation is recorded:**

```typescript
interface CancellationRecord {
  readonly workflowId: string;
  readonly requestedAt: string;
  readonly requestedBy: string; // actor ID
  readonly phaseAtRequest: WorkflowPhase;
  readonly note: string;
}
```

The cancellation is recorded as a `WorkflowEvent` with type `CANCELLATION_REQUESTED`.

**What happens to partial changes and evidence:**

| Item | Behavior |
|---|---|
| Partial file changes | **Preserved.** The orchestrator does NOT revert partial changes. They are surfaced to the human. |
| Partial test evidence | **Preserved.** Any test results collected before cancellation are retained in the workflow run state. |
| Git baseline | **Unchanged.** The baseline captured at workflow start remains the reference point. |
| OpenCode process | **Allowed to complete.** The process is not terminated. |

**How the system prevents execution from continuing after cancellation:**

1. The `cancelRequested` flag is set on the workflow run.
2. After the current phase completes, the orchestrator checks the flag before evaluating the next transition.
3. If `cancelRequested` is true, the orchestrator does NOT evaluate the normal transition. Instead, it transitions to `BLOCKED` via `EXTERNAL_BLOCK` with reason "Cancellation requested by human."
4. The workflow run is now in a terminal state. No further execution is possible.

**Cancellation vs Rejection:**

| Aspect | Rejection | Cancellation |
|---|---|---|
| Mechanism | State-machine transition (`APPROVAL_REJECTED`) | Flag checked between phases |
| Available from | `WAITING_FOR_APPROVAL` only | Any active phase |
| Effect on running process | None (process continues) | None (process continues) |
| Effect on workflow state | Transitions to `REJECTED` | Transitions to `BLOCKED` after current phase |
| Partial changes | N/A (no execution yet) | Preserved and surfaced |
| Terminal state | `REJECTED` | `BLOCKED` |

**Cancellation is an approved mechanism (PO Decision 2).** It does not require new state-machine transitions. It uses the existing `EXTERNAL_BLOCK` trigger to transition to `BLOCKED`. This is consistent with the existing state machine.

---

## 9. Scope Contract

### 9.1 Explicit File-Operation Permissions (C7)

Path authorization does NOT implicitly authorize deletion or renaming. The approved plan MUST explicitly declare which file operations are permitted for each path.

```typescript
interface FilePermission {
  readonly path: string;
  readonly operations: readonly ("create" | "modify" | "delete" | "rename")[];
}
```

| Rule | Value |
|---|---|
| Missing path permissions | If a path is not listed in the approved plan, it is **unauthorized**. No implicit permission is granted. |
| Missing operation permissions | If a path is listed but no operations are declared, **no operations are permitted**. The path is blocked. |
| Explicitly permitted operations | Only the operations explicitly listed in the approved plan are permitted. |
| Paths outside approved scope | **Unauthorized.** No implicit permission. |
| File deletion | Requires explicit `delete` operation in the plan. |
| File rename | Requires explicit `rename` operation in the plan. |
| Directories | Directories are NOT authorized. Only exact file paths are authorized. |
| Newly created files | Must be explicitly listed in the plan with `create` operation. |
| Files discovered only during execution | **Unauthorized.** If OpenCode creates a file not listed in the plan, it is a scope violation. |

**Blocking behavior:** If a requested operation is not explicitly permitted:
1. The orchestrator records the unauthorized path and operation
2. Transitions to `SCOPE_VIOLATION`
3. The unauthorized paths and their attempted operations are recorded in the workflow run
4. The human is notified with the exact paths and operations

### 9.2 Scope Authorization Precedence (C7 — new in Revision 6)

The existing `GuardScope` interface has `allowedPrefixes` and `allowedExactPaths`. The `FilePermission` interface is a new addition for Stage 2C. The `GuardScope` is extended to include `filePermissions`:

```typescript
interface GuardScope {
  readonly allowedPrefixes: readonly string[];
  readonly allowedExactPaths: readonly string[];
  readonly filePermissions: readonly FilePermission[];
}
```

**Authorization evaluation rules:**

| Priority | Field | Role |
|---|---|---|
| 1 (highest) | `filePermissions` | When non-empty, this is the **authoritative** scope. Only paths listed here are authorized, and only for the operations explicitly listed. |
| 2 | `allowedExactPaths` | Exact file paths that are authorized. Used when `filePermissions` is empty. |
| 3 (lowest) | `allowedPrefixes` | Path prefixes that are authorized (e.g., `src/` authorizes all files under `src/`). Used when `filePermissions` is empty. |

**Evaluation procedure:**

1. If `filePermissions` is non-empty:
   - A path is authorized **only** if it appears in `filePermissions`.
   - Only the operations listed for that path are permitted.
   - `allowedExactPaths` and `allowedPrefixes` are **ignored**.
2. If `filePermissions` is empty:
   - A path is authorized if it matches `allowedExactPaths` OR `allowedPrefixes`.
   - All operations (`create`, `modify`, `delete`, `rename`) are permitted for authorized paths.
3. If all three are empty:
   - The scope is empty. No paths are authorized. This is the safe default.

**Conflict resolution:**

| Scenario | Resolution |
|---|---|
| Path in `filePermissions` AND `allowedExactPaths` | `filePermissions` wins. Only operations listed in `filePermissions` are permitted. |
| Path in `filePermissions` AND `allowedPrefixes` | `filePermissions` wins. Only operations listed in `filePermissions` are permitted. |
| Path in `allowedExactPaths` AND `allowedPrefixes` | Path is authorized (either match suffices). All operations permitted. |
| Path in neither `allowedExactPaths` nor `allowedPrefixes` | Unauthorized. |
| Path matches `allowedPrefixes` but not in `filePermissions` (when `filePermissions` is non-empty) | Unauthorized. `filePermissions` is authoritative. |

**Fail-safe behavior:** If authorization cannot be determined for a path (e.g., the path is ambiguous, the scope is malformed, or the path matches conflicting rules):
1. The orchestrator transitions to `BLOCKED` with reason "Scope authorization cannot be determined for path `<path>`."
2. The path and scope state are recorded in the workflow run.
3. The human is notified with the exact path and scope configuration.
4. No further workflow action is taken.

### 9.3 Unauthorized Path Handling

When `GitGuard.evaluate()` returns `allowed: false`:
1. The orchestrator immediately transitions to `SCOPE_VIOLATION`
2. The unauthorized paths are recorded in the workflow run
3. The human is notified with the exact paths and their git states
4. No further workflow action is taken

---

## 10. Git Safety Contract

### 10.1 Prohibited Operations (preserved from Stage 2A)

```
add, am, checkout, clean, commit, merge, mv, pull, push,
rebase, reset, restore, revert, rm, stash, switch
```

### 10.2 Permitted Read-Only Operations

```
diff, log, rev-parse, status, ls-files
```

### 10.3 Git Content-Hash Contract (C1 — proposed extension)

**Note:** The content-hash model described in this section is a **proposed Stage 2C extension**. The existing Stage 2A `GitSnapshot` does not include `contentHashes`. The existing `evaluateGuard` uses flag comparison (`stateFlags`) only. The content-hash-based attribution model described below is contract behavior that requires implementation.

**Extended snapshot model:**

```typescript
interface GitSnapshot {
  readonly capturedAt: string;
  readonly headCommit: string | null;
  readonly stagedPaths: readonly string[];
  readonly modifiedPaths: readonly string[];
  readonly untrackedPaths: readonly string[];
  readonly renamedPaths: readonly { from: string; to: string }[];
  readonly deletedPaths: readonly string[];
  readonly porcelainStatus: string;
  /**
   * Content hashes for pre-existing modified and untracked files.
   * Key: repository-relative path. Value: SHA-256 hash of file content.
   * Only populated for files that were modified or untracked at baseline.
   * Files that cannot be read are recorded with hash value null.
   */
  readonly contentHashes: Readonly<Record<string, string | null>>;
}
```

**Capture procedure:**

| Step | Command | What it captures |
|---|---|---|
| 1 | `git rev-parse HEAD` | HEAD commit hash |
| 2 | `git status --porcelain=v1` | Full porcelain status (audit trail) |
| 3 | `git diff --cached --name-only` | Staged paths |
| 4 | `git diff --name-only` | Unstaged modified paths |
| 5 | `git ls-files --others --exclude-standard` | Untracked paths |
| 6 | Parse porcelain status for `R` and `D` states | Renamed and deleted paths |
| 7 | Read content of pre-existing modified and untracked files | Content hashes |

**Content hash calculation:**

For each file in `modifiedPaths` and `untrackedPaths` at baseline:
1. Read the file content
2. Calculate SHA-256 hash
3. Store in `contentHashes[path]`

If a file cannot be read (permissions, binary, etc.):
1. Store `contentHashes[path] = null`
2. Record a warning: "Cannot hash file `<path>`: `<reason>`"

### 10.4 Change Attribution Rules (C3 — new in Revision 6)

**Critical distinction:** Content hashes prove that file content changed. They do NOT prove which process or user made the change. Attribution is established by combining content hashes with the authorized scope. **Hash-based attribution is an assumption, not definitive proof of which actor made a change.** Concurrent external changes to files in authorized scope may be misattributed to the workflow.

**Baseline policy:** The baseline captured at workflow start is the single reference point for all attribution decisions. The baseline distinguishes between:
- **Clean files:** Files that were unmodified and tracked at baseline. Changes to these files are assumed workflow-attributed if they are in authorized scope.
- **Pre-existing modified or untracked files:** Files that were modified or untracked at baseline. These files are **protected.** Any change to a protected file during workflow execution is **BLOCKED** regardless of scope authorization, because attribution cannot be confirmed.

**Protected-file rule takes precedence:** If a file was modified or untracked at baseline, the protected-file rule (BLOCKED on change) takes precedence over any scope authorization. A file may be in authorized scope, but if it was modified at baseline and changes again, it is BLOCKED.

**File set definitions:**

| Set | Definition |
|---|---|
| **Baseline path set (B)** | The set of all repository-relative file paths tracked by Git at baseline, plus all untracked paths at baseline. |
| **Current path set (C)** | The set of all repository-relative file paths tracked by Git at the current snapshot, plus all untracked paths at the current snapshot. |
| **Evaluation path set (E)** | The union of B and C: E = B ∪ C. This is the complete set of paths that MUST be evaluated. |

**Change classification:** For each path p in E, the orchestrator classifies the change as exactly one of:

| Classification | Condition | Detection |
|---|---|---|
| **Added** | p is in C and not in B | File exists in current snapshot but not in baseline |
| **Deleted** | p is in B and not in C | File exists in baseline but not in current snapshot |
| **Modified** | p is in B and C, and content hash differs | File exists in both snapshots with different content |
| **Renamed** | Porcelain `R` status maps a source path to a destination path | Both source and destination paths must be evaluated |
| **Unchanged** | p is in B and C, and content hash matches | File exists in both snapshots with identical content |

**Comparison procedure:** The orchestrator compares the complete baseline and current Git path sets to detect ALL changes. The comparison MUST account for:
- **Added files:** Files present in current path set but not in baseline path set
- **Modified files:** Files present in both path sets with different content hashes
- **Deleted files:** Files present in baseline path set but not in current path set (MUST NOT be omitted merely because they no longer exist in the current snapshot)
- **Renamed files:** Files with `R` status in porcelain (both source and destination paths must be checked)
- **Clean tracked files changed during execution:** Files that were clean at baseline but are now modified
- **Pre-existing modified and untracked files:** Files that were modified or untracked at baseline

**Complete path set comparison:** The orchestrator MUST compare the union of all paths from both snapshots (baseline and current), not just the paths present in the current snapshot. This ensures:
- Deleted files remain visible to the comparison (they are in the baseline path set but not the current path set)
- Added files are detected (they are in the current path set but not the baseline path set)
- Renamed files are detected via porcelain `R` status
- No file can bypass attribution or authorization checks by virtue of being absent from the current snapshot

**Authorization reconciliation:** The attribution algorithm MUST be reconciled with the contract's existing authorization rules defined in Section 9.2. The orchestrator MUST resolve effective authorization before evaluating any changed path.

**Effective authorization resolution:**

Before evaluating any path in the evaluation path set E, the orchestrator MUST resolve the effective authorization model:

| Condition | Effective authorization | Operation-level restrictions |
|---|---|---|
| `filePermissions` is non-empty | `filePermissions` is authoritative. Only paths listed are authorized, and only for the operations explicitly listed. `allowedExactPaths` and `allowedPrefixes` are ignored. | Operation-specific: only the operations listed for each path in `filePermissions` are permitted. |
| `filePermissions` is empty, `allowedExactPaths` or `allowedPrefixes` is non-empty | `allowedExactPaths` and `allowedPrefixes` are used. A path is authorized if it matches either. | The existing contract (Section 9.2) permits all operations (`create`, `modify`, `delete`, `rename`) for authorized paths. **Note:** The fallback representation does not support operation-specific permissions. This is preserved as existing contract behavior. |
| All three are empty | No paths are authorized. Safe default. | No operations are permitted. |

**Authorization and attribution precedence:**
1. First, resolve the effective authorization model (see above)
2. Then, for each path, determine if it is authorized under the effective model
3. Then, determine attribution (using the content-hash comparison)
4. If a file is unauthorized, it is **Out-of-scope** regardless of attribution
5. If a file is authorized but attribution is ambiguous, it is **Unattributable** (BLOCKED)
6. A file's presence in the current snapshot does not establish authorization
7. Human confirmation of attribution does not authorize an otherwise prohibited change

**File operation types:**

| Operation | Detection | Attribution |
|---|---|---|
| **Added** (new file) | File exists in current snapshot but not in baseline | If authorized under effective model: **Assumed workflow-attributed.** If not: **Out-of-scope.** |
| **Modified** (content changed) | File exists in both baseline and current, content hash differs | If clean at baseline and authorized under effective model: **Assumed workflow-attributed.** If protected (modified/untracked at baseline): **Unattributable.** |
| **Deleted** | File exists in baseline but not in current snapshot | If authorized under effective model with `delete` operation: **Assumed workflow-attributed.** If not: **Out-of-scope.** |
| **Renamed** | Porcelain shows `R` status | Both source and destination paths must be checked (see below). |
| **Unchanged** | File exists in both, content hash matches | **OK.** No action needed. |

**Rename handling:** For a rename operation (porcelain `R` status), the orchestrator MUST check both paths:
- **Source path (old path):** Evaluated as a deletion. Must have `delete` operation authorized under the effective authorization model.
- **Destination path (new path):** Evaluated as a creation. Must have `create` operation authorized under the effective authorization model.
- Both paths must be authorized under the effective model
- If either path is unauthorized: **Out-of-scope.** SCOPE_VIOLATION.
- If the source path was protected (modified/untracked at baseline): **Unattributable.** BLOCKED.

**Four attribution categories:**

| Category | Definition | Detection | Behavior |
|---|---|---|---|
| **Pre-existing, unchanged** | File was modified or untracked at baseline and remains unchanged | Content hash matches baseline | **OK.** No action needed. File is protected. |
| **Assumed workflow-attributed** | File was clean at baseline, is in authorized scope, and was added, modified, deleted, or renamed | Content hash differs from baseline (or file is new/renamed/deleted) | **OK.** Change is assumed workflow-attributed based on scope authorization and content-hash change. This is a conservative assumption, not definitive proof. |
| **Out-of-scope** | File is outside authorized scope | File appears in diff but not authorized under effective model | **SCOPE_VIOLATION.** Unauthorized regardless of who made the change. |
| **Unattributable** | File's content hash is null (unreadable), or file was modified/untracked at baseline and changed during execution | Content hash is null, or protected file changed | **BLOCKED.** Surfaced for human review. |

**Baseline gaps:** A baseline gap is a change that existed before orchestration began (i.e., the file was already modified or untracked at baseline). Baseline gaps are handled by the protected-file rule:
- If a baseline gap file remains unchanged: **OK.** Protected.
- If a baseline gap file changes during execution: **Unattributable.** BLOCKED. The orchestrator cannot determine whether the change was made by the workflow or by an external process that existed before orchestration.

**Ambiguous attribution:** If the orchestrator cannot determine whether a change was made by the workflow or by an external process, the change is **Unattributable** and the workflow is **BLOCKED.** Ambiguous attribution MUST NOT silently pass verification. The orchestrator MUST surface the ambiguity for human review.

**Attribution decision procedure:**

The orchestrator evaluates every path p in the evaluation path set E = B ∪ C:

0. **Resolve effective authorization model** (see "Effective authorization resolution" above). Determine whether `filePermissions` is authoritative or whether `allowedExactPaths`/`allowedPrefixes` apply.

1. **For each path p in E:**
   a. Determine the change classification (Added, Deleted, Modified, Renamed, Unchanged).
   b. If p was modified or untracked at baseline (protected file):
      - If content hash matches baseline: **Pre-existing, unchanged.** Protected.
      - If content hash differs: **Unattributable.** BLOCKED. (Protected-file rule takes precedence over scope.)
      - If content hash is null: **Unattributable.** BLOCKED.
   c. If p was clean at baseline and is authorized under the effective model:
      - If p is new (not in B): **Assumed workflow-attributed** (created by workflow) — only if `create` operation is authorized.
      - If p is deleted (not in C): **Assumed workflow-attributed** (deleted by workflow) — only if `delete` operation is authorized.
      - If content hash differs from baseline: **Assumed workflow-attributed** (modified by workflow) — only if `modify` operation is authorized.
      - If content hash is null: **Unattributable.** BLOCKED.
   d. If p was clean at baseline and is NOT authorized under the effective model:
      - If p is new: **Out-of-scope.** SCOPE_VIOLATION.
      - If p is deleted: **Out-of-scope.** SCOPE_VIOLATION.
      - If content hash differs: **Out-of-scope.** SCOPE_VIOLATION.
      - If content hash is null: **Unattributable.** BLOCKED.
   e. If p is a rename source path: check `delete` operation authorization under the effective model.
   f. If p is a rename destination path: check `create` operation authorization under the effective model.
   g. If authorization cannot be determined for p (ambiguous scope, malformed rules, conflicting permissions): **BLOCKED** with reason "Scope authorization cannot be determined for path `<p>`."

2. **If any path is Out-of-scope:** transition to `SCOPE_VIOLATION`.
3. **If any path is Unattributable:** transition to `BLOCKED` with reason "Cannot establish attribution for file `<path>`."
4. **If authorization cannot be determined for any path:** transition to `BLOCKED` with reason "Scope authorization cannot be determined for path `<path>`."

**Fail-closed principle:** The algorithm NEVER grants authorization merely because a file is absent, renamed, or deleted. A file's absence from the current snapshot (deletion) does not bypass authorization checks — the deletion itself must be authorized. A file's absence from the baseline (addition) does not bypass authorization checks — the addition itself must be authorized. If authorization cannot be deterministically established for any path in E, the workflow is **BLOCKED.**

**Concurrent changes during execution:**

If a file is modified by the workflow AND by an external process concurrently:
1. The content hash will differ from baseline
2. The orchestrator cannot distinguish workflow changes from external changes
3. If the file is authorized under the effective model: the change is attributed to the workflow (conservative assumption)
4. If the file is not authorized under the effective model: the orchestrator transitions to `BLOCKED` with reason "Concurrent modification detected for file `<path>`. Cannot establish attribution."

**The orchestrator MUST NOT:**
- Revert pre-existing modifications
- Clean pre-existing untracked files
- Stage pre-existing changes
- Overwrite pre-existing work
- Silently incorporate pre-existing changes

### 10.5 Comparison Rules

| Scenario | Detection method | Fail-closed behavior |
|---|---|---|
| Pre-existing modified file remains untouched | Content hash matches | OK |
| Pre-existing modified file changes again | Content hash differs | **BLOCKED** — surfaced for human review; cannot confirm workflow attribution |
| Pre-existing untracked file remains untouched | Content hash matches | OK |
| Pre-existing untracked file is changed | Content hash differs | **BLOCKED** — surfaced for human review; cannot confirm workflow attribution |
| Pre-existing untracked file is deleted | File no longer exists | **BLOCKED** — surfaced for human review; cannot confirm workflow attribution |
| New authorized file created | File appears in snapshot, in scope | OK if `create` authorized |
| Unauthorized file created | File appears in snapshot, not in scope | **SCOPE_VIOLATION** |
| File renamed | Porcelain shows `R` status | OK if `rename` authorized |
| File deleted | Porcelain shows `D` status | OK if `delete` authorized |
| Staged file changed again | In both `stagedPaths` and `modifiedPaths` | Evaluate each component |
| HEAD changes | `headCommit` differs from baseline | **BLOCKED** — human must reconcile (including during `VERIFYING`; Rev 19) |
| Content hash is null (file unreadable) | Cannot determine if file changed | **BLOCKED** — surface as uncertainty |

**Protected pre-existing files:** When a pre-existing modified or untracked file changes during workflow execution, the orchestrator transitions to `BLOCKED` with reason "Pre-existing file `<path>` was modified. Cannot confirm workflow attribution." The file is surfaced for human review.

**Protected-file human review:**

| Aspect | Rule |
|---|---|
| How is review recorded? | The human records their review as a `WorkflowEvent` with type `PROTECTED_FILE_REVIEW`. The event includes: the file path, the reviewer's actor ID, the review outcome, and a timestamp. |
| What are the valid review outcomes? | **Confirmed workflow-related:** The human confirms the change was made by the workflow. **Confirmed external:** The human confirms the change was made by an external process. **Unresolved:** The human cannot determine the source. |
| What permits verification to resume? | Verification resumes ONLY when the human records a `PROTECTED_FILE_REVIEW` event with outcome **Confirmed workflow-related** for each blocked protected file. The orchestrator re-evaluates the file's attribution. |
| What happens if the review outcome is "Confirmed external"? | The workflow transitions to `BLOCKED` with reason "Protected file `<path>` was modified by an external process." The workflow cannot resume. |
| What happens if the review outcome is "Unresolved"? | The workflow remains `BLOCKED`. Verification cannot resume until the human provides a definitive outcome. |
| Does review grant approval to modify protected files? | **No.** Human review resolves the attribution question for the current change only. It does NOT grant ongoing permission to modify protected files. Future changes to the same file are still blocked. |
| Can the orchestrator proceed without human review? | **No.** Verification is blocked until human review is recorded for each blocked protected file. |

**Review vs attribution confirmation vs authorization:**

| Concept | What it is | What it is NOT |
|---|---|---|
| **Review** | The human examines the change and records their determination of its origin. | Review is NOT authorization to modify the file. |
| **Attribution confirmation** | The human confirms that a specific change was made by the workflow (or by an external process). | Attribution confirmation is NOT scope authorization. It does not permit future modifications. |
| **Authorization** | The approved plan's `filePermissions` grant permission to perform specific operations on specific paths. | Authorization is NOT granted by human review. It is granted only by the approved plan. |

**Human review MUST NOT:**
- Override scope restrictions
- Grant implementation permission
- Authorize modifications to protected files
- Bypass the approved plan's `filePermissions`

**The orchestrator does NOT:**
- Silently incorporate pre-existing changes
- Attribute changes to the workflow without human review
- Treat human review as authorization to modify protected files

---

## 11. PO Decision Contract

### 11.1 Behavior When OpenCode Reports `PO_DECISION_REQUIRED`

1. Stop immediately.
2. Record the exact gap.
3. Transition to `PO_DECISION_REQUIRED` (terminal state).
4. Surface to the human/PO.
5. Do NOT: guess, infer, invent, select a default, ask OpenCode to decide.

### 11.2 Surfacing Format

```typescript
interface PoDecisionRequest {
  workflowId: string;
  storyId: string;
  phase: WorkflowPhase;
  decisionNeeded: string;
  sources: readonly string[];
  options?: readonly string[];
  blocking: true;
}
```

---

## 12. Failure Contract

### 12.1 Failure States

| State | Meaning | Terminal? |
|---|---|---|
| `BLOCKED` | Cannot proceed; needs information or resolution | Yes |
| `FAILED` | A step failed; verification did not pass | Yes |
| `REJECTED` | Human explicitly rejected the plan | Yes |
| `SCOPE_VIOLATION` | Work went beyond the approved story | Yes |
| `PO_DECISION_REQUIRED` | A locked decision is missing, ambiguous, or conflicting | Yes |

### 12.2 Which Phase Can Produce Which State

Verified against `workflow.ts`:

| Phase | Can produce |
|---|---|
| `REQUESTED` | `BLOCKED`, `FAILED` |
| `PLANNING` | `PLAN_READY`, `BLOCKED`, `SCOPE_VIOLATION`, `PO_DECISION_REQUIRED`, `FAILED` |
| `PLAN_READY` | `WAITING_FOR_APPROVAL`, `BLOCKED`, `SCOPE_VIOLATION`, `PO_DECISION_REQUIRED`, `FAILED` |
| `WAITING_FOR_APPROVAL` | `BUILDING`, `REJECTED`, `BLOCKED`, `SCOPE_VIOLATION`, `PO_DECISION_REQUIRED`, `FAILED` |
| `BUILDING` | `TESTING`, `BLOCKED`, `SCOPE_VIOLATION`, `PO_DECISION_REQUIRED`, `FAILED` |
| `TESTING` | `REVIEWING`, `BLOCKED`, `SCOPE_VIOLATION`, `PO_DECISION_REQUIRED`, `FAILED` |
| `REVIEWING` | `VERIFYING`, `BLOCKED`, `SCOPE_VIOLATION`, `PO_DECISION_REQUIRED`, `FAILED` |
| `VERIFYING` | `VERIFIED`, `BLOCKED`, `SCOPE_VIOLATION`, `PO_DECISION_REQUIRED`, `FAILED` |

---

## 13. Verification Contract

### 13.1 Per-Check Evidence Model (C4)

Replace ambiguous Boolean fields with a coherent, extensible per-check evidence model:

```typescript
type CheckStatus = "passed" | "failed" | "not_applicable" | "unavailable" | "waived";

interface CheckEvidence {
  readonly checkId: string;
  readonly status: CheckStatus;
  readonly phase: WorkflowPhase;
  readonly applicable: boolean;
  readonly mandatory: boolean;
  readonly executed: boolean;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly command: string | null;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly durationMs: number | null;
  readonly total: number | null;
  readonly failed: number | null;
  readonly skipped: number | null;
  readonly evidence: string | null;
  readonly executedAt: string | null;
  readonly waiver: {
    readonly actor: string;
    readonly reason: string;
    readonly grantedAt: string;
  } | null;
  readonly notes: readonly string[];
}
```

### 13.2 Overall Verification Result

```typescript
interface VerificationResult {
  readonly verdict: "VERIFIED" | "NOT_VERIFIED";
  readonly checks: readonly CheckEvidence[];
  readonly blockers: readonly string[];
  readonly timestamp: string;
}
```

**Derivation rules:**
1. If any mandatory check has status `failed` -> `NOT_VERIFIED`
2. If any mandatory check has status `unavailable` (without a waiver) -> `NOT_VERIFIED`
3. If any mandatory check has status `waived` AND the waiver is valid (granted by human PO, not revoked, workflow run active, phase-specific single-check scope per PD-10) -> continue evaluation (waiver is valid)
4. If any mandatory check has status `waived` AND the waiver is invalid (revoked, workflow run ended, or scope not authorized) -> treat as `unavailable`
5. If any mandatory check has status `unavailable` (including `waived` with invalid waiver) -> `NOT_VERIFIED`
6. If any mandatory check has status `not_applicable` -> continue evaluation (only if justified, see below)
7. If all mandatory checks have status `passed`, `waived` (with valid waiver), or `not_applicable` AND at least one mandatory check has status `passed` (i.e., at least one executed mandatory check — Rev 19) -> `VERIFIED`. A `waived` check satisfies its own individual check requirement but does NOT satisfy this minimum-evidence condition.
8. If any non-mandatory check has status `failed` -> `NOT_VERIFIED` (non-mandatory failures still block)
9. If any non-mandatory check has status `unavailable` (without a waiver) -> continue evaluation (does not block)
10. If any check has contradictory evidence (e.g., `status: "passed"` but `passed: false`) -> `NOT_VERIFIED` with blocker "Contradictory evidence for check `<id>`"
11. (Rev 19) If acceptance-criteria or PO-decision evidence is missing or unavailable -> `NOT_VERIFIED` (fail closed). The orchestrator MUST NOT treat absence of evidence as satisfaction.
12. (Rev 19) If the approved plan scope is unavailable or cannot be established, the scope-clean check is `unavailable` and verification fails closed. A permissive fallback scope MUST NOT be used as proof of scope compliance.

**Minimum evidence for VERIFIED (Rev 19):** `VERIFIED` requires at least one mandatory check with status `passed` — i.e., at least one mandatory check that was actually executed by the orchestrator and passed. An empty set of applicable mandatory checks MUST NOT result in `VERIFIED`. The orchestrator MUST NOT produce `VERIFIED` without meaningful verification evidence. (Rev 19 revision of the Rev 10 minimum-evidence rule: a set consisting only of `waived` and/or `not_applicable` mandatory checks does NOT satisfy this minimum; a `waived` check still contributes to the overall evaluation and may satisfy its own transition requirement, but it is not an executed check.)

**Mandatory vs non-mandatory checks:**

| Check type | `passed` | `failed` | `waived` | `unavailable` | `not_applicable` |
|---|---|---|---|---|---|
| Mandatory | Contributes to VERIFIED | Blocks VERIFIED | Contributes to VERIFIED (with valid waiver) | Blocks VERIFIED | Contributes to VERIFIED (only if justified) |
| Non-mandatory | Contributes to VERIFIED | Blocks VERIFIED | Contributes to VERIFIED (with valid waiver) | Does NOT block VERIFIED | Contributes to VERIFIED |

**Not-applicable justification:** A mandatory check marked `not_applicable` must have a documented, justified reason in the `notes` field. The orchestrator MUST NOT mark a mandatory check `not_applicable` to bypass verification. Acceptance criteria, scope validation, required review, and other mandatory verification MUST NOT be bypassed by marking checks `not_applicable`.

**All-not_applicable case:** If every check (mandatory and non-mandatory) has status `not_applicable`, the verdict is `NOT_VERIFIED` with blocker "No applicable mandatory checks found. Verification cannot be completed." An all-`not_applicable` result MUST NOT automatically produce `VERIFIED`.

**Accepted states for VERIFIED:** A check contributes to `VERIFIED` only if its status is one of:
- `passed` — the check ran and passed
- `waived` — the check was unavailable and a valid PO waiver exists (granted by human PO, not revoked, workflow run active, phase-specific single-check scope per PD-10)
- `not_applicable` — the check does not apply to this story (only if justified)

**Blocking states:** A check blocks `VERIFIED` if its status is one of:
- `failed` — the check ran and did not pass (cannot be waived, mandatory or not)
- `unavailable` (mandatory only) — the check could not run and no valid PO waiver exists

**Waiver validity:** A waiver is valid only if ALL of the following conditions are met:
1. It was granted by a human PO (`human`, `po`, or `chatgpt-po` actor)
2. It has not been revoked
3. It applies to exactly one explicitly identified check within a phase (PD-10 — APPROVED)
4. The workflow run is still active (waivers become invalid when the workflow run ends)

**PD-9 resolved (APPROVED):** Waivers do not expire. A waiver remains valid until explicitly revoked or its workflow run ends. No time-based expiration is implemented.

**PD-10 resolved (APPROVED):** Phase-specific, single-check waiver. A waiver applies to exactly one explicitly identified check within a phase. Multiple checks require separate waivers.

**Waiver revocation semantics (PD-9 — APPROVED):**
- Only the actor who granted a waiver may revoke it.
- Waiver grants and revocations are recorded as `WorkflowEvent` entries.
- (Rev 19) The `WorkflowEvent` model is extended with auditable waiver entries: a waiver grant event (granting actor, check id, phase, reason, timestamp) and a waiver revocation event (revoking actor, check id, phase, timestamp). A revocation event is valid only when the revoking actor equals the granting actor; otherwise the waiver remains valid (PD-9). Grant and revocation events are part of the run's audit trail and MUST be recorded by the waiver-granting mechanism.
- Revocation applies to subsequent evaluations of the affected check.
- Revocation does not retroactively invalidate completed checks.
- Revocation does not interrupt an already-running phase. It is applied when the affected check is evaluated again.
- All waivers become invalid when their workflow run ends.

The orchestrator MUST NOT:
- Implement time-based waiver expiration (PD-9 resolved — waivers do not expire).
- Allow a waiver to be revoked by an actor other than the granting actor.
- Retroactively invalidate completed checks when a waiver is revoked.
- Interrupt a running phase when a waiver is revoked.
- Apply a waiver to a check other than the explicitly identified check it was granted for (PD-10 resolved — phase-specific, single-check waiver).

**Note on rule 2 and rule 3:** A check with a valid waiver has status `waived`, not `unavailable`. Rule 2 applies only to checks with status `unavailable` that have no waiver. Rule 3 applies to checks with status `waived`. These are mutually exclusive states.

### 13.3 Independent Verification Boundaries (C3)

| Check | Execution method | Can satisfy mandatory requirement? | Evidence source |
|---|---|---|---|
| Typecheck | Orchestrator executes via `ProcessRunner` | Yes — independently executed | Orchestrator's own `ProcessExecutionOutcome` |
| Build | Orchestrator executes via `ProcessRunner` | Yes — independently executed | Orchestrator's own `ProcessExecutionOutcome` |
| Focused tests | Orchestrator executes via `ProcessRunner` | Yes — independently executed | Orchestrator's own `ProcessExecutionOutcome` |
| Regression tests | Orchestrator executes via `ProcessRunner` | Yes — independently executed | Orchestrator's own `ProcessExecutionOutcome` |
| Headed E2E | OpenCode-reported only (**sole exception** — see below) | Yes — if passed with explicit headed evidence. No — if unavailable without valid waiver (phase-specific, single-check per PD-10), or if passed without explicit headed evidence | OpenCode's output, parsed by `ResultParser` |
| Changed files | Orchestrator executes via `ProcessRunner` (git commands) | Yes — independently executed | Orchestrator's own `ProcessExecutionOutcome` |
| Scope clean | Orchestrator evaluates via `GitGuard` | Yes — independently executed | `GitGuard.evaluate()` |
| Review approved | Orchestrator reads review report | Yes — independently validated | Review report content |
| Acceptance criteria | Orchestrator reads PO decision documents | Yes — independently validated | PO decision document content |

**Key principle:** OpenCode-reported test results are NEVER treated as independently executed verification. They are parsed and recorded as OpenCode-reported evidence, but they do not satisfy mandatory verification requirements. Only orchestrator-executed checks satisfy mandatory requirements.

**Sole exception — Headed E2E:** Headed E2E is the **only** check that may be satisfied by OpenCode-reported evidence. This exception is narrowly scoped: it applies ONLY to headed E2E, and ONLY when explicit headed-execution evidence is provided. No other check may be satisfied by OpenCode-reported evidence. The orchestrator does NOT independently execute headed E2E (see Section 13.4 for the rationale).

### 13.4 OpenCode-Reported vs Orchestrator-Executed Evidence (C2 — new in Revision 6)

**Critical distinction:** There are two categories of test evidence:

| Category | Definition | Source | Trust level |
|---|---|---|---|
| **Orchestrator-executed** | The orchestrator ran the test command itself via `ProcessRunner` and has direct evidence (exit code, stdout, stderr) | Orchestrator's own `ProcessExecutionOutcome` | **Authoritative.** Can satisfy mandatory verification. |
| **OpenCode-reported** | OpenCode ran the test as part of `/ai-build` or `/ai-test` and reported the result in its output. The orchestrator parses this from OpenCode's stdout/stderr. | OpenCode's output, parsed by `ResultParser` | **Non-authoritative.** Does NOT satisfy mandatory verification. Recorded as information only. |

**Rules:**

1. OpenCode-reported test results are **never** treated as proof of workflow verification.
2. An OpenCode exit code of zero does **not** produce `VERIFIED`.
3. An OpenCode-reported "PASSED" does **not** satisfy a mandatory check.
4. Only orchestrator-executed checks can satisfy mandatory verification requirements. **The sole exception is headed E2E** (see Section 13.3).
5. OpenCode-reported results are recorded in the `raw` field of `NormalizedResult` for audit purposes.

**Which evidence qualifies for mandatory verification:**

| Check | Qualifying evidence | Non-qualifying evidence |
|---|---|---|
| Typecheck | Orchestrator's own `tsc --noEmit` run | OpenCode's reported typecheck result |
| Build | Orchestrator's own `npm run build` run | OpenCode's reported build result |
| Focused tests | Orchestrator's own `vitest run <path>` run | OpenCode's reported test result |
| Regression tests | Orchestrator's own `npm test` run | OpenCode's reported test result |
| Headed E2E | OpenCode-reported headed E2E result with explicit headed-execution evidence (**sole exception**) | Headless E2E (always `failed`); passed without headed evidence (always `failed`) |
| Scope clean | Orchestrator's own `GitGuard.evaluate()` | OpenCode's reported scope status |
| Git integrity | Orchestrator's own git commands | OpenCode's reported git status |

**Headed E2E limitation:** The orchestrator does NOT independently execute headed E2E tests. This is because:
1. Headed E2E requires a browser environment that may not be available
2. Headed E2E is expensive to run
3. Headed E2E results are environment-dependent

**Consequence:** Headed E2E is always OpenCode-reported evidence. It is the **sole exception** to the orchestrator-only verification rule (see Section 13.3). If E2E is mandatory and OpenCode reports it as passed **with explicit headed-execution evidence**, the orchestrator accepts the OpenCode-reported evidence. If E2E is mandatory and OpenCode reports it as passed **without explicit headed-execution evidence**, the orchestrator classifies it as `failed`. If E2E is mandatory and OpenCode reports it as unavailable, the orchestrator requires a PO waiver (phase-specific, single-check per PD-10 — the check remains `unavailable` and blocks `VERIFIED` until a valid waiver exists). If E2E is mandatory and OpenCode reports it as headless, the orchestrator classifies it as `failed`.

**Headed evidence requirement (PO Decision 1 — APPROVED):** The orchestrator MUST NOT infer headed execution from a generic pass result, a successful process exit code, or an unverified assertion. Explicit evidence of headed execution is required for a passed E2E result to be accepted.

**This is explicitly identified as a limitation.** The orchestrator cannot independently verify headed E2E results. This limitation is surfaced in the verification report.

### 13.5 Verification Command Matrix (C8)

Commands are read from `.opencode/ai-workflow-rules.md` Section 8 at runtime. The orchestrator does NOT hardcode commands.

| Check | Command | Arguments | CWD | Applicable when | Mandatory when |
|---|---|---|---|---|---|
| Backend typecheck | `npx` | `["tsc", "--noEmit"]` | `<repo>/backend` | Story touches backend TypeScript | Always (if applicable) |
| Backend focused tests | `npx` | `["vitest", "run", "<path>"]` | `<repo>/backend` | Story has backend testable behavior | Always (if applicable) |
| Backend regression tests | `npm` | `["test"]` | `<repo>/backend` | Story touches existing backend code | Always (if applicable) |
| Frontend typecheck | `npm` | `["run", "typecheck"]` | `<repo>/frontend` | Story touches frontend TypeScript | Always (if applicable) |
| Frontend build | `npm` | `["run", "build"]` | `<repo>/frontend` | Story touches frontend code | Always (if applicable) |
| Frontend focused tests | `npx` | `["vitest", "run", "<path>"]` | `<repo>/frontend` | Story has frontend testable behavior | Always (if applicable) |
| Frontend regression tests | `npm` | `["test"]` | `<repo>/frontend` | Story touches existing frontend code | Always (if applicable) |
| Headed E2E | `npm` | `["run", "test:e2e:headed"]` | `<repo>/frontend` | Story touches frontend and E2E is applicable | Always (if applicable) |
| Git status | `git` | `["status", "--porcelain=v1"]` | `<repo>` | Always | Always |
| Git diff | `git` | `["diff", "--name-only"]` | `<repo>` | Always | Always |
| Git rev-parse | `git` | `["rev-parse", "HEAD"]` | `<repo>` | Always | Always |

**Command conversion:** The governance document specifies commands as `cd backend; npm test`. The orchestrator converts this to:
- `command: "npm"`, `args: ["test"]`, `cwd: "<repo>/backend"`

This avoids shell interpretation. The `cwd` is set to the package directory.

**If a required command is missing from the governance document:** The check is `unavailable`. The orchestrator does NOT invent commands.

### 13.6 BUILDING and TESTING Evidence Distinction (C21)

| Aspect | BUILDING (OpenCode-reported) | TESTING (Orchestrator-executed) |
|---|---|---|
| Who executes | OpenCode via `/ai-build` | Orchestrator via `ProcessRunner` |
| Evidence type | OpenCode-reported | Independently executed |
| Authoritative? | No | Yes |
| Can satisfy transition requirement? | No | Yes |
| What happens on failure? | `BUILDING -> FAILED` via `TESTS_FAILED` | `TESTING -> FAILED` via `TESTS_FAILED` |
| How recorded? | Parsed from OpenCode output, stored as `NormalizedResult` with `raw` field | Stored as `NormalizedResult` with orchestrator's own `ProcessExecutionOutcome` |

**A failed mandatory check in BUILDING is NEVER converted into a successful check through a waiver.** The `BUILDING -> FAILED` via `TESTS_FAILED` transition is fail-closed.

**A waived unavailable check CAN satisfy the `TESTING -> REVIEWING` transition** if:
1. The check was `unavailable` (not `failed`)
2. A PO waiver was recorded
3. The waiver is still valid (not revoked, workflow run active, phase-specific single-check scope per PD-10)
4. The check is not `mandatory` OR the waiver explicitly covers a mandatory check

**Note:** A `waived` check with a valid waiver (granted by human PO, not revoked, workflow run active, phase-specific single-check scope per PD-10) CAN satisfy its individual check requirement for this transition. (Rev 19) This applies to an individual check only; the overall `VERIFIED` minimum-evidence condition still requires at least one executed mandatory check with status `passed`.

---

## 14. Context Contract

### 14.1 Context Flow Between Phases

```
PLANNING -> APPROVED PLAN -> BUILDING -> IMPLEMENTATION RESULT -> TESTING -> TEST EVIDENCE -> REVIEWING -> REVIEW EVIDENCE -> VERIFYING -> VERIFICATION VERDICT
```

### 14.2 What Is Carried Forward vs Freshly Retrieved

| Information | Carried forward | Freshly retrieved |
|---|---|---|
| Story ID | Yes | — |
| Story text | Yes (from stored resolution) | — |
| Approved plan | Yes (from workflow run) | — |
| Authorized paths + operations | Yes (from approved plan) | — |
| PO decision citations | Yes (from stored context) | — |
| Changed file list | — | Yes (from git diff) |
| Test results | — | Yes (fresh run) |
| Review findings | — | Yes (fresh run) |
| Git baseline | Yes (from workflow run) | — |
| Current git state | — | Yes (fresh snapshot) |

### 14.3 Context Size Limits (C9 — revised in Revision 6)

| Limit | Default |
|---|---|
| Maximum total context package size | 100,000 characters |
| Maximum single document size | 50,000 characters |
| All matching PO decision documents | Yes (must all be included) |
| Maximum number of sections per package | 20 |

**Reconciliation of limits with the "all matching PO documents" requirement:**

The requirement to include all matching PO decision documents takes precedence over the total size limit. If including all matching PO documents would exceed 100,000 characters, the orchestrator transitions to `BLOCKED`. The orchestrator does NOT silently exclude PO documents to fit within the limit.

**Deterministic behavior when limits are exceeded:**

| Scenario | Behavior |
|---|---|
| Single document exceeds 50,000 characters | Attempt to load only the relevant section (by heading). If the relevant section alone exceeds 50,000 characters, transition to `BLOCKED`. |
| Total context exceeds 100,000 characters | Transition to `BLOCKED` with reason "Total context size `<N>` exceeds limit of 100,000 characters." Report the exact size and which documents could not be included. |
| Authoritative content would be truncated | **Never truncate.** Transition to `BLOCKED` with reason "Authoritative document `<path>` exceeds size limit and cannot be loaded within context constraints." |
| Non-authoritative content exceeds limit | MAY be truncated. Report truncation in `notes`. |

**Truncation rules:**

| Content type | Truncation behavior |
|---|---|
| Non-authoritative content (derived, reference) | MAY be truncated. Report truncation in `notes`. |
| Authoritative content (master-backlog, user-story, po-decisions, stage-1-opencode-rules, project-instructions) | MUST NOT be truncated. If truncation would be required, transition to `BLOCKED`. |
| Implementation context (derived) | MAY be truncated. Report truncation in `notes`. |
| Test requirements (derived) | MAY be truncated. Report truncation in `notes`. |

**Oversized authoritative content:**

If an authoritative document exceeds 50,000 characters:
1. Attempt to load only the relevant section (by heading).
2. If the relevant section alone exceeds 50,000 characters, transition to `BLOCKED` with reason "Authoritative document `<path>` exceeds size limit and cannot be loaded within context constraints."
3. Do NOT silently truncate authoritative content.

**Missing or unreadable PO decisions:**

| Scenario | Behavior |
|---|---|
| PO decision file missing | Transition to `BLOCKED` with reason "Required PO decision file not found: `<path>`" |
| PO decision file unreadable | Transition to `BLOCKED` with reason "Required PO decision file unreadable: `<path>`" |
| PO decision file empty | Transition to `BLOCKED` with reason "Required PO decision file is empty: `<path>`" |
| PO decision file binary | Transition to `BLOCKED` with reason "Required PO decision file is binary: `<path>`" |

**Required references and dependencies:**

If a required reference cannot be loaded within the context limits:
1. Transition to `BLOCKED` with reason "Required reference `<path>` cannot be loaded within context limits."
2. Do NOT proceed with incomplete authoritative context.

**The orchestrator MUST NOT claim that all documents are included if the context limits prevent it.** The orchestrator reports exactly which documents were included and which could not be loaded.

---

## 15. State Transition Contract

### 15.1 Complete Transition Table (historical — not freshly verified in this task)

**Counting methodology:** This table lists **triples** (from, trigger, to). Multiple triggers may share the same from-to edge. The total number of triples is **58**. The total number of edges (distinct from-to pairs) is **39**.

| FROM | TRIGGER | TO |
|---|---|---|
| `REQUESTED` | `PLAN_REQUESTED` | `PLANNING` |
| `REQUESTED` | `EXTERNAL_BLOCK` | `BLOCKED` |
| `REQUESTED` | `STORY_AMBIGUOUS` | `BLOCKED` |
| `REQUESTED` | `DRAFT_ID_COLLISION` | `BLOCKED` |
| `REQUESTED` | `HARD_FAILURE` | `FAILED` |
| `PLANNING` | `PLAN_PRODUCED` | `PLAN_READY` |
| `PLANNING` | `EXTERNAL_BLOCK` | `BLOCKED` |
| `PLANNING` | `STORY_AMBIGUOUS` | `BLOCKED` |
| `PLANNING` | `DRAFT_ID_COLLISION` | `BLOCKED` |
| `PLANNING` | `SCOPE_VIOLATION_DETECTED` | `SCOPE_VIOLATION` |
| `PLANNING` | `PO_DECISION_REQUIRED` | `PO_DECISION_REQUIRED` |
| `PLANNING` | `HARD_FAILURE` | `FAILED` |
| `PLANNING` | `GUARD_VIOLATION` | `FAILED` |
| `PLAN_READY` | `APPROVAL_REQUESTED` | `WAITING_FOR_APPROVAL` |
| `PLAN_READY` | `EXTERNAL_BLOCK` | `BLOCKED` |
| `PLAN_READY` | `STORY_AMBIGUOUS` | `BLOCKED` |
| `PLAN_READY` | `DRAFT_ID_COLLISION` | `BLOCKED` |
| `PLAN_READY` | `SCOPE_VIOLATION_DETECTED` | `SCOPE_VIOLATION` |
| `PLAN_READY` | `PO_DECISION_REQUIRED` | `PO_DECISION_REQUIRED` |
| `PLAN_READY` | `HARD_FAILURE` | `FAILED` |
| `PLAN_READY` | `GUARD_VIOLATION` | `FAILED` |
| `WAITING_FOR_APPROVAL` | `APPROVAL_GRANTED` | `BUILDING` |
| `WAITING_FOR_APPROVAL` | `APPROVAL_REJECTED` | `REJECTED` |
| `WAITING_FOR_APPROVAL` | `EXTERNAL_BLOCK` | `BLOCKED` |
| `WAITING_FOR_APPROVAL` | `STORY_AMBIGUOUS` | `BLOCKED` |
| `WAITING_FOR_APPROVAL` | `DRAFT_ID_COLLISION` | `BLOCKED` |
| `WAITING_FOR_APPROVAL` | `SCOPE_VIOLATION_DETECTED` | `SCOPE_VIOLATION` |
| `WAITING_FOR_APPROVAL` | `PO_DECISION_REQUIRED` | `PO_DECISION_REQUIRED` |
| `WAITING_FOR_APPROVAL` | `HARD_FAILURE` | `FAILED` |
| `WAITING_FOR_APPROVAL` | `GUARD_VIOLATION` | `FAILED` |
| `BUILDING` | `BUILD_PRODUCED` | `TESTING` |
| `BUILDING` | `EXTERNAL_BLOCK` | `BLOCKED` |
| `BUILDING` | `SCOPE_VIOLATION_DETECTED` | `SCOPE_VIOLATION` |
| `BUILDING` | `PO_DECISION_REQUIRED` | `PO_DECISION_REQUIRED` |
| `BUILDING` | `HARD_FAILURE` | `FAILED` |
| `BUILDING` | `GUARD_VIOLATION` | `FAILED` |
| `BUILDING` | `TESTS_FAILED` | `FAILED` |
| `TESTING` | `TESTS_COMPLETED` | `REVIEWING` |
| `TESTING` | `TESTS_FAILED` | `FAILED` |
| `TESTING` | `HARD_FAILURE` | `FAILED` |
| `TESTING` | `GUARD_VIOLATION` | `FAILED` |
| `TESTING` | `EXTERNAL_BLOCK` | `BLOCKED` |
| `TESTING` | `SCOPE_VIOLATION_DETECTED` | `SCOPE_VIOLATION` |
| `TESTING` | `PO_DECISION_REQUIRED` | `PO_DECISION_REQUIRED` |
| `REVIEWING` | `REVIEW_COMPLETED` | `VERIFYING` |
| `REVIEWING` | `REVIEW_FAILED` | `FAILED` |
| `REVIEWING` | `HARD_FAILURE` | `FAILED` |
| `REVIEWING` | `GUARD_VIOLATION` | `FAILED` |
| `REVIEWING` | `EXTERNAL_BLOCK` | `BLOCKED` |
| `REVIEWING` | `SCOPE_VIOLATION_DETECTED` | `SCOPE_VIOLATION` |
| `REVIEWING` | `PO_DECISION_REQUIRED` | `PO_DECISION_REQUIRED` |
| `VERIFYING` | `VERIFICATION_COMPLETED` | `VERIFIED` |
| `VERIFYING` | `VERIFICATION_FAILED` | `FAILED` |
| `VERIFYING` | `HARD_FAILURE` | `FAILED` |
| `VERIFYING` | `GUARD_VIOLATION` | `FAILED` |
| `VERIFYING` | `EXTERNAL_BLOCK` | `BLOCKED` |
| `VERIFYING` | `SCOPE_VIOLATION_DETECTED` | `SCOPE_VIOLATION` |
| `VERIFYING` | `PO_DECISION_REQUIRED` | `PO_DECISION_REQUIRED` |

**Total triples:** 58

### 15.2 Edge Count Summary

| From phase | Edges | Triples |
|---|---|---|
| `REQUESTED` | 3 | 5 |
| `PLANNING` | 5 | 8 |
| `PLAN_READY` | 5 | 8 |
| `WAITING_FOR_APPROVAL` | 6 | 9 |
| `BUILDING` | 5 | 7 |
| `TESTING` | 5 | 7 |
| `REVIEWING` | 5 | 7 |
| `VERIFYING` | 5 | 7 |
| `VERIFIED` | 0 | 0 |
| Terminal states | 0 | 0 |
| **Total** | **39** | **58** |

### 15.3 Approval-Related Transitions

| Transition | Trigger | Available from |
|---|---|---|
| `WAITING_FOR_APPROVAL -> BUILDING` | `APPROVAL_GRANTED` | `WAITING_FOR_APPROVAL` only |
| `WAITING_FOR_APPROVAL -> REJECTED` | `APPROVAL_REJECTED` | `WAITING_FOR_APPROVAL` only |

**No other approval-related transitions exist.** Rejection is NOT permitted from `BUILDING`, `TESTING`, `REVIEWING`, or `VERIFYING`.

### 15.4 Proof: `PLAN_READY -> BUILDING` Has Exactly One Legal Trigger

From `workflow.ts` lines 124-131, `PLAN_READY` has no edge to `BUILDING`. The only edge to `BUILDING` is from `WAITING_FOR_APPROVAL` via `APPROVAL_GRANTED` (line 133).

### 15.5 Resolved: PLANNING PO_DECISION_REQUIRED Transition (PO Decision 3 — APPROVED)

**Previously:** The `PLANNING` phase had a code-level ambiguity where the `PO_DECISION_REQUIRED` trigger appeared in both the `BLOCKED` edge and the `PO_DECISION_REQUIRED` edge.

**Resolution (PO Decision 3 — APPROVED):** The PO explicitly selected Alternative B. The `PO_DECISION_REQUIRED` trigger from `PLANNING` MUST transition to `PO_DECISION_REQUIRED`, not `BLOCKED`.

**Implementation:** The orchestrator MUST route `PO_DECISION_REQUIRED` from `PLANNING` to `PO_DECISION_REQUIRED`. This is consistent with the `PLAN_READY` behavior, where `PO_DECISION_REQUIRED` only appears in the `PO_DECISION_REQUIRED` edge.

**Note:** The underlying `workflow.ts` code still lists `PO_DECISION_REQUIRED` in both edges. The orchestrator MUST implement the routing decision (Alternative B) regardless of the code-level ambiguity. Stage 2C does NOT modify `workflow.ts`.

---

## 16. Idempotency and Resume Contract

### 16.1 PD-1: In-Memory State for Stage 2C

Workflow state is kept in memory. No persistence to `state/` is implemented.

### 16.2 Behavior for Each Scenario

| Scenario | Behavior |
|---|---|
| OpenCode process crashes | Process outcome is `spawn-error` or `timeout`. Workflow stays in current phase. Human can re-invoke. |
| Orchestrator crashes | **The workflow run is lost.** No terminal transition is claimed. Human starts a new run. |
| Machine restart | Same as orchestrator crash. Run is lost. |
| `/ai-test` run twice | Second run overwrites test evidence. No duplicate runs. |
| `/ai-verify` run twice | Second run overwrites verification evidence. No duplicate runs. |
| Build completed but orchestrator did not record result | Orchestrator detects missing evidence and refuses to advance. |

---

## 17. Human and ChatGPT Interaction Contract

### 17.1 Reporting Events

| Event | When | Format |
|---|---|---|
| `PLAN_READY` | Plan produced | Plan summary + readiness verdict |
| `PO_DECISION_REQUIRED` | Missing/ambiguous PO decision | Exact gap + sources |
| `APPROVAL_REQUIRED` | Plan awaiting approval | Plan reference + approval request |
| `BUILD_STARTED` | Approval granted | Story ID + authorized paths |
| `TEST_FAILED` | Any test failure | Exact test name, assertion, reason |
| `REVIEW_FAILED` | Blocking review findings | Findings list with `file:line` |
| `SCOPE_VIOLATION` | Unauthorized file changed | Exact unauthorized paths |
| `VERIFIED` | All checks passed | Completion report |
| `CANCELLATION_REQUESTED` | Human requests cancellation | Workflow ID, phase at request, timestamp |

### 17.2 No ChatGPT API Integration

Stage 2C does NOT call the ChatGPT API. The human/ChatGPT PO interacts through the CLI.

---

## 18. Security and Prompt-Injection Contract

### 18.1 Threat Model

| Threat | Mitigation |
|---|---|
| Command injection | All arguments passed as array elements, never interpolated |
| Shell injection | `shell: false` always |
| Prompt injection | Content passed as DATA, not authority |
| Instruction substitution | OpenCode output parsed as DATA, never executed |
| Malicious verification evidence | Orchestrator independently validates |
| False file change claims | Cross-checked against actual `git diff` |

### 18.2 DATA vs AUTHORITY

| Category | Treatment |
|---|---|
| **AUTHORITY** (approval records, workflow state, git baseline, authorized paths) | Controlled by the orchestrator. Never influenced by OpenCode output. |
| **DATA** (story text, PO decisions, OpenCode output, test results) | May inform decisions but never becomes authority. |

### 18.3 OpenCode Output Is Never Authority

OpenCode output containing `VERIFIED`, `APPROVED`, `SAFE`, `PASSED` does NOT make the workflow verified, approved, safe, or passed. Only the orchestrator's independent evaluation can produce those states.

### 18.4 Input Sanitization

- Story IDs validated against `US-\d+`
- File paths validated against authorized scope
- No user input interpolated into shell commands
- Message passed to `opencode run` is a single argv element

---

## 19. Stage 2C Non-Goals

| Non-goal | Rationale |
|---|---|
| ChatGPT API integration | Human/ChatGPT PO interacts through CLI |
| Autonomous PO decisions | PO decisions are made by humans |
| Autonomous approval | Approval is always explicit and human |
| Automatic git commit | Human operator decides what enters git |
| Automatic rollback | No git mutation authority |
| Remote OpenCode server | Local CLI only |
| MCP | No MCP integration |
| Browser automation | No browser interaction |
| VS Code UI automation | No IDE integration |
| Multi-story parallel execution | One story at a time |
| Background daemon | Foreground CLI process |
| Production deployment | Development tooling only |
| Cloud orchestration | Local execution only |
| Workflow state persistence | In-memory only (PD-1) |
| Approval revocation after BUILDING | Not permitted by state machine |
| Additional authentication mechanism | Future scope, requires PO decision |

---

## 20. Proposed Implementation Changes

### 20.1 New Files

| File | Purpose |
|---|---|
| `src/story-resolver-impl.ts` | Real `StoryResolver`: reads Master Backlog Section B, cross-checks Section F |
| `src/context-builder-impl.ts` | Real `ContextBuilder`: loads documents from source paths only, with deterministic discovery |
| `src/result-parser-impl.ts` | Real `ResultParser`: parses OpenCode output into `NormalizedResult` |
| `src/git-guard-impl.ts` | Real `GitGuard`: read-only git baseline capture with content-hash support |
| `src/workflow-store.ts` | In-memory workflow run storage |
| `src/scope-resolver.ts` | Converts approved plan into `GuardScope` with explicit file operations |
| `src/independent-validator.ts` | Uses `ProcessRunner` to run verification commands directly |

### 20.2 Modified Files

| File | Change |
|---|---|
| `src/orchestrator.ts` | Implement all workflow methods |
| `src/cli.ts` | Wire workflow commands to real implementations |
| `src/config.ts` | Add `stage: "2C"` support; add `live` execution mode validation |
| `src/errors.ts` | Add new error codes (`WORKFLOW_NOT_FOUND`, `PLAN_NOT_APPROVED`, `CHECK_WAIVER_REQUIRED`) |
| `src/git-guard.ts` | Add extended snapshot model with content hashes; add real implementation class |
| `src/result-parser.ts` | Add real implementation class; extend `VerificationEvidence` to per-check model |
| `src/context-builder.ts` | Add real implementation class with deterministic discovery |
| `src/story-resolver.ts` | Add real implementation class |
| `src/workflow.ts` | Extend `VerificationEvidence`; extend `evaluateVerification()` |

### 20.3 Files NOT Modified

| File | Reason |
|---|---|
| `.opencode/ai-workflow-rules.md` | Authoritative governance |
| `.opencode/commands/ai-*.md` | OpenCode command definitions |
| `src/opencode-process.ts` | Already generic, no changes needed |
| `src/opencode-executable.ts` | Complete and correct |
| `src/approval-gate.ts` | Approval gate is complete |

---

## 21. Proposed Tests

### 21.1 Unit Tests

| Test file | Coverage |
|---|---|
| `test/story-resolver.test.ts` | Section B resolution, Section F collision, retired ID, ambiguous ID |
| `test/context-builder.test.ts` | Document loading, path validation, size limits, conflict handling, deterministic discovery |
| `test/result-parser.test.ts` | OpenCode output parsing, process-vs-workflow distinction, per-check evidence |
| `test/git-guard.test.ts` | Extended baseline with content hashes, all 10 scenarios, pre-existing protection, HEAD change detection |
| `test/scope-resolver.test.ts` | Plan-to-scope conversion, explicit file operations, precedence rules |
| `test/workflow-store.test.ts` | Run creation, phase advancement, event history |
| `test/independent-validator.test.ts` | Re-run typecheck, build, tests via `ProcessRunner`; mismatch handling |

### 21.2 Integration Tests

| Test file | Coverage |
|---|---|
| `test/orchestrator-plan.test.ts` | `start` -> `plan` -> `PLAN_READY` -> `WAITING_FOR_APPROVAL` |
| `test/orchestrator-approval.test.ts` | `requestApproval` -> `decideApproval` -> `BUILDING` or `REJECTED` |
| `test/orchestrator-build.test.ts` | `build` -> `BUILDING` -> `TESTING` or `SCOPE_VIOLATION` |
| `test/orchestrator-test.test.ts` | `test` -> `TESTING` -> `REVIEWING` or `FAILED` |
| `test/orchestrator-review.test.ts` | `review` -> `REVIEWING` -> `VERIFYING` or `FAILED` |
| `test/orchestrator-verify.test.ts` | `verify` -> `VERIFYING` -> `VERIFIED` or `FAILED` |
| `test/orchestrator-run.test.ts` | `run US-XXX` end-to-end |

### 21.3 Safety Invariant Tests (preserved)

| Test file | Coverage |
|---|---|
| `test/safety-invariants.test.ts` | All Stage 2A invariants |
| `test/opencode-adapter.test.ts` | Stage 2B adapter tests |

### 21.4 New Safety Tests

| Test | Coverage |
|---|---|
| `PLAN_READY -> BUILDING` is impossible | Assert `InvalidTransitionError` |
| No auto-approve path exists | Reflect over `ApprovalGate` interface |
| OpenCode exit 0 does not produce `VERIFIED` | Parse mock output |
| Unauthorized file produces `SCOPE_VIOLATION` | Mock git diff |
| Pre-existing change is protected | Mock baseline with pre-existing modification |
| PO decision gap stops workflow | Mock OpenCode output |
| Delete without explicit permission is unauthorized | Path with `modify` only; delete -> `SCOPE_VIOLATION` |
| Rename without explicit permission is unauthorized | Path with `modify` only; rename -> `SCOPE_VIOLATION` |
| HEAD change is detected | Mock `git rev-parse HEAD` |
| In-memory run loss is not a terminal transition | Crash orchestrator |
| BUILDING does not require tests to pass | Assert `BUILD_PRODUCED` only requires scope validation |
| TESTING requires all mandatory checks | Assert `TESTS_COMPLETED` requires all mandatory checks |
| E2E headless is not equivalent to headed | Assert headless E2E is `failed` |
| Waiver requires PO actor | Assert orchestrator cannot self-waive |
| Independent validation mismatch | OpenCode reports pass, orchestrator's run fails -> FAILED |
| Context size limit blocks | Assert oversized context -> `BLOCKED` |
| Document discovery is deterministic | Assert files selected by Epic header |
| Rejection after BUILDING is logged but not transitioned | Assert rejection from BUILDING does not change state |
| Content hash mismatch detects pre-existing file modification | Assert hash comparison works |
| Null content hash blocks | Assert unreadable file -> `BLOCKED` |
| Missing path permission blocks | Assert undeclared path -> unauthorized |
| Missing operation permission blocks | Assert undeclared operation -> unauthorized |
| Per-check evidence model is coherent | Assert no contradictory evidence |
| Verification result derivation is correct | Assert all mandatory checks must pass |
| Cancellation flag stops workflow after current phase | Assert cancel flag prevents next phase |
| Cancellation does not terminate running process | Assert process continues after cancel request |
| Scope precedence: filePermissions overrides allowedExactPaths | Assert filePermissions is authoritative |
| Scope fail-safe: undeterminable authorization -> BLOCKED | Assert BLOCKED on ambiguous scope |
| Waiver revocation reverts check to unavailable | Assert revoked waiver -> unavailable |
| Waiver scope (PD-10 — APPROVED) | Phase-specific, single-check waiver. A waiver applies to exactly one explicitly identified check within a phase. Multiple checks require separate waivers. |

---

## 22. Risks and Open Questions

| # | Risk / Question | Mitigation |
|---|---|---|
| 1 | OpenCode output format not stable | Parse defensively; degrade to `blocked` |
| 2 | Master Backlog format may vary | Parse defensively; report `not-found` |
| 3 | PO decision files may be large | Enforce context-size policy; block rather than truncate |
| 4 | Headed E2E may not run | Report `unavailable`; require PO waiver |
| 5 | Independent validation doubles execution time | Validate only fast checks independently |
| 6 | Content hash comparison performance | Only compare hashes for files in authorized scope |
| 7 | `BUILDING -> FAILED` via `TESTS_FAILED` | Parse OpenCode output; transition to FAILED on self-reported test failure |
| 8 | Concurrent file modifications | Content hash mismatch -> `BLOCKED` |
| 9 | Empty actor ID accepted | Known limitation; recorded as `""` |
| 10 | PLANNING PO_DECISION_REQUIRED ambiguity | **Resolved (PO Decision 3 — APPROVED).** Transition routes to `PO_DECISION_REQUIRED`, not `BLOCKED`. |
| 11 | Cancellation does not stop running process | By design. Process completes; next phase is blocked. |

---

## 23. PO Decisions Required

### PO Decision 1: Headed E2E Evidence (APPROVED)
- **Status:** APPROVED
- **Decision:** A passed E2E result is accepted only when explicit evidence confirms headed execution. A reported passed E2E result without explicit headed-execution evidence is classified as `failed`.
- **Rules:** The orchestrator MUST NOT infer headed execution from a generic pass result, a successful process exit code, or an unverified assertion.
- **Impact:** Sections 7.5, 13.3, 13.4 updated.

### PD-1: Workflow State Persistence
- **Status:** Resolved — In-memory for Stage 2C
- **Impact:** No persistence implemented. Run is lost on crash.

### PD-2: Approval Expiration (APPROVED)
- **Status:** APPROVED
- **Decision:** Approval validity is 48 hours from the recorded approval timestamp. Check expiration immediately before the transition to BUILDING. If approval has expired before BUILDING, reject the transition, invalidate the approval, record an expiration event, and remain in `WAITING_FOR_APPROVAL`. Require fresh approval before proceeding. Once BUILDING has started, approval expiration must not interrupt the active build.
- **Rules:**
  - Approval validity: 48 hours from the recorded approval timestamp.
  - Expiration check: immediately before the `WAITING_FOR_APPROVAL -> BUILDING` transition.
  - If expired: reject the transition, invalidate the approval, record an `APPROVAL_EXPIRED` `WorkflowEvent`, and remain in `WAITING_FOR_APPROVAL`.
  - If not expired: proceed with the transition to `BUILDING`.
  - Once BUILDING has started, approval expiration must not interrupt the active build.
- **Impact:** Sections 8.6, 25.5, 25.6 updated. Implementation blocker removed.

### PD-3: Plan Change Invalidates Approval
- **Status:** Resolved — Preserved existing rule
- **Impact:** Plan hash mismatch -> refuse to advance

### PD-4: Independent Verification Scope
- **Status:** Resolved — Typecheck, build, focused tests, regression tests are independently executed. Headed E2E is OpenCode-reported only.
- **Impact:** Headed E2E cannot be independently verified. This is a known limitation.

### PD-5: Execution Behavior After Approval
- **Status:** Resolved — Orchestrator continues automatically through phases after approval. Human can intervene at any point.
- **Impact:** No additional human confirmation between phases after approval.

### PD-6: Context-Size Policy
- **Status:** Resolved — 100K total, 50K per doc, all matching PO files, 20 sections
- **Impact:** Oversized authoritative content -> `BLOCKED`

### PD-7: Cancellation After BUILDING (PO Decision 2 — APPROVED)
- **Status:** APPROVED
- **Decision:** Cancellation is permitted after BUILDING starts. Cancellation is an **operational stop, not approval revocation**. It does not revoke or withdraw previously granted approval.
- **Mechanism:** The human requests cancellation via the CLI. The orchestrator sets a `cancelRequested` flag. The current phase completes normally. Before the next phase starts, the orchestrator checks the flag and transitions to `BLOCKED` if cancellation was requested.
- **Distinction from revocation:** Revocation (`APPROVAL_REJECTED`) is a state-machine transition only available from `WAITING_FOR_APPROVAL`. Cancellation is an operational stop available from any active phase. Cancellation does not affect the approval record.
- **Precedence:** Failure transitions take precedence over cancellation (see 8.10).

### PO Decision 3: PLANNING PO_DECISION_REQUIRED Transition (APPROVED)
- **Status:** APPROVED
- **Decision:** The `PO_DECISION_REQUIRED` trigger from `PLANNING` MUST transition to `PO_DECISION_REQUIRED`, not `BLOCKED`. This resolves the code-level ambiguity where the trigger appeared in both the `BLOCKED` edge and the `PO_DECISION_REQUIRED` edge.
- **Rules:** The orchestrator MUST route `PO_DECISION_REQUIRED` from `PLANNING` to `PO_DECISION_REQUIRED`. This is consistent with the `PLAN_READY` behavior.
- **Impact:** Sections 3.3, 15.1, 15.5, 22, 25.5, 25.6 updated. Implementation blocker removed.

### PD-8: Additional Authentication Mechanism
- **Status:** Unresolved
- **Question:** Should the orchestrator verify the identity of the person approving?
- **Options:** A) No verification (current) B) OS-level authentication C) External identity provider
- **Implications:** A) Simplest, but actor ID is self-declared B) Adds complexity, may not be possible in all environments C) Major scope addition
- **Essential before implementation?** No — does NOT block implementation. The orchestrator can be implemented without authentication. This is a known limitation and future scope.

### PD-9: Waiver Expiration (APPROVED)
- **Status:** APPROVED
- **Decision:** Option A — Waivers do not expire. A waiver remains valid until explicitly revoked or its workflow run ends.
- **Rules:**
  - No time-based expiration. No expiry timestamps, timers, or expiry-related transitions.
  - Only the actor who granted a waiver may revoke it.
  - Waiver grants and revocations are recorded as `WorkflowEvent` entries.
  - (Rev 19) The `WorkflowEvent` model is extended with auditable waiver entries: a waiver grant event (granting actor, check id, phase, reason, timestamp) and a waiver revocation event (revoking actor, check id, phase, timestamp). A revocation event is valid only when the revoking actor equals the granting actor; otherwise the waiver remains valid (PD-9). Grant and revocation events are part of the run's audit trail and MUST be recorded by the waiver-granting mechanism.
  - Revocation applies to subsequent evaluations of the affected check.
  - Revocation does not retroactively invalidate completed checks.
  - Revocation does not interrupt an already-running phase. It is applied when the affected check is evaluated again.
  - All waivers become invalid when their workflow run ends.
- **Impact:** Sections 7.4, 13.2, 25.5, 25.6 updated. Implementation blocker removed.

### PD-10: Waiver Scope (APPROVED)
- **Status:** APPROVED
- **Decision:** Option A — Phase-specific, single-check waiver. A waiver applies to exactly one explicitly identified check within a phase. Multiple checks require separate waivers.
- **Rules:**
  - A waiver is valid only for the specific check it was explicitly granted for.
  - Multiple checks require separate waivers — one waiver per check.
  - Waiver scope is determined at grant time and cannot be expanded without a new waiver.
  - All other waiver rules (grant, revocation, expiration, audit events) remain unchanged.
- **Impact:** Sections 7.4, 13.2, 25.5, 25.6 updated. Implementation blocker removed.

### Stage 2C-6 Step 5 Audit Decisions (APPROVED — Revision 19)
- **Status:** APPROVED
- **Context:** Stage 2C-6 Step 5 read-only audit of the `verify()` implementation against Revision 18.
- **Decision 1:** Acceptance-criteria and PO-decision verification must fail closed when evidence is missing. A missing or unavailable acceptance-criteria/PO-decision result is `unavailable` and produces `NOT_VERIFIED`; absence of evidence is never treated as satisfaction. (Recorded in §13.2 rule 11, §4.6.)
- **Decision 2:** Scope verification must fail closed when the approved plan scope is unavailable or cannot be established. The scope-clean check is `unavailable`; a permissive fallback scope MUST NOT be used as proof of scope compliance. (Recorded in §13.2 rule 12.)
- **Decision 3:** `WorkflowEvent` is extended to support auditable waiver grants and revocations (grant event: actor, check id, phase, reason, timestamp; revocation event: revoking actor, check id, phase, timestamp; revocation valid only when revoking actor equals granting actor). Grant and revocation events are part of the run's audit trail. PD-9 and PD-10 are preserved. (Recorded in §13.2 and §PD-9.)
- **Decision 4:** A Git HEAD change during verification MUST result in `BLOCKED` (`EXTERNAL_BLOCK`), not `FAILED`. This ratifies §10.5 and supersedes any implementation that routes HEAD change to `VERIFICATION_FAILED`.
- **Decision 5:** `VERIFIED` requires at least one executed mandatory check. A set consisting only of `waived`/`not_applicable` mandatory checks does NOT satisfy the minimum evidence requirement and MUST NOT produce `VERIFIED`. (Recorded in §13.2 minimum evidence, §15.5 transition conditions.)
- **Impact:** Sections 4.6, 10.5, 13.2, 15.5, 25.6 updated. No implementation blockers added; `verify()` remediation is required to conform.

---

## 24. Stage 2C Implementation Sequence

### Phase 2C-1: Foundation
- **Objective:** Add in-memory workflow store, scope resolver, independent validator, new error codes, config updates
- **New files:** `src/workflow-store.ts`, `src/scope-resolver.ts`, `src/independent-validator.ts`
- **Modified files:** `src/errors.ts`, `src/config.ts`
- **Tests:** `test/workflow-store.test.ts`, `test/scope-resolver.test.ts`, `test/independent-validator.test.ts`
- **Dependencies:** None
- **Acceptance criteria:** All existing tests pass. New modules have unit tests.
- **Stop conditions:** Typecheck fails. Any existing test fails.
- **Human review checkpoint:** Review new module interfaces and error codes.

### Phase 2C-2: Story Resolution
- **Objective:** Implement real `StoryResolver`
- **New files:** `src/story-resolver-impl.ts`
- **Modified files:** `src/story-resolver.ts`
- **Tests:** `test/story-resolver.test.ts`
- **Dependencies:** Phase 2C-1
- **Acceptance criteria:** Story resolution works for valid `US-###` IDs. Collisions are reported.
- **Stop conditions:** Typecheck fails. Story resolution returns incorrect results.
- **Human review checkpoint:** Review story resolution logic against Master Backlog format.

### Phase 2C-3: Context Builder
- **Objective:** Implement real `ContextBuilder` with deterministic discovery
- **New files:** `src/context-builder-impl.ts`
- **Modified files:** `src/context-builder.ts`
- **Tests:** `test/context-builder.test.ts`
- **Dependencies:** Phase 2C-1
- **Acceptance criteria:** Documents load from source paths. Missing/ambiguous documents block progress.
- **Stop conditions:** Typecheck fails. Document discovery is non-deterministic.
- **Human review checkpoint:** Review document discovery logic against `.opencode/ai-workflow-rules.md` Section 1.

### Phase 2C-4: Git Guard
- **Objective:** Implement real `GitGuard` with content-hash support
- **New files:** `src/git-guard-impl.ts`
- **Modified files:** `src/git-guard.ts`
- **Tests:** `test/git-guard.test.ts` (extended)
- **Dependencies:** Phase 2C-1
- **Acceptance criteria:** Baseline capture works. All 10 scenarios handled correctly. Pre-existing changes protected.
- **Stop conditions:** Typecheck fails. Any scenario classified incorrectly.
- **Human review checkpoint:** Review extended snapshot model and change classification logic.

### Phase 2C-5: Result Parser
- **Objective:** Implement real `ResultParser` with per-check evidence model
- **New files:** `src/result-parser-impl.ts`
- **Modified files:** `src/result-parser.ts`, `src/workflow.ts`
- **Tests:** `test/result-parser.test.ts`
- **Dependencies:** Phase 2C-1
- **Acceptance criteria:** OpenCode output parsed. Process success does not produce workflow success. Per-check evidence populated.
- **Stop conditions:** Typecheck fails. Process exit 0 produces `VERIFIED`.
- **Human review checkpoint:** Review evidence schema and `evaluateVerification()` logic.

### Phase 2C-6: Orchestrator Implementation
- **Objective:** Implement all `OrchestratorService` workflow methods
- **Modified files:** `src/orchestrator.ts`
- **Tests:** `test/orchestrator-plan.test.ts` through `test/orchestrator-verify.test.ts`
- **Dependencies:** Phases 2C-1 through 2C-5
- **Acceptance criteria:** Each phase transitions correctly. Illegal transitions throw. All safety invariants preserved.
- **Stop conditions:** Typecheck fails. Any transition incorrect. Any safety invariant violated.
- **Human review checkpoint:** Review orchestrator implementation against state machine graph.

### Phase 2C-7: CLI Wiring
- **Objective:** Wire workflow commands to real implementations
- **Modified files:** `src/cli.ts`
- **Tests:** CLI integration tests
- **Dependencies:** Phase 2C-6
- **Acceptance criteria:** All CLI commands work end-to-end. `orchestrator run <US-###>` executes the full workflow.
- **Stop conditions:** Typecheck fails. Any CLI command does not work.
- **Human review checkpoint:** Review CLI surface and output format.

### Phase 2C-8: Safety Verification
- **Objective:** Verify all safety invariants still pass
- **Tests:** Full test suite (`npm test`)
- **Dependencies:** Phase 2C-7
- **Acceptance criteria:** All tests pass. No `.opencode/` files modified.
- **Stop conditions:** Any test fails. Any governance file modified.
- **Human review checkpoint:** Final safety review.

### Phase 2C-9: Documentation
- **Objective:** Update `README.md`
- **Modified files:** `README.md`
- **Dependencies:** Phase 2C-8
- **Acceptance criteria:** Documentation is current and accurate.
- **Stop conditions:** Documentation is stale or inaccurate.
- **Human review checkpoint:** Final documentation review.

---

## 25. Final Consistency Audit

### 25.1 Final Audit

**1. Document consistency (checks performed against the written Revision 18 contract — historical audit; the Revision 19 approved decisions are recorded separately in §23 "Stage 2C-6 Step 5 Audit Decisions" and are not part of this enumeration):**

The following checks are **document-review results only** — they assess internal consistency of the written contract, not fresh source-code or test verification.

| Check | Result |
|---|---|
| Every state transition is explicitly defined | **Pass (document).** 58 triples documented. Historical counts not freshly verified against `workflow.ts` in this task. |
| Every terminal state has unambiguous behavior | **Pass (document).** 5 error terminals + 1 success terminal. All are sinks. |
| Approval requirements agree with transition rules | **Pass (document).** `APPROVAL_GRANTED` only from `WAITING_FOR_APPROVAL`. `APPROVAL_REJECTED` only from `WAITING_FOR_APPROVAL`. |
| Waiver rules agree with verification requirements | **Pass (document).** Only `unavailable` checks can be waived. `failed` checks cannot be waived. Waiver expiration resolved (PD-9 — APPROVED: waivers do not expire). Waiver scope resolved (PD-10 — APPROVED: phase-specific, single-check waiver). Waivers with valid scope contribute to VERIFIED. |
| Git safety rules agree with file-operation permissions | **Pass (document).** No implicit `create` or `modify`. Undeclared paths and operations are unauthorized. Deleted files explicitly evaluated in attribution algorithm. Effective authorization resolved before path evaluation. Fallback representation applied consistently. |
| Evidence statuses agree with verification decisions | **Pass (document).** Per-check evidence model with 5 statuses. Contradictory evidence -> `NOT_VERIFIED`. Mandatory/non-mandatory distinction is consistent. All-not_applicable case produces `NOT_VERIFIED`. A valid waiver may satisfy an individual mandatory check (PD-9 and PD-10 resolved); `VERIFIED` additionally requires at least one executed mandatory check with status `passed` (Rev 19). |
| E2E trust rules agree with mandatory verification requirements | **Pass (document).** Headed E2E requires explicit headed evidence. Passed without headed evidence is `failed`. Headless is `failed`. Unavailable requires waiver. |
| Context limits do not silently discard authoritative material | **Pass (document).** Authoritative content MUST NOT be truncated. Oversized -> `BLOCKED`. |
| All unresolved decisions are clearly distinguished from approved decisions | **Pass (document).** PO Decision 1 (headed E2E), PO Decision 2 (PD-7 cancellation), PO Decision 3 (PLANNING transition), PD-9 (waiver expiration), PD-10 (waiver scope), and PD-2 (approval expiration) APPROVED. PD-8 pending (non-blocking). No unapproved defaults are assumed anywhere in the contract. (Historical Revision 18 audit row; the five Revision 19 audit decisions — acceptance-criteria/PO-decision fail-closed, scope fail-closed, waiver audit events, HEAD-change BLOCKED, executed mandatory check required — are recorded in §23 and §25.6.) |

**2. Source-code verification (checks actually performed against the implementation):**

| Check | Result |
|---|---|
| Source code inspected during this task | **Not performed.** No source code was read or verified in this task. |
| State machine counts freshly verified | **Not verified.** Counts (9 active, 5 terminal, 19 triggers, 39 edges, 58 triples) are historical facts from previous revisions, not freshly verified in this task. |
| Orchestrator workflow methods implemented | **Not implemented.** All workflow methods refuse (historical fact from previous revisions). |
| GitGuard content-hash support implemented | **Not implemented.** `captureBaseline()` / `captureCurrentState()` throw (historical fact from previous revisions). |
| IndependentValidator implemented | **Not implemented.** No independent verification exists (historical fact from previous revisions). |

**3. Test verification (tests actually executed and their recorded results):**

| Check | Result |
|---|---|
| Any tests executed during this task | **Not performed.** No tests were run in this task. |
| Proposed tests executed | **Not run.** 30+ new safety tests are proposed but have not been implemented or executed. |
| Existing tests pass | **Not verified.** No test execution was performed in this task. |

**4. Planned validation (tests and checks proposed but not yet executed):**

| Item | Status |
|---|---|
| 30+ new safety tests | **Planned — not implemented, not executed.** |
| Orchestrator workflow methods | **Planned — not implemented.** |
| GitGuard content-hash support | **Planned — not implemented.** |
| IndependentValidator | **Planned — not implemented.** |
| Full test suite execution | **Planned — not executed.** |

**Overall assessment:** The document is internally consistent. All PO decisions are now resolved: (1) the Git attribution algorithm and waiver validity rules have been corrected in Revision 13 to address issues identified during the Revision 12 review; (2) the authorization model has been reconciled in Revision 14 to ensure the attribution algorithm consistently applies the effective authorization precedence from Section 9.2; (3) the PLANNING PO_DECISION_REQUIRED ambiguity has been resolved in Revision 15 (PO Decision 3 — APPROVED); (4) PD-9 (waiver expiration) has been resolved in Revision 16 (APPROVED — Option A: waivers do not expire); (5) PD-10 (waiver scope) has been resolved in Revision 17 (APPROVED — Option A: phase-specific, single-check waiver); (6) PD-2 (approval expiration) has been resolved in Revision 18 (APPROVED — 48-hour validity, checked before BUILDING transition); (7) five Stage 2C-6 Step 5 audit decisions have been resolved in Revision 19 (acceptance-criteria/PO-decision verification fails closed on missing evidence; scope verification fails closed when approved plan scope is unavailable; `WorkflowEvent` extended for auditable waiver grants/revocations; Git HEAD change during verification results in BLOCKED; `VERIFIED` requires at least one executed mandatory check). Implementation has not begun. Tests have not been run. The contract is **APPROVED** by the Product Owner on 2026-09-29. There are no remaining implementation blockers from pending PO decisions (Revision 19 approved 2026-10-02).

### 25.2 State Counts (historical — not freshly verified in this task)

| Item | Count | Evidence |
|---|---|---|
| Active phases | 9 | Historical — not freshly verified in this task |
| Terminal phases | 5 | Historical — not freshly verified in this task |
| Success terminal | 1 (`VERIFIED`) | Historical — not freshly verified in this task |
| Total phases | 14 | Historical — not freshly verified in this task |
| Transition triggers | 19 | Historical — not freshly verified in this task |
| Total edges | 39 | Historical — not freshly verified in this task |
| Total triples | 58 | Historical — not freshly verified in this task |
| Approval-related transitions | 2 | Historical — not freshly verified in this task |
| Failure outcomes | 5 | Historical — not freshly verified in this task |

### 25.3 Evidence Contract Consistency

| Check | Phase | Applicable? | Mandatory? | Execution method | Evidence source | Waiver? |
|---|---|---|---|---|---|---|
| Focused tests | TESTING | If testable behavior | Yes | `ProcessRunner` | Orchestrator | No |
| Regression tests | TESTING | If touches existing code | Yes | `ProcessRunner` | Orchestrator | No |
| Typecheck | TESTING | If TypeScript | Yes | `ProcessRunner` | Orchestrator | No |
| Build | TESTING | If buildable code | Yes | `ProcessRunner` | Orchestrator | No |
| Headed E2E | TESTING | If frontend + E2E applicable | Yes | OpenCode-reported | OpenCode | Yes (if unavailable) |
| Review approval | REVIEWING | Always | Yes | Orchestrator reads report | Review report | No |
| Acceptance criteria | VERIFYING | Always | Yes | Orchestrator reads PO docs | PO decision docs | No |
| Scope validation | VERIFYING | Always | Yes | `GitGuard.evaluate()` | Orchestrator | No |
| Git integrity | VERIFYING | Always | Yes | `GitGuard.evaluate()` | Orchestrator | No |
| PO decisions resolved | VERIFYING | Always | Yes | Orchestrator reads PO docs | PO decision docs | No |

**Evidence cannot be reused from an earlier workflow run.** Each workflow run collects its own evidence. **A missing result is NOT treated as success.** Missing evidence blocks the transition.

### 25.4 Revision 7 Changes Summary

| Change | Type | Description | Sections affected |
|---|---|---|---|
| PO Decision 1 | PO approval | Headed E2E evidence: passed result requires explicit headed evidence; passed without headed evidence is `failed` | 7.5, 13.3, 13.4 |
| PO Decision 2 | PO approval | PD-7: Cancellation after BUILDING approved as operational stop, not approval revocation | 8.10, 23 |
| Consistency Fix 1 | Consistency | Cancellation and failure precedence: failure transitions take precedence over cancellation | 8.10 |
| Consistency Fix 2 | Consistency | Evidence schema: rule 3 corrected to reference `waived` status instead of `unavailable` with waiver | 7.1, 7.2, 13.2 |
| Consistency Fix 3 | Consistency | Git attribution: content-hash model marked as proposed; protected pre-existing files block verification; attribution documented as assumption | 10.3, 10.4, 10.5 |

### 25.5 Remaining Unresolved Issues

| # | Issue | Type | Blocker? |
|---|---|---|---|
| 1 | **PD-8: Additional Authentication Mechanism** — Actor ID is self-declared, not cryptographically verified. | Pending PO decision | **No** — does not block implementation. Known limitation, future scope. |
| 2 | **Headed E2E cannot be independently verified** — The orchestrator accepts OpenCode-reported headed E2E results with explicit headed evidence. | Known limitation | **No** — explicitly identified as a limitation. Surfaced in verification report. Sole exception to orchestrator-only rule. |
| 3 | **Cancellation does not stop running process** — The orchestrator allows the current phase to complete before honoring cancellation. | By design | **No** — safety measure. Prevents inconsistent repository state. |

### 25.6 Implementation Blockers

**All PO decisions are now resolved** (including the five Stage 2C-6 Step 5 audit decisions approved in Revision 19). There are no remaining implementation blockers from pending PO decisions.

**Does NOT block implementation:**
- PD-8: Additional Authentication Mechanism — The orchestrator can be implemented without authentication. This is a known limitation and future scope.

**Headed E2E limitation:** The orchestrator's acceptance of OpenCode-reported headed E2E results (with explicit headed evidence) is a known limitation, not a blocker. It is the sole exception to the orchestrator-only verification rule and is surfaced in the verification report.

---

**END OF STAGE 2C CONTRACT DESIGN — REVISION 19**

**Status: APPROVED**

**Approval Date:** 2026-10-02 (Revision 19; Revision 18 approved 2026-09-29)

**Approved By:** Product Owner (PO)
