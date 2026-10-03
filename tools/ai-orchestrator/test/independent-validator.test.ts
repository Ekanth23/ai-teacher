/**
 * Stage 2C-1 — Independent validator unit tests.
 *
 * Covers orchestrator-executed verification commands via ProcessRunner,
 * process-vs-workflow distinction, and mandatory check handling.
 */

import { describe, expect, it } from "vitest";

import {
  createIndependentValidator,
  type IndependentValidator,
  type VerificationCommand,
} from "../src/independent-validator.js";
import type { ProcessRunner, ProcessExecutionOutcome } from "../src/opencode-process.js";

class FakeRunner implements ProcessRunner {
  readonly calls: { command: string; args: readonly string[]; cwd: string }[] = [];
  #outcome: ProcessExecutionOutcome;

  constructor(outcome: ProcessExecutionOutcome) {
    this.#outcome = outcome;
  }

  run(request: { command: string; args: readonly string[]; cwd: string }): Promise<ProcessExecutionOutcome> {
    this.calls.push({ command: request.command, args: [...request.args], cwd: request.cwd });
    return Promise.resolve(this.#outcome);
  }
}

function successOutcome(): ProcessExecutionOutcome {
  return {
    status: "success",
    exitCode: 0,
    command: "npx",
    args: ["tsc", "--noEmit"],
    stdout: "",
    stderr: "",
    durationMs: 100,
    timedOut: false,
    truncated: false,
    signal: null,
  };
}

function failureOutcome(): ProcessExecutionOutcome {
  return {
    status: "failure",
    exitCode: 1,
    command: "npx",
    args: ["vitest", "run"],
    stdout: "",
    stderr: "test failed",
    durationMs: 200,
    timedOut: false,
    truncated: false,
    signal: null,
  };
}

function timeoutOutcome(): ProcessExecutionOutcome {
  return {
    status: "timeout",
    exitCode: null,
    command: "npm",
    args: ["test"],
    stdout: "partial",
    stderr: "",
    durationMs: 5000,
    timedOut: true,
    truncated: false,
    signal: null,
    terminationAttempted: true,
    terminationSignals: ["SIGTERM"],
  };
}

function spawnErrorOutcome(): ProcessExecutionOutcome {
  return {
    status: "spawn-error",
    exitCode: null,
    command: "git",
    args: ["status"],
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    truncated: false,
    signal: null,
    errorCode: "ENOENT",
    errorMessage: "spawn git ENOENT",
  };
}

function verificationCommand(overrides: Partial<VerificationCommand> = {}): VerificationCommand {
  return {
    checkId: "backend-typecheck",
    command: "npx",
    args: ["tsc", "--noEmit"],
    cwd: "/repo/backend",
    mandatory: true,
    ...overrides,
  };
}

describe("independent validator", () => {
  it("runs a check and returns a passing result", async () => {
    const runner = new FakeRunner(successOutcome());
    const validator = createIndependentValidator(runner);

    const result = await validator.runCheck(verificationCommand());

    expect(result.checkId).toBe("backend-typecheck");
    expect(result.check.passed).toBe(true);
    expect(result.check.ran).toBe(true);
    expect(result.check.exitCode).toBe(0);
    expect(result.outcome.status).toBe("success");
  });

  it("runs a check and returns a failing result", async () => {
    const runner = new FakeRunner(failureOutcome());
    const validator = createIndependentValidator(runner);

    const result = await validator.runCheck(verificationCommand());

    expect(result.check.passed).toBe(false);
    expect(result.check.ran).toBe(true);
    expect(result.check.exitCode).toBe(1);
  });

  it("treats a timeout as a failure", async () => {
    const runner = new FakeRunner(timeoutOutcome());
    const validator = createIndependentValidator(runner);

    const result = await validator.runCheck(verificationCommand());

    expect(result.check.passed).toBe(false);
    expect(result.check.ran).toBe(false);
  });

  it("treats a spawn error as a failure", async () => {
    const runner = new FakeRunner(spawnErrorOutcome());
    const validator = createIndependentValidator(runner);

    const result = await validator.runCheck(verificationCommand());

    expect(result.check.passed).toBe(false);
    expect(result.check.ran).toBe(false);
  });

  it("passes the correct command and args to the runner", async () => {
    const runner = new FakeRunner(successOutcome());
    const validator = createIndependentValidator(runner);

    await validator.runCheck(verificationCommand());

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.command).toBe("npx");
    expect(runner.calls[0]?.args).toEqual(["tsc", "--noEmit"]);
    expect(runner.calls[0]?.cwd).toBe("/repo/backend");
  });

  it("runs multiple checks and reports all mandatory passed", async () => {
    const runner = new FakeRunner(successOutcome());
    const validator = createIndependentValidator(runner);

    const summary = await validator.runChecks([
      verificationCommand({ checkId: "typecheck" }),
      verificationCommand({ checkId: "build", command: "npm", args: ["run", "build"] }),
    ]);

    expect(summary.results).toHaveLength(2);
    expect(summary.allMandatoryPassed).toBe(true);
    expect(summary.hasFailures).toBe(false);
  });

  it("reports failure when a mandatory check fails", async () => {
    let callCount = 0;
    const runner: ProcessRunner = {
      run: () => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve(successOutcome());
        return Promise.resolve(failureOutcome());
      },
    };
    const validator = createIndependentValidator(runner);

    const summary = await validator.runChecks([
      verificationCommand({ checkId: "typecheck" }),
      verificationCommand({ checkId: "build", command: "npm", args: ["run", "build"] }),
    ]);

    expect(summary.allMandatoryPassed).toBe(false);
    expect(summary.hasFailures).toBe(true);
  });

  it("does not treat process success as workflow verification", async () => {
    const runner = new FakeRunner(successOutcome());
    const validator = createIndependentValidator(runner);

    const result = await validator.runCheck(verificationCommand());

    // Process success means the command ran and exited 0.
    // It does NOT mean the story is VERIFIED.
    expect(result.outcome.status).toBe("success");
    expect(result.check.passed).toBe(true);
    // The check result is a CheckResult, not a workflow verdict.
    expect(result.check).not.toHaveProperty("verdict");
    expect(result.check).not.toHaveProperty("status");
  });
});

describe("independent validator is not an approval authority", () => {
  it("exposes no approval or workflow transition surface", () => {
    const runner = new FakeRunner(successOutcome());
    const validator: IndependentValidator = createIndependentValidator(runner);

    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(validator));
    for (const forbidden of ["approve", "grantApproval", "decide", "transition", "advance", "setState"]) {
      expect(surface).not.toContain(forbidden);
    }
  });
});
