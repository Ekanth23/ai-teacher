/**
 * Stage 2C-6 Step 5 — Orchestrator verify unit tests.
 *
 * Covers VERIFYING-phase execution, independent mandatory checks, per-check
 * evidence, waiver validity (PD-9/PD-10), scope compliance, git integrity,
 * workflow transitions, and workflow event recording.
 */

import { describe, expect, it } from "vitest";

import { Stage2COrchestrator } from "../src/orchestrator-impl.js";
import { InMemoryWorkflowStore, type AdvanceRequest } from "../src/workflow-store.js";
import { InvalidTransitionError } from "../src/errors.js";
import { InMemoryApprovalGate } from "../src/approval-gate.js";
import { createResultParser } from "../src/result-parser.js";
import { evaluateWaiverValidity, type WaiverSource, type WorkflowWaiver } from "../src/result-parser.js";
import { loadConfig } from "../src/config.js";
import type { StoryResolver } from "../src/story-resolver.js";
import type { ContextBuilder } from "../src/context-builder.js";
import type { OpenCodeClient } from "../src/opencode-client.js";
import { evaluateGuard, diffSnapshots, type GitGuard, type GitBaseline, type GitCurrentState, type GuardScope } from "../src/git-guard.js";
import type { Reporter } from "../src/reporters/console-reporter.js";
import type { ProcessRunner, ProcessExecutionOutcome } from "../src/opencode-process.js";

// --- Mock implementations ---

function createMockStoryResolver(overrides: Partial<StoryResolver> = {}): StoryResolver {
  return {
    resolve: async () => ({
      kind: "not-found" as const,
      storyId: "US-101",
      message: "Story not found in mock resolver.",
    }),
    authoritativeSections: () => ["SECTION B", "SECTION F", "SECTION C"],
    ...overrides,
  };
}

function createMockContextBuilder(overrides: Partial<ContextBuilder> = {}): ContextBuilder {
  return {
    build: async (request) => ({
      packageId: `ctx-${request.storyId ?? "unassigned"}`,
      storyId: request.storyId,
      epicId: request.epicId,
      createdAt: new Date().toISOString(),
      sections: [],
      notes: ["Mock context builder"],
      complete: false,
    }),
    capabilities: () => ["master-backlog", "user-story", "po-decisions"],
    ...overrides,
  };
}

// verify() must not call OpenCode at all. Any call fails the test loudly.
function createThrowingOpenCodeClient(): OpenCodeClient {
  return {
    createSession: async () => {
      throw new Error("verify() must not invoke OpenCode");
    },
    continueSession: async () => {
      throw new Error("verify() must not invoke OpenCode");
    },
    runCommand: async () => {
      throw new Error("verify() must not invoke OpenCode");
    },
    collectResult: async () => {
      throw new Error("verify() must not invoke OpenCode");
    },
    dispose: async () => {},
  };
}

function createBaseline(headCommit: string | null = "abc123"): GitBaseline {
  return {
    kind: "baseline",
    capturedAt: new Date().toISOString(),
    headCommit,
    stagedPaths: [],
    modifiedPaths: [],
    untrackedPaths: [],
    renamedPaths: [],
    deletedPaths: [],
    porcelainStatus: "",
    contentHashes: {},
  };
}

function createCurrentState(headCommit: string | null = "abc123"): GitCurrentState {
  return { ...createBaseline(headCommit), kind: "current" };
}

function createMockGitGuard(overrides: Partial<GitGuard> = {}): GitGuard {
  return {
    captureBaseline: async () => createBaseline(),
    captureCurrentState: async () => createCurrentState(),
    diffAgainstBaseline: () => ({ added: ["backend/src/foo.ts"], modified: [], removed: [], all: ["backend/src/foo.ts"] }),
    evaluate: () => ({
      allowed: true,
      unauthorizedPaths: [],
      protectedPaths: [],
      reason: "All changes are in scope.",
      onViolation: "STOP" as const,
    }),
    ...overrides,
  };
}

/**
 * Creates a GitGuard that delegates to the real guard math (evaluateGuard / diffSnapshots)
 * over fixture snapshots. This exercises the F-6 path (allowed:true + protectedPaths)
 * through the actual guard logic rather than a mocked verdict.
 */
function createRealGuardGitGuard(overrides: {
  baselineFixture: GitBaseline;
  currentFixture: GitCurrentState;
  scope: GuardScope;
} = { baselineFixture: createBaseline(), currentFixture: createCurrentState(), scope: { allowedPrefixes: ["backend/", "frontend/", "src/", "tools/"], allowedExactPaths: [], filePermissions: [] } }): GitGuard {
  return {
    captureBaseline: async () => overrides.baselineFixture,
    captureCurrentState: async () => overrides.currentFixture,
    diffAgainstBaseline: (b, c) => diffSnapshots(b, c),
    evaluate: (b, c, s) => evaluateGuard(b, c, s),
    ...overrides,
  };
}

function createMockReporter(): Reporter {
  return {
    log: () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  } as unknown as Reporter;
}

function outcome(overrides: Partial<ProcessExecutionOutcome> = {}): ProcessExecutionOutcome {
  return {
    status: "success",
    exitCode: 0,
    command: "mock",
    args: [],
    stdout: "",
    stderr: "",
    durationMs: 1,
    timedOut: false,
    truncated: false,
    signal: null,
    ...overrides,
  } as ProcessExecutionOutcome;
}

function failureOutcome(): ProcessExecutionOutcome {
  return outcome({ status: "failure", exitCode: 1, stderr: "boom" });
}

function timeoutOutcome(): ProcessExecutionOutcome {
  return {
    ...outcome({
      status: "timeout",
      exitCode: null,
      timedOut: true,
    }),
    terminationAttempted: true,
    terminationSignals: ["SIGTERM"],
  } as ProcessExecutionOutcome;
}

function spawnErrorOutcome(): ProcessExecutionOutcome {
  return {
    ...outcome({
      status: "spawn-error",
      exitCode: null,
    }),
    errorCode: "ENOENT",
    errorMessage: "spawn npx ENOENT",
  } as ProcessExecutionOutcome;
}

function createMockProcessRunner(outcomeFor: (args: readonly string[]) => ProcessExecutionOutcome): ProcessRunner {
  return {
    run: (request) => Promise.resolve(outcomeFor(request.args)),
  };
}

// --- Waiver helpers ---

function waiver(overrides: Partial<WorkflowWaiver> = {}): WorkflowWaiver {
  return {
    checkId: "headed-e2e",
    phase: "VERIFYING",
    actor: "po",
    reason: "Browser not available in this environment",
    grantedAt: "2026-10-01T00:00:00.000Z",
    revokedBy: null,
    revokedAt: null,
    ...overrides,
  };
}

