/**
 * Stage 2A — Console reporter.
 *
 * A thin, dependency-free output adapter. The orchestrator reports through this
 * interface only, so a later stage can add file/JSON/markdown reporters without
 * touching workflow logic.
 *
 * Every method is a pure function of its input plus an injected sink. Stage 2A
 * exercises only `status()`; the workflow methods exist so the reporting contract
 * is fixed before the workflow is.
 */

import type { ApprovalRequest } from "../approval-gate.js";
import type { LogLevel } from "../config.js";
import type { OrchestratorStatus } from "../orchestrator.js";
import type { CheckResult, NormalizedResult } from "../result-parser.js";
import type { WorkflowRun } from "../orchestrator.js";
import type { WorkflowPhase } from "../workflow.js";

/** Where formatted lines go. Injectable so tests never touch the real console. */
export type ReporterSink = (line: string) => void;

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export function levelEnabled(threshold: LogLevel, level: Exclude<LogLevel, "silent">): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[threshold];
}

export interface Reporter {
  status(status: OrchestratorStatus): void;
  workflowState(run: WorkflowRun): void;
  planReady(details: { readonly storyId: string | null; readonly planReference: string }): void;
  approvalRequired(request: ApprovalRequest): void;
  buildStarted(details: { readonly storyId: string | null; readonly approvedBy: string }): void;
  testResult(result: NormalizedResult): void;
  reviewResult(result: NormalizedResult): void;
  verificationResult(result: NormalizedResult): void;
  failure(details: { readonly phase: WorkflowPhase; readonly storyId: string | null; readonly message: string }): void;
  blocked(details: { readonly phase: WorkflowPhase; readonly storyId: string | null; readonly reason: string }): void;
}

export interface ConsoleReporterOptions {
  readonly logLevel: LogLevel;
  readonly sink?: ReporterSink;
}

function formatCheck(label: string, check: CheckResult): string {
  if (!check.ran) {
    return `  ${label}: not run${check.notes.length > 0 ? ` (${check.notes[0]})` : ""}`;
  }
  const counts =
    check.total === null
      ? ""
      : ` ${check.failed ?? 0} failed / ${check.total} total${check.skipped === null ? "" : ` / ${check.skipped} skipped`}`;
  return `  ${label}: ${check.passed ? "PASS" : "FAIL"}${counts}`;
}

export class ConsoleReporter implements Reporter {
  readonly #logLevel: LogLevel;
  readonly #sink: ReporterSink;

  constructor(options: ConsoleReporterOptions) {
    this.#logLevel = options.logLevel;
    this.#sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  }

  #info(line: string): void {
    if (levelEnabled(this.#logLevel, "info")) this.#sink(line);
  }

  #warn(line: string): void {
    if (levelEnabled(this.#logLevel, "warn")) this.#sink(line);
  }

  #error(line: string): void {
    if (levelEnabled(this.#logLevel, "error")) this.#sink(line);
  }

  status(status: OrchestratorStatus): void {
    const lines: string[] = [
      "ai-orchestrator status",
      `  stage                 : ${status.stage}`,
      `  implementation       : ${status.implementationStatus}`,
      `  execution enabled    : ${status.executionEnabled}`,
      `  opencode connected   : ${status.opencodeConnected}`,
      `  git mutation enabled : ${status.gitMutationEnabled}`,
      `  network enabled      : ${status.networkEnabled}`,
      `  approval automation  : ${status.approvalAutomation}`,
      `  execution mode       : ${status.executionMode}`,
      `  log level            : ${status.logLevel}`,
      `  opencode command     : ${status.opencodeCommand}`,
      `  opencode server url  : ${status.opencodeServerUrl ?? "(not configured)"}`,
      `  repository root      : ${status.repositoryRoot}`,
      `  state directory      : ${status.stateDirectory}`,
      "",
      "  workflow phases",
      `    active   : ${status.stateMachine.activePhases.join(" -> ")}`,
      `    terminal : ${status.stateMachine.terminalPhases.join(", ")}`,
      `    success  : ${status.stateMachine.successPhases.join(", ")}`,
      `    build requires approval: ${status.stateMachine.buildRequiresApproval}`,
      "",
      `  implemented (${status.implemented.length})`,
      ...status.implemented.map((item) => `    + ${item}`),
      "",
      `  not implemented (${status.notImplemented.length})`,
      ...status.notImplemented.map((item) => `    - ${item}`),
      "",
      `  safety invariants (${status.safetyInvariants.length})`,
      ...status.safetyInvariants.map((item) => `    * ${item}`),
      "",
      "  Stage 2A does NOT execute OpenCode, does NOT modify the AI Teacher application,",
      "  does NOT approve plans automatically, and does NOT call external APIs.",
    ];
    for (const line of lines) this.#info(line);
  }

  workflowState(run: WorkflowRun): void {
    this.#info(`[state] workflow=${run.id} story=${run.storyId ?? "(none)"} phase=${run.phase}`);
  }

  planReady(details: { readonly storyId: string | null; readonly planReference: string }): void {
    this.#info(`[plan] ready story=${details.storyId ?? "(none)"} plan=${details.planReference}`);
    this.#warn("[plan] PLAN_READY -> BUILDING is NOT permitted. An explicit human approval is required.");
  }

  approvalRequired(request: ApprovalRequest): void {
    this.#warn(
      `[approval] REQUIRED workflow=${request.workflowId} story=${request.storyId ?? "(none)"} plan=${request.planReference}`,
    );
  }

  buildStarted(details: { readonly storyId: string | null; readonly approvedBy: string }): void {
    this.#info(`[build] started story=${details.storyId ?? "(none)"} approvedBy=${details.approvedBy}`);
  }

  testResult(result: NormalizedResult): void {
    this.#info(`[test] story=${result.storyId ?? "(none)"} status=${result.status}`);
    this.#info(formatCheck("tests", result.tests));
    this.#info(formatCheck("typecheck", result.typecheck));
  }

  reviewResult(result: NormalizedResult): void {
    this.#info(`[review] story=${result.storyId ?? "(none)"} status=${result.status}`);
    for (const diagnostic of result.warnings) {
      this.#warn(`[review] warning: ${diagnostic.message}`);
    }
  }

  verificationResult(result: NormalizedResult): void {
    this.#info(`[verify] story=${result.storyId ?? "(none)"} status=${result.status} next=${result.nextRecommendedState}`);
    this.#info(formatCheck("build", result.build));
    this.#info(`  changed files: ${result.changedFiles.length}`);
  }

  failure(details: { readonly phase: WorkflowPhase; readonly storyId: string | null; readonly message: string }): void {
    this.#error(`[failure] phase=${details.phase} story=${details.storyId ?? "(none)"} ${details.message}`);
  }

  blocked(details: { readonly phase: WorkflowPhase; readonly storyId: string | null; readonly reason: string }): void {
    this.#error(`[blocked] phase=${details.phase} story=${details.storyId ?? "(none)"} ${details.reason}`);
  }
}

export function createConsoleReporter(options: ConsoleReporterOptions): Reporter {
  return new ConsoleReporter(options);
}
