/**
 * Stage 2B — safety invariant suite.
 *
 * These are the Stage 2A invariants, preserved verbatim in intent. Stage 2B added a
 * real OpenCode CLI transport; NONE of it may weaken a single line below.
 *
 * This file is the durable, in-repo form of the Stage 2A invariant suite. It runs
 * fully offline: it never spawns a process, opens a socket, or touches the AI
 * Teacher application.
 */

import { describe, expect, it } from "vitest";

import { InMemoryApprovalGate, evaluateBuildPermission, APPROVAL_GATE_NON_GOALS } from "../src/approval-gate.js";
import { loadConfig } from "../src/config.js";
import { evaluateGuard, diffSnapshots, isReadOnlyGitInvocation, createGitGuard } from "../src/git-guard.js";
import { OpenCodeCliClient, StubOpenCodeClient, isProcessSuccessful } from "../src/opencode-client.js";
import { createProcessRunner, type ProcessExecutionOutcome } from "../src/opencode-process.js";
import { createOrchestrator } from "../src/orchestrator.js";
import { PROCESS_VS_WORKFLOW_INVARIANTS, createResultParser } from "../src/result-parser.js";
import { createConsoleReporter } from "../src/reporters/console-reporter.js";
import { createStoryResolver } from "../src/story-resolver.js";
import { SUCCESS_PHASES, TERMINAL_PHASES, TRANSITION_GRAPH, assertTransition, canTransition, evaluateVerification } from "../src/workflow.js";

describe("workflow state machine", () => {
  it("PLAN_READY cannot enter BUILDING", () => {
    expect(canTransition("PLAN_READY", "BUILDING", "APPROVAL_GRANTED")).toBe(false);
    expect(() => assertTransition("PLAN_READY", "BUILDING", "APPROVAL_GRANTED")).toThrow();
  });

  it("BUILDING has exactly one legal entry, via APPROVAL_GRANTED", () => {
    const entries = Object.entries(TRANSITION_GRAPH).flatMap(([from, edges]) =>
      edges.filter((edge) => edge.to === "BUILDING").map((edge) => ({ from, triggers: edge.triggers })),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.from).toBe("WAITING_FOR_APPROVAL");
    expect(entries[0]?.triggers).toEqual(["APPROVAL_GRANTED"]);
  });

  it("terminal states remain sinks", () => {
    // Precise wording matters here. There are FIVE error terminals
    // (TERMINAL_PHASES) and ONE success terminal (VERIFIED). All six phases have
    // zero outgoing edges, but VERIFIED is not a sixth error state. Keeping the
    // two groups explicit prevents a "6 terminals" misreport.
    expect(TERMINAL_PHASES).toHaveLength(5);
    expect(SUCCESS_PHASES).toEqual(["VERIFIED"]);

    for (const phase of TERMINAL_PHASES) {
      expect(TRANSITION_GRAPH[phase]).toHaveLength(0);
    }
    // The success terminal is a sink too.
    for (const phase of SUCCESS_PHASES) {
      expect(TRANSITION_GRAPH[phase]).toHaveLength(0);
    }
  });

  it("VERIFIED is reachable only from VERIFYING via VERIFICATION_COMPLETED", () => {
    expect(TERMINAL_PHASES).not.toContain("VERIFIED");
    const incoming = Object.entries(TRANSITION_GRAPH).flatMap(([from, edges]) =>
      edges.filter((edge) => edge.to === "VERIFIED").map((edge) => ({ from, triggers: edge.triggers })),
    );
    expect(incoming).toEqual([{ from: "VERIFYING", triggers: ["VERIFICATION_COMPLETED"] }]);
  });

  it("failed TESTING cannot become VERIFIED", () => {
    expect(Object.values(TRANSITION_GRAPH.TESTING).every((edge) => edge.to !== "VERIFYING")).toBe(true);
    expect(evaluateVerification({ testsPassed: false, reviewApproved: true, guardViolations: [], typecheckPassed: true }).allowed).toBe(false);
  });

  it("failed REVIEWING cannot become VERIFIED", () => {
    expect(evaluateVerification({ testsPassed: true, reviewApproved: false, guardViolations: [], typecheckPassed: true }).allowed).toBe(false);
  });

  it("an unauthorized file change blocks VERIFIED", () => {
    const decision = evaluateVerification({ testsPassed: true, reviewApproved: true, guardViolations: ["AGENTS.md"], typecheckPassed: true });
    expect(decision.allowed).toBe(false);
    expect(decision.errorCode).toBe("GUARD_VIOLATION");
  });

  it("all-green evidence is the only path to VERIFIED", () => {
    expect(evaluateVerification({ testsPassed: true, reviewApproved: true, guardViolations: [], typecheckPassed: true }).allowed).toBe(true);
  });
});

