/**
 * Stage 2C-5 — Result Parser unit tests.
 *
 * Covers OpenCode output parsing, process-vs-workflow distinction,
 * per-check evidence model, and phase-specific parsing.
 */

import { describe, expect, it } from "vitest";

import { OpenCodeResultParser } from "../src/result-parser-impl.js";
import {
  applyWaiverValidity,
  createCheckEvidence,
  evaluatePerCheckVerification,
  createResultParser,
  isHumanPoActor,
  mergeWaiverSources,
  type CheckEvidence,
  type WorkflowWaiver,
} from "../src/result-parser.js";
import type { ProcessExecutionOutcome } from "../src/opencode-process.js";

/** Create a minimal ProcessExecutionOutcome for testing. */
function processOutcome(overrides: Partial<ProcessExecutionOutcome> = {}): ProcessExecutionOutcome {
  return {
    status: "success",
    exitCode: 0,
    command: "opencode",
    args: ["run", "--format", "json"],
    stdout: "",
    stderr: "",
    durationMs: 1000,
    timedOut: false,
    truncated: false,
    signal: null,
    ...overrides,
  } as ProcessExecutionOutcome;
}

/** Create a JSON string for stdout. */
function jsonStdout(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}

describe("result parser — process vs workflow distinction", () => {
  const parser = new OpenCodeResultParser();

  it("declares itself as implemented", () => {
    expect(parser.implemented).toBe(true);
  });

  it("process exit code 0 does NOT produce workflow success for VERIFYING", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ tests: { passed: false }, typecheck: { passed: false }, build: { passed: false } }),
    });
    const result = parser.parse(outcome, "VERIFYING", "US-101");
    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).toBe("FAILED");
  });

  it("process exit code 0 does NOT produce VERIFIED", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ tests: { passed: true }, typecheck: { passed: true }, build: { passed: true } }),
    });
    const result = parser.parse(outcome, "VERIFYING", "US-101");
    // Even with all checks passed, the parser produces a result that the
    // orchestrator must independently evaluate. The parser itself does not
    // produce VERIFIED status.
    expect(result.status).toBe("success");
    expect(result.phase).toBe("VERIFYING");
  });

  it("process failure produces failure result", () => {
    const outcome = processOutcome({
      status: "failure",
      exitCode: 1,
      stdout: jsonStdout({ tests: { passed: true } }),
    });
    const result = parser.parse(outcome, "TESTING", "US-101");
    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).toBe("FAILED");
  });

  it("process timeout produces failure result", () => {
    const outcome = processOutcome({
      status: "timeout",
      timedOut: true,
      terminationAttempted: true,
      terminationSignals: ["SIGTERM"],
    });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.status).toBe("failure");
    expect(result.summary).toContain("timed out");
  });

  it("process spawn-error produces failure result", () => {
    const outcome = processOutcome({
      status: "spawn-error",
      errorCode: "ENOENT",
      errorMessage: "opencode not found",
    });
    const result = parser.parse(outcome, "PLANNING", "US-101");
    expect(result.status).toBe("failure");
    expect(result.summary).toContain("failed to start");
  });
});

describe("result parser — invalid and malformed input", () => {
  const parser = new OpenCodeResultParser();

  it("handles null raw input", () => {
    const result = parser.parse(null, "BUILDING", "US-101");
    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("Invalid process outcome");
  });

  it("handles undefined raw input", () => {
    const result = parser.parse(undefined, "BUILDING", "US-101");
    expect(result.status).toBe("blocked");
  });

  it("handles non-object raw input", () => {
    const result = parser.parse("not an object", "BUILDING", "US-101");
    expect(result.status).toBe("blocked");
  });

  it("handles array raw input", () => {
    const result = parser.parse([1, 2, 3], "BUILDING", "US-101");
    expect(result.status).toBe("blocked");
  });

  it("handles missing required fields", () => {
    const result = parser.parse({ status: "success" }, "BUILDING", "US-101");
    expect(result.status).toBe("blocked");
  });

  it("handles invalid status value", () => {
    const result = parser.parse(
      { status: "unknown", command: "opencode", args: [], stdout: "", stderr: "", durationMs: 1, timedOut: false, truncated: false },
      "BUILDING",
      "US-101",
    );
    expect(result.status).toBe("blocked");
  });

  it("handles invalid JSON in stdout gracefully", () => {
    const outcome = processOutcome({ stdout: "not json at all {{{" });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.status).toBe("success");
    expect(result.changedFiles).toEqual([]);
  });

  it("handles empty stdout", () => {
    const outcome = processOutcome({ stdout: "" });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.status).toBe("success");
    expect(result.changedFiles).toEqual([]);
  });

  it("handles stdout with only whitespace", () => {
    const outcome = processOutcome({ stdout: "   \n  \n   " });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.status).toBe("success");
  });
});

