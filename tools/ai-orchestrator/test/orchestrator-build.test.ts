/**
 * Stage 2C-6 Step 2 — Orchestrator build unit tests.
 *
 * Covers build execution, approval validation, git guard integration,
 * scope violations, and failure handling.
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

/**
 * Creates a GitGuard that delegates to the real guard math (evaluateGuard / diffSnapshots)
 * over fixture snapshots. This exercises the F-6 path (allowed:true + protectedPaths)
 * through the actual guard logic rather than a mocked verdict.
 */
function createRealGuardGitGuard(overrides: {
  baselineFixture: GitBaseline;
  currentFixture: GitCurrentState;
  scope: GuardScope;
}): GitGuard {
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

// --- Helper to create a workflow run in BUILDING phase ---

async function createBuildingRun(
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

  // Persist approved scope for this run (missing scope fails closed).
  store.recordEvidence(run.id, {
    approvedScope: {
      workflowId: run.id,
      scope: { allowedPrefixes: ["src/", "tools/", "backend/", "frontend/"], allowedExactPaths: [], filePermissions: [] },
      approvedBy: "po-user-1",
      approvedAt: new Date().toISOString(),
    },
  });

  return building;
}

// --- Tests ---

describe("orchestrator build", () => {
  it("transitions to TESTING on successful build with permitted changes", async () => {
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
      captureCurrentState: async (): Promise<GitCurrentState> => ({
        capturedAt: "2026-01-01T00:00:01Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: ["src/file.ts"],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: " M src/file.ts\n",
        contentHashes: {},
        kind: "current",
      }),
      evaluate: (_baseline: GitBaseline | null, _current: GitCurrentState, _scope: GuardScope) => ({
        allowed: true,
        unauthorizedPaths: [],
        protectedPaths: [],
        reason: "All changes in scope",
        onViolation: "STOP" as const,
      }),
    });

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({ files: ["src/file.ts"], tests: { passed: true } }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ files: ["src/file.ts"], tests: { passed: true } }),
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
        stdout: JSON.stringify({ files: ["src/file.ts"], tests: { passed: true } }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    expect(result.phase).toBe("TESTING");
    expect(result.history[result.history.length - 1]?.trigger).toBe("BUILD_PRODUCED");
  });

  it("throws when build is called from wrong phase", async () => {
    const { orchestrator } = createTestOrchestrator();

    const run = await orchestrator.start({
      storyId: "US-101",
      requestedBy: "po",
      intent: "test",
    });

    // Run is in PLANNING, not BUILDING
    await expect(orchestrator.build(run.id)).rejects.toThrow();
  });

  it("throws for non-existent workflow", async () => {
    const { orchestrator } = createTestOrchestrator();

    await expect(orchestrator.build("wf-nonexistent")).rejects.toThrow();
  });

  it("blocks when approval is missing", async () => {
    const { orchestrator, store, approvalGate } = createTestOrchestrator();

    const run = await createBuildingRun(orchestrator, store);

    // Verify approval exists
    expect(approvalGate.current(run.id)?.decision).toBe("ApprovalGranted");

    // Create a new orchestrator with an empty approval gate
    const emptyApprovalGate = new InMemoryApprovalGate();
    const orchestratorNoApproval = new Stage2COrchestrator({
      config: loadConfig(),
      opencode: createMockOpenCodeClient(),
      contextBuilder: createMockContextBuilder(),
      storyResolver: createMockStoryResolver(),
      approvalGate: emptyApprovalGate,
      resultParser: createResultParser(),
      gitGuard: createMockGitGuard(),
      reporter: createMockReporter(),
      workflowStore: store,
      processRunner: createMockProcessRunner(),
    });

    const result = await orchestratorNoApproval.build(run.id);
    expect(result.phase).toBe("BLOCKED");
  });

  it("blocks when approval is expired (PD-2)", async () => {
    const baseTime = Date.now();
    const HOUR_MS = 60 * 60 * 1000;

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
    });

    const { orchestrator, store, approvalGate } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      now: () => baseTime,
    });

    const run = await createBuildingRun(orchestrator, store);

    // Verify approval is valid
    const record = approvalGate.current(run.id);
    expect(record?.decision).toBe("ApprovalGranted");

    // Move time forward by 49 hours
    const later = baseTime + 49 * HOUR_MS;
    const orchestratorLater = new Stage2COrchestrator({
      config: loadConfig(),
      opencode: createMockOpenCodeClient(),
      contextBuilder: createMockContextBuilder(),
      storyResolver: createMockStoryResolver(),
      approvalGate,
      resultParser: createResultParser(),
      gitGuard: mockGitGuard,
      reporter: createMockReporter(),
      workflowStore: store,
      processRunner: createMockProcessRunner(),
      now: () => later,
    });

    const result = await orchestratorLater.build(run.id);

    // Should remain in BUILDING (expiration recorded as event)
    expect(result.phase).toBe("BUILDING");

    // Check that an expiration event was recorded
    const lastEvent = result.history[result.history.length - 1];
    expect(lastEvent?.note).toContain("expired");
  });

  it("blocks when git baseline capture fails", async () => {
    const mockGitGuard = createMockGitGuard({
      captureBaseline: async () => {
        throw new Error("Git not available");
      },
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history[result.history.length - 1]?.note).toContain("Failed to capture git baseline");
  });

  it("blocks when git state capture fails after execution", async () => {
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

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({ files: ["src/file.ts"] }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ files: ["src/file.ts"] }),
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
        stdout: JSON.stringify({ files: ["src/file.ts"] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history[result.history.length - 1]?.note).toContain("Failed to capture git state");
  });

  it("transitions to SCOPE_VIOLATION on unauthorized file changes", async () => {
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
      captureCurrentState: async (): Promise<GitCurrentState> => ({
        capturedAt: "2026-01-01T00:00:01Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: ["src/file.ts", "unauthorized/file.ts"],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: " M src/file.ts\n M unauthorized/file.ts\n",
        contentHashes: {},
        kind: "current",
      }),
      evaluate: (_baseline: GitBaseline | null, _current: GitCurrentState, _scope: GuardScope) => ({
        allowed: false,
        unauthorizedPaths: ["unauthorized/file.ts"],
        protectedPaths: [],
        reason: "Unauthorized changes detected",
        onViolation: "STOP" as const,
      }),
    });

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({ files: ["src/file.ts", "unauthorized/file.ts"] }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ files: ["src/file.ts", "unauthorized/file.ts"] }),
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
        stdout: JSON.stringify({ files: ["src/file.ts", "unauthorized/file.ts"] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    expect(result.phase).toBe("SCOPE_VIOLATION");
    expect(result.history[result.history.length - 1]?.trigger).toBe("SCOPE_VIOLATION_DETECTED");
  });

  it("blocks on protected file modifications", async () => {
    const mockGitGuard = createMockGitGuard({
      captureBaseline: async (): Promise<GitBaseline> => ({
        capturedAt: "2026-01-01T00:00:00Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: ["existing.ts"],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: " M existing.ts\n",
        contentHashes: {},
        kind: "baseline",
      }),
      captureCurrentState: async (): Promise<GitCurrentState> => ({
        capturedAt: "2026-01-01T00:00:01Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: ["existing.ts"],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: " M existing.ts\n",
        contentHashes: {},
        kind: "current",
      }),
      evaluate: (_baseline: GitBaseline | null, _current: GitCurrentState, _scope: GuardScope) => ({
        allowed: false,
        unauthorizedPaths: [],
        protectedPaths: ["existing.ts"],
        reason: "Protected file modifications detected",
        onViolation: "STOP" as const,
      }),
    });

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({ files: ["existing.ts"] }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ files: ["existing.ts"] }),
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
        stdout: JSON.stringify({ files: ["existing.ts"] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history[result.history.length - 1]?.note).toContain("Pre-existing file `existing.ts` was modified. Cannot confirm workflow attribution.");
  });

  it("blocks on HEAD changes", async () => {
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
      captureCurrentState: async (): Promise<GitCurrentState> => ({
        capturedAt: "2026-01-01T00:00:01Z",
        headCommit: "def456",
        stagedPaths: [],
        modifiedPaths: ["src/file.ts"],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: " M src/file.ts\n",
        contentHashes: {},
        kind: "current",
      }),
      evaluate: (_baseline: GitBaseline | null, _current: GitCurrentState, _scope: GuardScope) => ({
        allowed: true,
        unauthorizedPaths: [],
        protectedPaths: [],
        reason: "All changes in scope",
        onViolation: "STOP" as const,
      }),
    });

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({ files: ["src/file.ts"] }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ files: ["src/file.ts"] }),
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
        stdout: JSON.stringify({ files: ["src/file.ts"] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history[result.history.length - 1]?.note).toContain("HEAD changed");
  });

  it("transitions to FAILED on OpenCode non-zero exit", async () => {
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
      captureCurrentState: async (): Promise<GitCurrentState> => ({
        capturedAt: "2026-01-01T00:00:01Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: [],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: "",
        contentHashes: {},
        kind: "current",
      }),
    });

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 1,
        stdout: "",
        stderr: "Build failed",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "failure" as const,
          exitCode: 1,
          command: "opencode",
          args: [],
          stdout: "",
          stderr: "Build failed",
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
        stderr: "Build failed",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    expect(result.phase).toBe("FAILED");
    expect(result.history[result.history.length - 1]?.trigger).toBe("TESTS_FAILED");
  });

  it("transitions to FAILED on OpenCode timeout", async () => {
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
      captureCurrentState: async (): Promise<GitCurrentState> => ({
        capturedAt: "2026-01-01T00:00:01Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: [],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: "",
        contentHashes: {},
        kind: "current",
      }),
    });

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: null,
        stdout: "",
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 30000,
        completed: false,
        process: {
          status: "timeout" as const,
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
        },
      }),
      collectResult: async () => ({
        status: "timeout" as const,
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
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    expect(result.phase).toBe("FAILED");
  });

  it("does not produce workflow success from OpenCode exit code 0 alone", async () => {
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
      captureCurrentState: async (): Promise<GitCurrentState> => ({
        capturedAt: "2026-01-01T00:00:01Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: ["src/file.ts"],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: " M src/file.ts\n",
        contentHashes: {},
        kind: "current",
      }),
      evaluate: (_baseline: GitBaseline | null, _current: GitCurrentState, _scope: GuardScope) => ({
        allowed: true,
        unauthorizedPaths: [],
        protectedPaths: [],
        reason: "All changes in scope",
        onViolation: "STOP" as const,
      }),
    });

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({ files: ["src/file.ts"], tests: { passed: true } }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ files: ["src/file.ts"], tests: { passed: true } }),
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
        stdout: JSON.stringify({ files: ["src/file.ts"], tests: { passed: true } }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    // Build succeeds (transitions to TESTING), but this is NOT workflow verification
    expect(result.phase).toBe("TESTING");
    expect(result.phase).not.toBe("VERIFIED");
  });
});

