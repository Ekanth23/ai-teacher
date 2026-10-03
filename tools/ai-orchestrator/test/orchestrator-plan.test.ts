/**
 * Stage 2C-6 Step 1 — Orchestrator start and plan unit tests.
 *
 * Covers workflow run creation, PLANNING phase execution, story resolution,
 * context building, OpenCode execution, and state transitions.
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
  processRunner?: ProcessRunner;
} = {}) {
  const config = loadConfig();
  const store = overrides.store ?? new InMemoryWorkflowStore();
  const orchestrator = new Stage2COrchestrator({
    config,
    opencode: overrides.opencode ?? createMockOpenCodeClient(),
    contextBuilder: overrides.contextBuilder ?? createMockContextBuilder(),
    storyResolver: overrides.storyResolver ?? createMockStoryResolver(),
    approvalGate: new InMemoryApprovalGate(),
    resultParser: createResultParser(),
    gitGuard: overrides.gitGuard ?? createMockGitGuard(),
    reporter: createMockReporter(),
    workflowStore: store,
    processRunner: overrides.processRunner ?? createMockProcessRunner(),
  });
  return { orchestrator, store };
}

// --- Tests ---

describe("orchestrator start", () => {
  it("creates a workflow run and transitions to PLANNING", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test workflow",
    });

    expect(run.id).toMatch(/^wf-/);
    expect(run.storyId).toBe("US-101");
    expect(run.phase).toBe("PLANNING");
    expect(run.history).toHaveLength(1);
    expect(run.history[0]?.from).toBe("REQUESTED");
    expect(run.history[0]?.to).toBe("PLANNING");
    expect(run.history[0]?.trigger).toBe("PLAN_REQUESTED");

    // Verify the run is stored
    const stored = store.get(run.id);
    expect(stored).not.toBeNull();
    expect(stored?.phase).toBe("PLANNING");
  });

  it("accepts null storyId", async () => {
    const { orchestrator } = createTestOrchestrator();

    const run = await orchestrator.start({
      storyId: null,
      requestedBy: "po",
      intent: "test workflow",
    });

    expect(run.storyId).toBeNull();
    expect(run.phase).toBe("PLANNING");
  });

  it("rejects invalid storyId format", async () => {
    const { orchestrator } = createTestOrchestrator();

    await expect(
      orchestrator.start({
        storyId: "INVALID",
        requestedBy: "po",
        intent: "test workflow",
      }),
    ).rejects.toThrow();
  });

  it("rejects storyId without US- prefix", async () => {
    const { orchestrator } = createTestOrchestrator();

    await expect(
      orchestrator.start({
        storyId: "101",
        requestedBy: "po",
        intent: "test workflow",
      }),
    ).rejects.toThrow();
  });

  it("generates unique IDs for each run", async () => {
    const { orchestrator } = createTestOrchestrator();

    const run1 = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });
    const run2 = await orchestrator.start({
      storyId: "US-102",
      requestedBy: "po",
      intent: "test",
    });

    expect(run1.id).not.toBe(run2.id);
  });
});

describe("orchestrator plan", () => {
  it("blocks when story is not found", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "not-found" as const,
          storyId: "US-101",
          message: "Story not found in mock resolver.",
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history).toHaveLength(2);
    expect(result.history[1]?.trigger).toBe("EXTERNAL_BLOCK");
    expect(result.history[1]?.note).toContain("not found");
  });

  it("blocks when story is retired", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "retired-story" as const,
          storyId: "US-101",
          message: "Story US-101 is retired.",
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history[1]?.trigger).toBe("EXTERNAL_BLOCK");
  });

  it("blocks on collision detection", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "collision-detected" as const,
          collision: {
            storyId: "US-101",
            authoritativeEntry: {
              storyId: "US-101",
              epicId: "Epic-1",
              title: "Original story",
              status: "active",
              notes: null,
              resolvedFrom: "SECTION B" as const,
            },
            conflictingEntry: {
              storyId: "US-101",
              epicId: "Epic-2",
              title: "Different story",
              status: "active",
              notes: null,
              resolvedFrom: "SECTION F" as const,
            },
            impliesDifferentWork: true,
            requiresPoDecision: true,
            message: "ID collision detected between Section B and Section F.",
          },
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history[1]?.trigger).toBe("DRAFT_ID_COLLISION");
  });

  it("blocks on ambiguous story", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "ambiguous" as const,
          storyId: "US-101",
          candidates: [],
          message: "Multiple ambiguous candidates found.",
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history[1]?.trigger).toBe("STORY_AMBIGUOUS");
  });

  it("transitions to PLAN_READY when plan is produced with verdict", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "resolved" as const,
          story: {
            storyId: "US-101",
            epicId: "Epic-1",
            title: "Test story",
            status: "active",
            notes: null,
            resolvedFrom: "SECTION B" as const,
          },
          collision: null,
        }),
      }),
      opencode: createMockOpenCodeClient({
        createSession: async (request) => ({
          sessionId: `ocs_mock_${request.storyId ?? "unassigned"}`,
          providerSessionId: null,
          createdForStoryId: request.storyId,
          startedAt: new Date().toISOString(),
        }),
        runCommand: async () => ({
          session: {
            sessionId: "ocs_mock",
            providerSessionId: null,
            createdForStoryId: "US-101",
            startedAt: new Date().toISOString(),
          },
          command: "ai-plan",
          exitCode: 0,
          stdout: JSON.stringify({ verdict: "READY FOR BUILD" }),
          stderr: "",
          usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
          durationMs: 1000,
          completed: true,
          process: {
            status: "success" as const,
            exitCode: 0,
            command: "opencode",
            args: [],
            stdout: JSON.stringify({ verdict: "READY FOR BUILD" }),
            stderr: "",
            durationMs: 1000,
            timedOut: false,
            truncated: false,
            signal: null,
          },
        }),
        collectResult: async () => ({
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ verdict: "READY FOR BUILD" }),
          stderr: "",
          durationMs: 1000,
          timedOut: false,
          truncated: false,
          signal: null,
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("PLAN_READY");
    expect(result.history).toHaveLength(2);
    expect(result.history[1]?.trigger).toBe("PLAN_PRODUCED");
  });

  it("transitions to PO_DECISION_REQUIRED when plan reports it", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "resolved" as const,
          story: {
            storyId: "US-101",
            epicId: "Epic-1",
            title: "Test story",
            status: "active",
            notes: null,
            resolvedFrom: "SECTION B" as const,
          },
          collision: null,
        }),
      }),
      opencode: createMockOpenCodeClient({
        createSession: async (request) => ({
          sessionId: `ocs_mock_${request.storyId ?? "unassigned"}`,
          providerSessionId: null,
          createdForStoryId: request.storyId,
          startedAt: new Date().toISOString(),
        }),
        runCommand: async () => ({
          session: {
            sessionId: "ocs_mock",
            providerSessionId: null,
            createdForStoryId: "US-101",
            startedAt: new Date().toISOString(),
          },
          command: "ai-plan",
          exitCode: 0,
          stdout: JSON.stringify({ status: "po-decision-required", reason: "Missing PO decision" }),
          stderr: "",
          usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
          durationMs: 1000,
          completed: true,
          process: {
            status: "success" as const,
            exitCode: 0,
            command: "opencode",
            args: [],
            stdout: JSON.stringify({ status: "po-decision-required", reason: "Missing PO decision" }),
            stderr: "",
            durationMs: 1000,
            timedOut: false,
            truncated: false,
            signal: null,
          },
        }),
        collectResult: async () => ({
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ status: "po-decision-required", reason: "Missing PO decision" }),
          stderr: "",
          durationMs: 1000,
          timedOut: false,
          truncated: false,
          signal: null,
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("PO_DECISION_REQUIRED");
    expect(result.history[1]?.trigger).toBe("PO_DECISION_REQUIRED");
  });

  it("blocks when plan output has no readiness verdict", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "resolved" as const,
          story: {
            storyId: "US-101",
            epicId: "Epic-1",
            title: "Test story",
            status: "active",
            notes: null,
            resolvedFrom: "SECTION B" as const,
          },
          collision: null,
        }),
      }),
      opencode: createMockOpenCodeClient({
        createSession: async (request) => ({
          sessionId: `ocs_mock_${request.storyId ?? "unassigned"}`,
          providerSessionId: null,
          createdForStoryId: request.storyId,
          startedAt: new Date().toISOString(),
        }),
        runCommand: async () => ({
          session: {
            sessionId: "ocs_mock",
            providerSessionId: null,
            createdForStoryId: "US-101",
            startedAt: new Date().toISOString(),
          },
          command: "ai-plan",
          exitCode: 0,
          stdout: JSON.stringify({ someOtherField: "value" }),
          stderr: "",
          usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
          durationMs: 1000,
          completed: true,
          process: {
            status: "success" as const,
            exitCode: 0,
            command: "opencode",
            args: [],
            stdout: JSON.stringify({ someOtherField: "value" }),
            stderr: "",
            durationMs: 1000,
            timedOut: false,
            truncated: false,
            signal: null,
          },
        }),
        collectResult: async () => ({
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ someOtherField: "value" }),
          stderr: "",
          durationMs: 1000,
          timedOut: false,
          truncated: false,
          signal: null,
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history[1]?.trigger).toBe("EXTERNAL_BLOCK");
  });

  it("blocks when OpenCode process fails", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "resolved" as const,
          story: {
            storyId: "US-101",
            epicId: "Epic-1",
            title: "Test story",
            status: "active",
            notes: null,
            resolvedFrom: "SECTION B" as const,
          },
          collision: null,
        }),
      }),
      opencode: createMockOpenCodeClient({
        createSession: async (request) => ({
          sessionId: `ocs_mock_${request.storyId ?? "unassigned"}`,
          providerSessionId: null,
          createdForStoryId: request.storyId,
          startedAt: new Date().toISOString(),
        }),
        runCommand: async () => ({
          session: {
            sessionId: "ocs_mock",
            providerSessionId: null,
            createdForStoryId: "US-101",
            startedAt: new Date().toISOString(),
          },
          command: "ai-plan",
          exitCode: 1,
          stdout: "",
          stderr: "Process failed",
          usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
          durationMs: 1000,
          completed: true,
          process: {
            status: "failure" as const,
            exitCode: 1,
            command: "opencode",
            args: [],
            stdout: "",
            stderr: "Process failed",
            durationMs: 1000,
            timedOut: false,
            truncated: false,
            signal: null,
          },
        }),
        collectResult: async () => ({
          status: "failure" as const,
          exitCode: 1,
          command: "opencode",
          args: [],
          stdout: "",
          stderr: "Process failed",
          durationMs: 1000,
          timedOut: false,
          truncated: false,
          signal: null,
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("BLOCKED");
  });

  it("throws for non-existent workflow", async () => {
    const { orchestrator } = createTestOrchestrator();

    await expect(orchestrator.plan("wf-nonexistent")).rejects.toThrow();
  });

  it("throws when plan is called from wrong phase", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    // Manually advance to PLAN_READY
    store.advance(run.id, {
      to: "PLAN_READY",
      trigger: "PLAN_PRODUCED",
      actor: "orchestrator",
    });

    await expect(orchestrator.plan(run.id)).rejects.toThrow();
  });

  it("blocks when storyId is null", async () => {
    const { orchestrator } = createTestOrchestrator();

    const run = await orchestrator.start({
      storyId: null,
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("BLOCKED");
  });

  it("blocks when storyId is null", async () => {
    const { orchestrator } = createTestOrchestrator();

    const run = await orchestrator.start({
      storyId: null,
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    expect(result.phase).toBe("BLOCKED");
  });
});

describe("orchestrator plan — safety invariants", () => {
  it("process exit code 0 does NOT produce workflow success", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "resolved" as const,
          story: {
            storyId: "US-101",
            epicId: "Epic-1",
            title: "Test story",
            status: "active",
            notes: null,
            resolvedFrom: "SECTION B" as const,
          },
          collision: null,
        }),
      }),
      opencode: createMockOpenCodeClient({
        createSession: async (request) => ({
          sessionId: `ocs_mock_${request.storyId ?? "unassigned"}`,
          providerSessionId: null,
          createdForStoryId: request.storyId,
          startedAt: new Date().toISOString(),
        }),
        runCommand: async () => ({
          session: {
            sessionId: "ocs_mock",
            providerSessionId: null,
            createdForStoryId: "US-101",
            startedAt: new Date().toISOString(),
          },
          command: "ai-plan",
          exitCode: 0,
          stdout: JSON.stringify({ verdict: "READY FOR BUILD" }),
          stderr: "",
          usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
          durationMs: 1000,
          completed: true,
          process: {
            status: "success" as const,
            exitCode: 0,
            command: "opencode",
            args: [],
            stdout: JSON.stringify({ verdict: "READY FOR BUILD" }),
            stderr: "",
            durationMs: 1000,
            timedOut: false,
            truncated: false,
            signal: null,
          },
        }),
        collectResult: async () => ({
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ verdict: "READY FOR BUILD" }),
          stderr: "",
          durationMs: 1000,
          timedOut: false,
          truncated: false,
          signal: null,
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    // The plan phase produces PLAN_READY, not VERIFIED or BUILDING
    expect(result.phase).toBe("PLAN_READY");
    expect(result.phase).not.toBe("VERIFIED");
    expect(result.phase).not.toBe("BUILDING");
  });

  it("does not establish approval from OpenCode output", async () => {
    const { orchestrator } = createTestOrchestrator({
      storyResolver: createMockStoryResolver({
        resolve: async () => ({
          kind: "resolved" as const,
          story: {
            storyId: "US-101",
            epicId: "Epic-1",
            title: "Test story",
            status: "active",
            notes: null,
            resolvedFrom: "SECTION B" as const,
          },
          collision: null,
        }),
      }),
      opencode: createMockOpenCodeClient({
        createSession: async (request) => ({
          sessionId: `ocs_mock_${request.storyId ?? "unassigned"}`,
          providerSessionId: null,
          createdForStoryId: request.storyId,
          startedAt: new Date().toISOString(),
        }),
        runCommand: async () => ({
          session: {
            sessionId: "ocs_mock",
            providerSessionId: null,
            createdForStoryId: "US-101",
            startedAt: new Date().toISOString(),
          },
          command: "ai-plan",
          exitCode: 0,
          stdout: JSON.stringify({ verdict: "READY FOR BUILD", approved: true }),
          stderr: "",
          usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
          durationMs: 1000,
          completed: true,
          process: {
            status: "success" as const,
            exitCode: 0,
            command: "opencode",
            args: [],
            stdout: JSON.stringify({ verdict: "READY FOR BUILD", approved: true }),
            stderr: "",
            durationMs: 1000,
            timedOut: false,
            truncated: false,
            signal: null,
          },
        }),
        collectResult: async () => ({
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ verdict: "READY FOR BUILD", approved: true }),
          stderr: "",
          durationMs: 1000,
          timedOut: false,
          truncated: false,
          signal: null,
        }),
      }),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    const result = await orchestrator.plan(run.id);

    // The orchestrator does not interpret "approved" as workflow approval
    expect(result.phase).toBe("PLAN_READY");
    expect(result.phase).not.toBe("BUILDING");
  });
});
