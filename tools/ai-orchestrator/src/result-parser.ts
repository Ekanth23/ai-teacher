/**
 * Stage 2C — Normalized result model with per-check evidence.
 *
 * PURPOSE
 * -------
 * Define one shape that every phase (plan, build, test, review, verify) reports
 * through, so the orchestrator can apply the same safety rules regardless of which
 * Stage 1 command produced the output.
 *
 * STAGE 2B — PROCESS RESULT vs WORKFLOW RESULT
 * -------------------------------------------
 * Stage 2B added a real `opencode run` transport. It produces a
 * `ProcessExecutionOutcome` (see `opencode-process.ts`), which is a DIFFERENT kind
 * of fact:
 *
 *   process result : "the OpenCode process exited 0"      -> success
 *   workflow result: "US-### satisfies its criteria"       -> not derivable
 *
 * STAGE 2C — REAL PARSER
 * ----------------------
 * Stage 2C implements real OpenCode output parsing. The parser:
 *   - Parses ProcessExecutionOutcome into NormalizedResult
 *   - Classifies checks into the per-check evidence model (Section 7, 13.1)
 *   - NEVER derives workflow success from process success alone (Section 6.3)
 *   - Treats OpenCode output as DATA, never AUTHORITY (Section 18)
 *   - Handles malformed, incomplete, missing, and invalid results safely
 *
 * SAFETY INVARIANTS (preserved)
 * ----------------------------
 *   - Process exit code 0 does NOT produce workflow success
 *   - OpenCode output cannot independently establish approval
 *   - OpenCode output cannot authorize scope
 *   - OpenCode output cannot bypass workflow safety checks
 *   - Only the orchestrator's independent evaluation produces workflow verdicts
 */

import { NotImplementedInStageError } from "./errors.js";
import type { WorkflowPhase } from "./workflow.js";
import { OpenCodeResultParser } from "./result-parser-impl.js";

/** Stage that is expected to implement output parsing. */
export const PARSER_PLANNED_STAGE = "Stage 2B" as const;

export type ResultStatus =
  | "success"
  | "failure"
  | "blocked"
  | "rejected"
  | "scope-violation"
  | "po-decision-required";

export const RESULT_STATUSES: readonly ResultStatus[] = [
  "success",
  "failure",
  "blocked",
  "rejected",
  "scope-violation",
  "po-decision-required",
];

/**
 * Non-negotiable distinction, restated as data so a reviewer can grep for it.
 *
 * These strings are exported on purpose. They are the contract between the
 * Stage 2B transport and this module, and they must survive any future refactor
 * that is tempted to infer a workflow verdict from a process verdict.
 */
export const PROCESS_VS_WORKFLOW_INVARIANTS: readonly string[] = Object.freeze([
  "An OpenCode exit code of 0 means the PROCESS completed. It does NOT mean a story was implemented.",
  "An OpenCode exit code of 0 does NOT mean tests passed.",
  "An OpenCode exit code of 0 does NOT mean review passed.",
  "An OpenCode exit code of 0 does NOT mean the story is VERIFIED.",
  "Only the orchestrator's TESTING, REVIEWING, and VERIFYING phases may produce a workflow verdict.",
  "Only an explicit human ApprovalGranted decision may move a workflow into BUILDING.",
]);

/** A single validation command outcome. */
export interface CheckResult {
  readonly ran: boolean;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly total: number | null;
  readonly failed: number | null;
  readonly skipped: number | null;
  readonly durationMs: number | null;
  /** Verbatim command, recorded for auditability. */
  readonly command: string | null;
  readonly notes: readonly string[];
}

export function skippedCheck(note: string): CheckResult {
  return {
    ran: false,
    passed: false,
    exitCode: null,
    total: null,
    failed: null,
    skipped: null,
    durationMs: null,
    command: null,
    notes: [note],
  };
}

/* -------------------------------------------------------------------------- */
/* Stage 2C — Per-check evidence model (Section 7, 13.1)                      */
/* -------------------------------------------------------------------------- */

/**
 * The five check statuses. Every check MUST be classified into exactly one.
 *
 * The `CheckStatus` type adds `waived` to represent a specific sub-case of
 * `unavailable` (a check that could not run but has a valid PO waiver).
 */
export type CheckStatus = "passed" | "failed" | "not_applicable" | "unavailable" | "waived";

export const CHECK_STATUSES: readonly CheckStatus[] = Object.freeze([
  "passed",
  "failed",
  "not_applicable",
  "unavailable",
  "waived",
]);

