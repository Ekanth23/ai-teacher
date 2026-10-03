/**
 * Stage 2C — Independent validator.
 *
 * PURPOSE
 * -------
 * Run verification commands directly via `ProcessRunner`, independent of
 * OpenCode. This is the orchestrator's own verification path — the only path
 * that can satisfy mandatory verification requirements (except headed E2E,
 * which is the sole exception per Section 13.3).
 *
 * CONTRACT (Section 13.3, 13.4)
 * ------------------------------
 * OpenCode-reported test results are NEVER treated as independently executed
 * verification. Only orchestrator-executed checks satisfy mandatory
 * requirements.
 *
 * The independent validator:
 * - Runs typecheck, build, focused tests, regression tests via ProcessRunner
 * - Returns structured CheckResult objects
 * - Does NOT interpret OpenCode output
 * - Does NOT treat process success as workflow verification
 */

import type { ProcessRunner, ProcessExecutionOutcome } from "./opencode-process.js";
import type { CheckResult } from "./result-parser.js";

/** A verification command to be executed by the orchestrator. */
export interface VerificationCommand {
  /** Unique identifier for this check. */
  readonly checkId: string;
  /** The command to run (e.g., "npx", "npm", "git"). */
  readonly command: string;
  /** Arguments to pass to the command. */
  readonly args: readonly string[];
  /** Working directory for the command. */
  readonly cwd: string;
  /** Whether this check is mandatory for verification. */
  readonly mandatory: boolean;
}

/** Result of a single verification check execution. */
export interface ValidationResult {
  readonly checkId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly mandatory: boolean;
  readonly outcome: ProcessExecutionOutcome;
  readonly check: CheckResult;
}

/** Summary of all validation results. */
export interface ValidationSummary {
  readonly results: readonly ValidationResult[];
  readonly allMandatoryPassed: boolean;
  readonly hasFailures: boolean;
}

/** Independent validator interface. */
export interface IndependentValidator {
  runCheck(command: VerificationCommand): Promise<ValidationResult>;
  runChecks(commands: readonly VerificationCommand[]): Promise<ValidationSummary>;
}

/**
 * Convert a ProcessExecutionOutcome into a CheckResult.
 *
 * A non-zero exit code is a failure. A timeout is a failure. A spawn error
 * is a failure. Only exit code 0 with status "success" is a pass.
 */
function outcomeToCheckResult(outcome: ProcessExecutionOutcome): CheckResult {
  const passed = outcome.status === "success" && outcome.exitCode === 0;
  return {
    ran: outcome.status === "success" || outcome.status === "failure",
    passed,
    exitCode: outcome.exitCode,
    total: null,
    failed: passed ? 0 : 1,
    skipped: null,
    durationMs: outcome.durationMs,
    command: outcome.command,
    notes: [],
  };
}

/**
 * Independent validator implementation.
 *
 * Uses the injected ProcessRunner to execute verification commands. Does
 * not spawn processes directly — all process creation goes through the
 * injected runner.
 */
export class OrchestratorIndependentValidator implements IndependentValidator {
  readonly #runner: ProcessRunner;

  constructor(runner: ProcessRunner) {
    this.#runner = runner;
  }

  async runCheck(command: VerificationCommand): Promise<ValidationResult> {
    const outcome = await this.#runner.run({
      command: command.command,
      args: [...command.args],
      cwd: command.cwd,
      timeoutMs: 600_000,
      env: process.env,
      maxOutputBytes: 4 * 1024 * 1024,
      killGraceMs: 2_000,
    });

    return {
      checkId: command.checkId,
      command: command.command,
      args: [...command.args],
      cwd: command.cwd,
      mandatory: command.mandatory,
      outcome,
      check: outcomeToCheckResult(outcome),
    };
  }

  async runChecks(commands: readonly VerificationCommand[]): Promise<ValidationSummary> {
    const results: ValidationResult[] = [];
    for (const command of commands) {
      const result = await this.runCheck(command);
      results.push(result);
    }

    const allMandatoryPassed = results
      .filter((r) => r.mandatory)
      .every((r) => r.check.passed);

    const hasFailures = results.some((r) => !r.check.passed);

    return {
      results,
      allMandatoryPassed,
      hasFailures,
    };
  }
}

/**
 * Factory for the default independent validator.
 */
export function createIndependentValidator(runner: ProcessRunner): IndependentValidator {
  return new OrchestratorIndependentValidator(runner);
}
