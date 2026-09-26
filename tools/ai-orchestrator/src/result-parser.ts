/**
 * Stage 2A — Normalized result model.
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
 * This module stays intentionally stubbed. `opencode run` exiting 0 is NOT parsed
 * here into `VERIFIED`, `TEST PASSED`, or `REVIEW PASSED`, and this stub is
 * preserved across Stage 2B on purpose. Producing a workflow verdict from process
 * output alone would let a transport detail masquerade as a PO-governed outcome.
 *
 * STAGE 2A HARD RULE
 * ------------------
 * No OpenCode output is parsed. `parseOpenCodeResult()` throws. A future stage
 * implements parsing without changing `NormalizedResult`.
 *
 * The orchestrator reports *what happened*. It does not decide what is correct
 * about AI Teacher; that remains the PO's and the reviewers' responsibility.
 */

import { NotImplementedInStageError } from "./errors.js";
import type { WorkflowPhase } from "./workflow.js";

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

export function createResultParser(): ResultParser {
  return new Stage2AResultParser();
}