/**
 * Per-check evidence model (Section 13.1).
 *
 * Derived fields (applicable, executed, passed) are computed from `status`
 * and MUST NOT be set independently. This prevents contradictory combinations.
 */
export interface CheckEvidence {
  readonly checkId: string;
  readonly status: CheckStatus;
  readonly phase: WorkflowPhase;
  /** Derived: false iff status === "not_applicable" */
  readonly applicable: boolean;
  /** From check definition, not from status */
  readonly mandatory: boolean;
  /** Derived: true iff status === "passed" || status === "failed" */
  readonly executed: boolean;
  /** Derived: true iff status === "passed" */
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

/**
 * Overall verification result (Section 13.2).
 */
export interface VerificationResult {
  readonly verdict: "VERIFIED" | "NOT_VERIFIED";
  readonly checks: readonly CheckEvidence[];
  readonly blockers: readonly string[];
  readonly timestamp: string;
}

/**
 * Create a CheckEvidence with derived fields computed from status.
 *
 * This is the ONLY way to construct a CheckEvidence. It enforces the
 * derivation rules from Section 7.2 so that contradictory combinations
 * are impossible by construction.
 */
export function createCheckEvidence(options: {
  readonly checkId: string;
  readonly status: CheckStatus;
  readonly phase: WorkflowPhase;
  readonly mandatory?: boolean;
  readonly exitCode?: number | null;
  readonly command?: string | null;
  readonly args?: readonly string[];
  readonly cwd?: string | null;
  readonly durationMs?: number | null;
  readonly total?: number | null;
  readonly failed?: number | null;
  readonly skipped?: number | null;
  readonly evidence?: string | null;
  readonly executedAt?: string | null;
  readonly waiver?: CheckEvidence["waiver"];
  readonly notes?: readonly string[];
}): CheckEvidence {
  const applicable = options.status !== "not_applicable";
  const executed = options.status === "passed" || options.status === "failed";
  const passed = options.status === "passed";

  return {
    checkId: options.checkId,
    status: options.status,
    phase: options.phase,
    applicable,
    mandatory: options.mandatory ?? true,
    executed,
    passed,
    exitCode: options.exitCode ?? null,
    command: options.command ?? null,
    args: options.args ?? [],
    cwd: options.cwd ?? null,
    durationMs: options.durationMs ?? null,
    total: options.total ?? null,
    failed: options.failed ?? null,
    skipped: options.skipped ?? null,
    evidence: options.evidence ?? null,
    executedAt: options.executedAt ?? null,
    waiver: options.waiver ?? null,
    notes: options.notes ?? [],
  };
}

/**
 * Evaluate per-check evidence to produce a VerificationResult.
 *
 * Implements the derivation rules from Section 13.2:
 * 1. Contradictory evidence -> NOT_VERIFIED
 * 2. Mandatory check failed -> NOT_VERIFIED
 * 3. Mandatory check unavailable (without waiver) -> NOT_VERIFIED
 * 4. All mandatory not_applicable -> NOT_VERIFIED (minimum evidence required)
 * 5. Non-mandatory check failed -> NOT_VERIFIED
 * 6. All mandatory checks passed/waived/not_applicable with at least one passed -> VERIFIED
 */
/* -------------------------------------------------------------------------- */
/* Stage 2C-6 — Waiver records and validity (Section 13.2, PD-9, PD-10)       */
/* -------------------------------------------------------------------------- */

/**
 * A waiver as persisted for a workflow run.
 *
 * Stage 2C-6 has no CLI/API waiver-grant command; this record is the typed
 * shape the orchestrator consumes when evaluating checks. A granted waiver
 * covers exactly one check within one phase (PD-10). It grants nothing else.
 */
export interface WorkflowWaiver {
  readonly checkId: string;
  readonly phase: WorkflowPhase;
  readonly actor: string;
  readonly reason: string;
  readonly grantedAt: string;
  /** Who revoked it, or null when never revoked. */
  readonly revokedBy: string | null;
  readonly revokedAt: string | null;
}

/**
 * Source of waiver records for a workflow run. The default implementation
 * returns nothing: no waivers exist unless a human PO recorded them.
 */
export interface WaiverSource {
  listForRun(workflowId: string): readonly WorkflowWaiver[];
}

export const EMPTY_WAIVER_SOURCE: WaiverSource = {
  listForRun: () => [],
};

const HUMAN_PO_ACTORS: readonly string[] = ["human", "po", "chatgpt-po"];

/**
 * True when the actor is an authorized human PO (`human`, `po`, `chatgpt-po`).
 *
 * Only a human PO may grant or revoke a waiver. The orchestrator cannot
 * self-waive and OpenCode cannot grant a waiver.
 */
export function isHumanPoActor(actor: string): boolean {
  return HUMAN_PO_ACTORS.includes(actor);
}

/**
 * Merge ledger-recorded waivers with an injected `WaiverSource` list.
 *
 * The run's own ledger is authoritative for a `(checkId, phase)` pair: when the
 * ledger holds a record for that pair, any injected record describing the same
 * pair is dropped. Without this rule a revoked ledger waiver could be bypassed
 * by a second still-valid waiver for the same check and phase, and the audit
 * trail would show "revoked" while verification still reported the check as
 * `waived`. Ledger records are placed first so the existing first-valid-wins
 * selection in `applyWaiverValidity` prefers them.
 *
 * Injected records for pairs the ledger does not mention are preserved exactly
 * as they are today.
 */
export function mergeWaiverSources(
  ledger: readonly WorkflowWaiver[],
  injected: readonly WorkflowWaiver[],
): readonly WorkflowWaiver[] {
  const shadowedPairs = new Set(ledger.map((w) => `${w.phase} ${w.checkId}`));
  return [...ledger, ...injected.filter((w) => !shadowedPairs.has(`${w.phase} ${w.checkId}`))];
}

/**
 * Evaluate whether a waiver is valid for a specific check in a phase.
 *
 * Implements Revision 18 Section 13.2 + PD-9 + PD-10:
 *   1. Granted by a human PO (`human`, `po`, or `chatgpt-po`).
 *   2. Not revoked by its granting actor. A "revocation" attributed to a
 *      different actor is not a valid revocation (PD-9: only the granting
 *      actor may revoke) and leaves the waiver valid.
 *   3. Applies to exactly one explicitly identified check within a phase
 *      (PD-10): the record's checkId/phase must match the check being
 *      evaluated. A waiver recorded for check A never covers check B.
 *   4. The workflow run must still be active (waivers become invalid when
 *      the run ends).
 *   5. No time-based expiration is implemented (PD-9): `grantedAt` is never
 *      compared against the current time.
 */
export function evaluateWaiverValidity(
  waiver: WorkflowWaiver,
  input: { readonly checkId: string; readonly phase: WorkflowPhase; readonly runPhase: WorkflowPhase },
): { readonly valid: boolean; readonly reason: string } {
  if (!HUMAN_PO_ACTORS.includes(waiver.actor)) {
    return { valid: false, reason: `Waiver actor "${waiver.actor}" is not a human PO.` };
  }

  if (waiver.revokedBy !== null && waiver.revokedBy === waiver.actor) {
    return { valid: false, reason: `Waiver was revoked by its granting actor "${waiver.revokedBy}".` };
  }

  if (waiver.checkId !== input.checkId || waiver.phase !== input.phase) {
    return {
      valid: false,
      reason: `Waiver scope is "${waiver.checkId}" @ ${waiver.phase}, not "${input.checkId}" @ ${input.phase} (PD-10).`,
    };
  }

  // Workflow run active check (waivers invalid once the run ends).
  const TERMINAL = new Set(["BLOCKED", "FAILED", "REJECTED", "SCOPE_VIOLATION", "PO_DECISION_REQUIRED", "VERIFIED"]);
  if (TERMINAL.has(input.runPhase)) {
    return { valid: false, reason: `Workflow run is terminal (${input.runPhase}); waivers are invalid once the run ends.` };
  }

  return { valid: true, reason: "Valid PO waiver." };
}

/**
 * Apply PD-9/PD-10 waiver validity to a check set.
 *
 * - A `failed` check is never converted by a waiver.
 * - An `unavailable` check with a valid, matching waiver becomes `waived`.
 * - A check claiming `waived` without a valid, matching waiver is demoted to
 *   `unavailable` (contract rule 4).
 */
export function applyWaiverValidity(
  checks: readonly CheckEvidence[],
  waivers: readonly WorkflowWaiver[],
  runPhase: WorkflowPhase,
): CheckEvidence[] {
  return checks.map((check) => {
    if (check.status !== "unavailable" && check.status !== "waived") {
      return check;
    }

    const candidates = waivers.filter((w) => w.checkId === check.checkId && w.phase === check.phase);

    let selected: { waiver: WorkflowWaiver; valid: boolean; reason: string } | null = null;
    for (const waiver of candidates) {
      const validity = evaluateWaiverValidity(waiver, { checkId: check.checkId, phase: check.phase, runPhase });
      if (validity.valid) {
        selected = { waiver, valid: true, reason: validity.reason };
        break;
      }
      selected ??= { waiver, valid: false, reason: validity.reason };
    }

    const rebuild = (status: CheckEvidence["status"], note: string | null, waiver?: CheckEvidence["waiver"]): CheckEvidence =>
      createCheckEvidence({
        checkId: check.checkId,
        status,
        phase: check.phase,
        mandatory: check.mandatory,
        exitCode: check.exitCode,
        command: check.command,
        args: check.args,
        cwd: check.cwd,
        durationMs: check.durationMs,
        total: check.total,
        failed: check.failed,
        skipped: check.skipped,
        evidence: check.evidence,
        executedAt: check.executedAt,
        waiver: waiver ?? null,
        notes: note === null ? [...check.notes] : [...check.notes, note],
      });

    if (selected === null) {
      if (check.status === "waived") {
        return rebuild("unavailable", "Check is marked waived but no matching waiver record exists; demoted to unavailable.");
      }
      return check;
    }

    if (!selected.valid) {
      return rebuild("unavailable", `Waiver present but invalid: ${selected.reason}`);
    }

    return rebuild("waived", `Valid PO waiver: ${selected.waiver.reason}`, {
      actor: selected.waiver.actor,
      reason: selected.waiver.reason,
      grantedAt: selected.waiver.grantedAt,
    });
  });
}

export function evaluatePerCheckVerification(checks: readonly CheckEvidence[]): VerificationResult {
  const blockers: string[] = [];
  const timestamp = new Date().toISOString();

  // Rule 10: Contradictory evidence
  for (const check of checks) {
    if (check.status === "passed" && !check.passed) {
      blockers.push(`Contradictory evidence for check "${check.checkId}": status is "passed" but passed is false.`);
    }
    if (check.status === "not_applicable" && check.applicable) {
      blockers.push(`Contradictory evidence for check "${check.checkId}": status is "not_applicable" but applicable is true.`);
    }
    if (check.status === "failed" && check.passed) {
      blockers.push(`Contradictory evidence for check "${check.checkId}": status is "failed" but passed is true.`);
    }
  }

  if (blockers.length > 0) {
    return { verdict: "NOT_VERIFIED", checks, blockers, timestamp };
  }

  const mandatoryChecks = checks.filter((c) => c.mandatory);

  // All-not_applicable case: no applicable mandatory checks
  if (mandatoryChecks.length > 0 && mandatoryChecks.every((c) => c.status === "not_applicable")) {
    blockers.push("No applicable mandatory checks found. Verification cannot be completed.");
    return { verdict: "NOT_VERIFIED", checks, blockers, timestamp };
  }

  // Rules 1-5: Check mandatory and non-mandatory checks
  for (const check of mandatoryChecks) {
    if (check.status === "failed") {
      blockers.push(`Mandatory check "${check.checkId}" failed.`);
    } else if (check.status === "unavailable") {
      blockers.push(`Mandatory check "${check.checkId}" is unavailable without a valid PO waiver.`);
    }
  }

  // Rule 8: Non-mandatory failures still block
  for (const check of checks) {
    if (!check.mandatory && check.status === "failed") {
      blockers.push(`Non-mandatory check "${check.checkId}" failed.`);
    }
  }

  if (blockers.length > 0) {
    return { verdict: "NOT_VERIFIED", checks, blockers, timestamp };
  }

  // Minimum evidence for VERIFIED (Rev 19, contract 13.2 rule 7 and
  // "Minimum evidence for VERIFIED"): at least one executed mandatory check
  // with status `passed`. `executed` is derived from `status` and is never set
  // independently. A command-backed ProcessRunner check and an orchestrator
  // evaluation (scope-clean, git-integrity, review-approved, acceptance-criteria,
  // po-decisions-resolved) or the sole OpenCode-reported exception (headed-e2e
  // with explicit headed evidence) are all authorized by contract 13.3 to
  // satisfy mandatory requirements, so no command is required here. A `waived`
  // or `not_applicable` check is not an executed check and never qualifies.
  const hasMinimumEvidence = mandatoryChecks.some((c) => c.mandatory && c.status === "passed" && c.executed);

  if (!hasMinimumEvidence) {
    blockers.push("No independently executed mandatory check has status passed. Verification cannot be completed.");
    return { verdict: "NOT_VERIFIED", checks, blockers, timestamp };
  }

  return { verdict: "VERIFIED", checks, blockers, timestamp };
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly file: string | null;
  readonly line: number | null;
}

export type GitPathState = "added" | "modified" | "deleted" | "untracked" | "renamed" | "conflicted";

export interface ChangedPath {
  readonly path: string;
  readonly state: GitPathState;
  /** True when this path was already dirty before the workflow started. */
  readonly preExisting: boolean;
  /** True when the path matches an authorized scope for the current story. */
  readonly authorized: boolean;
}

export interface GitResultSummary {
  readonly headCommit: string | null;
  readonly baselineCaptured: boolean;
  readonly changedPaths: readonly ChangedPath[];
  readonly unauthorizedPaths: readonly string[];
  /** Stage 2A is always false. The orchestrator never mutates git. */
  readonly mutatedByOrchestrator: false;
}

export interface NormalizedResult {
  readonly status: ResultStatus;
  readonly storyId: string | null;
  readonly phase: WorkflowPhase;
  readonly changedFiles: readonly string[];
  readonly tests: CheckResult;
  readonly typecheck: CheckResult;
  readonly build: CheckResult;
  readonly errors: readonly Diagnostic[];
  readonly warnings: readonly Diagnostic[];
  readonly git: GitResultSummary;
  /** The phase the orchestrator recommends next. Never `VERIFIED` on a failure. */
  readonly nextRecommendedState: WorkflowPhase;
  readonly summary: string;
  /** Verbatim source payload, retained for audit. Opaque to the orchestrator. */
  readonly raw: unknown;
}

export const EMPTY_GIT_SUMMARY: GitResultSummary = Object.freeze({
  headCommit: null,
  baselineCaptured: false,
  changedPaths: Object.freeze([]) as readonly ChangedPath[],
  unauthorizedPaths: Object.freeze([]) as readonly string[],
  mutatedByOrchestrator: false,
});

/**
 * Build a `NormalizedResult` from a `ResultStatus`.
 *
 * Pure. It encodes the reporting-side safety rules:
 *   - a non-success status never recommends `VERIFIED`;
 *   - a scope violation is always surfaced as such, never downgraded to `failure`.
 */
export function resultForStatus(
  status: ResultStatus,
  phase: WorkflowPhase,
  storyId: string | null,
  summary: string,
): NormalizedResult {
  return {
    status,
    storyId,
    phase,
    changedFiles: [],
    tests: skippedCheck("Stage 2A: no test run was performed."),
    typecheck: skippedCheck("Stage 2A: no typecheck was performed."),
    build: skippedCheck("Stage 2A: no build was performed."),
    errors: [],
    warnings: [],
    git: EMPTY_GIT_SUMMARY,
    nextRecommendedState: nextStateFor(status, phase),
    summary,
    raw: null,
  };
}

/** Map a result status to the phase the orchestrator should move to. */
export function nextStateFor(status: ResultStatus, current: WorkflowPhase): WorkflowPhase {
  switch (status) {
    case "success":
      return current;
    case "failure":
      return "FAILED";
    case "blocked":
      return "BLOCKED";
    case "rejected":
      return "REJECTED";
    case "scope-violation":
      return "SCOPE_VIOLATION";
    case "po-decision-required":
      return "PO_DECISION_REQUIRED";
    default:
      return "BLOCKED";
  }
}

export interface ResultParser {
  /** Parse a raw adapter payload into the normalized model. */
  parse(raw: unknown, phase: WorkflowPhase, storyId: string | null): NormalizedResult;
  /** True once real parsing is implemented. */
  readonly implemented: boolean;
}

/** Stage 2A parser. Declares the shape, refuses to parse. */
export class Stage2AResultParser implements ResultParser {
  readonly implemented = false as const;

  parse(_raw: unknown, _phase: WorkflowPhase, _storyId: string | null): NormalizedResult {
    throw new NotImplementedInStageError("ResultParser.parse", "Stage 2A", PARSER_PLANNED_STAGE);
  }
}

/**
 * Factory for the default ResultParser.
 *
 * Stage 2C returns the real OpenCode result parser.
 */
export function createResultParser(): ResultParser {
  return new OpenCodeResultParser();
}
