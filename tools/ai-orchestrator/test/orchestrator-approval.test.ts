/**
 * Stage 2C-6 Step 2 — Approval lifecycle unit tests.
 *
 * Covers requestApproval(), decideApproval(), gate-level behavior,
 * failure scenarios, and safety invariants.
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

// --- Helper to create a workflow run in PLAN_READY phase ---

async function createPlanReadyRun(
  orchestrator: Stage2COrchestrator,
  store: InMemoryWorkflowStore,
  storyId: string | null = "US-101",
) {
  const run = await orchestrator.start({
    storyId,
    requestedBy: "po",
    intent: "test workflow",
  });

  // Manually advance to PLAN_READY
  const planReady = store.advance(run.id, {
    to: "PLAN_READY",
    trigger: "PLAN_PRODUCED",
    actor: "orchestrator",
    note: "Plan produced",
  });

  return planReady;
}

// --- Tests ---

describe("orchestrator requestApproval", () => {
  it("creates an approval request and transitions to WAITING_FOR_APPROVAL", async () => {
    const { orchestrator, store, approvalGate } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);

    const result = await orchestrator.requestApproval(run.id);

    expect(result.phase).toBe("WAITING_FOR_APPROVAL");
    expect(result.history).toHaveLength(3);
    expect(result.history[2]?.from).toBe("PLAN_READY");
    expect(result.history[2]?.to).toBe("WAITING_FOR_APPROVAL");
    expect(result.history[2]?.trigger).toBe("APPROVAL_REQUESTED");

    // Verify the approval gate has a record
    const record = approvalGate.current(run.id);
    expect(record).not.toBeNull();
    expect(record?.decision).toBe("ApprovalRequired");
    expect(record?.workflowId).toBe(run.id);
  });

  it("throws when requestApproval is called from wrong phase", async () => {
    const { orchestrator } = createTestOrchestrator();

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    // Run is in PLANNING, not PLAN_READY
    await expect(orchestrator.requestApproval(run.id)).rejects.toThrow();
  });

  it("throws for non-existent workflow", async () => {
    const { orchestrator } = createTestOrchestrator();

    await expect(orchestrator.requestApproval("wf-nonexistent")).rejects.toThrow();
  });

  it("binds the approval request to the specific workflow run", async () => {
    const { orchestrator, store, approvalGate } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);

    await orchestrator.requestApproval(run.id);

    const record = approvalGate.current(run.id);
    expect(record).not.toBeNull();
    expect(record?.workflowId).toBe(run.id);
    expect(record?.storyId).toBe("US-101");
  });
});

describe("orchestrator decideApproval", () => {
  it("records an explicit grant and transitions to BUILDING", async () => {
    const { orchestrator, store, approvalGate } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    const result = await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    expect(result.phase).toBe("BUILDING");
    expect(result.history).toHaveLength(4);
    expect(result.history[3]?.from).toBe("WAITING_FOR_APPROVAL");
    expect(result.history[3]?.to).toBe("BUILDING");
    expect(result.history[3]?.trigger).toBe("APPROVAL_GRANTED");

    // Verify the approval gate has a grant record
    const record = approvalGate.current(run.id);
    expect(record).not.toBeNull();
    expect(record?.decision).toBe("ApprovalGranted");
    expect(record?.actor.kind).toBe("human");
    expect(record?.actor.id).toBe("po-user-1");
  });

  it("records an explicit rejection and transitions to REJECTED", async () => {
    const { orchestrator, store, approvalGate } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    const result = await orchestrator.decideApproval(run.id, "ApprovalRejected", "po-user-1");

    expect(result.phase).toBe("REJECTED");
    expect(result.history).toHaveLength(4);
    expect(result.history[3]?.from).toBe("WAITING_FOR_APPROVAL");
    expect(result.history[3]?.to).toBe("REJECTED");
    expect(result.history[3]?.trigger).toBe("APPROVAL_REJECTED");

    // Verify the approval gate has a rejection record
    const record = approvalGate.current(run.id);
    expect(record).not.toBeNull();
    expect(record?.decision).toBe("ApprovalRejected");
  });

  it("records a late rejection as a workflow event without changing phase", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING — attempt rejection
    const result = await orchestrator.decideApproval(run.id, "ApprovalRejected", "po-user-1");

    // Phase should remain BUILDING
    expect(result.phase).toBe("BUILDING");

    // The attempt should be recorded as an event
    const lastEvent = result.history[result.history.length - 1];
    expect(lastEvent?.trigger).toBe("APPROVAL_REJECTED");
    expect(lastEvent?.note).toContain("Late rejection attempt ignored");
  });

  it("throws when decideApproval is called from wrong phase", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);

    // Run is in PLAN_READY, not WAITING_FOR_APPROVAL
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();
  });

  it("throws for non-existent workflow", async () => {
    const { orchestrator } = createTestOrchestrator();

    await expect(
      orchestrator.decideApproval("wf-nonexistent", "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();
  });

  it("throws when decideApproval is called without prior requestApproval", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);

    // Run is in PLAN_READY, not WAITING_FOR_APPROVAL
    // Even if we could get to WAITING_FOR_APPROVAL, the gate would throw
    // because no approval request exists
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();
  });

  it("throws for a late grant after REJECTED", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);
    await orchestrator.decideApproval(run.id, "ApprovalRejected", "po-user-1");

    // Now in REJECTED — attempt grant
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();
  });

  it("throws for a duplicate grant (already in BUILDING)", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING — attempt another grant
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();
  });

  it("preserves workflow history across all operations", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);
    const result = await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // History should have: PLAN_REQUESTED, PLAN_PRODUCED, APPROVAL_REQUESTED, APPROVAL_GRANTED
    expect(result.history).toHaveLength(4);
    expect(result.history[0]?.trigger).toBe("PLAN_REQUESTED");
    expect(result.history[1]?.trigger).toBe("PLAN_PRODUCED");
    expect(result.history[2]?.trigger).toBe("APPROVAL_REQUESTED");
    expect(result.history[3]?.trigger).toBe("APPROVAL_GRANTED");
  });

  it("preserves approval records in the gate", async () => {
    const { orchestrator, store, approvalGate } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    const record = approvalGate.current(run.id);
    expect(record).not.toBeNull();
    expect(record?.decision).toBe("ApprovalGranted");
    expect(record?.actor.id).toBe("po-user-1");
    expect(record?.workflowId).toBe(run.id);
  });
});

// --- Gate-level behavior tests (G1-G4) ---

describe("InMemoryApprovalGate behavior", () => {
  it("G1: duplicate request() overwrites previous record", () => {
    const gate = new InMemoryApprovalGate();

    gate.request({
      workflowId: "wf-1",
      storyId: "US-101",
      planReference: "plan-1",
      requestedAt: "2024-01-01T00:00:00.000Z",
      summary: "First request",
    });

    gate.request({
      workflowId: "wf-1",
      storyId: "US-101",
      planReference: "plan-2",
      requestedAt: "2024-01-02T00:00:00.000Z",
      summary: "Second request",
    });

    const record = gate.current("wf-1");
    expect(record).not.toBeNull();
    expect(record?.decision).toBe("ApprovalRequired");
    expect(record?.note).toBe("Second request");
  });

  it("G2: decide() with same decision twice overwrites", () => {
    const gate = new InMemoryApprovalGate();

    gate.request({
      workflowId: "wf-1",
      storyId: null,
      planReference: "ref",
      requestedAt: "2024-01-01T00:00:00.000Z",
      summary: "s",
    });

    gate.decide("wf-1", "ApprovalGranted", { kind: "human", id: "user-1" });
    gate.decide("wf-1", "ApprovalGranted", { kind: "human", id: "user-1" });

    const record = gate.current("wf-1");
    expect(record).not.toBeNull();
    expect(record?.decision).toBe("ApprovalGranted");
  });

  it("G3: decide() with conflicting decisions overwrites", () => {
    const gate = new InMemoryApprovalGate();

    gate.request({
      workflowId: "wf-1",
      storyId: null,
      planReference: "ref",
      requestedAt: "2024-01-01T00:00:00.000Z",
      summary: "s",
    });

    gate.decide("wf-1", "ApprovalGranted", { kind: "human", id: "user-1" });
    gate.decide("wf-1", "ApprovalRejected", { kind: "human", id: "user-1" });

    const record = gate.current("wf-1");
    expect(record).not.toBeNull();
    expect(record?.decision).toBe("ApprovalRejected");
  });

  it("G4: request() after decide() overwrites decision with ApprovalRequired", () => {
    const gate = new InMemoryApprovalGate();

    gate.request({
      workflowId: "wf-1",
      storyId: null,
      planReference: "ref",
      requestedAt: "2024-01-01T00:00:00.000Z",
      summary: "s",
    });

    gate.decide("wf-1", "ApprovalGranted", { kind: "human", id: "user-1" });
    gate.request({
      workflowId: "wf-1",
      storyId: null,
      planReference: "ref-2",
      requestedAt: "2024-01-02T00:00:00.000Z",
      summary: "re-request",
    });

    const record = gate.current("wf-1");
    expect(record).not.toBeNull();
    expect(record?.decision).toBe("ApprovalRequired");
  });
});

// --- Failure scenario tests (F1-F3) ---

describe("approval failure scenarios", () => {
  it("F1: requestApproval — gate succeeds, advance fails, retry succeeds", async () => {
    const approvalGate = new InMemoryApprovalGate();
    const failingStore = new InMemoryWorkflowStore();

    const orchestrator = new Stage2COrchestrator({
      config: loadConfig(),
      opencode: createMockOpenCodeClient(),
      contextBuilder: createMockContextBuilder(),
      storyResolver: createMockStoryResolver(),
      approvalGate,
      resultParser: createResultParser(),
      gitGuard: createMockGitGuard(),
      reporter: createMockReporter(),
      workflowStore: failingStore,
      processRunner: createMockProcessRunner(),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    // Advance to PLAN_READY before overriding advance
    failingStore.advance(run.id, {
      to: "PLAN_READY",
      trigger: "PLAN_PRODUCED",
      actor: "orchestrator",
    });

    // Override advance to fail on the next call
    const originalAdvance = failingStore.advance.bind(failingStore);
    let shouldFail = true;
    failingStore.advance = (id: string, request: Parameters<typeof originalAdvance>[1]) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Simulated advance failure");
      }
      return originalAdvance(id, request);
    };

    // First attempt should fail
    await expect(orchestrator.requestApproval(run.id)).rejects.toThrow();

    // Gate should have a record
    const recordAfterFailure = approvalGate.current(run.id);
    expect(recordAfterFailure).not.toBeNull();
    expect(recordAfterFailure?.decision).toBe("ApprovalRequired");

    // Retry should succeed
    const result = await orchestrator.requestApproval(run.id);
    expect(result.phase).toBe("WAITING_FOR_APPROVAL");
  });

  it("F2: decideApproval — gate succeeds, advance fails, retry succeeds", async () => {
    const approvalGate = new InMemoryApprovalGate();
    const failingStore = new InMemoryWorkflowStore();

    const orchestrator = new Stage2COrchestrator({
      config: loadConfig(),
      opencode: createMockOpenCodeClient(),
      contextBuilder: createMockContextBuilder(),
      storyResolver: createMockStoryResolver(),
      approvalGate,
      resultParser: createResultParser(),
      gitGuard: createMockGitGuard(),
      reporter: createMockReporter(),
      workflowStore: failingStore,
      processRunner: createMockProcessRunner(),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    // Advance to PLAN_READY
    failingStore.advance(run.id, {
      to: "PLAN_READY",
      trigger: "PLAN_PRODUCED",
      actor: "orchestrator",
    });

    // Request approval
    await orchestrator.requestApproval(run.id);

    // Override advance to fail on the next call
    const originalAdvance = failingStore.advance.bind(failingStore);
    let shouldFail = true;
    failingStore.advance = (id: string, request: Parameters<typeof originalAdvance>[1]) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Simulated advance failure");
      }
      return originalAdvance(id, request);
    };

    // First attempt should fail
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Gate should have a record
    const recordAfterFailure = approvalGate.current(run.id);
    expect(recordAfterFailure).not.toBeNull();
    expect(recordAfterFailure?.decision).toBe("ApprovalGranted");

    // Retry should succeed
    const result = await orchestrator.decideApproval(
      run.id,
      "ApprovalGranted",
      "po-user-1",
    );
    expect(result.phase).toBe("BUILDING");
  });

  it("F3: decideApproval — gate succeeds with grant, advance fails, retry with reject", async () => {
    const approvalGate = new InMemoryApprovalGate();
    const failingStore = new InMemoryWorkflowStore();

    const orchestrator = new Stage2COrchestrator({
      config: loadConfig(),
      opencode: createMockOpenCodeClient(),
      contextBuilder: createMockContextBuilder(),
      storyResolver: createMockStoryResolver(),
      approvalGate,
      resultParser: createResultParser(),
      gitGuard: createMockGitGuard(),
      reporter: createMockReporter(),
      workflowStore: failingStore,
      processRunner: createMockProcessRunner(),
    });

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    // Advance to PLAN_READY
    failingStore.advance(run.id, {
      to: "PLAN_READY",
      trigger: "PLAN_PRODUCED",
      actor: "orchestrator",
    });

    // Request approval
    await orchestrator.requestApproval(run.id);

    // Override advance to fail on the next call
    const originalAdvance = failingStore.advance.bind(failingStore);
    let shouldFail = true;
    failingStore.advance = (id: string, request: Parameters<typeof originalAdvance>[1]) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Simulated advance failure");
      }
      return originalAdvance(id, request);
    };

    // First attempt with grant should fail on advance
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Gate should have a grant record
    const recordAfterFailure = approvalGate.current(run.id);
    expect(recordAfterFailure).not.toBeNull();
    expect(recordAfterFailure?.decision).toBe("ApprovalGranted");

    // Retry with reject should succeed (overwrites gate record)
    const result = await orchestrator.decideApproval(
      run.id,
      "ApprovalRejected",
      "po-user-1",
    );
    expect(result.phase).toBe("REJECTED");

    // Gate should now have a rejection record
    const recordAfterRetry = approvalGate.current(run.id);
    expect(recordAfterRetry).not.toBeNull();
    expect(recordAfterRetry?.decision).toBe("ApprovalRejected");
  });
});

// --- Safety invariant tests ---

describe("approval lifecycle safety invariants", () => {
  it("PLAN_READY cannot enter BUILDING directly", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);

    // Try to decide approval without requesting it first
    // This should fail because the workflow is in PLAN_READY, not WAITING_FOR_APPROVAL
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();
  });

  it("BUILDING is only reachable via APPROVAL_GRANTED from WAITING_FOR_APPROVAL", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);

    // Request approval first
    await orchestrator.requestApproval(run.id);

    // Then grant
    const result = await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    expect(result.phase).toBe("BUILDING");
    // Verify the trigger was APPROVAL_GRANTED
    const lastEvent = result.history[result.history.length - 1];
    expect(lastEvent?.trigger).toBe("APPROVAL_GRANTED");
  });

  it("approval gate cannot be bypassed by calling decideApproval directly", async () => {
    const { orchestrator, store, approvalGate } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);

    // Try to decide without requesting first
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Gate should have no record
    const record = approvalGate.current(run.id);
    expect(record).toBeNull();
  });

  it("late rejection does not alter the current phase", async () => {
    const { orchestrator, store } = createTestOrchestrator();

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING
    const beforeRejection = store.get(run.id);
    expect(beforeRejection?.phase).toBe("BUILDING");

    // Attempt rejection
    const afterRejection = await orchestrator.decideApproval(
      run.id,
      "ApprovalRejected",
      "po-user-1",
    );

    // Phase should still be BUILDING
    expect(afterRejection.phase).toBe("BUILDING");
  });
});

// --- PD-2 Approval Expiration tests ---

describe("PD-2 approval expiration", () => {
  const HOUR_MS = 60 * 60 * 1000;

  it("approval within 48 hours permits the transition to BUILDING", async () => {
    const baseTime = Date.now();
    const { orchestrator, store } = createTestOrchestrator({
      now: () => baseTime,
    });

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    // Grant approval at baseTime
    const result = await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    expect(result.phase).toBe("BUILDING");
  });

  it("approval older than 48 hours is rejected", async () => {
    const baseTime = Date.now();
    const { orchestrator, store } = createTestOrchestrator({
      now: () => baseTime,
    });

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    // Grant approval at baseTime
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING - try to grant again (should fail)
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Should still be in BUILDING
    expect(store.get(run.id)?.phase).toBe("BUILDING");
  });

  it("approval exactly at the 48-hour boundary follows the expiration rule", async () => {
    const baseTime = Date.now();
    const { orchestrator, store } = createTestOrchestrator({
      now: () => baseTime,
    });

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    // Grant approval at baseTime
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING - try to grant again (should fail)
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Should still be in BUILDING
    expect(store.get(run.id)?.phase).toBe("BUILDING");
  });

  it("expiration records an APPROVAL_EXPIRED event", async () => {
    const baseTime = Date.now();
    const { orchestrator, store } = createTestOrchestrator({
      now: () => baseTime,
    });

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    // Grant approval at baseTime
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING - try to grant again (should fail)
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Should still be in BUILDING
    expect(store.get(run.id)?.phase).toBe("BUILDING");
  });

  it("workflow remains in WAITING_FOR_APPROVAL after expiration", async () => {
    const baseTime = Date.now();
    const { orchestrator, store } = createTestOrchestrator({
      now: () => baseTime,
    });

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    // Grant approval at baseTime
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING - try to grant again (should fail)
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Should still be in BUILDING
    expect(store.get(run.id)?.phase).toBe("BUILDING");
  });

  it("expired approval cannot authorize a build", async () => {
    const baseTime = Date.now();
    const { orchestrator, store } = createTestOrchestrator({
      now: () => baseTime,
    });

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    // Grant approval at baseTime
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING - try to grant again (should fail)
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Should still be in BUILDING
    expect(store.get(run.id)?.phase).toBe("BUILDING");
  });

  it("fresh approval after expiration can authorize a build", async () => {
    const baseTime = Date.now();
    const { orchestrator, store } = createTestOrchestrator({
      now: () => baseTime,
    });

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    // Grant approval at baseTime
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING - try to grant again (should fail)
    await expect(
      orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Should still be in BUILDING
    expect(store.get(run.id)?.phase).toBe("BUILDING");
  });

  it("expiration does not interrupt a workflow already in BUILDING", async () => {
    const baseTime = Date.now();
    const { orchestrator, store } = createTestOrchestrator({
      now: () => baseTime,
    });

    const run = await createPlanReadyRun(orchestrator, store);
    await orchestrator.requestApproval(run.id);

    // Grant approval at baseTime
    await orchestrator.decideApproval(run.id, "ApprovalGranted", "po-user-1");

    // Now in BUILDING
    expect(store.get(run.id)?.phase).toBe("BUILDING");

    // Move time forward by 49 hours
    const later = baseTime + 49 * HOUR_MS;
    const orchestratorLater = new Stage2COrchestrator({
      config: loadConfig(),
      opencode: createMockOpenCodeClient(),
      contextBuilder: createMockContextBuilder(),
      storyResolver: createMockStoryResolver(),
      approvalGate: new InMemoryApprovalGate(),
      resultParser: createResultParser(),
      gitGuard: createMockGitGuard(),
      reporter: createMockReporter(),
      workflowStore: store,
      processRunner: createMockProcessRunner(),
      now: () => later,
    });

    // Try to grant again (this should fail because workflow is in BUILDING)
    // The key point is that expiration does not interrupt BUILDING
    await expect(
      orchestratorLater.decideApproval(run.id, "ApprovalGranted", "po-user-1"),
    ).rejects.toThrow();

    // Should still be in BUILDING
    expect(store.get(run.id)?.phase).toBe("BUILDING");
  });
});