function waiverSource(records: readonly WorkflowWaiver[]): WaiverSource {
  return { listForRun: () => records };
}

// --- Orchestrator factory ---

function createTestOrchestrator(overrides: {
  gitGuard?: GitGuard;
  processRunner?: ProcessRunner;
  store?: InMemoryWorkflowStore;
  waivers?: WaiverSource;
} = {}) {
  const config = loadConfig();
  const store = overrides.store ?? new InMemoryWorkflowStore();
  const orchestrator = new Stage2COrchestrator({
    config,
    opencode: createThrowingOpenCodeClient(),
    contextBuilder: createMockContextBuilder(),
    storyResolver: createMockStoryResolver(),
    approvalGate: new InMemoryApprovalGate(),
    resultParser: createResultParser(),
    gitGuard: overrides.gitGuard ?? createMockGitGuard(),
    reporter: createMockReporter(),
    workflowStore: store,
    processRunner: overrides.processRunner ?? createMockProcessRunner(() => outcome()),
    ...(overrides.waivers !== undefined ? { waivers: overrides.waivers } : {}),
  });
  return { orchestrator, store };
}

/** Create a run in VERIFYING phase with a REVIEW_COMPLETED event in history. */
async function createVerifyingRun(
  orchestrator: Stage2COrchestrator,
  store: InMemoryWorkflowStore,
  options: { persistEvidence?: boolean } = {},
): Promise<ReturnType<InMemoryWorkflowStore["get"]>> {
  const run = await orchestrator.start({
    storyId: "US-101",
    requestedBy: "po",
    intent: "test workflow",
  });

  store.advance(run.id, { to: "PLAN_READY", trigger: "PLAN_PRODUCED", actor: "orchestrator", note: "Plan produced" });
  await orchestrator.requestApproval(run.id);
  const building = await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");
  store.advance(building.id, { to: "TESTING", trigger: "BUILD_PRODUCED", actor: "orchestrator", note: "Build completed" });
  store.advance(building.id, { to: "REVIEWING", trigger: "TESTS_COMPLETED", actor: "orchestrator", note: "Tests completed" });

  // Persist approved scope + evidence (Rev 19 Decision 2 / evidence persistence).
  if (options.persistEvidence !== false) {
    store.recordEvidence(run.id, {
      approvedScope: {
        workflowId: run.id,
        scope: { allowedPrefixes: ["backend/", "frontend/", "src/", "tools/"], allowedExactPaths: [], filePermissions: [] },
        approvedBy: "po-user-1",
        approvedAt: new Date().toISOString(),
      },
      acceptanceCriteria: {
        workflowId: run.id,
        storyId: "US-101",
        satisfied: true,
        recordedBy: "po-user-1",
        recordedAt: new Date().toISOString(),
        reference: "mock criteria",
      },
      poDecisions: {
        workflowId: run.id,
        storyId: "US-101",
        resolved: true,
        recordedBy: "po-user-1",
        recordedAt: new Date().toISOString(),
        reference: "mock po decisions",
      },
    });
  }

  return store.advance(building.id, { to: "VERIFYING", trigger: "REVIEW_COMPLETED", actor: "orchestrator", note: "Review completed" });
}

// Runner that passes everything except the args supplied.
function runnerFailingArg(failArgs: readonly string[], factory: () => ProcessExecutionOutcome = failureOutcome): ProcessRunner {
  return createMockProcessRunner((args) => (args.join(" ") === failArgs.join(" ") ? factory() : outcome()));
}

const ALL_SUCCESS_RUNNER: ProcessRunner = createMockProcessRunner(() => outcome());

// Check id -> args used by #getVerificationCommands for backend checks.
const BACKEND_CHECK_ARGS: Record<string, readonly string[]> = {
  "backend-typecheck": ["tsc", "--noEmit"],
  "backend-build": ["run", "build"],
  "backend-focused-tests": ["vitest", "run"],
  "backend-regression-tests": ["test"],
};

// --- Tests ---