describe("result parser — PLANNING phase", () => {
  const parser = new OpenCodeResultParser();

  it("produces success when readiness verdict is present", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ verdict: "READY FOR BUILD" }),
    });
    const result = parser.parse(outcome, "PLANNING", "US-101");
    expect(result.status).toBe("success");
    expect(result.phase).toBe("PLANNING");
    expect(result.summary).toContain("READY FOR BUILD");
    expect(result.nextRecommendedState).toBe("PLAN_READY");
  });

  it("produces blocked when readiness verdict is missing", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ someOtherField: "value" }),
    });
    const result = parser.parse(outcome, "PLANNING", "US-101");
    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedState).toBe("BLOCKED");
  });

  it("skips tests, typecheck, and build for PLANNING", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ verdict: "READY FOR BUILD" }),
    });
    const result = parser.parse(outcome, "PLANNING", "US-101");
    expect(result.tests.ran).toBe(false);
    expect(result.typecheck.ran).toBe(false);
    expect(result.build.ran).toBe(false);
  });

  it("has empty changedFiles for PLANNING", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ verdict: "READY FOR BUILD" }),
    });
    const result = parser.parse(outcome, "PLANNING", "US-101");
    expect(result.changedFiles).toEqual([]);
  });
});

describe("result parser — BUILDING phase", () => {
  const parser = new OpenCodeResultParser();

  it("parses changed files from output", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ files: ["src/file1.ts", "src/file2.ts"] }),
    });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.status).toBe("success");
    expect(result.changedFiles).toContain("src/file1.ts");
    expect(result.changedFiles).toContain("src/file2.ts");
  });

  it("parses OpenCode self-reported test results", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({
        files: ["src/file.ts"],
        tests: { passed: true, total: 10, failed: 0 },
        typecheck: { passed: true },
        build: { passed: true },
      }),
    });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.status).toBe("success");
    expect(result.tests.ran).toBe(true);
    expect(result.tests.passed).toBe(true);
    expect(result.typecheck.ran).toBe(true);
    expect(result.build.ran).toBe(true);
  });

  it("marks checks as skipped when no data is present", () => {
    const outcome = processOutcome({ stdout: "" });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.tests.ran).toBe(false);
    expect(result.typecheck.ran).toBe(false);
    expect(result.build.ran).toBe(false);
  });

  it("recommends TESTING as next state", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ files: ["src/file.ts"] }),
    });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.nextRecommendedState).toBe("TESTING");
  });
});

describe("result parser — TESTING phase", () => {
  const parser = new OpenCodeResultParser();

  it("produces success when all checks pass", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({
        files: ["src/file.ts"],
        tests: { passed: true, total: 10, failed: 0 },
        typecheck: { passed: true },
        build: { passed: true },
      }),
    });
    const result = parser.parse(outcome, "TESTING", "US-101");
    expect(result.status).toBe("success");
    expect(result.nextRecommendedState).toBe("REVIEWING");
  });

  it("produces failure when any check fails", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({
        files: ["src/file.ts"],
        tests: { passed: false, total: 10, failed: 2 },
        typecheck: { passed: true },
        build: { passed: true },
      }),
    });
    const result = parser.parse(outcome, "TESTING", "US-101");
    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).toBe("FAILED");
  });

  it("produces failure when typecheck fails", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({
        files: ["src/file.ts"],
        tests: { passed: true },
        typecheck: { passed: false },
        build: { passed: true },
      }),
    });
    const result = parser.parse(outcome, "TESTING", "US-101");
    expect(result.status).toBe("failure");
  });

  it("produces failure when build fails", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({
        files: ["src/file.ts"],
        tests: { passed: true },
        typecheck: { passed: true },
        build: { passed: false },
      }),
    });
    const result = parser.parse(outcome, "TESTING", "US-101");
    expect(result.status).toBe("failure");
  });
});

