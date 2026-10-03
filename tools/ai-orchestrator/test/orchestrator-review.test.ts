/**
 * Stage 2C-6 Step 4 — Orchestrator review unit tests.
 *
 * Covers review execution, blocking findings evaluation, workflow transitions,
 * and failure handling.
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
import type { GitGuard } from "../src/git-guard.js";
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

function createMockProcessRunner(): ProcessRunner {
  return {
    run: (): Promise<ProcessExecutionOutcome> => Promise.resolve({
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
    }),
  };
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
    processRunner: overrides.processRunner ?? createMockProcessRunner(),
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
  });
  return { orchestrator, store, approvalGate, reporter };
}

// --- Helper to create a workflow run in REVIEWING phase ---

async function createReviewingRun(
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

  // Advance to REVIEWING
  const reviewing = store.advance(building.id, {
    to: "REVIEWING",
    trigger: "TESTS_COMPLETED",
    actor: "orchestrator",
    note: "Tests completed",
  });

  return reviewing;
}

// --- Helper to create a mock OpenCode client with specific review output ---

function createReviewOpenCodeClient(overrides: {
  createSession?: () => Promise<import("../src/opencode-client.js").OpenCodeSessionRef>;
  runCommand?: () => Promise<import("../src/opencode-client.js").OpenCodeTurnResult>;
  collectResult?: () => Promise<unknown>;
  dispose?: () => Promise<void>;
}): OpenCodeClient {
  return {
    createSession: overrides.createSession ?? (async (request) => ({
      sessionId: `ocs_mock_${request.storyId ?? "unassigned"}`,
      providerSessionId: null,
      createdForStoryId: request.storyId,
      startedAt: new Date().toISOString(),
    })),
    continueSession: async () => {
      throw new Error("Not implemented in mock");
    },
    runCommand: overrides.runCommand ?? (async () => ({
      session: {
        sessionId: "ocs_mock",
        providerSessionId: null,
        createdForStoryId: "US-101",
        startedAt: new Date().toISOString(),
      },
      command: "ai-review",
      exitCode: 0,
      stdout: "",
      stderr: "",
      usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
      durationMs: 1000,
      completed: true,
      process: {
        status: "success" as const,
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: "",
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      },
    })),
    collectResult: overrides.collectResult ?? (async () => ({})),
    dispose: overrides.dispose ?? (async () => {}),
  };
}

// --- Tests ---

describe("orchestrator review", () => {
  it("transitions to VERIFYING when review has no blocking findings", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: JSON.stringify({ findings: [] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    const result = await orchestrator.review(run.id);

    expect(result.status).toBe("success");
    expect(result.phase).toBe("REVIEWING");
    expect(result.nextRecommendedState).toBe("VERIFYING");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("VERIFYING");
    expect(updatedRun.history[updatedRun.history.length - 1]?.trigger).toBe("REVIEW_COMPLETED");
  });

  it("throws when review is called from wrong phase", async () => {
    const { orchestrator } = createTestOrchestrator();

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    // Run is in PLANNING, not REVIEWING
    await expect(orchestrator.review(run.id)).rejects.toThrow();
  });

  it("throws for non-existent workflow", async () => {
    const { orchestrator } = createTestOrchestrator();

    await expect(orchestrator.review("wf-nonexistent")).rejects.toThrow();
  });

  it("transitions to FAILED when OpenCode session creation fails", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      createSession: async () => {
        throw new Error("Session creation failed");
      },
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);

    // Session creation failure should cause the review to fail
    await expect(orchestrator.review(run.id)).rejects.toThrow();
  });

  it("transitions to FAILED when OpenCode execution fails", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      runCommand: async () => {
        throw new Error("Execution failed");
      },
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);

    // Execution failure should cause the review to fail
    await expect(orchestrator.review(run.id)).rejects.toThrow();
  });

  it("transitions to FAILED on non-zero process exit", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "failure",
        exitCode: 1,
        command: "opencode",
        args: [],
        stdout: "",
        stderr: "Review failed",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    const result = await orchestrator.review(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("transitions to FAILED on OpenCode timeout", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "timeout",
        exitCode: null,
        command: "opencode",
        args: [],
        stdout: "",
        stderr: "",
        durationMs: 30000,
        timedOut: true,
        truncated: false,
        signal: null,
        terminationAttempted: true,
        terminationSignals: ["SIGTERM"],
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    const result = await orchestrator.review(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("transitions to FAILED on malformed review output", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: "not valid json",
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    const result = await orchestrator.review(run.id);

    // Malformed output should result in blocked/failure
    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("transitions to FAILED when review output is missing", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: "",
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    const result = await orchestrator.review(run.id);

    // Missing output should result in failure
    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("transitions to FAILED when review contains blocking findings", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: JSON.stringify({
          findings: [
            { severity: "error", message: "Blocking issue", file: "src/foo.ts", line: 10 },
          ],
        }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    const result = await orchestrator.review(run.id);

    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
    expect(updatedRun.history[updatedRun.history.length - 1]?.trigger).toBe("REVIEW_FAILED");
  });

  it("transitions to VERIFYING when review contains only non-blocking findings", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: JSON.stringify({
          findings: [
            { severity: "warning", message: "Minor issue", file: "src/foo.ts", line: 10 },
          ],
        }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    const result = await orchestrator.review(run.id);

    expect(result.status).toBe("success");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("VERIFYING");
  });

  it("does not treat OpenCode success as proof of review passing", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: JSON.stringify({
          findings: [
            { severity: "error", message: "Blocking issue", file: "src/foo.ts", line: 10 },
          ],
        }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    const result = await orchestrator.review(run.id);

    // OpenCode succeeded but review has blocking findings
    expect(result.status).toBe("failure");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("FAILED");
  });

  it("records workflow events for review execution", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: JSON.stringify({ findings: [] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    await orchestrator.review(run.id);

    const updatedRun = store.get(run.id)!;
    const reviewEvent = updatedRun.history.find(
      (e) => e.trigger === "REVIEW_COMPLETED" || e.trigger === "REVIEW_FAILED",
    );
    expect(reviewEvent).toBeDefined();
    expect(reviewEvent?.actor).toBe("orchestrator");
  });

  it("disposes session on success", async () => {
    let disposed = false;
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: JSON.stringify({ findings: [] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
      dispose: async () => {
        disposed = true;
      },
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    await orchestrator.review(run.id);

    expect(disposed).toBe(true);
  });

  it("disposes session on failure", async () => {
    let disposed = false;
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: JSON.stringify({
          findings: [
            { severity: "error", message: "Blocking issue", file: "src/foo.ts", line: 10 },
          ],
        }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
      dispose: async () => {
        disposed = true;
      },
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    await orchestrator.review(run.id);

    expect(disposed).toBe(true);
  });

  it("preserves approval safety invariants", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: JSON.stringify({ findings: [] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store, approvalGate } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    await orchestrator.review(run.id);

    // Approval should still be valid
    const record = approvalGate.current(run.id);
    expect(record?.decision).toBe("ApprovalGranted");
  });

  it("preserves scope safety invariants", async () => {
    const mockOpenCode = createReviewOpenCodeClient({
      collectResult: async () => ({
        status: "success",
        exitCode: 0,
        command: "opencode",
        args: [],
        stdout: JSON.stringify({ findings: [] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      opencode: mockOpenCode,
    });

    const run = await createReviewingRun(orchestrator, store);
    const result = await orchestrator.review(run.id);

    // Review should not produce VERIFIED
    expect(result.nextRecommendedState).toBe("VERIFYING");
    expect(result.nextRecommendedState).not.toBe("VERIFIED");

    const updatedRun = store.get(run.id)!;
    expect(updatedRun.phase).toBe("VERIFYING");
    expect(updatedRun.phase).not.toBe("VERIFIED");
  });
});