describe("orchestrator verify", () => {
  it("transitions to VERIFIED when all mandatory checks are satisfied", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("success");
    expect(result.phase).toBe("VERIFYING");
    expect(result.nextRecommendedState).toBe("VERIFIED");

    const updated = store.get(run!.id)!;
    expect(updated.phase).toBe("VERIFIED");
    const event = updated.history.find((e) => e.trigger === "VERIFICATION_COMPLETED");
    expect(event).toBeDefined();
    expect(event?.actor).toBe("orchestrator");
  });

  it("executes no OpenCode command (OpenCode output is DATA, never AUTHORITY)", async () => {
    // createThrowingOpenCodeClient is wired in by createTestOrchestrator:
    // any OpenCode call would throw and fail the test.
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);
    expect(result.status).toBe("success");
  });

  it.each(Object.entries(BACKEND_CHECK_ARGS))(
    "transitions to FAILED when mandatory check '%s' fails",
    async (_checkId, args) => {
      const store = new InMemoryWorkflowStore();
      const { orchestrator } = createTestOrchestrator({
        store,
        processRunner: runnerFailingArg(args),
      });
      const run = await createVerifyingRun(orchestrator, store);

      const result = await orchestrator.verify(run!.id);

      expect(result.status).toBe("failure");
      expect(result.nextRecommendedState).toBe("FAILED");

      const updated = store.get(run!.id)!;
      expect(updated.phase).toBe("FAILED");
      expect(updated.phase).not.toBe("VERIFIED");
      expect(updated.history.some((e) => e.trigger === "VERIFICATION_FAILED")).toBe(true);
    },
  );

  it("treats a timed-out check as unavailable, not success", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      processRunner: runnerFailingArg(["vitest", "run"], timeoutOutcome),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("treats a spawn-error check as unavailable, not success", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      processRunner: runnerFailingArg(["run", "build"], spawnErrorOutcome),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("does not treat a contradictory process outcome (success status, non-zero exit) as passing", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      processRunner: createMockProcessRunner((args) =>
        args[0] === "tsc"
          ? outcome({ status: "success", exitCode: 1 } as unknown as Partial<ProcessExecutionOutcome>)
          : outcome(),
      ),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("blocks verification when git baseline capture fails (missing evidence)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        captureBaseline: async () => {
          throw new Error("git unavailable");
        },
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    // Strengthened (Slice 5): an infrastructure failure is no longer reported as
    // an ordinary verification failure. The status and the recommended state now
    // agree with the stored run phase asserted below.
    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedState).toBe("BLOCKED");
    expect(store.get(run!.id)!.phase).toBe("BLOCKED");
  });

  it("transitions to SCOPE_VIOLATION on unauthorized changes", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        evaluate: () => ({
          allowed: false,
          unauthorizedPaths: ["secrets/prod.env"],
          protectedPaths: [],
          reason: "Unauthorized change",
          onViolation: "STOP" as const,
        }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("scope-violation");
    expect(result.nextRecommendedState).toBe("SCOPE_VIOLATION");

    const updated = store.get(run!.id)!;
    expect(updated.phase).toBe("SCOPE_VIOLATION");
    expect(updated.history.some((e) => e.trigger === "SCOPE_VIOLATION_DETECTED")).toBe(true);
  });

  it("blocks on protected-file modifications", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        evaluate: () => ({
          allowed: false,
          unauthorizedPaths: [],
          protectedPaths: ["backend/existing.ts"],
          reason: "Protected paths",
          onViolation: "STOP" as const,
        }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("blocked");
    expect(store.get(run!.id)!.phase).toBe("BLOCKED");
  });

  it("blocks (EXTERNAL_BLOCK) when HEAD changes during verification", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        captureCurrentState: async () => createCurrentState("different-head"),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedState).toBe("BLOCKED");

    const updated = store.get(run!.id)!;
    expect(updated.phase).toBe("BLOCKED");
    expect(updated.phase).not.toBe("VERIFIED");
    expect(updated.phase).not.toBe("FAILED");
    expect(updated.history.some((e) => e.trigger === "EXTERNAL_BLOCK")).toBe(true);
    expect(updated.history.some((e) => e.trigger === "VERIFICATION_FAILED")).toBe(false);
  });

  it("cannot produce VERIFIED on a subsequent attempt after the HEAD-change block", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        captureCurrentState: async () => createCurrentState("different-head"),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    await orchestrator.verify(run!.id);
    expect(store.get(run!.id)!.phase).toBe("BLOCKED");

    // BLOCKED is terminal: a second verify() call cannot advance it.
    await expect(orchestrator.verify(run!.id)).rejects.toThrow();
    expect(store.get(run!.id)!.phase).toBe("BLOCKED");
  });

  it("blocks when E2E is unavailable without a waiver (frontend story)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("honours a waiver granted through the orchestrator and records its audit event", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const grant = orchestrator.grantWaiver(run!.id, {
      checkId: "headed-e2e",
      phase: "VERIFYING",
      actor: "po",
      reason: "Browser not available",
    });
    expect(grant.ok).toBe(true);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("success");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "headed-e2e")?.status).toBe("waived");

    const history = store.get(run!.id)!.history;
    const grantEvents = history.filter((e) => e.kind === "waiver-grant");
    expect(grantEvents).toHaveLength(1);
    expect(grantEvents[0]?.actor).toBe("po");
    expect(grantEvents[0]?.waiver).toMatchObject({ checkId: "headed-e2e", phase: "VERIFYING", reason: "Browser not available" });
  });

  it("a revoked granted waiver reverts the check to unavailable and fails closed", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    orchestrator.grantWaiver(run!.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po", reason: "Browser not available" });
    const revoke = orchestrator.revokeWaiver(run!.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });
    expect(revoke.ok).toBe(true);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "headed-e2e")?.status).toBe("unavailable");
    expect(store.get(run!.id)!.history.filter((e) => e.kind === "waiver-revocation")).toHaveLength(1);
  });

  it("a revoked ledger waiver is not bypassed by a still-valid injected waiver for the same check and phase", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
      waivers: waiverSource([waiver({ checkId: "headed-e2e", phase: "VERIFYING" })]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    orchestrator.grantWaiver(run!.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po", reason: "Browser not available" });
    orchestrator.revokeWaiver(run!.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });

    const result = await orchestrator.verify(run!.id);

    // The injected waiver describes the same pair, but the ledger record is
    // authoritative for it: the revocation is not bypassable.
    expect(result.status).toBe("failure");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "headed-e2e")?.status).toBe("unavailable");
  });

  it("rejects a waiver grant from an unauthorized actor without recording a grant event", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);
    const before = store.get(run!.id)!;

    const result = orchestrator.grantWaiver(run!.id, {
      checkId: "headed-e2e",
      phase: "VERIFYING",
      actor: "orchestrator",
      reason: "self-waiver attempt",
    });

    expect(result.ok).toBe(false);
    expect(store.get(run!.id)!.history.filter((e) => e.kind !== "transition")).toHaveLength(0);
    expect(store.get(run!.id)!.waivers).toHaveLength(0);
    expect(store.get(run!.id)).toEqual(before);
  });

  it("rejects revoking a waiver by a different PO and leaves the waiver valid (PD-9)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const grant = orchestrator.grantWaiver(run!.id, {
      checkId: "headed-e2e",
      phase: "VERIFYING",
      actor: "human",
      reason: "Browser not available",
    });
    expect(grant.ok).toBe(true);

    const revoke = orchestrator.revokeWaiver(run!.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });
    expect(revoke.ok).toBe(false);
    expect(store.get(run!.id)!.history.filter((e) => e.kind === "waiver-revocation")).toHaveLength(0);

    // The waiver is still valid, so verification still succeeds.
    const result = await orchestrator.verify(run!.id);
    expect(result.status).toBe("success");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "headed-e2e")?.status).toBe("waived");
  });

  it("applies a valid single-check PO waiver (PD-9/PD-10)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
      waivers: waiverSource([waiver({ checkId: "headed-e2e", phase: "VERIFYING" })]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("success");
    expect(result.nextRecommendedState).toBe("VERIFIED");
    expect(store.get(run!.id)!.phase).toBe("VERIFIED");
  });

  it("does not expire waivers by time (PD-9: no time-based expiration)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
      waivers: waiverSource([waiver({ grantedAt: "2020-01-01T00:00:00.000Z" })]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("success");
    expect(store.get(run!.id)!.phase).toBe("VERIFIED");
  });

  it("treats a revoked waiver as invalid (PD-9)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
      waivers: waiverSource([
        waiver({ revokedBy: "po", revokedAt: "2026-10-02T00:00:00.000Z" }),
      ]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("ignores a revocation attributed to a different actor (only the granting actor may revoke)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
      waivers: waiverSource([
        waiver({ revokedBy: "someone-else", revokedAt: "2026-10-02T00:00:00.000Z" }),
      ]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("success");
    expect(store.get(run!.id)!.phase).toBe("VERIFIED");
  });

  it("invalidates waivers when the workflow run has ended (PD-9)", () => {
    const validity = evaluateWaiverValidity(waiver(), {
      checkId: "headed-e2e",
      phase: "VERIFYING",
      runPhase: "FAILED",
    });
    expect(validity.valid).toBe(false);
    expect(validity.reason).toContain("terminal");
  });

  it("does not apply a waiver recorded for a different check (PD-10 single-check scope)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
      // Waiver names backend-typecheck, but the unavailable mandatory check is headed-e2e.
      waivers: waiverSource([waiver({ checkId: "backend-typecheck" })]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("does not expand one waiver across multiple checks (PD-10)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      processRunner: runnerFailingArg(["tsc", "--noEmit"], spawnErrorOutcome),
      waivers: waiverSource([waiver({ checkId: "backend-typecheck" })]),
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["backend/src/foo.ts", "frontend/src/App.tsx"], modified: [], removed: [], all: ["backend/src/foo.ts", "frontend/src/App.tsx"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    // backend-typecheck is waived, but headed-e2e is unavailable and NOT covered by that waiver.
    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("does not apply a waiver granted for a different phase (PD-10 phase-specific)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
      waivers: waiverSource([waiver({ phase: "TESTING" })]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("rejects a waiver granted by a non-human-PO actor", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
      waivers: waiverSource([waiver({ actor: "orchestrator" })]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("never lets a waiver convert a failed check into a pass", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      processRunner: runnerFailingArg(["tsc", "--noEmit"]),
      waivers: waiverSource([waiver({ checkId: "backend-typecheck" })]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("throws when verify is called from a wrong phase", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });

    const run = await orchestrator.start({ storyId: "US-101", requestedBy: "po", intent: "t" });
    // Run is in PLANNING, not VERIFYING.
    await expect(orchestrator.verify(run.id)).rejects.toThrow();
  });

  it("throws for a non-existent workflow identifier", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });

    await expect(orchestrator.verify("wf-nonexistent")).rejects.toThrow();
  });

  it("never recommends VERIFIED on a failed result", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      processRunner: ALL_SUCCESS_RUNNER,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["frontend/src/App.tsx"], modified: [], removed: [], all: ["frontend/src/App.tsx"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).not.toBe("VERIFIED");
  });

  it("records workflow events for verification-failed transitions", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      processRunner: runnerFailingArg(["tsc", "--noEmit"]),
    });
    const run = await createVerifyingRun(orchestrator, store);

    await orchestrator.verify(run!.id);

    const updated = store.get(run!.id)!;
    const event = updated.history.find((e) => e.trigger === "VERIFICATION_FAILED");
    expect(event).toBeDefined();
    expect(event?.from).toBe("VERIFYING");
    expect(event?.to).toBe("FAILED");
    expect(event?.actor).toBe("orchestrator");
  });
});