describe("result parser — REVIEWING phase", () => {
  const parser = new OpenCodeResultParser();

  it("produces success when no blocking findings", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({
        files: ["src/file.ts"],
        findings: [
          { severity: "info", message: "Minor style issue", file: "src/file.ts", line: 10 },
        ],
      }),
    });
    const result = parser.parse(outcome, "REVIEWING", "US-101");
    expect(result.status).toBe("success");
    expect(result.nextRecommendedState).toBe("VERIFYING");
  });

  it("produces failure when blocking findings exist", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({
        files: ["src/file.ts"],
        findings: [
          { severity: "error", message: "Critical bug", file: "src/file.ts", line: 10 },
          { severity: "warning", message: "Style issue", file: "src/file.ts", line: 20 },
        ],
      }),
    });
    const result = parser.parse(outcome, "REVIEWING", "US-101");
    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).toBe("FAILED");
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("skips tests, typecheck, and build for REVIEWING", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ files: ["src/file.ts"], findings: [] }),
    });
    const result = parser.parse(outcome, "REVIEWING", "US-101");
    expect(result.tests.ran).toBe(false);
    expect(result.typecheck.ran).toBe(false);
    expect(result.build.ran).toBe(false);
  });
});

describe("result parser — VERIFYING phase", () => {
  const parser = new OpenCodeResultParser();

  it("produces success when all checks pass", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({
        files: ["src/file.ts"],
        tests: { passed: true },
        typecheck: { passed: true },
        build: { passed: true },
      }),
    });
    const result = parser.parse(outcome, "VERIFYING", "US-101");
    expect(result.status).toBe("success");
    expect(result.nextRecommendedState).toBe("VERIFIED");
    expect(result.summary).toContain("VERIFIED");
  });

  it("produces failure when any check fails", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({
        files: ["src/file.ts"],
        tests: { passed: false },
        typecheck: { passed: true },
        build: { passed: true },
      }),
    });
    const result = parser.parse(outcome, "VERIFYING", "US-101");
    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).toBe("FAILED");
    expect(result.summary).toContain("NOT VERIFIED");
  });
});

describe("result parser — per-check evidence model", () => {
  it("creates CheckEvidence with correct derived fields for passed", () => {
    const evidence = createCheckEvidence({
      checkId: "backend-typecheck",
      status: "passed",
      phase: "TESTING",
    });
    expect(evidence.applicable).toBe(true);
    expect(evidence.executed).toBe(true);
    expect(evidence.passed).toBe(true);
    expect(evidence.mandatory).toBe(true);
  });

  it("creates CheckEvidence with correct derived fields for failed", () => {
    const evidence = createCheckEvidence({
      checkId: "backend-tests",
      status: "failed",
      phase: "TESTING",
    });
    expect(evidence.applicable).toBe(true);
    expect(evidence.executed).toBe(true);
    expect(evidence.passed).toBe(false);
  });

  it("creates CheckEvidence with correct derived fields for not_applicable", () => {
    const evidence = createCheckEvidence({
      checkId: "frontend-build",
      status: "not_applicable",
      phase: "TESTING",
    });
    expect(evidence.applicable).toBe(false);
    expect(evidence.executed).toBe(false);
    expect(evidence.passed).toBe(false);
  });

  it("creates CheckEvidence with correct derived fields for unavailable", () => {
    const evidence = createCheckEvidence({
      checkId: "headed-e2e",
      status: "unavailable",
      phase: "TESTING",
    });
    expect(evidence.applicable).toBe(true);
    expect(evidence.executed).toBe(false);
    expect(evidence.passed).toBe(false);
  });

  it("creates CheckEvidence with correct derived fields for waived", () => {
    const evidence = createCheckEvidence({
      checkId: "headed-e2e",
      status: "waived",
      phase: "TESTING",
      waiver: { actor: "po", reason: "Browser not available", grantedAt: "2026-01-01T00:00:00Z" },
    });
    expect(evidence.applicable).toBe(true);
    expect(evidence.executed).toBe(false);
    expect(evidence.passed).toBe(false);
    expect(evidence.waiver).not.toBeNull();
  });

  it("allows non-mandatory checks", () => {
    const evidence = createCheckEvidence({
      checkId: "optional-check",
      status: "passed",
      phase: "TESTING",
      mandatory: false,
    });
    expect(evidence.mandatory).toBe(false);
  });
});