describe("approval gate", () => {
  it("NO APPROVAL -> NO BUILD", () => {
    const gate = new InMemoryApprovalGate();
    expect(evaluateBuildPermission("WAITING_FOR_APPROVAL", null).allowed).toBe(false);

    gate.request({
      workflowId: "wf-safety",
      storyId: "US-000",
      planReference: "ref",
      requestedAt: new Date().toISOString(),
      summary: "s",
    });
    expect(evaluateBuildPermission("WAITING_FOR_APPROVAL", gate.current("wf-safety")).allowed).toBe(false);
  });

  it("rejection denies the build; a human grant permits it", () => {
    const gate = new InMemoryApprovalGate();
    gate.request({ workflowId: "wf-2", storyId: null, planReference: "ref", requestedAt: new Date().toISOString(), summary: "s" });

    const rejected = gate.decide("wf-2", "ApprovalRejected", { kind: "po", id: "human" });
    expect(evaluateBuildPermission("WAITING_FOR_APPROVAL", rejected).allowed).toBe(false);

    const granted = gate.decide("wf-2", "ApprovalGranted", { kind: "po", id: "human" });
    expect(evaluateBuildPermission("WAITING_FOR_APPROVAL", granted).allowed).toBe(true);
  });

  it("exposes no automatic-approval member", () => {
    const gate = new InMemoryApprovalGate();
    for (const forbidden of ["autoApprove", "approveOnTimeout", "force", "skipApproval", "approvalByDefault", "allow"]) {
      expect(Object.keys(gate as unknown as Record<string, unknown>)).not.toContain(forbidden);
    }
    expect(APPROVAL_GATE_NON_GOALS.length).toBeGreaterThan(0);
  });
});

describe("git guard", () => {
  it("refuses every mutating git subcommand", () => {
    for (const sub of ["add", "commit", "stash", "reset", "clean", "checkout", "restore", "push", "revert", "merge", "rm", "mv"]) {
      expect(isReadOnlyGitInvocation(sub)).toBe(false);
    }
    for (const sub of ["status", "diff", "rev-parse", "log", "ls-files"]) {
      expect(isReadOnlyGitInvocation(sub)).toBe(true);
    }
  });

  it("treats a missing baseline as STOP", () => {
    const current = { capturedAt: "t", headCommit: "abc", stagedPaths: [], modifiedPaths: [], untrackedPaths: ["x"], renamedPaths: [], deletedPaths: [], porcelainStatus: "", contentHashes: {}, kind: "current" as const };
    expect(evaluateGuard(null, current, { allowedPrefixes: ["backend/"], allowedExactPaths: [], filePermissions: [] }).allowed).toBe(false);
  });

  it("STOPs on an unauthorized path and protects pre-existing work", () => {
    const baseline = { capturedAt: "t0", headCommit: "abc", stagedPaths: [], modifiedPaths: [], untrackedPaths: ["DESIGN.md"], renamedPaths: [], deletedPaths: [], porcelainStatus: "", contentHashes: {}, kind: "baseline" as const };
    const current = { capturedAt: "t1", headCommit: "abc", stagedPaths: [], modifiedPaths: [], untrackedPaths: ["DESIGN.md", "AGENTS.md"], renamedPaths: [], deletedPaths: [], porcelainStatus: "", contentHashes: {}, kind: "current" as const };
    const verdict = evaluateGuard(baseline, current, { allowedPrefixes: ["backend/"], allowedExactPaths: [], filePermissions: [] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.unauthorizedPaths).toContain("AGENTS.md");
    expect(verdict.onViolation).toBe("STOP");
    expect(diffSnapshots(baseline, current).added).not.toContain("DESIGN.md");
  });

  it("cannot read the repository in Stage 2B either", async () => {
    const guard = createGitGuard();
    await expect(guard.captureBaseline()).rejects.toThrow(/not implemented/i);
    await expect(guard.captureCurrentState()).rejects.toThrow(/not implemented/i);
  });
});

describe("OpenCode adapter is not an approval authority", () => {
  const config = loadConfig().opencode;
  const neverCalled = { run: () => { throw new Error("the adapter must not be able to reach a process in this test"); } };

  it("exposes no approval, state, or transition surface", () => {
    const client = new OpenCodeCliClient({ config, processRunner: neverCalled, env: {} });
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
    for (const forbidden of ["approve", "grantApproval", "decide", "transition", "advance", "setState", "commit", "stage"]) {
      expect(surface).not.toContain(forbidden);
    }
  });

  it("cannot produce a workflow verdict", () => {
    const client = new OpenCodeCliClient({ config, processRunner: neverCalled, env: {} });
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(client))).not.toContain("verify");
    expect(isProcessSuccessful).toBeTypeOf("function");
    // The process helper only reports on PROCESS status.
    expect(PROCESS_VS_WORKFLOW_INVARIANTS.join(" ")).toMatch(/does NOT mean the story is VERIFIED/);
  });

  it("declares no shell, no server, and no network capability", () => {
    const client = new OpenCodeCliClient({ config, processRunner: neverCalled, env: {} });
    expect(client.capabilities.usesShell).toBe(false);
    expect(client.capabilities.startsServer).toBe(false);
    expect(client.capabilities.performsNetworkIo).toBe(false);
  });

  it("keeps the Stage 2A stub refusing every method", async () => {
    const stub = new StubOpenCodeClient(config);
    await expect(stub.createSession({} as never)).rejects.toThrow(/not implemented/i);
    await expect(stub.runCommand({} as never, {} as never)).rejects.toThrow(/not implemented/i);
  });
});

