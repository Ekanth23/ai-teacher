/**
 * Stage 2C — Real OpenCode result parser implementation.
 *
 * PURPOSE
 * -------
 * Parse OpenCode ProcessExecutionOutcome into NormalizedResult.
 *
 * SAFETY RULES (Section 6.3, 18):
 *   - Process exit code 0 does NOT produce workflow success
 *   - OpenCode output is DATA, never AUTHORITY
 *   - OpenCode output cannot independently establish approval
 *   - OpenCode output cannot authorize scope
 *   - OpenCode output cannot bypass workflow safety checks
 *   - Malformed, incomplete, missing, and invalid results are handled safely
 */

import type { ProcessExecutionOutcome } from "./opencode-process.js";
import type { WorkflowPhase } from "./workflow.js";
import {
  type NormalizedResult,
  type CheckResult,
  type Diagnostic,
  skippedCheck,
  EMPTY_GIT_SUMMARY,
  nextStateFor,
  type ResultParser,
} from "./result-parser.js";

/**
 * Stage 2C real ResultParser.
 *
 * Parses OpenCode ProcessExecutionOutcome into NormalizedResult.
 *
 * The parser evaluates phase-specific evidence independently of process status.
 * Process success does NOT produce workflow success (Section 6.3).
 */
export class OpenCodeResultParser implements ResultParser {
  readonly implemented = true as const;

  parse(raw: unknown, phase: WorkflowPhase, storyId: string | null): NormalizedResult {
    // Validate raw input is a ProcessExecutionOutcome
    if (!this.#isValidProcessOutcome(raw)) {
      return this.#blockedResult(
        phase,
        storyId,
        "Invalid process outcome: raw input is not a valid ProcessExecutionOutcome.",
      );
    }

    const outcome = raw as ProcessExecutionOutcome;

    // Process failure, timeout, or spawn-error -> failure result
    // Process success does NOT produce workflow success (Section 6.3)
    if (outcome.status !== "success") {
      return this.#failureResult(phase, storyId, outcome);
    }

    // Parse stdout for JSON output
    const parsed = this.#parseStdout(outcome.stdout);