describe("orchestrator build — safety invariants", () => {
  it("process exit code 0 does NOT produce VERIFIED", async () => {
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
      captureCurrentState: async (): Promise<GitCurrentState> => ({
        capturedAt: "2026-01-01T00:00:01Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: ["src/file.ts"],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: " M src/file.ts\n",
        contentHashes: {},
        kind: "current",
      }),
      evaluate: (_baseline: GitBaseline | null, _current: GitCurrentState, _scope: GuardScope) => ({
        allowed: true,
        unauthorizedPaths: [],
        protectedPaths: [],
        reason: "All changes in scope",
        onViolation: "STOP" as const,
      }),
    });

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({ files: ["src/file.ts"], tests: { passed: true } }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ files: ["src/file.ts"], tests: { passed: true } }),
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
        stdout: JSON.stringify({ files: ["src/file.ts"], tests: { passed: true } }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    // Build phase produces TESTING, not VERIFIED
    expect(result.phase).toBe("TESTING");
    expect(result.phase).not.toBe("VERIFIED");
  });

  it("OpenCode output cannot authorize scope", async () => {
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
      captureCurrentState: async (): Promise<GitCurrentState> => ({
        capturedAt: "2026-01-01T00:00:01Z",
        headCommit: "abc123",
        stagedPaths: [],
        modifiedPaths: ["unauthorized/file.ts"],
        untrackedPaths: [],
        renamedPaths: [],
        deletedPaths: [],
        porcelainStatus: " M unauthorized/file.ts\n",
        contentHashes: {},
        kind: "current",
      }),
      evaluate: (_baseline: GitBaseline | null, _current: GitCurrentState, _scope: GuardScope) => ({
        allowed: false,
        unauthorizedPaths: ["unauthorized/file.ts"],
        protectedPaths: [],
        reason: "Unauthorized changes detected",
        onViolation: "STOP" as const,
      }),
    });

    // OpenCode claims success and authorization
    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({
          files: ["unauthorized/file.ts"],
          authorized: true,
          scope: "approved",
        }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({
            files: ["unauthorized/file.ts"],
            authorized: true,
            scope: "approved",
          }),
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
        stdout: JSON.stringify({
          files: ["unauthorized/file.ts"],
          authorized: true,
          scope: "approved",
        }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store } = createTestOrchestrator({
      gitGuard: mockGitGuard,
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, store);
    const result = await orchestrator.build(run.id);

    // Orchestrator does NOT trust OpenCode's scope authorization
    expect(result.phase).toBe("SCOPE_VIOLATION");
  });
});

