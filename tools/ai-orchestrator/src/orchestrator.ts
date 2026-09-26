/**
 * Stage 2A — Orchestrator service.
 *
 * PURPOSE
 * -------
 * Define the control layer that sits between the human / ChatGPT PO and OpenCode.
 *
 *   Human / ChatGPT PO
 *        |
 *        v
 *   Development Orchestrator   <-- this file
 *        |
 *        v
 *   OpenCode Adapter           <-- opencode-client.ts
 *        |
 *        v
 *   AI Teacher Repository
 *
 * The orchestrator is a CONTROL layer. It sequences, gates, records, and reports.
 * It never writes application code itself, never invents product decisions, and
 * never bypasses the approval gate.
 *
 * STAGE 2A SCOPE
 * --------------
 * This file provides:
 *   - the run/event model,
 *   - the service interface every future stage implements,
 *   - a concrete Stage 2A service where ONLY `getStatus()` works and every
 *     execution method fails loudly with `NotImplementedInStageError`.
 *
 * No workflow run is created. No file is read or written. No process is spawned.
 */

import type { ApprovalGate, ApprovalGateVerdict, ApprovalRecord } from "./approval-gate.js";
import { InMemoryApprovalGate } from "./approval-gate.js";
import type { OrchestratorConfig } from "./config.js";
import { CONFIG_INVARIANTS, loadConfig } from "./config.js";
import type { ContextBuilder } from "./context-builder.js";
import { createContextBuilder } from "./context-builder.js";
import { NotImplementedInStageError, ApprovalRequiredError } from "./errors.js";
import { GUARD_INVARIANTS } from "./git-guard.js";
import { createOpenCodeClient, OpenCodeCliClient, STAGE_2B_CAPABILITIES, WORKFLOW_PLANNED_STAGE, type OpenCodeClient } from "./opencode-client.js";
import type { ResultParser, NormalizedResult } from "./result-parser.js";
import { createResultParser } from "./result-parser.js";
import type { Reporter } from "./reporters/console-reporter.js";
import { createStoryResolver, type StoryResolver } from "./story-resolver.js";
import { createGitGuard, type GitGuard } from "./git-guard.js";
import {
  describeStateMachine,
  transition,
  type StateMachineSummary,
  type TransitionTrigger,
  type WorkflowPhase,
} from "./workflow.js";

/**
 * Stage that owns automatic workflow execution.
 *
 * Stage 2B delivered the OpenCode CLI transport. The workflow methods below stay
 * refused until this stage.
 */
export const ORCHESTRATOR_PLANNED_STAGE = WORKFLOW_PLANNED_STAGE;

export interface WorkflowEvent {
  readonly from: WorkflowPhase;
  readonly to: WorkflowPhase;
  readonly trigger: TransitionTrigger;
  readonly at: string;
  readonly actor: string;
  readonly note: string | null;
}

/** In-memory representation of one workflow run. Stage 2A creates none. */
export interface WorkflowRun {
  readonly id: string;
  readonly storyId: string | null;
  readonly phase: WorkflowPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: readonly WorkflowEvent[];
}

export interface StartWorkflowRequest {
  readonly storyId: string | null;
  readonly requestedBy: string;
  readonly intent: string;
}

export interface OrchestratorStatus {
  readonly name: "ai-orchestrator";
  readonly stage: OrchestratorConfig["stage"];
  readonly implementationStatus: "skeleton-plus-cli-adapter";
  readonly executionEnabled: false;
  readonly opencodeConnected: false;
  readonly gitMutationEnabled: false;
  readonly networkEnabled: false;
  readonly approvalAutomation: false;
  readonly repositoryRoot: string;
  readonly stateDirectory: string;
  readonly executionMode: OrchestratorConfig["executionMode"];
  readonly logLevel: OrchestratorConfig["logLevel"];
  readonly opencodeCommand: string;
  readonly opencodeServerUrl: string | null;
  readonly stateMachine: StateMachineSummary;
  readonly implemented: readonly string[];
  readonly notImplemented: readonly string[];
  readonly safetyInvariants: readonly string[];
  readonly opencodeCapabilities: typeof STAGE_2B_CAPABILITIES;
  /** Resolved native OpenCode executable, or null when it could not be resolved. */
  readonly opencodeExecutable: string | null;
}

/** The full control-layer surface. Stage 2B implements the executable subset. */
export interface OrchestratorService {
  getStatus(): OrchestratorStatus;