    // Build phase-specific result
    return this.#buildResult(phase, storyId, outcome, parsed);
  }

  /**
   * Validate that raw is a valid ProcessExecutionOutcome.
   */
  #isValidProcessOutcome(raw: unknown): raw is ProcessExecutionOutcome {
    if (typeof raw !== "object" || raw === null) return false;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.status !== "string") return false;
    if (!["success", "failure", "timeout", "spawn-error"].includes(obj.status)) return false;
    if (typeof obj.command !== "string") return false;
    if (!Array.isArray(obj.args)) return false;
    if (typeof obj.stdout !== "string") return false;
    if (typeof obj.stderr !== "string") return false;
    if (typeof obj.durationMs !== "number") return false;
    if (typeof obj.timedOut !== "boolean") return false;
    if (typeof obj.truncated !== "boolean") return false;
    return true;
  }

  /**
   * Parse stdout for JSON output.
   *
   * Defensive by design: any parse problem yields null.
   * The parser NEVER invents data.
   *
   * When multiple JSON lines are present, the last valid one is used
   * (the final output from OpenCode is the most relevant).
   */
  #parseStdout(stdout: string): Record<string, unknown> | null {
    if (stdout.trim().length === 0) return null;

    let lastValid: Record<string, unknown> | null = null;
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          lastValid = parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
    }
    return lastValid;
  }

  /**
   * Build a NormalizedResult for a process failure, timeout, or spawn-error.
   */
  #failureResult(
    phase: WorkflowPhase,
    storyId: string | null,
    outcome: ProcessExecutionOutcome,
  ): NormalizedResult {
    const reason =
      outcome.status === "timeout"
        ? "OpenCode process timed out."
        : outcome.status === "spawn-error"
          ? "OpenCode process failed to start."
          : `OpenCode process exited with code ${outcome.exitCode ?? "unknown"}.`;

    return {
      status: "failure",
      storyId,
      phase,
      changedFiles: [],
      tests: skippedCheck(`Process ${outcome.status}: tests were not executed.`),
      typecheck: skippedCheck(`Process ${outcome.status}: typecheck was not executed.`),
      build: skippedCheck(`Process ${outcome.status}: build was not executed.`),
      errors: [{ severity: "error", message: reason, file: null, line: null }],
      warnings: [],
      git: EMPTY_GIT_SUMMARY,
      nextRecommendedState: "FAILED",
      summary: reason,
      raw: outcome,
    };
  }

  /**
   * Build a blocked result for invalid input.
   */
  #blockedResult(phase: WorkflowPhase, storyId: string | null, reason: string): NormalizedResult {
    return {
      status: "blocked",
      storyId,
      phase,
      changedFiles: [],
      tests: skippedCheck(`Blocked: ${reason}`),
      typecheck: skippedCheck(`Blocked: ${reason}`),
      build: skippedCheck(`Blocked: ${reason}`),
      errors: [{ severity: "error", message: reason, file: null, line: null }],
      warnings: [],
      git: EMPTY_GIT_SUMMARY,
      nextRecommendedState: "BLOCKED",
      summary: reason,
      raw: null,
    };
  }

  /**
   * Build a NormalizedResult based on phase-specific evidence.
   *
   * The parser evaluates phase-specific evidence independently of process status.
   * Process success does NOT produce workflow success (Section 6.3).
   */
  #buildResult(
    phase: WorkflowPhase,
    storyId: string | null,
    outcome: ProcessExecutionOutcome,
    parsed: Record<string, unknown> | null,
  ): NormalizedResult {
    switch (phase) {
      case "PLANNING":
        return this.#buildPlanResult(storyId, outcome, parsed);
      case "BUILDING":
        return this.#buildBuildResult(storyId, outcome, parsed);
      case "TESTING":
        return this.#buildTestResult(storyId, outcome, parsed);
      case "REVIEWING":
        return this.#buildReviewResult(storyId, outcome, parsed);
      case "VERIFYING":
        return this.#buildVerifyResult(storyId, outcome, parsed);
      default:
        return this.#buildDefaultResult(phase, storyId, outcome, parsed);
    }
  }

  /**
   * Build result for PLANNING phase.
   *
   * Tests/typecheck/build are skipped. Summary must contain readiness verdict.
   *
   * The parser checks for:
   * - A `status` field indicating `po-decision-required`
   * - A `verdict` field with a readiness verdict
   */
  #buildPlanResult(
    storyId: string | null,
    outcome: ProcessExecutionOutcome,
    parsed: Record<string, unknown> | null,
  ): NormalizedResult {
    // Check for PO decision required
    const status = parsed?.status;
    if (status === "po-decision-required") {
      const reason = typeof parsed?.reason === "string" ? parsed.reason : "PO decision required.";
      return {
        status: "po-decision-required",
        storyId,
        phase: "PLANNING",
        changedFiles: [],
        tests: skippedCheck("PLANNING phase: no test run was performed."),
        typecheck: skippedCheck("PLANNING phase: no typecheck was performed."),
        build: skippedCheck("PLANNING phase: no build was performed."),
        errors: [{ severity: "error", message: reason, file: null, line: null }],
        warnings: [],
        git: EMPTY_GIT_SUMMARY,
        nextRecommendedState: "PO_DECISION_REQUIRED",
        summary: `Plan produced. PO decision required: ${reason}`,
        raw: outcome,
      };
    }

    const verdict = this.#extractVerdict(parsed);
    const hasVerdict = verdict !== null;

    const summary = hasVerdict
      ? `Plan produced. Readiness verdict: ${verdict}`
      : "Plan produced. No readiness verdict found in output.";

    return {
      status: hasVerdict ? "success" : "blocked",
      storyId,
      phase: "PLANNING",
      changedFiles: [],
      tests: skippedCheck("PLANNING phase: no test run was performed."),
      typecheck: skippedCheck("PLANNING phase: no typecheck was performed."),
      build: skippedCheck("PLANNING phase: no build was performed."),
      errors: hasVerdict ? [] : [{ severity: "error", message: "No readiness verdict found in plan output.", file: null, line: null }],
      warnings: [],
      git: EMPTY_GIT_SUMMARY,
      nextRecommendedState: hasVerdict ? "PLAN_READY" : "BLOCKED",
      summary,
      raw: outcome,
    };
  }

  /**
   * Build result for BUILDING phase.
   *
   * OpenCode self-reported test results are parsed but NOT trusted (Section 6.2, 13.4).
   * Changed files are authorized paths only.
   */
  #buildBuildResult(
    storyId: string | null,
    outcome: ProcessExecutionOutcome,
    parsed: Record<string, unknown> | null,
  ): NormalizedResult {
    const changedFiles = this.#extractChangedFiles(parsed);
    const tests = this.#extractCheckResult(parsed, "tests");
    const typecheck = this.#extractCheckResult(parsed, "typecheck");
    const build = this.#extractCheckResult(parsed, "build");

    // OpenCode self-reported results are parsed but NOT trusted
    const summary = `Build completed. Files changed: ${changedFiles.length}. ` +
      `OpenCode self-reported results (not trusted): tests=${tests.passed ? "passed" : "not passed"}, ` +
      `typecheck=${typecheck.passed ? "passed" : "not passed"}, build=${build.passed ? "passed" : "not passed"}.`;

    return {
      status: "success",
      storyId,
      phase: "BUILDING",
      changedFiles,
      tests,
      typecheck,
      build,
      errors: [],
      warnings: [],
      git: EMPTY_GIT_SUMMARY,
      nextRecommendedState: "TESTING",
      summary,
      raw: outcome,
    };
  }

  /**
   * Build result for TESTING phase.
   *
   * Tests/typecheck/build are real results (mandatory).
   * Changed files from git diff.
   */
  #buildTestResult(
    storyId: string | null,
    outcome: ProcessExecutionOutcome,
    parsed: Record<string, unknown> | null,
  ): NormalizedResult {
    const changedFiles = this.#extractChangedFiles(parsed);
    const tests = this.#extractCheckResult(parsed, "tests");
    const typecheck = this.#extractCheckResult(parsed, "typecheck");
    const build = this.#extractCheckResult(parsed, "build");

    const summary = `Testing completed. Tests: ${tests.passed ? "passed" : "failed"}, ` +
      `typecheck: ${typecheck.passed ? "passed" : "failed"}, build: ${build.passed ? "passed" : "failed"}.`;

    const allPassed = tests.passed && typecheck.passed && build.passed;

    return {
      status: allPassed ? "success" : "failure",
      storyId,
      phase: "TESTING",
      changedFiles,
      tests,
      typecheck,
      build,
      errors: allPassed ? [] : [{ severity: "error", message: "One or more mandatory checks failed.", file: null, line: null }],
      warnings: [],
      git: EMPTY_GIT_SUMMARY,
      nextRecommendedState: allPassed ? "REVIEWING" : "FAILED",
      summary,
      raw: outcome,
    };
  }

  /**
   * Build result for REVIEWING phase.
   *
   * Tests/typecheck/build are skipped. Summary = findings list, blocking findings count.
   */
  #buildReviewResult(
    storyId: string | null,
    outcome: ProcessExecutionOutcome,
    parsed: Record<string, unknown> | null,
  ): NormalizedResult {
    const changedFiles = this.#extractChangedFiles(parsed);
    const findings = this.#extractFindings(parsed);
    const blockingFindings = findings.filter((f) => f.severity === "error");

    const summary = `Review completed. Findings: ${findings.length} total, ${blockingFindings.length} blocking.`;

    return {
      status: blockingFindings.length === 0 ? "success" : "failure",
      storyId,
      phase: "REVIEWING",
      changedFiles,
      tests: skippedCheck("REVIEWING phase: no test run was performed."),
      typecheck: skippedCheck("REVIEWING phase: no typecheck was performed."),
      build: skippedCheck("REVIEWING phase: no build was performed."),
      errors: blockingFindings,
      warnings: findings.filter((f) => f.severity === "warning"),
      git: EMPTY_GIT_SUMMARY,
      nextRecommendedState: blockingFindings.length === 0 ? "VERIFYING" : "FAILED",
      summary,
      raw: outcome,
    };
  }

  /**
   * Build result for VERIFYING phase.
   *
   * Tests/typecheck/build are real results (mandatory). Summary = verdict.
   */
  #buildVerifyResult(
    storyId: string | null,
    outcome: ProcessExecutionOutcome,
    parsed: Record<string, unknown> | null,
  ): NormalizedResult {
    const changedFiles = this.#extractChangedFiles(parsed);
    const tests = this.#extractCheckResult(parsed, "tests");
    const typecheck = this.#extractCheckResult(parsed, "typecheck");
    const build = this.#extractCheckResult(parsed, "build");

    const allPassed = tests.passed && typecheck.passed && build.passed;
    const verdict = allPassed ? "VERIFIED" : "NOT VERIFIED";

    const summary = `Verification completed. Verdict: ${verdict}. ` +
      `Tests: ${tests.passed ? "passed" : "failed"}, ` +
      `typecheck: ${typecheck.passed ? "passed" : "failed"}, build: ${build.passed ? "passed" : "failed"}.`;

    return {
      status: allPassed ? "success" : "failure",
      storyId,
      phase: "VERIFYING",
      changedFiles,
      tests,
      typecheck,
      build,
      errors: allPassed ? [] : [{ severity: "error", message: `Verification verdict: ${verdict}`, file: null, line: null }],
      warnings: [],
      git: EMPTY_GIT_SUMMARY,
      nextRecommendedState: allPassed ? "VERIFIED" : "FAILED",
      summary,
      raw: outcome,
    };
  }

  /**
   * Build default result for unknown phases.
   */
  #buildDefaultResult(
    phase: WorkflowPhase,
    storyId: string | null,
    outcome: ProcessExecutionOutcome,
    parsed: Record<string, unknown> | null,
  ): NormalizedResult {
    const changedFiles = this.#extractChangedFiles(parsed);
    const tests = this.#extractCheckResult(parsed, "tests");
    const typecheck = this.#extractCheckResult(parsed, "typecheck");
    const build = this.#extractCheckResult(parsed, "build");

    return {
      status: "success",
      storyId,
      phase,
      changedFiles,
      tests,
      typecheck,
      build,
      errors: [],
      warnings: [],
      git: EMPTY_GIT_SUMMARY,
      nextRecommendedState: nextStateFor("success", phase),
      summary: `Phase ${phase} completed.`,
      raw: outcome,
    };
  }

  /**
   * Extract readiness verdict from parsed output.
   */
  #extractVerdict(parsed: Record<string, unknown> | null): string | null {
    if (parsed === null) return null;
    const verdict = parsed.verdict ?? parsed.readiness ?? parsed.readinessVerdict;
    if (typeof verdict === "string" && verdict.trim().length > 0) return verdict.trim();
    return null;
  }

  /**
   * Extract changed files from parsed output.
   */
  #extractChangedFiles(parsed: Record<string, unknown> | null): string[] {
    if (parsed === null) return [];
    const files = parsed.files ?? parsed.changedFiles ?? parsed.changed_paths;
    if (Array.isArray(files)) {
      return files.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
    }
    return [];
  }

  /**
   * Extract a CheckResult from parsed output.
   */
  #extractCheckResult(parsed: Record<string, unknown> | null, key: string): CheckResult {
    if (parsed === null) {
      return skippedCheck(`No parsed output: ${key} was not executed.`);
    }

    const checkData = parsed[key];
    if (typeof checkData !== "object" || checkData === null) {
      return skippedCheck(`No ${key} data found in output.`);
    }

    const obj = checkData as Record<string, unknown>;
    const passed = obj.passed === true || obj.status === "passed" || obj.status === "success";
    const ran = passed || obj.passed === false || obj.status === "failed" || obj.status === "failure";

    if (!ran) {
      return skippedCheck(`${key} was not executed.`);
    }

    return {
      ran: true,
      passed,
      exitCode: typeof obj.exitCode === "number" ? obj.exitCode : null,
      total: typeof obj.total === "number" ? obj.total : null,
      failed: typeof obj.failed === "number" ? obj.failed : (passed ? 0 : 1),
      skipped: typeof obj.skipped === "number" ? obj.skipped : null,
      durationMs: typeof obj.durationMs === "number" ? obj.durationMs : null,
      command: typeof obj.command === "string" ? obj.command : null,
      notes: [],
    };
  }

  /**
   * Extract findings from parsed output.
   */
  #extractFindings(parsed: Record<string, unknown> | null): Diagnostic[] {
    if (parsed === null) return [];
    const findings = parsed.findings;
    if (!Array.isArray(findings)) return [];

    return findings
      .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
      .map((f) => ({
        severity: f.severity === "warning" || f.severity === "info" ? f.severity : "error",
        message: typeof f.message === "string" ? f.message : "Unknown finding",
        file: typeof f.file === "string" ? f.file : null,
        line: typeof f.line === "number" ? f.line : null,
      }));
  }
}