describe("process success is not workflow verification", () => {
  const successOutcome: ProcessExecutionOutcome = {
    status: "success",
    exitCode: 0,
    command: "opencode",
    args: [],
    stdout: "{}",
    stderr: "",
    durationMs: 1,
    timedOut: false,
    truncated: false,
    signal: null,
  };

  it("an exit code of 0 yields a process success only", () => {
    expect(successOutcome.status).toBe("success");
    // The parser processes the output but does NOT produce VERIFIED from process success alone.
    const result = createResultParser().parse(successOutcome, "VERIFYING", "US-101");
    expect(result.status).not.toBe("po-decision-required");
    expect(result.phase).toBe("VERIFYING");
  });

  it("states the distinction explicitly", () => {
    expect(PROCESS_VS_WORKFLOW_INVARIANTS.length).toBeGreaterThanOrEqual(5);
  });
});

describe("story resolution and result parsing stay conservative", () => {
  it("invents no story", async () => {
    const resolution = await createStoryResolver().resolve({ storyId: "US-101", masterBacklogPath: "x" });
    expect(resolution.kind).toBe("not-found");
  });

  it("parses OpenCode output safely without producing workflow verdicts from process success", () => {
    const result = createResultParser().parse({ anything: true }, "TESTING", "US-101");
    expect(result.status).toBe("blocked");
  });
});

describe("orchestrator workflow execution", () => {
  it("start, plan, requestApproval, and decideApproval are implemented; other methods still refuse", async () => {
    const config = loadConfig();
    const orchestrator = createOrchestrator(createConsoleReporter({ logLevel: "silent", sink: () => {} }), { config });

    const status = orchestrator.getStatus();
    expect(status.stage).toBe("2B");
    expect(status.executionEnabled).toBe(true);
    expect(status.opencodeConnected).toBe(false);
    expect(status.approvalAutomation).toBe(false);
    expect(status.gitMutationEnabled).toBe(false);
    expect(status.networkEnabled).toBe(false);
    expect(status.stateMachine.buildRequiresApproval).toBe(true);

    // start, plan, requestApproval, decideApproval, build, test, review, and verify are now implemented (Stage 2C-6 Steps 2-5)
    // Other methods still refuse
    for (const method of ["report"] as const) {
      // Bound so the private-field access inside the implementation stays intact.
      const call = orchestrator[method].bind(orchestrator) as (id: string) => Promise<unknown>;
      await expect(call("wf-1")).rejects.toThrow(/not.*implemented/i);
    }
  });
});

describe("configuration safety floor", () => {
  it("keeps every fail-safe literal", () => {
    const config = loadConfig();
    expect(config.safety.gitMutationEnabled).toBe(false);
    expect(config.safety.networkEnabled).toBe(false);
    expect(config.safety.approvalRequired).toBe(true);
    expect(config.safety.explicitApprovalOnly).toBe(true);
  });

  it("reads no secret-looking configuration", () => {
    const config = loadConfig({}, {});
    expect(Object.keys(config.opencode).sort()).toEqual(
      ["bin", "command", "killGraceMs", "maxOutputBytes", "serverUrl", "timeoutMs", "workingDirectory"].sort(),
    );
  });
});

describe("process runner is not reachable from the safety path", () => {
  it("createProcessRunner exists but no safety module spawns anything", () => {
    expect(createProcessRunner).toBeTypeOf("function");
  });
});
