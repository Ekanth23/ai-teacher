/**
 * Stage 2C-6 Step 3 — Orchestrator test unit tests.
 *
 * Covers test execution, independent validation, headed E2E evidence,
 * workflow transitions, and failure handling.
 */

import { describe, expect, it } from "vitest";

import { Stage2COrchestrator } from "../src/orchestrator-impl.js";
import { InMemoryWorkflowStore } from "../src/workflow-store.js";
import { InMemoryApprovalGate } from "../src/approval-gate.js";
import { createResultParser } from "../src/result-parser.js";
import { loadConfig } from "../src/config.js";
import type { StoryResolver } from "../src/story-resolver.js";
import type { ContextBuilder } from "../src/context-builder.js";
import type { OpenCodeClient } from "../src/opencode-client.js";
import type { GitGuard, GitBaseline, GitCurrentState } from "../src/git-guard.js";
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

function createMockOpenCodeClient(overrides: Partial<OpenCodeClient> = {}): OpenCodeClient {
  return {
    createSession: async (request) => ({
      sessionId: `ocs_mock_${request.storyId ?? "unassigned"}`,
      providerSessionId: null,
      createdForStoryId: request.storyId,
      startedAt: new Date().toISOString(),
    }),
    continueSession: async () => {
      throw new Error("Not implemented in mock");
    },
    runCommand: async () => {
      throw new Error("Not implemented in mock");
    },
    collectResult: async () => ({}),
    dispose: async () => {},
    ...overrides,
  };
}