describe("F-6 Corrective Slice: Protected-file verification safety (build)", () => {
  it("B1: blocks (BLOCKED) on pre-existing modified file with flag flip (S1)", async () => {
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

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({ files: ["backend/existing.ts"] }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ files: ["backend/existing.ts"] }),
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
        stdout: JSON.stringify({ files: ["backend/existing.ts"] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store: orchestratorStore } = createTestOrchestrator({
      store,
      gitGuard: createRealGuardGitGuard({ baselineFixture, currentFixture, scope }),
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, orchestratorStore);
    const result = await orchestrator.build(run.id);

    expect(result.phase).toBe("BLOCKED");
    expect(result.history[result.history.length - 1]?.trigger).toBe("EXTERNAL_BLOCK");
    expect(result.history[result.history.length - 1]?.note).toContain("Pre-existing file `backend/existing.ts` was modified. Cannot confirm workflow attribution.");
  });

  it("B2: protected + unauthorized together yields SCOPE_VIOLATION (ordering lock)", async () => {
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

    const mockOpenCode = createMockOpenCodeClient({
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
        command: "ai-build",
        exitCode: 0,
        stdout: JSON.stringify({ files: ["backend/existing.ts", "secrets/prod.env"] }),
        stderr: "",
        usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
        durationMs: 1000,
        completed: true,
        process: {
          status: "success" as const,
          exitCode: 0,
          command: "opencode",
          args: [],
          stdout: JSON.stringify({ files: ["backend/existing.ts", "secrets/prod.env"] }),
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
        stdout: JSON.stringify({ files: ["backend/existing.ts", "secrets/prod.env"] }),
        stderr: "",
        durationMs: 1000,
        timedOut: false,
        truncated: false,
        signal: null,
      }),
    });

    const { orchestrator, store: orchestratorStore } = createTestOrchestrator({
      store,
      gitGuard: createRealGuardGitGuard({ baselineFixture, currentFixture, scope }),
      opencode: mockOpenCode,
    });

    const run = await createBuildingRun(orchestrator, orchestratorStore);
    const result = await orchestrator.build(run.id);

    // §10.4 step 2 (Out-of-scope) before step 3 (Unattributable)
    expect(result.phase).toBe("SCOPE_VIOLATION");
    expect(result.history[result.history.length - 1]?.trigger).toBe("SCOPE_VIOLATION_DETECTED");
    expect(result.history[result.history.length - 1]?.note).toContain("Unauthorized changes detected: secrets/prod.env");
  });
});