describe("result parser — evaluatePerCheckVerification", () => {
  it("returns VERIFIED when all mandatory checks pass", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "tests", status: "passed", phase: "TESTING", command: "npx vitest run" }),
      createCheckEvidence({ checkId: "typecheck", status: "passed", phase: "TESTING", command: "npx tsc --noEmit" }),
      createCheckEvidence({ checkId: "build", status: "passed", phase: "TESTING", command: "npm run build" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("VERIFIED");
    expect(result.blockers).toHaveLength(0);
  });

  it("returns NOT_VERIFIED when a mandatory check fails", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "tests", status: "failed", phase: "TESTING" }),
      createCheckEvidence({ checkId: "typecheck", status: "passed", phase: "TESTING" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("returns NOT_VERIFIED when a mandatory check is unavailable", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "tests", status: "unavailable", phase: "TESTING" }),
      createCheckEvidence({ checkId: "typecheck", status: "passed", phase: "TESTING" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
  });

  it("returns NOT_VERIFIED for all-not_applicable case", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "tests", status: "not_applicable", phase: "TESTING" }),
      createCheckEvidence({ checkId: "typecheck", status: "not_applicable", phase: "TESTING" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers[0]).toContain("No applicable mandatory checks");
  });

  it("returns NOT_VERIFIED for contradictory evidence", () => {
    // Create a contradictory CheckEvidence manually (bypassing createCheckEvidence)
    const contradictory: CheckEvidence = {
      checkId: "tests",
      status: "passed",
      phase: "TESTING",
      applicable: true,
      mandatory: true,
      executed: true,
      passed: false, // Contradiction: status is "passed" but passed is false
      exitCode: 0,
      command: null,
      args: [],
      cwd: null,
      durationMs: null,
      total: null,
      failed: null,
      skipped: null,
      evidence: null,
      executedAt: null,
      waiver: null,
      notes: [],
    };
    const result = evaluatePerCheckVerification([contradictory]);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers[0]).toContain("Contradictory evidence");
  });

  it("returns VERIFIED when a mandatory check is waived with valid waiver", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({
        checkId: "headed-e2e",
        status: "waived",
        phase: "TESTING",
        waiver: { actor: "po", reason: "Browser not available", grantedAt: "2026-01-01T00:00:00Z" },
      }),
      createCheckEvidence({ checkId: "tests", status: "passed", phase: "TESTING", command: "npx vitest run" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("VERIFIED");
  });

  it("returns NOT_VERIFIED when non-mandatory check fails", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "tests", status: "passed", phase: "TESTING" }),
      createCheckEvidence({ checkId: "optional", status: "failed", phase: "TESTING", mandatory: false }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
  });

  it("returns NOT_VERIFIED when no mandatory check has passed", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "tests", status: "not_applicable", phase: "TESTING" }),
      createCheckEvidence({ checkId: "typecheck", status: "passed", phase: "TESTING", mandatory: false }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
  });

  it("returns NOT_VERIFIED when all mandatory checks are waived (minimum evidence)", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({
        checkId: "headed-e2e",
        status: "waived",
        phase: "TESTING",
        waiver: { actor: "po", reason: "x", grantedAt: "2026-01-01T00:00:00Z" },
      }),
      createCheckEvidence({
        checkId: "typecheck",
        status: "waived",
        phase: "TESTING",
        waiver: { actor: "po", reason: "y", grantedAt: "2026-01-01T00:00:00Z" },
      }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers.join(" ")).toContain("No independently executed mandatory check has status passed");
  });

  it("returns NOT_VERIFIED for a mixture of waived and not_applicable mandatory checks", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({
        checkId: "headed-e2e",
        status: "waived",
        phase: "TESTING",
        waiver: { actor: "po", reason: "x", grantedAt: "2026-01-01T00:00:00Z" },
      }),
      createCheckEvidence({ checkId: "tests", status: "not_applicable", phase: "TESTING" }),
    ];
    expect(evaluatePerCheckVerification(checks).verdict).toBe("NOT_VERIFIED");
  });

  it("returns VERIFIED when a passed mandatory check exists alongside a validly waived check", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "tests", status: "passed", phase: "TESTING", command: "npx vitest run" }),
      createCheckEvidence({
        checkId: "headed-e2e",
        status: "waived",
        phase: "TESTING",
        waiver: { actor: "po", reason: "x", grantedAt: "2026-01-01T00:00:00Z" },
      }),
    ];
    expect(evaluatePerCheckVerification(checks).verdict).toBe("VERIFIED");
  });

  // --- minimum evidence (contract 13.2 rule 7, Rev 19) ---

  it("returns VERIFIED for an executed, passed mandatory check with no command (orchestrator evaluation)", () => {
    // Contract 13.3 authorizes orchestrator evaluation (GitGuard.evaluate, review
    // report, PO decision documents) to satisfy mandatory requirements. These
    // checks carry no ProcessRunner command and must still qualify.
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "scope-clean", status: "passed", phase: "VERIFYING" }),
      createCheckEvidence({ checkId: "git-integrity", status: "passed", phase: "VERIFYING" }),
      createCheckEvidence({
        checkId: "acceptance-criteria",
        status: "passed",
        phase: "VERIFYING",
        evidence: "All acceptance criteria satisfied (ref: PO-1).",
      }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("VERIFIED");
    expect(result.blockers).toHaveLength(0);
  });

  it("returns VERIFIED when a passed headed E2E check with headed evidence is the only passed mandatory check", () => {
    // Sole OpenCode-reported exception (contract 13.3/13.4): authorized to satisfy
    // the minimum when explicit headed-execution evidence is present.
    const checks: CheckEvidence[] = [
      createCheckEvidence({
        checkId: "headed-e2e",
        status: "passed",
        phase: "VERIFYING",
        evidence: "Playwright headed run, 12 passed",
      }),
      createCheckEvidence({ checkId: "backend-typecheck", status: "passed", phase: "VERIFYING", command: "npx", args: ["tsc", "--noEmit"] }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("VERIFIED");
    expect(result.blockers).toHaveLength(0);
  });

  it("returns NOT_VERIFIED when the passed mandatory check claims it was not executed", () => {
    // `executed` is derived from `status`; a hand-built record claiming
    // status "passed" with executed false must not satisfy the minimum.
    const unexecuted: CheckEvidence = {
      ...createCheckEvidence({ checkId: "acceptance-criteria", status: "passed", phase: "VERIFYING" }),
      executed: false,
    };
    expect(unexecuted.command).toBeNull();
    const result = evaluatePerCheckVerification([unexecuted]);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers.join(" ")).toContain("No independently executed mandatory check has status passed");
  });

  it("returns NOT_VERIFIED when the mandatory check set is empty", () => {
    const result = evaluatePerCheckVerification([]);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers.join(" ")).toContain("No independently executed mandatory check has status passed");
  });

  it("returns NOT_VERIFIED when only non-mandatory checks exist", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "optional", status: "passed", phase: "VERIFYING", mandatory: false, command: "npx vitest run" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers.join(" ")).toContain("No independently executed mandatory check has status passed");
  });

  it("returns NOT_VERIFIED when only a not_applicable mandatory check exists alongside a passed non-mandatory check", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "headed-e2e", status: "not_applicable", phase: "VERIFYING" }),
      createCheckEvidence({ checkId: "optional", status: "passed", phase: "VERIFYING", mandatory: false, command: "npx vitest run" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
    // The all-not_applicable rule fires first; a passed non-mandatory check never
    // contributes to the minimum-evidence condition.
    expect(result.blockers.join(" ")).toContain("No applicable mandatory checks found");
  });

  it("returns NOT_VERIFIED when a not_applicable mandatory check sits alongside only non-mandatory passes", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "headed-e2e", status: "not_applicable", phase: "VERIFYING" }),
      createCheckEvidence({ checkId: "backend-typecheck", status: "passed", phase: "VERIFYING", mandatory: false, command: "npx" }),
      createCheckEvidence({ checkId: "optional", status: "passed", phase: "VERIFYING", mandatory: false, command: "npx vitest run" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers.join(" ")).toContain("No applicable mandatory checks found");
  });

  it("a command-free passed mandatory check does not rescue a failed mandatory check", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "scope-clean", status: "passed", phase: "VERIFYING" }),
      createCheckEvidence({ checkId: "backend-typecheck", status: "failed", phase: "VERIFYING", command: "npx" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers.join(" ")).toContain("Mandatory check \"backend-typecheck\" failed");
  });

  it("a command-free passed mandatory check does not rescue an unavailable mandatory check", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "scope-clean", status: "passed", phase: "VERIFYING" }),
      createCheckEvidence({ checkId: "acceptance-criteria", status: "unavailable", phase: "VERIFYING" }),
    ];
    const result = evaluatePerCheckVerification(checks);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers.join(" ")).toContain("Mandatory check \"acceptance-criteria\" is unavailable");
  });

  it("returns NOT_VERIFIED for contradictory evidence on a command-free mandatory check", () => {
    const contradictory: CheckEvidence = {
      ...createCheckEvidence({ checkId: "scope-clean", status: "passed", phase: "VERIFYING" }),
      passed: false,
    };
    const result = evaluatePerCheckVerification([contradictory]);
    expect(result.verdict).toBe("NOT_VERIFIED");
    expect(result.blockers.join(" ")).toContain("Contradictory evidence");
  });

  // --- applyWaiverValidity (contract rule 4 + PD-9/PD-10) ---

  const validWaiver: WorkflowWaiver = {
    checkId: "headed-e2e",
    phase: "TESTING",
    actor: "po",
    reason: "Browser not available",
    grantedAt: "2026-01-01T00:00:00Z",
    revokedBy: null,
    revokedAt: null,
  };

  it("isHumanPoActor accepts only the approved human PO actors", () => {
    expect(isHumanPoActor("human")).toBe(true);
    expect(isHumanPoActor("po")).toBe(true);
    expect(isHumanPoActor("chatgpt-po")).toBe(true);
    expect(isHumanPoActor("orchestrator")).toBe(false);
    expect(isHumanPoActor("opencode")).toBe(false);
    expect(isHumanPoActor("po-user-1")).toBe(false);
  });

  it("mergeWaiverSources keeps injected waivers unchanged when the ledger is empty", () => {
    expect(mergeWaiverSources([], [validWaiver])).toEqual([validWaiver]);
    expect(mergeWaiverSources([], [])).toEqual([]);
  });

  it("mergeWaiverSources lets the ledger shadow an injected waiver for the same check and phase", () => {
    const ledgerWaiver: WorkflowWaiver = { ...validWaiver, grantedAt: "2026-02-01T00:00:00Z" };
    const injectedSamePair: WorkflowWaiver = { ...validWaiver, actor: "human" };

    const merged = mergeWaiverSources([ledgerWaiver], [injectedSamePair]);

    expect(merged).toEqual([ledgerWaiver]);
  });

  it("mergeWaiverSources preserves injected waivers for other checks and phases", () => {
    const ledgerWaiver: WorkflowWaiver = { ...validWaiver };
    const otherCheck: WorkflowWaiver = { ...validWaiver, checkId: "backend-typecheck" };
    const otherPhase: WorkflowWaiver = { ...validWaiver, phase: "VERIFYING" };

    const merged = mergeWaiverSources([ledgerWaiver], [otherCheck, otherPhase]);

    expect(merged).toHaveLength(3);
    expect(merged[0]).toBe(ledgerWaiver);
    expect(merged[1]).toBe(otherCheck);
    expect(merged[2]).toBe(otherPhase);
  });

  it("a revoked ledger waiver cannot be bypassed by another valid waiver for the same check and phase", () => {
    const revokedLedger: WorkflowWaiver = { ...validWaiver, revokedBy: "po", revokedAt: "2026-03-01T00:00:00Z" };
    // A still-valid injected waiver describing the same check and phase.
    const injected: WorkflowWaiver = { ...validWaiver, actor: "human" };

    const merged = mergeWaiverSources([revokedLedger], [injected]);
    expect(merged).toHaveLength(1);

    const checks: CheckEvidence[] = [createCheckEvidence({ checkId: "headed-e2e", status: "unavailable", phase: "TESTING" })];
    const adjusted = applyWaiverValidity(checks, merged, "TESTING");

    // Fail closed: the revocation is not bypassable.
    expect(adjusted[0]?.status).toBe("unavailable");
  });

  it("demotes a waived check without a matching waiver to unavailable", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "headed-e2e", status: "waived", phase: "TESTING" }),
    ];
    const adjusted = applyWaiverValidity(checks, [], "TESTING");
    expect(adjusted[0]?.status).toBe("unavailable");
  });

  it("a revoked waiver cannot validate a waived check", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "headed-e2e", status: "waived", phase: "TESTING" }),
    ];
    const adjusted = applyWaiverValidity(checks, [{ ...validWaiver, revokedBy: "po", revokedAt: "2026-01-02T00:00:00Z" }], "TESTING");
    expect(adjusted[0]?.status).toBe("unavailable");
  });

  it("a waiver with the wrong check id, phase, or actor cannot validate a waived check", () => {
    const waived: CheckEvidence[] = [createCheckEvidence({ checkId: "headed-e2e", status: "waived", phase: "TESTING" })];
    expect(applyWaiverValidity(waived, [{ ...validWaiver, checkId: "other" }], "TESTING")[0]?.status).toBe("unavailable");
    expect(applyWaiverValidity(waived, [{ ...validWaiver, phase: "REVIEWING" }], "TESTING")[0]?.status).toBe("unavailable");
    expect(applyWaiverValidity(waived, [{ ...validWaiver, actor: "opencode" }], "TESTING")[0]?.status).toBe("unavailable");
  });

  it("a valid matching waiver promotes an unavailable check to waived", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "headed-e2e", status: "unavailable", phase: "TESTING" }),
    ];
    const adjusted = applyWaiverValidity(checks, [validWaiver], "TESTING");
    expect(adjusted[0]?.status).toBe("waived");
    expect(adjusted[0]?.waiver?.actor).toBe("po");
  });

  it("a failed check remains non-waivable", () => {
    const checks: CheckEvidence[] = [
      createCheckEvidence({ checkId: "headed-e2e", status: "failed", phase: "TESTING" }),
    ];
    const adjusted = applyWaiverValidity(checks, [validWaiver], "TESTING");
    expect(adjusted[0]?.status).toBe("failed");
  });

  it("preserves contradictory-evidence handling in applyWaiverValidity inputs", () => {
    const contradictory = createCheckEvidence({ checkId: "tests", status: "passed", phase: "TESTING" });
    const tampered = { ...contradictory, passed: false };
    expect(applyWaiverValidity([tampered], [], "TESTING")[0]?.status).toBe("passed");
    expect(evaluatePerCheckVerification([tampered]).verdict).toBe("NOT_VERIFIED");
  });
});