describe("orchestrator verify — Rev 19 evidence requirements", () => {
  it("fails closed when approved scope is missing", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);
    // Remove persisted evidence
    store.recordEvidence(run!.id, {});
    (store.get(run!.id) as { evidence: unknown }).evidence = {};

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "scope-clean")?.status).toBe("unavailable");
  });

  it("fails closed when approved scope belongs to a different workflow", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);
    store.recordEvidence(run!.id, {
      approvedScope: {
        workflowId: "wf-other",
        scope: { allowedPrefixes: ["backend/"], allowedExactPaths: [], filePermissions: [] },
        approvedBy: "po-user-1",
        approvedAt: new Date().toISOString(),
      },
    });

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "scope-clean")?.status).toBe("unavailable");
  });

  it("passes acceptance-criteria check with valid authoritative evidence", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("success");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "acceptance-criteria")?.status).toBe("passed");
    expect(raw.checks.find((c) => c.checkId === "po-decisions-resolved")?.status).toBe("passed");
  });

  it("fails closed when acceptance-criteria evidence is missing", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);
    (store.get(run!.id) as { evidence: unknown }).evidence = {
      approvedScope: store.get(run!.id)!.evidence.approvedScope,
      poDecisions: store.get(run!.id)!.evidence.poDecisions,
    };

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "acceptance-criteria")?.status).toBe("unavailable");
  });

  it("rejects acceptance-criteria evidence from a different story", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);
    store.recordEvidence(run!.id, {
      acceptanceCriteria: {
        workflowId: run!.id,
        storyId: "US-999",
        satisfied: true,
        recordedBy: "po-user-1",
        recordedAt: new Date().toISOString(),
        reference: "wrong story",
      },
    });

    const result = await orchestrator.verify(run!.id);

    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "acceptance-criteria")?.status).toBe("unavailable");
    expect(result.status).toBe("failure");
  });

  it("passing tests alone cannot substitute for missing acceptance-criteria evidence", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store, processRunner: createMockProcessRunner(() => outcome()) });
    const run = await createVerifyingRun(orchestrator, store);
    (store.get(run!.id) as { evidence: unknown }).evidence = {
      approvedScope: store.get(run!.id)!.evidence.approvedScope,
      poDecisions: store.get(run!.id)!.evidence.poDecisions,
    };

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
  });

  it("fails closed when PO-decision evidence is missing", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);
    (store.get(run!.id) as { evidence: unknown }).evidence = {
      approvedScope: store.get(run!.id)!.evidence.approvedScope,
      acceptanceCriteria: store.get(run!.id)!.evidence.acceptanceCriteria,
    };

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("failure");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "po-decisions-resolved")?.status).toBe("unavailable");
  });

  it("treats unresolved PO decisions as failed and blocks VERIFIED", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);
    store.recordEvidence(run!.id, {
      poDecisions: {
        workflowId: run!.id,
        storyId: "US-101",
        resolved: false,
        recordedBy: "po-user-1",
        recordedAt: new Date().toISOString(),
        reference: "pending decision PD-X",
      },
    });

    const result = await orchestrator.verify(run!.id);

    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "po-decisions-resolved")?.status).toBe("failed");
    expect(result.status).toBe("failure");
  });

  it("rejects PO-decision evidence belonging to a different workflow", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);
    store.recordEvidence(run!.id, {
      poDecisions: {
        workflowId: "wf-other",
        storyId: "US-101",
        resolved: true,
        recordedBy: "po-user-1",
        recordedAt: new Date().toISOString(),
        reference: "other workflow",
      },
    });

    const result = await orchestrator.verify(run!.id);

    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "po-decisions-resolved")?.status).toBe("unavailable");
    expect(result.status).toBe("failure");
  });

  it("a run whose only passed mandatory checks are orchestrator evaluations VERIFIES without any command (contract 13.2 rule 7 / Rev 19)", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["Docs/notes.md"], modified: [], removed: [], all: ["Docs/notes.md"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    // No backend/frontend commands match Docs/notes.md -> zero command-backed checks.
    const raw = result.raw as { checks: { checkId: string; status: string; command: string | null }[] };
    expect(raw.checks.filter((c) => c.command !== null)).toHaveLength(0);
    // Contract 13.3 authorizes orchestrator evaluation (scope, git integrity,
    // review, acceptance criteria, PO decisions) to satisfy mandatory checks.
    for (const checkId of ["scope-clean", "git-integrity", "review-approved", "acceptance-criteria", "po-decisions-resolved"]) {
      expect(raw.checks.find((c) => c.checkId === checkId)?.status).toBe("passed");
    }
    expect(result.status).toBe("success");
    expect(store.get(run!.id)!.phase).toBe("VERIFIED");
  });

  it("a run with no command-backed check still fails closed when evaluation evidence is missing", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["Docs/notes.md"], modified: [], removed: [], all: ["Docs/notes.md"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store, { persistEvidence: false });

    const result = await orchestrator.verify(run!.id);

    // No command-backed check and no evaluation evidence -> fail closed.
    const raw = result.raw as { checks: { checkId: string; status: string; command: string | null }[] };
    expect(raw.checks.filter((c) => c.command !== null)).toHaveLength(0);
    expect(raw.checks.find((c) => c.checkId === "scope-clean")?.status).toBe("unavailable");
    expect(raw.checks.find((c) => c.checkId === "acceptance-criteria")?.status).toBe("unavailable");
    expect(result.status).not.toBe("success");
    expect(store.get(run!.id)!.phase).not.toBe("VERIFIED");
  });

  // --- Slice 5: verification reporting accuracy ---

  it("(14) Path A: baseline capture failure reports no Git facts at all", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        captureBaseline: async () => {
          throw new Error("git unavailable");
        },
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.phase).toBe("VERIFYING");
    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedState).toBe("BLOCKED");
    // Nothing was ever observed, so nothing is reported.
    expect(result.git.headCommit).toBeNull();
    expect(result.git.baselineCaptured).toBe(false);
    expect(result.git.changedPaths).toEqual([]);
    expect(result.git.unauthorizedPaths).toEqual([]);
    expect(result.changedFiles).toEqual([]);
    expect(result.raw).toBeNull();
    expect(result.git.mutatedByOrchestrator).toBe(false);
  });

  it("(15) Path B: current-state capture failure reports the baseline it did capture", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        captureCurrentState: async () => {
          throw new Error("git unavailable");
        },
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.phase).toBe("VERIFYING");
    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedState).toBe("BLOCKED");
    expect(store.get(run!.id)!.phase).toBe("BLOCKED");
    // The baseline DID succeed: it is reported, not discarded.
    expect(result.git.baselineCaptured).toBe(true);
    expect(result.git.headCommit).toBe("abc123");
    // Without two snapshots a change cannot be determined, and it is not inferred.
    expect(result.git.changedPaths).toEqual([]);
    expect(result.git.unauthorizedPaths).toEqual([]);
    expect(result.changedFiles).toEqual([]);
  });

  it("(16) Path C: HEAD change reports the final HEAD but no invented authorization", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        captureCurrentState: async () => createCurrentState("different-head"),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedState).toBe("BLOCKED");
    expect(result.git.baselineCaptured).toBe(true);
    // The latest HEAD actually observed, not null.
    expect(result.git.headCommit).toBe("different-head");
    // No REAL GuardVerdict exists at the HEAD check, so changedPaths stays empty
    // rather than reporting an invented `authorized` value. changedFiles is
    // still reported because the diff genuinely exists.
    expect(result.git.changedPaths).toEqual([]);
    expect(result.changedFiles).toEqual(["backend/src/foo.ts"]);
  });

  it("(17) Paths D/E: block paths with a real verdict report derived changed paths", async () => {
    for (const verdict of [
      { protectedPaths: ["backend/existing.ts"], unauthorizedPaths: [], reason: "Protected paths" },
      { protectedPaths: [], unauthorizedPaths: [], reason: "Scope authorization cannot be determined." },
    ]) {
      const store = new InMemoryWorkflowStore();
      const { orchestrator } = createTestOrchestrator({
        store,
        gitGuard: createMockGitGuard({
          evaluate: () => ({ allowed: false, onViolation: "STOP" as const, ...verdict }),
        }),
      });
      const run = await createVerifyingRun(orchestrator, store);

      const result = await orchestrator.verify(run!.id);

      expect(result.phase).toBe("VERIFYING");
      expect(result.status).toBe("blocked");
      expect(result.nextRecommendedState).toBe("BLOCKED");
      expect(result.git.baselineCaptured).toBe(true);
      expect(result.git.headCommit).toBe("abc123");
      // A real verdict exists, so changedPaths is reported and fully derived.
      expect(result.git.changedPaths).toEqual([
        { path: "backend/src/foo.ts", state: "added", preExisting: false, authorized: true },
      ]);
      expect(result.git.unauthorizedPaths).toEqual([]);
    }
  });

  it("(18) Path H with null approved scope reports no derived changed paths", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["Docs/notes.md"], modified: [], removed: [], all: ["Docs/notes.md"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store, { persistEvidence: false });

    const result = await orchestrator.verify(run!.id);

    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "scope-clean")?.status).toBe("unavailable");
    expect(result.status).toBe("failure");
    expect(store.get(run!.id)!.phase).toBe("FAILED");
    // No real verdict exists (evaluate() never ran), so changedPaths is empty
    // even though a diff was available.
    expect(result.git.changedPaths).toEqual([]);
    expect(result.git.unauthorizedPaths).toEqual([]);
    expect(result.git.baselineCaptured).toBe(true);
    expect(result.git.headCommit).toBe("abc123");
  });

  it("(19) no exit path emits an authorized value without a real scope verdict", async () => {
    const scenarios = [
      { name: "verified", git: createMockGitGuard(), evidence: true },
      { name: "check failure", git: createMockGitGuard(), evidence: true, runner: runnerFailingArg(["tsc", "--noEmit"]) },
      {
        name: "scope violation",
        evidence: true,
        git: createMockGitGuard({
          evaluate: () => ({ allowed: false, unauthorizedPaths: ["secrets/prod.env"], protectedPaths: [], reason: "Unauthorized change", onViolation: "STOP" as const }),
        }),
      },
      {
        name: "protected file",
        evidence: true,
        git: createMockGitGuard({
          evaluate: () => ({ allowed: false, unauthorizedPaths: [], protectedPaths: ["backend/existing.ts"], reason: "Protected paths", onViolation: "STOP" as const }),
        }),
      },
      { name: "head change", evidence: true, git: createMockGitGuard({ captureCurrentState: async () => createCurrentState("different-head") }) },
      {
        name: "baseline capture failure",
        evidence: true,
        git: createMockGitGuard({ captureBaseline: async () => { throw new Error("git unavailable"); } }),
      },
      {
        name: "current-state capture failure",
        evidence: true,
        git: createMockGitGuard({ captureCurrentState: async () => { throw new Error("git unavailable"); } }),
      },
      // No approved scope => no real verdict anywhere.
      { name: "null approved scope", evidence: false },
    ];

    for (const scenario of scenarios) {
      const store = new InMemoryWorkflowStore();
      const { orchestrator } = createTestOrchestrator({
        store,
        gitGuard: scenario.git ?? createMockGitGuard(),
        ...(scenario.runner !== undefined ? { processRunner: scenario.runner } : {}),
      });
      const run = await createVerifyingRun(orchestrator, store, { persistEvidence: scenario.evidence });

      const result = await orchestrator.verify(run!.id);

      // Every reported authorization flag is traceable: a path is only ever
      // reported when a real GuardVerdict was produced for this exit path.
      if (result.git.changedPaths.length > 0) {
        expect(result.git.baselineCaptured, scenario.name).toBe(true);
        expect(result.git.headCommit, scenario.name).not.toBeNull();
      }
      // headCommit is never fabricated: it is either observed or honestly null.
      if (result.git.headCommit !== null) {
        expect(result.git.baselineCaptured, scenario.name).toBe(true);
      }
    }
  });

  it("(20) a rejected transition reports failure, the actual stored phase, and a diagnostic", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);

    // Simulate run-phase drift: the store rejects every transition from now on,
    // which is exactly what advance() does when the edge is not legal.
    const realAdvance = store.advance.bind(store);
    (store as unknown as { advance: unknown }).advance = () => {
      throw new InvalidTransitionError("VERIFYING", "VERIFIED", "VERIFICATION_COMPLETED", "legal targets are [].");
    };

    const result = await orchestrator.verify(run!.id);

    // No exception escapes, and no fabricated success is reported.
    expect(result.phase).toBe("VERIFYING");
    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).toBe("VERIFYING");
    expect(result.nextRecommendedState).toBe(store.get(run!.id)!.phase);

    const messages = result.errors.map((e) => e.message);
    expect(messages.some((m) => m.includes("was rejected"))).toBe(true);
    expect(messages.some((m) => m.includes("VERIFICATION_COMPLETED"))).toBe(true);
    expect(messages.some((m) => m.includes("Workflow remains in VERIFYING"))).toBe(true);

    (store as unknown as { advance: unknown }).advance = realAdvance;
  });

  it("(21) a rejected VERIFICATION_COMPLETED is never reported as success", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);

    const realAdvance = store.advance.bind(store);
    (store as unknown as { advance: unknown }).advance = () => {
      throw new InvalidTransitionError("VERIFYING", "VERIFIED", "VERIFICATION_COMPLETED", "legal targets are [].");
    };

    const result = await orchestrator.verify(run!.id);

    // The per-check verdict was VERIFIED, but the workflow never recorded it.
    const raw = result.raw as { verdict: string };
    expect(raw.verdict).toBe("VERIFIED");
    expect(result.status).not.toBe("success");
    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).not.toBe("VERIFIED");
    expect(store.get(run!.id)!.phase).toBe("VERIFYING");
    expect(result.summary).toContain("did not complete");

    (store as unknown as { advance: unknown }).advance = realAdvance;
  });