function createMockGitGuard(overrides: Partial<GitGuard> = {}): GitGuard {
  return {
    captureBaseline: async () => {
      throw new Error("Not implemented in mock");
    },
    captureCurrentState: async () => {
      throw new Error("Not implemented in mock");
    },
    diffAgainstBaseline: () => ({ added: [], modified: [], removed: [], all: [] }),
    evaluate: () => ({
      allowed: true,
      unauthorizedPaths: [],
      protectedPaths: [],
      reason: "Mock git guard",
      onViolation: "STOP" as const,
    }),
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

// --- Helper to create orchestrator with mocks ---

function createTestOrchestrator(overrides: {
  storyResolver?: StoryResolver;
  contextBuilder?: ContextBuilder;
  opencode?: OpenCodeClient;
  gitGuard?: GitGuard;
  store?: InMemoryWorkflowStore;
  approvalGate?: InMemoryApprovalGate;
  reporter?: Reporter;
  now?: () => number;
  processRunner?: ProcessRunner;
} = {}) {
  const config = loadConfig();
  const store = overrides.store ?? new InMemoryWorkflowStore();
  const approvalGate = overrides.approvalGate ?? new InMemoryApprovalGate();
  const reporter = overrides.reporter ?? createMockReporter();
  const orchestrator = new Stage2COrchestrator({
    config,
    opencode: overrides.opencode ?? createMockOpenCodeClient(),
    contextBuilder: overrides.contextBuilder ?? createMockContextBuilder(),
    storyResolver: overrides.storyResolver ?? createMockStoryResolver(),
    approvalGate,
    resultParser: createResultParser(),
    gitGuard: overrides.gitGuard ?? createMockGitGuard(),
    reporter,
    workflowStore: store,
    processRunner: overrides.processRunner ?? createMockProcessRunner(createSuccessOutcome()),
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
  });
  return { orchestrator, store, approvalGate, reporter };
}

// --- Helper to create a mock ProcessRunner ---

function createMockProcessRunner(outcome: ProcessExecutionOutcome): ProcessRunner {
  return {
    run: () => Promise.resolve(outcome),
  };
}

function createSuccessOutcome(): ProcessExecutionOutcome {
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

function createFailureOutcome(exitCode: number = 1): ProcessExecutionOutcome {
  return {
    status: "failure",
    exitCode,
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

function createTimeoutOutcome(): ProcessExecutionOutcome {
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

function createSpawnErrorOutcome(): ProcessExecutionOutcome {
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

// --- Helper to create a workflow run in TESTING phase ---

async function createTestingRun(
  orchestrator: Stage2COrchestrator,
  store: InMemoryWorkflowStore,
  storyId: string | null = "US-101",
) {
  const run = await orchestrator.start({
    storyId,
    requestedBy: "po",
    intent: "test workflow",
  });

  // Advance to PLAN_READY
  store.advance(run.id, {
    to: "PLAN_READY",
    trigger: "PLAN_PRODUCED",
    actor: "orchestrator",
    note: "Plan produced",
  });

  // Request approval
  await orchestrator.requestApproval(run.id);

  // Grant approval
  const building = await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

  // Advance to TESTING
  store.advance(building.id, {
    to: "TESTING",
    trigger: "BUILD_PRODUCED",
    actor: "orchestrator",
    note: "Build completed",
  });

  return store.get(building.id)!;
}

// --- Helper to create a mock GitGuard with specific behavior ---

function createGitGuardWithChanges(changes: string[]): GitGuard {
  return createMockGitGuard({
    captureBaseline: async (): Promise<GitBaseline> => ({
      capturedAt: "2026-01-01T00:00:00Z",
      headCommit: "abc123",
      stagedPaths: [],
      modifiedPaths: [],
      untrackedPaths: [],
      renamedPaths: [],
      deletedPaths: [],
      porcelainStatus: "",
      contentHashes: {},
      kind: "baseline",
    }),
    captureCurrentState: async (): Promise<GitCurrentState> => ({
      capturedAt: "2026-01-01T00:00:01Z",
      headCommit: "abc123",
      stagedPaths: [],
      modifiedPaths: changes,
      untrackedPaths: [],
      renamedPaths: [],
      deletedPaths: [],
      porcelainStatus: changes.map((c) => ` M ${c}`).join("\n"),
      contentHashes: {},
      kind: "current",
    }),
    diffAgainstBaseline: () => ({
      added: [],
      modified: changes,
      removed: [],
      all: changes,
    }),
  });
}

// --- Tests ---

describe("orchestrator test", () => {
  it("transitions to REVIEWING when all mandatory checks pass", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("success");
    expect(result.phase).toBe("TESTING");
    expect(result.nextRecommendedState).toBe("REVIEWING");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("REVIEWING");
    expect(updatedRun.history[updatedRun.history.length - 1]?.trigger).toBe("TESTS_COMPLETED");
  });

  it("throws when test is called from wrong phase", async () => {
    const { orchestrator } = createTestOrchestrator();

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    // Run is in PLANNING, not TESTING
    await expect(orchestrator.test(run.id)).rejects.toThrow();
  });

  it("throws for non-existent workflow", async () => {
    const { orchestrator } = createTestOrchestrator();

    await expect(orchestrator.test("wf-nonexistent")).rejects.toThrow();
  });

  it("transitions to FAILED when typecheck fails", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createFailureOutcome(1));

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("failure");
    expect(result.nextRecommendedState).toBe("FAILED");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
    expect(updatedRun.history[updatedRun.history.length - 1]?.trigger).toBe("TESTS_FAILED");
  });

  it("transitions to FAILED when build fails", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    let callCount = 0;
    const mockProcessRunner: ProcessRunner = {
      run: () => {
        callCount += 1;
        // First call (typecheck) succeeds, second call (build) fails
        if (callCount === 1) return Promise.resolve(createSuccessOutcome());
        return Promise.resolve(createFailureOutcome(1));
      },
    };

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("transitions to FAILED when focused tests fail", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    let callCount = 0;
    const mockProcessRunner: ProcessRunner = {
      run: () => {
        callCount += 1;
        // First two calls succeed, third call (focused tests) fails
        if (callCount <= 2) return Promise.resolve(createSuccessOutcome());
        return Promise.resolve(createFailureOutcome(1));
      },
    };

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("transitions to FAILED when regression tests fail", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    let callCount = 0;
    const mockProcessRunner: ProcessRunner = {
      run: () => {
        callCount += 1;
        // First three calls succeed, fourth call (regression tests) fails
        if (callCount <= 3) return Promise.resolve(createSuccessOutcome());
        return Promise.resolve(createFailureOutcome(1));
      },
    };

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("transitions to FAILED on ProcessRunner timeout", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createTimeoutOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("transitions to FAILED on ProcessRunner spawn error", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createSpawnErrorOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("transitions to FAILED on non-zero exit code", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createFailureOutcome(2));

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("does not produce VERIFIED from successful test execution", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    // Test phase produces REVIEWING, not VERIFIED
    expect(result.nextRecommendedState).toBe("REVIEWING");
    expect(result.nextRecommendedState).not.toBe("VERIFIED");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("REVIEWING");
    expect(updatedRun.phase).not.toBe("VERIFIED");
  });

  it("records workflow events for test execution", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    await orchestrator.test(run.id);

    const updatedRun = store.get(run.id)!;
    const testEvent = updatedRun.history.find(
      (e) => e.trigger === "TESTS_COMPLETED" || e.trigger === "TESTS_FAILED",
    );
    expect(testEvent).toBeDefined();
    expect(testEvent?.actor).toBe("orchestrator");
  });

  it("prevents direct transition to VERIFIED", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    // Test phase produces REVIEWING, never VERIFIED
    expect(result.nextRecommendedState).not.toBe("VERIFIED");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).not.toBe("VERIFIED");
  });

  it("captures changed files from git diff", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts", "src/another.ts"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.changedFiles).toContain("src/file.ts");
    expect(result.changedFiles).toContain("src/another.ts");
  });

  it("includes test summary with pass/fail counts", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.summary).toContain("Testing completed");
    expect(result.summary).toContain("Typecheck: passed");
    expect(result.summary).toContain("Build: passed");
    expect(result.summary).toContain("Tests: passed");
  });
});

describe("orchestrator test — headed E2E evidence", () => {
  it("classifies E2E as not_applicable for backend-only changes", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    // E2E is not applicable for backend-only changes
    expect(result.summary).toContain("E2E: not_applicable");
  });

  it("classifies E2E as unavailable when no OpenCode evidence exists", async () => {
    const mockGitGuard = createGitGuardWithChanges(["frontend/App.tsx"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    // E2E is applicable but no OpenCode evidence exists
    expect(result.summary).toContain("E2E: unavailable");
  });

  it("transitions to FAILED when E2E is unavailable without waiver", async () => {
    const mockGitGuard = createGitGuardWithChanges(["frontend/App.tsx"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    // E2E is mandatory and unavailable -> failure
    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });
});

describe("orchestrator test — safety invariants", () => {
  it("process exit code 0 does NOT produce VERIFIED", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    const mockProcessRunner = createMockProcessRunner(createSuccessOutcome());

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    // Test phase produces REVIEWING, not VERIFIED
    expect(result.nextRecommendedState).toBe("REVIEWING");
    expect(result.nextRecommendedState).not.toBe("VERIFIED");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("REVIEWING");
    expect(updatedRun.phase).not.toBe("VERIFIED");
  });

  it("OpenCode output cannot establish test success", async () => {
    const mockGitGuard = createGitGuardWithChanges(["src/file.ts"]);
    // ProcessRunner returns failure even though OpenCode might report success
    const mockProcessRunner = createMockProcessRunner(createFailureOutcome(1));

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      processRunner: mockProcessRunner,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    // Independent validation failure -> failure
    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("git baseline capture failure transitions to FAILED", async () => {
    const mockGitGuard = createMockGitGuard({
      captureBaseline: async () => {
        throw new Error("Git not available");
      },
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("git state capture failure transitions to FAILED", async () => {
    const mockGitGuard = createMockGitGuard({
      captureBaseline: async (): Promise<GitBaseline> => ({
        capturedAt: "2026-01-01T00:00:00Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: [],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: "",
        contentHashes: {},
        kind: "baseline",
      }),
      captureCurrentState: async () => {
        throw new Error("Git state capture failed");
      },
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
    });

    const run = await createTestingRun(orchestrator, store);
    const result = await orchestrator.test(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });
});