describe("result parser — factory", () => {
  it("createResultParser returns a real parser", () => {
    const parser = createResultParser();
    expect(parser.implemented).toBe(true);
  });

  it("createResultParser returns OpenCodeResultParser", () => {
    const parser = createResultParser();
    expect(parser).toBeInstanceOf(OpenCodeResultParser);
  });
});

describe("result parser — safety invariants", () => {
  const parser = new OpenCodeResultParser();

  it("does not produce VERIFIED status from process success alone", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ tests: { passed: true }, typecheck: { passed: true }, build: { passed: true } }),
    });
    const result = parser.parse(outcome, "VERIFYING", "US-101");
    // The parser produces a "success" status, but this is NOT "VERIFIED"
    // The orchestrator must independently evaluate verification
    expect(result.status).toBe("success");
    expect(result.phase).toBe("VERIFYING");
    // The nextRecommendedState is VERIFIED, but this is a recommendation,
    // not a verdict. The orchestrator must still evaluate.
    expect(result.nextRecommendedState).toBe("VERIFIED");
  });

  it("does not establish approval from OpenCode output", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ approved: true, verdict: "APPROVED" }),
    });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    // The parser does not interpret "approved" as workflow approval
    expect(result.status).toBe("success");
  });

  it("does not authorize scope from OpenCode output", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ files: ["any/file.ts"], scope: "authorized" }),
    });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    // The parser records changed files but does not authorize them
    expect(result.changedFiles).toContain("any/file.ts");
  });

  it("handles multiple JSON lines in stdout", () => {
    const outcome = processOutcome({
      stdout: `{"intermediate": "data"}\n${jsonStdout({ files: ["src/file.ts"], tests: { passed: true } })}`,
    });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.status).toBe("success");
    expect(result.changedFiles).toContain("src/file.ts");
  });

  it("handles null values in JSON output", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({ files: null, tests: null, typecheck: null, build: null }),
    });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.status).toBe("success");
    expect(result.changedFiles).toEqual([]);
    expect(result.tests.ran).toBe(false);
  });

  it("handles missing fields in JSON output", () => {
    const outcome = processOutcome({
      stdout: jsonStdout({}),
    });
    const result = parser.parse(outcome, "BUILDING", "US-101");
    expect(result.status).toBe("success");
    expect(result.changedFiles).toEqual([]);
  });
});