  start(request: StartWorkflowRequest): Promise<WorkflowRun>;
  plan(workflowId: string): Promise<WorkflowRun>;
  requestApproval(workflowId: string): Promise<WorkflowRun>;
  decideApproval(workflowId: string, decision: "ApprovalGranted" | "ApprovalRejected", actorId: string): Promise<WorkflowRun>;
  build(workflowId: string): Promise<WorkflowRun>;
  test(workflowId: string): Promise<NormalizedResult>;
  review(workflowId: string): Promise<NormalizedResult>;
  verify(workflowId: string): Promise<NormalizedResult>;
  report(workflowId: string): Promise<NormalizedResult>;

  /** Read-only access to the approval boundary. */
  approvalGate(): ApprovalGate;
  /** Read-only access to the state machine. */
  stateMachine(): StateMachineSummary;
}

export interface OrchestratorDependencies {
  readonly config: OrchestratorConfig;
  readonly opencode: OpenCodeClient;
  readonly contextBuilder: ContextBuilder;
  readonly storyResolver: StoryResolver;
  readonly approvalGate: ApprovalGate;
  readonly resultParser: ResultParser;
  readonly gitGuard: GitGuard;
  readonly reporter: Reporter;
}

export const IMPLEMENTED_CAPABILITIES: readonly string[] = Object.freeze([
  "Configuration loading with fail-safe defaults (offline, no secrets).",
  "Workflow state machine with explicit legal edges and a mandatory approval edge.",
  "Pure verification gate evaluation (tests/review/typecheck/guard).",
  "Human approval boundary with no auto-approval path.",
  "Pure git snapshot diffing and scope evaluation (no repository access).",
  "Context Package, story resolution, and normalized result models (types + stubs).",
  "Console reporter and `orchestrator status` / `orchestrator help` CLI.",
  "Stage 2B: native OpenCode executable resolution with no shell fallback.",
  "Stage 2B: `opencode run` CLI adapter with stdout/stderr/exit-code capture.",
  "Stage 2B: enforced per-invocation timeout with child termination.",
  "Stage 2B: structured process outcomes (success / failure / timeout / spawn-error).",
  "Stage 2B: read-only `opencode --version` connectivity probe.",
]);

export const NOT_IMPLEMENTED_CAPABILITIES: readonly string[] = Object.freeze([
  "Stage 2C: automatic /ai-plan, /ai-build, /ai-test, /ai-review, /ai-verify execution.",
  "Automatic multi-story execution and autonomous story selection.",
  "Automatic approval of any kind.",
  "Automatic git commits, staging, or rollback.",
  "OpenCode server mode, HTTP integration, webhooks, or MCP integration.",
  "Background daemon, browser automation, or VS Code UI automation.",
  "ChatGPT API integration.",
  "Reading the Master Backlog, PO decisions, or any repository document.",
  "Story resolution by scanning the frozen Master Backlog.",
  "Context Package document loading.",
  "Parsing real OpenCode output into workflow results.",
  "Git baseline capture and live `git status` reads.",
  "Any git mutation (add, commit, stash, reset, clean, checkout, restore, push).",
  "Persisting workflow state to the state directory.",
]);

/**
 * Stage 2A orchestrator, extended by Stage 2B.
 *
 * `getStatus()` is real. The workflow methods `start`/`plan`/`build`/... still
 * refuse, because automatic workflow execution is Stage 2C work and is explicitly
 * out of Stage 2B scope. Stage 2B adds the OpenCode CLI *transport* only; the
 * orchestrator remains the sole owner of workflow state and approval.
 */
export class Stage2AOrchestrator implements OrchestratorService {
  readonly #deps: OrchestratorDependencies;

  constructor(deps: OrchestratorDependencies) {
    this.#deps = deps;
  }