// --- F-1 Corrective Slice: race condition ---

  it("F-1: failed verification when workflow already VERIFIED never recommends VERIFIED", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      processRunner: createMockProcessRunner(() => failureOutcome()),
    });
    const run = await createVerifyingRun(orchestrator, store);

    // Verify the workflow is in VERIFYING phase before the call
    expect(store.get(run!.id)!.phase).toBe("VERIFYING");

    // Mock store.advance to simulate the race condition:
    // 1. The verification runs and determines verdict is NOT_VERIFIED (failure)
    // 2. Before this call's transition is applied, a concurrent call transitions to VERIFIED
    // 3. This call's transition to FAILED is rejected because VERIFIED is terminal
    const realAdvance = store.advance.bind(store);
    let firstCall = true;
    (store as unknown as { advance: unknown }).advance = (workflowId: string, request: AdvanceRequest) => {
      if (firstCall && request.trigger === "VERIFICATION_FAILED") {
        firstCall = false;
        // Simulate: concurrent call already transitioned to VERIFIED
        // Use the real advance to transition to VERIFIED first
        realAdvance(workflowId, {
          to: "VERIFIED",
          trigger: "VERIFICATION_COMPLETED",
          actor: "orchestrator",
          note: "Concurrent verification completed",
        });
        // Now throw because VERIFIED is terminal
        throw new InvalidTransitionError("VERIFIED", "FAILED", "VERIFICATION_FAILED", "VERIFIED is terminal and has no outgoing transitions.");
      }
      return realAdvance(workflowId, request);
    };

    const result = await orchestrator.verify(run!.id);

    // F-1 assertion: failure status + nextRecommendedState must NOT be VERIFIED
    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).not.toBe("VERIFIED");
    // The safe fallback is FAILED
    expect(result.nextRecommendedState).toBe("FAILED");
    // The workflow phase is now VERIFIED (from the simulated concurrent call)
    expect(store.get(run!.id)!.phase).toBe("VERIFIED");

    (store as unknown as { advance: unknown }).advance = realAdvance;
  });

  it("(22) every exit path keeps status, phase and nextRecommendedState consistent", async () => {
    const cases: { name: string; status: string; next: string }[] = [];
    const scenarios = [
      { name: "verified", git: createMockGitGuard(), expected: { status: "success", next: "VERIFIED" } },
      { name: "check failure", git: createMockGitGuard(), runner: runnerFailingArg(["tsc", "--noEmit"]), expected: { status: "failure", next: "FAILED" } },
      {
        name: "scope violation",
        git: createMockGitGuard({ evaluate: () => ({ allowed: false, unauthorizedPaths: ["secrets/prod.env"], protectedPaths: [], reason: "Unauthorized change", onViolation: "STOP" as const }) }),
        expected: { status: "scope-violation", next: "SCOPE_VIOLATION" },
      },
      {
        name: "protected file",
        git: createMockGitGuard({ evaluate: () => ({ allowed: false, unauthorizedPaths: [], protectedPaths: ["backend/existing.ts"], reason: "Protected paths", onViolation: "STOP" as const }) }),
        expected: { status: "blocked", next: "BLOCKED" },
      },
      {
        name: "ambiguous scope",
        git: createMockGitGuard({ evaluate: () => ({ allowed: false, unauthorizedPaths: [], protectedPaths: [], reason: "Scope authorization cannot be determined.", onViolation: "STOP" as const }) }),
        expected: { status: "blocked", next: "BLOCKED" },
      },
      { name: "head change", git: createMockGitGuard({ captureCurrentState: async () => createCurrentState("different-head") }), expected: { status: "blocked", next: "BLOCKED" } },
      { name: "baseline capture failure", git: createMockGitGuard({ captureBaseline: async () => { throw new Error("git unavailable"); } }), expected: { status: "blocked", next: "BLOCKED" } },
      { name: "current-state capture failure", git: createMockGitGuard({ captureCurrentState: async () => { throw new Error("git unavailable"); } }), expected: { status: "blocked", next: "BLOCKED" } },
    ];

    for (const scenario of scenarios) {
      const store = new InMemoryWorkflowStore();
      const { orchestrator } = createTestOrchestrator({
        store,
        gitGuard: scenario.git,
        ...(scenario.runner !== undefined ? { processRunner: scenario.runner } : {}),
      });
      const run = await createVerifyingRun(orchestrator, store);
      const result = await orchestrator.verify(run!.id);
      const storedPhase = store.get(run!.id)!.phase;

      // I-1: the recommended state is read back from the store.
      expect(result.nextRecommendedState, scenario.name).toBe(storedPhase);
      // Approved VERIFYING phase semantics (Decision A).
      expect(result.phase, scenario.name).toBe("VERIFYING");
      // I-2 pairing for applied transitions.
      expect(result.status, scenario.name).toBe(scenario.expected.status);
      expect(result.nextRecommendedState, scenario.name).toBe(scenario.expected.next);

      cases.push({ name: scenario.name, status: result.status, next: result.nextRecommendedState });
    }

    expect(cases).toHaveLength(8);
  });

  it("(23) success implies VERIFIED with real Git metadata", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({ store });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("success");
    expect(result.nextRecommendedState).toBe("VERIFIED");
    expect(store.get(run!.id)!.phase).toBe("VERIFIED");
    // No success claim on unavailable Git metadata.
    expect(result.git.baselineCaptured).toBe(true);
    expect(result.git.headCommit).toBe("abc123");
    expect(result.errors).toEqual([]);
  });

  it("(24) null HEAD is not treated as known-and-unchanged", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        captureBaseline: async () => createBaseline(null),
        captureCurrentState: async () => createCurrentState(null),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    // No HEAD change is detected (both are null), but git-integrity is failed.
    expect(store.get(run!.id)!.phase).not.toBe("BLOCKED");
    const raw = result.raw as { checks: { checkId: string; status: string }[] };
    expect(raw.checks.find((c) => c.checkId === "git-integrity")?.status).toBe("failed");
    expect(result.status).toBe("failure");
    // null is reported honestly, not replaced by a value.
    expect(result.git.headCommit).toBeNull();
    expect(result.git.baselineCaptured).toBe(true);
  });

  it("(25) scope violation reports the actual unauthorized paths", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        diffAgainstBaseline: () => ({ added: ["backend/src/foo.ts", "secrets/prod.env"], modified: [], removed: [], all: ["backend/src/foo.ts", "secrets/prod.env"] }),
        evaluate: () => ({ allowed: false, unauthorizedPaths: ["secrets/prod.env"], protectedPaths: [], reason: "Unauthorized change", onViolation: "STOP" as const }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("scope-violation");
    expect(result.git.unauthorizedPaths).toEqual(["secrets/prod.env"]);
    const unauthorized = result.git.changedPaths.find((p) => p.path === "secrets/prod.env");
    const authorized = result.git.changedPaths.find((p) => p.path === "backend/src/foo.ts");
    expect(unauthorized?.authorized).toBe(false);
    expect(authorized?.authorized).toBe(true);
  });

  it("(26) a spawn failure or timeout is surfaced in the reported errors", async () => {
    for (const [name, factory, expected] of [
      ["spawn-error", spawnErrorOutcome, "spawn-error"],
      ["timeout", timeoutOutcome, "timeout"],
    ] as const) {
      const store = new InMemoryWorkflowStore();
      const { orchestrator } = createTestOrchestrator({
        store,
        processRunner: runnerFailingArg(["tsc", "--noEmit"], factory),
      });
      const run = await createVerifyingRun(orchestrator, store);

      const result = await orchestrator.verify(run!.id);

      expect(result.status, name).toBe("failure");
      expect(result.nextRecommendedState, name).toBe("FAILED");
      expect(store.get(run!.id)!.phase, name).toBe("FAILED");

      const raw = result.raw as { checks: { checkId: string; status: string }[] };
      expect(raw.checks.find((c) => c.checkId === "backend-typecheck")?.status, name).toBe("unavailable");

      // The infrastructure cause is now visible in the reported result, not only
      // buried in raw.checks.
      const messages = result.errors.map((e) => e.message);
      expect(messages.some((m) => m.includes("backend-typecheck") && m.includes(expected)), name).toBe(true);
    }
  });

  it("(27) a pre-existing dirty path is reported as preExisting", async () => {
    const store = new InMemoryWorkflowStore();
    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createMockGitGuard({
        captureBaseline: async () => ({ ...createBaseline("abc123"), untrackedPaths: ["backend/src/foo.ts"] }),
        diffAgainstBaseline: () => ({ added: ["backend/src/foo.ts"], modified: [], removed: [], all: ["backend/src/foo.ts"] }),
      }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.git.changedPaths).toEqual([
      { path: "backend/src/foo.ts", state: "added", preExisting: true, authorized: true },
    ]);
  });

  // --- F-6 Corrective Slice: Protected-file verification safety ---

  it("V1: blocks (BLOCKED) on pre-existing modified file with flag flip (S1)", async () => {
    const store = new InMemoryWorkflowStore();
    const baselineFixture: GitBaseline = {
      kind: "baseline",
      capturedAt: new Date().toISOString(),
      headCommit: "abc123",
      stagedPaths: [],
      modifiedPaths: ["backend/existing.ts"],
      untrackedPaths: [],
      renamedPaths: [],
      deletedPaths: [],
      porcelainStatus: " M backend/existing.ts",
      contentHashes: {},
    };
    const currentFixture: GitCurrentState = {
      ...baselineFixture,
      kind: "current",
      stagedPaths: ["backend/existing.ts"],
      modifiedPaths: [],
      porcelainStatus: "M  backend/existing.ts",
    };
    const scope: GuardScope = { allowedPrefixes: ["backend/", "frontend/", "src/", "tools/"], allowedExactPaths: [], filePermissions: [] };

    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createRealGuardGitGuard({ baselineFixture, currentFixture, scope }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedState).toBe("BLOCKED");
    expect(store.get(run!.id)!.phase).toBe("BLOCKED");
    expect(store.get(run!.id)!.history.some((e) => e.trigger === "EXTERNAL_BLOCK")).toBe(true);
    expect(store.get(run!.id)!.history.some((e) => e.trigger === "VERIFICATION_COMPLETED")).toBe(false);
    expect(result.git.baselineCaptured).toBe(true);
    expect(result.git.headCommit).toBe("abc123");
    expect(result.summary).toContain("Pre-existing file `backend/existing.ts` was modified. Cannot confirm workflow attribution.");
  });

  it("V2: blocks (BLOCKED) on pre-existing untracked file deletion (S2)", async () => {
    const store = new InMemoryWorkflowStore();
    const baselineFixture: GitBaseline = {
      kind: "baseline",
      capturedAt: new Date().toISOString(),
      headCommit: "abc123",
      stagedPaths: [],
      modifiedPaths: [],
      untrackedPaths: ["backend/scratch.txt"],
      renamedPaths: [],
      deletedPaths: [],
      porcelainStatus: "?? backend/scratch.txt",
      contentHashes: {},
    };
    const currentFixture: GitCurrentState = {
      ...baselineFixture,
      kind: "current",
      untrackedPaths: [],
      porcelainStatus: "",
    };
    const scope: GuardScope = { allowedPrefixes: ["backend/", "frontend/", "src/", "tools/"], allowedExactPaths: [], filePermissions: [] };

    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createRealGuardGitGuard({ baselineFixture, currentFixture, scope }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedState).toBe("BLOCKED");
    expect(store.get(run!.id)!.phase).toBe("BLOCKED");
    expect(store.get(run!.id)!.history.some((e) => e.trigger === "EXTERNAL_BLOCK")).toBe(true);
    expect(result.summary).toContain("Pre-existing file `backend/scratch.txt` was modified. Cannot confirm workflow attribution.");
  });

  it("V3: blocks (BLOCKED) on untracked-to-tracked transition (S3)", async () => {
    const store = new InMemoryWorkflowStore();
    const baselineFixture: GitBaseline = {
      kind: "baseline",
      capturedAt: new Date().toISOString(),
      headCommit: "abc123",
      stagedPaths: [],
      modifiedPaths: [],
      untrackedPaths: ["backend/temp.ts"],
      renamedPaths: [],
      deletedPaths: [],
      porcelainStatus: "?? backend/temp.ts",
      contentHashes: {},
    };
    const currentFixture: GitCurrentState = {
      ...baselineFixture,
      kind: "current",
      untrackedPaths: [],
      modifiedPaths: ["backend/temp.ts"],
      porcelainStatus: " M backend/temp.ts",
    };
    const scope: GuardScope = { allowedPrefixes: ["backend/", "frontend/", "src/", "tools/"], allowedExactPaths: [], filePermissions: [] };

    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createRealGuardGitGuard({ baselineFixture, currentFixture, scope }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedState).toBe("BLOCKED");
    expect(store.get(run!.id)!.phase).toBe("BLOCKED");
    expect(result.summary).toContain("Pre-existing file `backend/temp.ts` was modified. Cannot confirm workflow attribution.");
  });

  it("V4: reaches VERIFIED on clean authorized change (no over-blocking)", async () => {
    const store = new InMemoryWorkflowStore();
    const baselineFixture: GitBaseline = {
      kind: "baseline",
      capturedAt: new Date().toISOString(),
      headCommit: "abc123",
      stagedPaths: [],
      modifiedPaths: [],
      untrackedPaths: [],
      renamedPaths: [],
      deletedPaths: [],
      porcelainStatus: "",
      contentHashes: {},
    };
    const currentFixture: GitCurrentState = {
      ...baselineFixture,
      kind: "current",
      modifiedPaths: ["backend/src/foo.ts"],
      porcelainStatus: " M backend/src/foo.ts",
    };
    const scope: GuardScope = { allowedPrefixes: ["backend/", "frontend/", "src/", "tools/"], allowedExactPaths: [], filePermissions: [] };

    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createRealGuardGitGuard({ baselineFixture, currentFixture, scope }),
      processRunner: createMockProcessRunner(() => outcome()),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    expect(result.status).toBe("success");
    expect(result.nextRecommendedState).toBe("VERIFIED");
    expect(store.get(run!.id)!.phase).toBe("VERIFIED");
    expect(store.get(run!.id)!.history.some((e) => e.trigger === "VERIFICATION_COMPLETED")).toBe(true);
    // No pre-existing paths should be in changedPaths
    expect(result.git.changedPaths.some((p) => p.preExisting)).toBe(false);
  });

  it("V5: protected + unauthorized together yields SCOPE_VIOLATION (ordering lock)", async () => {
    const store = new InMemoryWorkflowStore();
    const baselineFixture: GitBaseline = {
      kind: "baseline",
      capturedAt: new Date().toISOString(),
      headCommit: "abc123",
      stagedPaths: [],
      modifiedPaths: ["backend/existing.ts"],
      untrackedPaths: [],
      renamedPaths: [],
      deletedPaths: [],
      porcelainStatus: " M backend/existing.ts",
      contentHashes: {},
    };
    const currentFixture: GitCurrentState = {
      ...baselineFixture,
      kind: "current",
      stagedPaths: ["backend/existing.ts"],
      modifiedPaths: ["secrets/prod.env"],
      porcelainStatus: "M  backend/existing.ts\n M secrets/prod.env",
    };
    const scope: GuardScope = { allowedPrefixes: ["backend/", "frontend/", "src/", "tools/"], allowedExactPaths: [], filePermissions: [] };

    const { orchestrator } = createTestOrchestrator({
      store,
      gitGuard: createRealGuardGitGuard({ baselineFixture, currentFixture, scope }),
    });
    const run = await createVerifyingRun(orchestrator, store);

    const result = await orchestrator.verify(run!.id);

    // §10.4 step 2 (Out-of-scope) before step 3 (Unattributable)
    expect(result.status).toBe("scope-violation");
    expect(result.nextRecommendedState).toBe("SCOPE_VIOLATION");
    expect(store.get(run!.id)!.phase).toBe("SCOPE_VIOLATION");
    expect(store.get(run!.id)!.history.some((e) => e.trigger === "SCOPE_VIOLATION_DETECTED")).toBe(true);
    expect(store.get(run!.id)!.history.some((e) => e.trigger === "EXTERNAL_BLOCK")).toBe(false);
  });
});