  getStatus(): OrchestratorStatus {
    const { config } = this.#deps;
    const executable = resolveStatusExecutable(this.#deps.opencode, config);
    return {
      name: "ai-orchestrator",
      stage: config.stage,
      implementationStatus: "skeleton-plus-cli-adapter",
      executionEnabled: false,
      opencodeConnected: false,
      gitMutationEnabled: config.safety.gitMutationEnabled,
      networkEnabled: config.safety.networkEnabled,
      approvalAutomation: false,
      repositoryRoot: config.repositoryRoot,
      stateDirectory: config.stateDirectory,
      executionMode: config.executionMode,
      logLevel: config.logLevel,
      opencodeCommand: config.opencode.command,
      opencodeServerUrl: config.opencode.serverUrl,
      stateMachine: describeStateMachine(),
      implemented: IMPLEMENTED_CAPABILITIES,
      notImplemented: NOT_IMPLEMENTED_CAPABILITIES,
      safetyInvariants: [...CONFIG_INVARIANTS, ...GUARD_INVARIANTS],
      opencodeCapabilities: STAGE_2B_CAPABILITIES,
      opencodeExecutable: executable,
    };
  }

  approvalGate(): ApprovalGate {
    return this.#deps.approvalGate;
  }

  stateMachine(): StateMachineSummary {
    return describeStateMachine();
  }

  start(_request: StartWorkflowRequest): Promise<WorkflowRun> {
    return this.#refuse("OrchestratorService.start");
  }

  plan(_workflowId: string): Promise<WorkflowRun> {
    return this.#refuse("OrchestratorService.plan");
  }

  requestApproval(_workflowId: string): Promise<WorkflowRun> {
    return this.#refuse("OrchestratorService.requestApproval");
  }

  decideApproval(
    _workflowId: string,
    _decision: "ApprovalGranted" | "ApprovalRejected",
    _actorId: string,
  ): Promise<WorkflowRun> {
    return this.#refuse("OrchestratorService.decideApproval");
  }

  build(_workflowId: string): Promise<WorkflowRun> {
    return this.#refuse("OrchestratorService.build");
  }

  test(_workflowId: string): Promise<NormalizedResult> {
    return this.#refuse("OrchestratorService.test");
  }

  review(_workflowId: string): Promise<NormalizedResult> {
    return this.#refuse("OrchestratorService.review");
  }

  verify(_workflowId: string): Promise<NormalizedResult> {
    return this.#refuse("OrchestratorService.verify");
  }

  report(_workflowId: string): Promise<NormalizedResult> {
    return this.#refuse("OrchestratorService.report");
  }

  #refuse(capability: string): Promise<never> {
    // Deliberate: Stage 2B delivered the OpenCode CLI transport only. Automatic
    // workflow execution is Stage 2C and is refused here so that a Stage 2B
    // adapter can never be mistaken for an autonomous workflow runner.
    return Promise.reject(new NotImplementedInStageError(capability, "Stage 2B", WORKFLOW_PLANNED_STAGE));
  }
}

/**
 * The single authorized way to advance a workflow.
 *
 * Order matters: the approval gate is consulted BEFORE the state machine, and a
 * denied gate short-circuits. Stage 2B must route every transition through this
 * function so that `NO APPROVAL -> NO BUILD` cannot be bypassed.
 */
export function assertWorkflowMayAdvance(input: {
  from: WorkflowPhase;
  to: WorkflowPhase;
  trigger: TransitionTrigger;
  approval: ApprovalGateVerdict;
}): WorkflowPhase {
  if (!input.approval.allowed) {
    throw new ApprovalRequiredError(
      `Workflow may not advance ${input.from} -> ${input.to}: ${input.approval.reason}`,
      { from: input.from, to: input.to, trigger: input.trigger },
    );
  }
  return transition(input.from, input.to, input.trigger);
}

/** Pure helper exposing the approval record shape to the reporter. */
export type { ApprovalRecord };

/** Pure, non-throwing executable lookup for `status`. Never spawns anything. */
function resolveStatusExecutable(client: OpenCodeClient, config: OrchestratorConfig): string | null {
  if (!(client instanceof OpenCodeCliClient)) return null;
  const resolution = client.resolveExecutablePath(config.opencode.workingDirectory);
  return resolution.kind === "resolved" ? resolution.path : null;
}

/**
 * Build the dependency graph.
 *
 * All collaborators are injected, so Stage 2B+ can replace any one of them without
 * touching the orchestrator, the state machine, or the CLI.
 */
export function createOrchestrator(
  reporter: Reporter,
  overrides: Partial<OrchestratorDependencies> = {},
): OrchestratorService {
  const config = overrides.config ?? loadConfig();
  return new Stage2AOrchestrator({
    config,
    opencode: overrides.opencode ?? createOpenCodeClient(config.opencode),
    contextBuilder: overrides.contextBuilder ?? createContextBuilder(),
    storyResolver: overrides.storyResolver ?? createStoryResolver(),
    approvalGate: overrides.approvalGate ?? new InMemoryApprovalGate(),
    resultParser: overrides.resultParser ?? createResultParser(),
    gitGuard: overrides.gitGuard ?? createGitGuard(),
    reporter,
  });
}
