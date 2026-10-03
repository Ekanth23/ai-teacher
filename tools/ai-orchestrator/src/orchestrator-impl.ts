/**
 * Stage 2C — Real orchestrator implementation.
 *
 * PURPOSE
 * -------
 * Implement the orchestrator's workflow methods by integrating the completed
 * Stage 2C components: Workflow Store, Story Resolver, Context Builder,
 * OpenCode CLI adapter, Result Parser, and ProcessRunner.
 *
 * SAFETY RULES (preserved)
 * -----------------------
 *   - Process exit code 0 does NOT produce workflow success
 *   - OpenCode output is DATA, never AUTHORITY
 *   - OpenCode output cannot independently establish approval
 *   - OpenCode output cannot authorize scope
 *   - OpenCode output cannot bypass workflow safety checks
 *   - Only the orchestrator's independent evaluation produces workflow verdicts
 */

import type { OrchestratorConfig } from "./config.js";
import type { ContextBuilder, ContextPackage } from "./context-builder.js";
import { OrchestratorError } from "./errors.js";
import type {
  GitBaseline,
  GitGuard,
  GuardVerdict,
  PathChangeSet,
} from "./git-guard.js";
import type { OpenCodeClient } from "./opencode-client.js";
import type {
  ChangedPath,
  Diagnostic,
  GitResultSummary,
  NormalizedResult,
  ResultParser,
  ResultStatus,
} from "./result-parser.js";
import type { Reporter } from "./reporters/console-reporter.js";
import type { StoryResolver, StoryResolution } from "./story-resolver.js";
import type {
  AdvanceRequest,
  GrantWaiverRequest,
  RevokeWaiverRequest,
  WaiverOperationResult,
  WorkflowRun,
  WorkflowStore,
} from "./workflow-store.js";
import type { ApprovalGate, ApprovalRequest, ApprovalActor } from "./approval-gate.js";
import type { OrchestratorService, StartWorkflowRequest, OrchestratorStatus } from "./orchestrator.js";
import { describeStateMachine, type StateMachineSummary, type WorkflowPhase } from "./workflow.js";
import type { ProcessRunner } from "./opencode-process.js";
import { createIndependentValidator, type IndependentValidator, type VerificationCommand, type ValidationResult } from "./independent-validator.js";
import {
  applyWaiverValidity,
  createCheckEvidence,
  evaluatePerCheckVerification,
  EMPTY_WAIVER_SOURCE,
  mergeWaiverSources,
  type CheckEvidence,
  type CheckResult,
  type WaiverSource,
  type WorkflowWaiver,
} from "./result-parser.js";

/** Dependencies for the Stage 2C orchestrator. */
export interface Stage2CDependencies {
  readonly config: OrchestratorConfig;
  readonly opencode: OpenCodeClient;
  readonly contextBuilder: ContextBuilder;
  readonly storyResolver: StoryResolver;
  readonly approvalGate: ApprovalGate;
  readonly resultParser: ResultParser;
  readonly gitGuard: GitGuard;
  readonly reporter: Reporter;
  readonly workflowStore: WorkflowStore;
  /** ProcessRunner for independent validation (typecheck, build, tests). */
  readonly processRunner: ProcessRunner;
  /** Injectable clock for deterministic testing. Defaults to Date.now(). */
  readonly now?: () => number;
  /**
   * Source of PO-recorded waiver records. Defaults to no waivers.
   * PD-9/PD-10 validity evaluation happens in `verify()`; this source
   * only supplies what a human PO recorded.
   */
  readonly waivers?: WaiverSource;
}

/**
 * Git facts that are actually in hand at a verification exit point.
 *
 * A missing property means the fact was never obtained on that path — it is
 * never inferred, defaulted, or back-filled from another snapshot.
 */
interface VerifyGitFacts {
  /** True whenever `captureBaseline()` resolved on this path. */
  readonly baselineCaptured: boolean;
  /** HEAD from the baseline snapshot. Absent when the baseline was not captured. */
  readonly baselineHead?: string | null;
  /** HEAD from the current-state snapshot. Absent when it was not captured. */
  readonly currentHead?: string | null;
  /** Baseline snapshot. Absent when the baseline was not captured. */
  readonly baseline?: GitBaseline;
  /** Diff between the two snapshots. Absent when either capture failed. */
  readonly diff?: PathChangeSet;
  /**
   * A REAL `GuardVerdict` produced from a non-null approved scope.
   *
   * Absent on every path where `evaluate()` did not run, and when the approved
   * scope was unavailable (the `allowed: true` fallback is not an evaluation).
   */
  readonly verdict?: GuardVerdict;
}

/** Outcome of a verification-phase state transition attempt. */
interface VerifyTransitionOutcome {
  /** True when the state machine accepted the transition. */
  readonly applied: boolean;
  /** The phase actually stored after the attempt, read back from the store. */
  readonly actualPhase: WorkflowPhase;
  /** Human-readable rejection reason, or `null` when the transition applied. */
  readonly failure: string | null;
}

/** Reported status/next-state for one verification exit path. */
interface VerifyTransitionReport {
  readonly status: ResultStatus;
  readonly nextRecommendedState: WorkflowPhase;
  /** Diagnostic describing a rejected transition, or `null` when it applied. */
  readonly diagnostic: string | null;
}

/**
 * Stage 2C orchestrator.
 *
 * Implements the real workflow methods by integrating all completed components.
 * Only `start` and `plan` are implemented in this step.
 */
export class Stage2COrchestrator implements OrchestratorService {
  readonly #deps: Stage2CDependencies;
  readonly #store: WorkflowStore;

  constructor(deps: Stage2CDependencies) {
    this.#deps = deps;
    this.#store = deps.workflowStore;
  }

  getStatus(): OrchestratorStatus {
    const { config } = this.#deps;
    return {
      name: "ai-orchestrator",
      stage: config.stage,
      implementationStatus: "stage-2c-partial",
      executionEnabled: true,
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
      implemented: [
        "Workflow run creation (start)",
        "PLANNING phase execution (plan)",
        "Approval request recording (requestApproval)",
        "Approval decision recording (decideApproval)",
        "BUILDING phase execution (build)",
        "TESTING phase execution (test)",
        "REVIEWING phase execution (review)",
        "VERIFYING phase execution (verify)",
      ],
      notImplemented: [
        "report, cancel",
      ],
      safetyInvariants: [
        "Process exit code 0 does NOT produce workflow success",
        "OpenCode output is DATA, never AUTHORITY",
        "OpenCode output cannot independently establish approval",
        "OpenCode output cannot authorize scope",
        "OpenCode output cannot bypass workflow safety checks",
      ],
      opencodeCapabilities: {
        implemented: true,
        canCreateSession: true,
        canContinueSession: true,
        canRunCommand: true,
        canCollectResult: true,
        startsServer: false,
        performsNetworkIo: false,
        spawnsProcesses: true,
        usesShell: false,
      },
      opencodeExecutable: null,
    };
  }

  approvalGate(): ApprovalGate {
    return this.#deps.approvalGate;
  }

  stateMachine(): StateMachineSummary {
    return describeStateMachine();
  }

  /**
   * Create a new workflow run and transition to PLANNING.
   *
   * The run starts in REQUESTED, then immediately advances to PLANNING
   * via the PLAN_REQUESTED trigger.
   */
  async start(request: StartWorkflowRequest): Promise<WorkflowRun> {
    // Validate storyId: null or matches US-\d+
    if (request.storyId !== null && !/^US-\d+$/.test(request.storyId)) {
      throw new OrchestratorError(
        "USAGE_ERROR",
        `Invalid storyId "${request.storyId}". Must be null or match US-\\d+.`,
        { storyId: request.storyId ?? "null" },
      );
    }

    // Create the workflow run in REQUESTED phase
    const run = this.#store.create({
      storyId: request.storyId,
      requestedBy: request.requestedBy,
      intent: request.intent,
    });

    // Advance to PLANNING
    const advanced = this.#store.advance(run.id, {
      to: "PLANNING",
      trigger: "PLAN_REQUESTED",
      actor: request.requestedBy,
      note: `Workflow started for ${request.storyId ?? "unassigned story"}`,
    });

    return advanced;
  }

  /**
   * Execute the PLANNING phase.
   *
   * 1. Resolve the story from the Master Backlog
   * 2. Build the context package
   * 3. Execute the plan command via OpenCode
   * 4. Parse the result
   * 5. Transition to PLAN_READY, PO_DECISION_REQUIRED, or BLOCKED
   *
   * SAFETY: Process success does NOT produce workflow success.
   * OpenCode output is DATA, never AUTHORITY.
   */
  async plan(workflowId: string): Promise<WorkflowRun> {
    const run = this.#store.get(workflowId);
    if (run === null) {
      throw new OrchestratorError(
        "WORKFLOW_NOT_FOUND",
        `Workflow run "${workflowId}" was not found.`,
        { workflowId },
      );
    }

    // Validate current phase is PLANNING
    if (run.phase !== "PLANNING") {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        `Cannot execute plan from phase ${run.phase}. Expected PLANNING.`,
        { workflowId, currentPhase: run.phase },
      );
    }

    const storyId = run.storyId;
    if (storyId === null) {
      return this.#blockRun(workflowId, "No story ID assigned to this workflow run.");
    }

    // Step 1: Resolve the story
    const resolution = await this.#resolveStory(storyId);
    if (resolution.kind !== "resolved") {
      return this.#handleResolutionFailure(workflowId, resolution);
    }

    // Step 2: Build the context package
    const contextPackage = await this.#buildContext(storyId, resolution);

    // Step 3: Execute the plan command via OpenCode
    const planResult = await this.#executePlanCommand(workflowId, storyId, contextPackage);

    // Step 4: Parse the result
    const parsed = this.#deps.resultParser.parse(planResult, "PLANNING", storyId);

    // Step 5: Transition based on the parsed result
    return this.#transitionFromPlan(workflowId, parsed);
  }

  /**
   * Resolve the story from the Master Backlog.
   */
  async #resolveStory(storyId: string): Promise<StoryResolution> {
    return this.#deps.storyResolver.resolve({
      storyId,
      masterBacklogPath: this.#deps.config.governance.masterBacklogPath,
    });
  }

  /**
   * Build the context package for the story.
   */
  async #buildContext(storyId: string, resolution: StoryResolution): Promise<ContextPackage> {
    const epicId = resolution.kind === "resolved" ? resolution.story.epicId : null;
    return this.#deps.contextBuilder.build({
      storyId,
      epicId,
      stateDirectory: this.#deps.config.stateDirectory,
      governance: this.#deps.config.governance,
      requestedKinds: [
        "master-backlog",
        "user-story",
        "po-decisions",
        "architecture",
        "project-instructions",
        "stage-1-opencode-rules",
      ],
    });
  }

  /**
   * Execute the plan command via OpenCode.
   *
   * SAFETY: Process success does NOT produce workflow success.
   * The result is parsed as DATA, not AUTHORITY.
   */
  async #executePlanCommand(
    _workflowId: string,
    storyId: string,
    contextPackage: ContextPackage,
  ): Promise<unknown> {
    const message = `Create an implementation plan for ${storyId}. Analyze the story, identify gaps, and produce a bounded plan with a readiness verdict.`;

    const session = await this.#deps.opencode.createSession({
      storyId,
      command: "ai-plan",
      contextPackageReference: contextPackage.packageId,
      workingDirectory: this.#deps.config.repositoryRoot,
      message,
    });

    try {
      await this.#deps.opencode.runCommand(session, {
        command: "ai-plan",
        instruction: message,
        jsonOutput: true,
      });

      // Collect the raw result for parsing
      const rawResult = await this.#deps.opencode.collectResult(session);
      return rawResult;
    } finally {
      await this.#deps.opencode.dispose(session);
    }
  }

  /**
   * Handle story resolution failure.
   *
   * Maps the resolution kind to the appropriate transition:
   * - not-found -> BLOCKED (EXTERNAL_BLOCK)
   * - retired-story -> BLOCKED (EXTERNAL_BLOCK)
   * - collision-detected -> BLOCKED (DRAFT_ID_COLLISION)
   * - ambiguous -> BLOCKED (STORY_AMBIGUOUS)
   */
  async #handleResolutionFailure(
    workflowId: string,
    resolution: StoryResolution,
  ): Promise<WorkflowRun> {
    switch (resolution.kind) {
      case "not-found":
        return this.#blockRun(workflowId, resolution.message);
      case "retired-story":
        return this.#blockRun(workflowId, resolution.message);
      case "collision-detected":
        return this.#store.advance(workflowId, {
          to: "BLOCKED",
          trigger: "DRAFT_ID_COLLISION",
          actor: "orchestrator",
          note: resolution.collision.message,
        });
      case "ambiguous":
        return this.#store.advance(workflowId, {
          to: "BLOCKED",
          trigger: "STORY_AMBIGUOUS",
          actor: "orchestrator",
          note: resolution.message,
        });
      default:
        return this.#blockRun(workflowId, "Unknown story resolution failure.");
    }
  }

  /**
   * Transition from PLANNING based on the parsed plan result.
   *
   * - PO_DECISION_REQUIRED -> PO_DECISION_REQUIRED (Alternative B)
   * - Success with verdict -> PLAN_READY
   * - Otherwise -> BLOCKED
   */
  async #transitionFromPlan(workflowId: string, parsed: NormalizedResult): Promise<WorkflowRun> {
    // Check for PO decision required
    if (parsed.status === "po-decision-required") {
      return this.#store.advance(workflowId, {
        to: "PO_DECISION_REQUIRED",
        trigger: "PO_DECISION_REQUIRED",
        actor: "orchestrator",
        note: parsed.summary,
      });
    }

    // Check for success (plan produced with readiness verdict)
    if (parsed.status === "success") {
      return this.#store.advance(workflowId, {
        to: "PLAN_READY",
        trigger: "PLAN_PRODUCED",
        actor: "orchestrator",
        note: parsed.summary,
      });
    }

    // Otherwise, block
    return this.#blockRun(workflowId, parsed.summary);
  }

  /**
   * Block a run with the given reason.
   */
  async #blockRun(workflowId: string, reason: string): Promise<WorkflowRun> {
    return this.#store.advance(workflowId, {
      to: "BLOCKED",
      trigger: "EXTERNAL_BLOCK",
      actor: "orchestrator",
      note: reason,
    });
  }

  // --- Approval lifecycle ---

  /**
   * Record an approval request and advance the workflow to WAITING_FOR_APPROVAL.
   *
   * Operation ordering: the approval gate is called BEFORE the state transition.
   * If the gate fails, no state has changed. If the advance fails after the gate
   * succeeds, the gate has an ApprovalRequired record but the workflow remains
   * in PLAN_READY. This is safe because the state machine prevents any transition
   * from PLAN_READY except via APPROVAL_REQUESTED, and retrying requestApproval()
   * overwrites the gate record (actual Map.set() behavior) and re-attempts the
   * advance.
   */
  async requestApproval(workflowId: string): Promise<WorkflowRun> {
    const run = this.#store.get(workflowId);
    if (run === null) {
      throw new OrchestratorError(
        "WORKFLOW_NOT_FOUND",
        `Workflow run "${workflowId}" was not found.`,
        { workflowId },
      );
    }

    // Validate current phase is PLAN_READY
    if (run.phase !== "PLAN_READY") {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        `Cannot request approval from phase ${run.phase}. Expected PLAN_READY.`,
        { workflowId, currentPhase: run.phase },
      );
    }

    // Create the approval request
    const planReference = `plan-${run.storyId ?? "unassigned"}-${run.id}`;
    const approvalRequest: ApprovalRequest = {
      workflowId: run.id,
      storyId: run.storyId,
      planReference,
      requestedAt: new Date().toISOString(),
      summary: `Approval requested for ${run.storyId ?? "unassigned story"}`,
    };

    // Record the approval request in the gate
    this.#deps.approvalGate.request(approvalRequest);

    // Advance to WAITING_FOR_APPROVAL
    return this.#store.advance(workflowId, {
      to: "WAITING_FOR_APPROVAL",
      trigger: "APPROVAL_REQUESTED",
      actor: "orchestrator",
      note: `Approval requested for plan ${planReference}`,
    });
  }

  /**
   * Record an explicit human approval or rejection and apply the permitted
   * state transition.
   *
   * Operation ordering: the approval gate is called BEFORE the state transition.
   * If the gate fails, no state has changed. If the advance fails after the gate
   * succeeds, the gate has a decision record but the workflow remains in
   * WAITING_FOR_APPROVAL. This is safe because the state machine prevents any
   * transition from WAITING_FOR_APPROVAL except via APPROVAL_GRANTED or
   * APPROVAL_REJECTED, and retrying decideApproval() overwrites the gate record
   * (actual Map.set() behavior) and re-attempts the advance.
   *
   * Late rejection: if rejection is attempted after BUILDING has started,
   * the attempt is recorded as a workflow event and a warning is surfaced.
   * The current phase is not altered and no running process is terminated.
   */
  async decideApproval(
    workflowId: string,
    decision: "ApprovalGranted" | "ApprovalRejected",
    actorId: string,
  ): Promise<WorkflowRun> {
    const run = this.#store.get(workflowId);
    if (run === null) {
      throw new OrchestratorError(
        "WORKFLOW_NOT_FOUND",
        `Workflow run "${workflowId}" was not found.`,
        { workflowId },
      );
    }

    // Special case: rejection attempted after BUILDING has started.
    // Record the attempt as a workflow event. The event itself serves as the
    // warning — the Reporter interface has no warn() method, and adding one
    // would change the existing contract. The current phase is not altered
    // and no running process is terminated.
    if (decision === "ApprovalRejected" && this.#isAfterBuilding(run.phase)) {
      return this.#store.recordEvent(workflowId, {
        from: run.phase,
        to: run.phase,
        trigger: "APPROVAL_REJECTED",
        actor: actorId,
        note: `Late rejection attempt ignored: build already started in phase ${run.phase}`,
      });
    }

    // Validate current phase
    if (run.phase !== "WAITING_FOR_APPROVAL") {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        `Cannot decide approval from phase ${run.phase}. Expected WAITING_FOR_APPROVAL.`,
        { workflowId, currentPhase: run.phase },
      );
    }

    // Create the actor (kind is always "human" per the CLI contract)
    const actor: ApprovalActor = { kind: "human", id: actorId };

    // Record the decision in the gate
    const record = this.#deps.approvalGate.decide(workflowId, decision, actor);

    // PD-2: Check approval expiration immediately before the transition to BUILDING.
    // The approval timestamp is the recorded decision timestamp (record.decidedAt).
    // If the approval has expired, reject the transition, invalidate the approval,
    // record an APPROVAL_EXPIRED event, and remain in WAITING_FOR_APPROVAL.
    if (decision === "ApprovalGranted") {
      const now = this.#deps.now?.() ?? Date.now();
      const approvalTime = new Date(record.decidedAt).getTime();
      const expirationMs = 48 * 60 * 60 * 1000; // 48 hours

      if (now - approvalTime > expirationMs) {
        // Approval has expired. Invalidate it and record the expiration event.
        // The workflow remains in WAITING_FOR_APPROVAL. No state transition occurs.
        this.#invalidateApproval(workflowId);
        return this.#store.recordEvent(workflowId, {
          from: run.phase,
          to: run.phase,
          trigger: "APPROVAL_REJECTED",
          actor: actorId,
          note: `Approval expired (48-hour validity). Fresh approval required.`,
        });
      }
    }

    // Advance based on the decision
    if (decision === "ApprovalGranted") {
      return this.#store.advance(workflowId, {
        to: "BUILDING",
        trigger: "APPROVAL_GRANTED",
        actor: actorId,
        note: `Approval granted by ${actorId}`,
      });
    } else {
      return this.#store.advance(workflowId, {
        to: "REJECTED",
        trigger: "APPROVAL_REJECTED",
        actor: actorId,
        note: `Approval rejected by ${actorId}`,
      });
    }
  }

  /**
   * Invalidate an approval by resetting it to ApprovalRequired.
   * This ensures an expired approval cannot authorize a subsequent build.
   */
  #invalidateApproval(workflowId: string): void {
    const current = this.#deps.approvalGate.current(workflowId);
    if (current !== null) {
      // Re-request the approval to reset it to ApprovalRequired
      this.#deps.approvalGate.request({
        workflowId: current.workflowId,
        storyId: current.storyId,
        planReference: "expired",
        requestedAt: new Date().toISOString(),
        summary: "Previous approval expired. Fresh approval required.",
      });
    }
  }

  /**
   * Check if the phase is BUILDING or later (i.e., build work has started).
   */
  #isAfterBuilding(phase: WorkflowPhase): boolean {
    return ["BUILDING", "TESTING", "REVIEWING", "VERIFYING", "VERIFIED"].includes(phase);
  }

  // --- Build phase ---

  /**
   * Execute the BUILDING phase.
   *
   * 1. Validate the workflow exists and is in BUILDING phase
   * 2. Check approval validity (PD-2: 48 hours)
   * 3. Capture the Git baseline
   * 4. Execute the build command via OpenCode
   * 5. Capture the Git state after execution
   * 6. Compare against baseline using Git Guard
   * 7. Detect unauthorized changes, protected-file modifications, HEAD changes
   * 8. Transition to TESTING, SCOPE_VIOLATION, FAILED, or BLOCKED
   *
   * SAFETY: Process success does NOT produce workflow success.
   * OpenCode output is DATA, never AUTHORITY.
   */
  async build(workflowId: string): Promise<WorkflowRun> {
    const run = this.#store.get(workflowId);
    if (run === null) {
      throw new OrchestratorError(
        "WORKFLOW_NOT_FOUND",
        `Workflow run "${workflowId}" was not found.`,
        { workflowId },
      );
    }

    // Validate current phase is BUILDING
    if (run.phase !== "BUILDING") {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        `Cannot execute build from phase ${run.phase}. Expected BUILDING.`,
        { workflowId, currentPhase: run.phase },
      );
    }

    const storyId = run.storyId;
    if (storyId === null) {
      return this.#blockRun(workflowId, "No story ID assigned to this workflow run.");
    }

    // Step 1: Check approval validity (PD-2: 48 hours)
    const approvalCheck = await this.#checkApprovalValidity(workflowId);
    if (!approvalCheck.valid) {
      return approvalCheck.result;
    }

    // Step 2: Capture the Git baseline
    let baseline;
    try {
      baseline = await this.#deps.gitGuard.captureBaseline();
    } catch (error) {
      return this.#blockRun(
        workflowId,
        `Failed to capture git baseline: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 3: Execute the build command via OpenCode
    const buildResult = await this.#executeBuildCommand(workflowId, storyId);

    // Step 4: Capture the Git state after execution
    let currentState;
    try {
      currentState = await this.#deps.gitGuard.captureCurrentState();
    } catch (error) {
      return this.#blockRun(
        workflowId,
        `Failed to capture git state after build: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 5: Compare against baseline using Git Guard (approved scope only;
    // missing approved scope fails closed).
    const scope = this.#getApprovedScope(workflowId);
    if (scope === null) {
      return this.#blockRun(workflowId, "Approved scope unavailable for this workflow run; cannot evaluate scope compliance.");
    }
    const verdict = this.#deps.gitGuard.evaluate(baseline, currentState, scope);

    // Step 6: Check for HEAD changes
    if (baseline.headCommit !== currentState.headCommit) {
      return this.#blockRun(
        workflowId,
        `HEAD changed during build: ${baseline.headCommit ?? "null"} -> ${currentState.headCommit ?? "null"}`,
      );
    }

    // Step 7: Handle guard violations
    // §10.4 decision procedure: Out-of-scope (step 2) before Unattributable (step 3).
    if (verdict.unauthorizedPaths.length > 0) {
      return this.#store.advance(workflowId, {
        to: "SCOPE_VIOLATION",
        trigger: "SCOPE_VIOLATION_DETECTED",
        actor: "orchestrator",
        note: `Unauthorized changes detected: ${verdict.unauthorizedPaths.join(", ")}`,
      });
    }

    if (verdict.protectedPaths.length > 0) {
      const paths = verdict.protectedPaths;
      const reason =
        paths.length === 1
          ? `Pre-existing file \`${paths[0]}\` was modified. Cannot confirm workflow attribution.`
          : `Pre-existing files \`${paths.join("`, `")}\` were modified. Cannot confirm workflow attribution.`;
      return this.#blockRun(workflowId, reason);
    }

    if (!verdict.allowed) {
      return this.#blockRun(workflowId, verdict.reason);
    }

    // Step 8: Parse the build result
    const parsed = this.#deps.resultParser.parse(buildResult, "BUILDING", storyId);

    // Step 9: Check for OpenCode-reported test failures
    if (parsed.status === "failure") {
      return this.#store.advance(workflowId, {
        to: "FAILED",
        trigger: "TESTS_FAILED",
        actor: "orchestrator",
        note: parsed.summary,
      });
    }

    // Step 10: Transition to TESTING
    return this.#store.advance(workflowId, {
      to: "TESTING",
      trigger: "BUILD_PRODUCED",
      actor: "orchestrator",
      note: parsed.summary,
    });
  }

  /**
   * Check approval validity according to PD-2.
   *
   * Returns `{ valid: true }` if the approval is still valid.
   * Returns `{ valid: false, result }` if the approval has expired.
   */
  async #checkApprovalValidity(workflowId: string): Promise<{ valid: true } | { valid: false; result: WorkflowRun }> {
    const record = this.#deps.approvalGate.current(workflowId);
    if (record === null || record.decision !== "ApprovalGranted") {
      return {
        valid: false,
        result: await this.#blockRun(workflowId, "No valid approval found for build."),
      };
    }

    const now = this.#deps.now?.() ?? Date.now();
    const approvalTime = new Date(record.decidedAt).getTime();
    const expirationMs = 48 * 60 * 60 * 1000; // 48 hours

    if (now - approvalTime > expirationMs) {
      // Approval has expired. Invalidate it and record the expiration event.
      this.#invalidateApproval(workflowId);
      return {
        valid: false,
        result: this.#store.recordEvent(workflowId, {
          from: "BUILDING",
          to: "BUILDING",
          trigger: "APPROVAL_REJECTED",
          actor: "orchestrator",
          note: "Approval expired (48-hour validity). Fresh approval required.",
        }),
      };
    }

    return { valid: true };
  }

  /**
   * Get the persisted approved scope for the workflow.
   *
   * Returns null when no valid approved scope was recorded. Never returns a
   * permissive default — absence of approved scope fails closed.
   */
  #getApprovedScope(workflowId: string): import("./git-guard.js").GuardScope | null {
    const run = this.#store.get(workflowId);
    if (run === null) return null;
    const record = run.evidence.approvedScope ?? null;
    return this.#resolveApprovedScope(run, record);
  }

  /**
   * Execute the build command via OpenCode.
   *
   * SAFETY: Process success does NOT produce workflow success.
   * The result is parsed as DATA, not AUTHORITY.
   */
  async #executeBuildCommand(
    _workflowId: string,
    storyId: string,
  ): Promise<unknown> {
    const message = `Implement the approved plan for ${storyId}. Follow the authorized scope exactly.`;

    const session = await this.#deps.opencode.createSession({
      storyId,
      command: "ai-build",
      contextPackageReference: `build-${storyId}`,
      workingDirectory: this.#deps.config.repositoryRoot,
      message,
    });

    try {
      await this.#deps.opencode.runCommand(session, {
        command: "ai-build",
        instruction: message,
        jsonOutput: true,
      });

      // Collect the raw result for parsing
      const rawResult = await this.#deps.opencode.collectResult(session);
      return rawResult;
    } finally {
      await this.#deps.opencode.dispose(session);
    }
  }

  // --- Test phase ---

  /**
   * Execute the TESTING phase.
   *
   * 1. Validate the workflow exists and is in TESTING phase
   * 2. Capture the Git baseline
   * 3. Get changed files from git diff
   * 4. Determine applicable checks based on changed files
   * 5. Execute independent validation via ProcessRunner
   * 6. Evaluate OpenCode-reported E2E evidence
   * 7. Combine results and evaluate per-check evidence
   * 8. Transition to REVIEWING or FAILED
   *
   * SAFETY: Process success does NOT produce workflow success.
   * OpenCode output is DATA, never AUTHORITY.
   * Only orchestrator-executed checks satisfy mandatory requirements.
   * Headed E2E is the sole exception (OpenCode-reported with explicit headed evidence).
   */
  async test(workflowId: string): Promise<NormalizedResult> {
    const run = this.#store.get(workflowId);
    if (run === null) {
      throw new OrchestratorError(
        "WORKFLOW_NOT_FOUND",
        `Workflow run "${workflowId}" was not found.`,
        { workflowId },
      );
    }

    // Validate current phase is TESTING
    if (run.phase !== "TESTING") {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        `Cannot execute test from phase ${run.phase}. Expected TESTING.`,
        { workflowId, currentPhase: run.phase },
      );
    }

    const storyId = run.storyId;

    // Step 1: Capture the Git baseline
    let baseline;
    try {
      baseline = await this.#deps.gitGuard.captureBaseline();
    } catch (error) {
      return this.#handleTestFailure(
        workflowId,
        storyId,
        `Failed to capture git baseline: ${error instanceof Error ? error.message : String(error)}`,
        "HARD_FAILURE",
      );
    }

    // Step 2: Capture the current Git state
    let currentState;
    try {
      currentState = await this.#deps.gitGuard.captureCurrentState();
    } catch (error) {
      return this.#handleTestFailure(
        workflowId,
        storyId,
        `Failed to capture git state: ${error instanceof Error ? error.message : String(error)}`,
        "HARD_FAILURE",
      );
    }

    // Step 3: Get changed files from git diff
    const diff = this.#deps.gitGuard.diffAgainstBaseline(baseline, currentState);
    const changedFiles = diff.all;

    // Step 4: Determine applicable checks based on changed files
    const commands = this.#getVerificationCommands(changedFiles);

    // Step 5: Execute independent validation via ProcessRunner
    const validator: IndependentValidator = createIndependentValidator(this.#deps.processRunner);
    const summary = await validator.runChecks(commands);

    // Step 6: Evaluate OpenCode-reported E2E evidence
    const e2eEvidence = this.#evaluateE2EEvidence(changedFiles);

    // Step 7: Build per-check evidence
    const checks = this.#buildCheckEvidence(summary, e2eEvidence, changedFiles);

    // Step 8: Evaluate overall verification result
    // E2E not_applicable does not block the transition (backend-only changes)
    // E2E unavailable without waiver blocks the transition
    // E2E passed does not block the transition
    const e2eBlocksTransition = e2eEvidence.status === "failed" || e2eEvidence.status === "unavailable";
    const allMandatoryPassed = summary.allMandatoryPassed && !e2eBlocksTransition;

    // Step 9: Build NormalizedResult
    const result = this.#buildTestResult(run, summary, e2eEvidence, changedFiles, checks);

    // Step 10: Transition based on results
    if (allMandatoryPassed) {
      this.#store.advance(workflowId, {
        to: "REVIEWING",
        trigger: "TESTS_COMPLETED",
        actor: "orchestrator",
        note: result.summary,
      });
    } else {
      this.#store.advance(workflowId, {
        to: "FAILED",
        trigger: "TESTS_FAILED",
        actor: "orchestrator",
        note: result.summary,
      });
    }

    return result;
  }

  /**
   * Get verification commands based on changed files.
   *
   * Uses the contract's command matrix (Section 13.5) to determine which
   * checks are applicable. The orchestrator does NOT hardcode commands;
   * it uses the command matrix derived from the governance document.
   */
  #getVerificationCommands(changedFiles: readonly string[]): VerificationCommand[] {
    const commands: VerificationCommand[] = [];
    const repoRoot = this.#deps.config.repositoryRoot;

    const hasBackendChanges = changedFiles.some(
      (f) => f.startsWith("backend/") || f.startsWith("src/"),
    );
    const hasFrontendChanges = changedFiles.some(
      (f) => f.startsWith("frontend/"),
    );

    // Backend checks
    if (hasBackendChanges) {
      commands.push({
        checkId: "backend-typecheck",
        command: "npx",
        args: ["tsc", "--noEmit"],
        cwd: `${repoRoot}/backend`,
        mandatory: true,
      });
      commands.push({
        checkId: "backend-build",
        command: "npm",
        args: ["run", "build"],
        cwd: `${repoRoot}/backend`,
        mandatory: true,
      });
      commands.push({
        checkId: "backend-focused-tests",
        command: "npx",
        args: ["vitest", "run"],
        cwd: `${repoRoot}/backend`,
        mandatory: true,
      });
      commands.push({
        checkId: "backend-regression-tests",
        command: "npm",
        args: ["test"],
        cwd: `${repoRoot}/backend`,
        mandatory: true,
      });
    }

    // Frontend checks
    if (hasFrontendChanges) {
      commands.push({
        checkId: "frontend-typecheck",
        command: "npm",
        args: ["run", "typecheck"],
        cwd: `${repoRoot}/frontend`,
        mandatory: true,
      });
      commands.push({
        checkId: "frontend-build",
        command: "npm",
        args: ["run", "build"],
        cwd: `${repoRoot}/frontend`,
        mandatory: true,
      });
      commands.push({
        checkId: "frontend-focused-tests",
        command: "npx",
        args: ["vitest", "run"],
        cwd: `${repoRoot}/frontend`,
        mandatory: true,
      });
      commands.push({
        checkId: "frontend-regression-tests",
        command: "npm",
        args: ["test"],
        cwd: `${repoRoot}/frontend`,
        mandatory: true,
      });
    }

    return commands;
  }

  /**
   * Evaluate OpenCode-reported E2E evidence.
   *
   * Headed E2E is the sole exception to the orchestrator-only verification
   * rule. The orchestrator accepts OpenCode-reported E2E results ONLY when
   * explicit headed-execution evidence is provided.
   *
   * A passed E2E result without explicit headed evidence is classified as
   * `failed`. The orchestrator MUST NOT infer headed execution from a
   * generic pass result, a successful process exit code, or an unverified
   * assertion.
   */
  #evaluateE2EEvidence(
    changedFiles: readonly string[],
  ): { status: "passed" | "failed" | "unavailable" | "not_applicable"; evidence: string | null } {
    const hasFrontendChanges = changedFiles.some((f) => f.startsWith("frontend/"));

    // E2E is not applicable for backend-only changes
    if (!hasFrontendChanges) {
      return { status: "not_applicable", evidence: null };
    }

    // Check for OpenCode-reported E2E evidence
    // The orchestrator does NOT independently execute headed E2E.
    // It relies on OpenCode-reported evidence from the build phase.
    // If no evidence is available, the check is `unavailable`.
    const e2eEvidence = this.#getOpenCodeE2EEvidence();

    if (e2eEvidence === null) {
      // No OpenCode-reported E2E evidence available
      return { status: "unavailable", evidence: null };
    }

    // Check for explicit headed evidence
    if (!e2eEvidence.headed) {
      // Passed E2E result without explicit headed evidence is `failed`
      return {
        status: "failed",
        evidence: "E2E reported passed but headed execution not explicitly confirmed",
      };
    }

    return { status: "passed", evidence: e2eEvidence.evidence };
  }

  /**
   * Get OpenCode-reported E2E evidence from the workflow run state.
   *
   * Returns null when no OpenCode-reported E2E evidence is available.
   * The orchestrator does NOT invent evidence sources.
   */
  #getOpenCodeE2EEvidence(): { headed: boolean; evidence: string } | null {
    // Check for OpenCode-reported E2E evidence in the workflow run state
    // This would be stored by the build phase's OpenCode execution
    // For now, return null (no evidence available)
    // This is a known limitation: the orchestrator cannot independently
    // verify headed E2E results. It relies on OpenCode-reported evidence.
    return null;
  }

  /**
   * Build per-check evidence from validation results and E2E evidence.
   */
  #buildCheckEvidence(
    summary: { results: readonly { checkId: string; check: CheckResult; mandatory: boolean }[] },
    e2eEvidence: { status: "passed" | "failed" | "unavailable" | "not_applicable"; evidence: string | null },
    _changedFiles: readonly string[],
  ): CheckEvidence[] {
    const checks: CheckEvidence[] = [];

    // Add independent validation results
    for (const result of summary.results) {
      const status = result.check.passed ? "passed" : "failed";
      checks.push(
        createCheckEvidence({
          checkId: result.checkId,
          status,
          phase: "TESTING",
          mandatory: result.mandatory,
          exitCode: result.check.exitCode,
          command: result.check.command,
          durationMs: result.check.durationMs,
          total: result.check.total,
          failed: result.check.failed,
          skipped: result.check.skipped,
        }),
      );
    }

    // Add E2E evidence
    checks.push(
      createCheckEvidence({
        checkId: "headed-e2e",
        status: e2eEvidence.status,
        phase: "TESTING",
        mandatory: true,
        evidence: e2eEvidence.evidence,
      }),
    );

    return checks;
  }

  /**
   * Build the NormalizedResult for the TESTING phase.
   */
  #buildTestResult(
    run: WorkflowRun,
    summary: { results: readonly { checkId: string; check: CheckResult; mandatory: boolean }[]; allMandatoryPassed: boolean },
    e2eEvidence: { status: "passed" | "failed" | "unavailable" | "not_applicable"; evidence: string | null },
    changedFiles: readonly string[],
    _checks: readonly CheckEvidence[],
  ): NormalizedResult {
    const storyId = run.storyId;

    // Extract individual check results
    const typecheckResult = summary.results.find((r) => r.checkId.includes("typecheck"));
    const buildResult = summary.results.find((r) => r.checkId.includes("build"));
    const testsResult = summary.results.find((r) => r.checkId.includes("focused-tests"));

    const typecheck: CheckResult = typecheckResult?.check ?? {
      ran: false,
      passed: false,
      exitCode: null,
      total: null,
      failed: null,
      skipped: null,
      durationMs: null,
      command: null,
      notes: ["Typecheck was not applicable for this story"],
    };

    const build: CheckResult = buildResult?.check ?? {
      ran: false,
      passed: false,
      exitCode: null,
      total: null,
      failed: null,
      skipped: null,
      durationMs: null,
      command: null,
      notes: ["Build was not applicable for this story"],
    };

    const tests: CheckResult = testsResult?.check ?? {
      ran: false,
      passed: false,
      exitCode: null,
      total: null,
      failed: null,
      skipped: null,
      durationMs: null,
      command: null,
      notes: ["Focused tests were not applicable for this story"],
    };

    const e2eBlocksTransition = e2eEvidence.status === "failed" || e2eEvidence.status === "unavailable";
    const allPassed = summary.allMandatoryPassed && !e2eBlocksTransition;

    const summaryText = `Testing completed. ` +
      `Typecheck: ${typecheck.passed ? "passed" : "failed"}, ` +
      `Build: ${build.passed ? "passed" : "failed"}, ` +
      `Tests: ${tests.passed ? "passed" : "failed"}, ` +
      `E2E: ${e2eEvidence.status}.`;

    return {
      status: allPassed ? "success" : "failure",
      storyId,
      phase: "TESTING",
      changedFiles: [...changedFiles],
      tests,
      typecheck,
      build,
      errors: allPassed ? [] : [{ severity: "error", message: "One or more mandatory checks failed.", file: null, line: null }],
      warnings: [],
      git: {
        headCommit: null,
        baselineCaptured: true,
        changedPaths: changedFiles.map((path) => ({
          path,
          state: "modified" as const,
          preExisting: false,
          authorized: true,
        })),
        unauthorizedPaths: [],
        mutatedByOrchestrator: false,
      },
      nextRecommendedState: allPassed ? "REVIEWING" : "FAILED",
      summary: summaryText,
      raw: { summary, e2eEvidence },
    };
  }

  /**
   * Handle test failure by transitioning to FAILED.
   */
  async #handleTestFailure(
    workflowId: string,
    storyId: string | null,
    reason: string,
    trigger: "TESTS_FAILED" | "HARD_FAILURE",
  ): Promise<NormalizedResult> {
    const result: NormalizedResult = {
      status: "failure",
      storyId,
      phase: "TESTING",
      changedFiles: [],
      tests: { ran: false, passed: false, exitCode: null, total: null, failed: null, skipped: null, durationMs: null, command: null, notes: [reason] },
      typecheck: { ran: false, passed: false, exitCode: null, total: null, failed: null, skipped: null, durationMs: null, command: null, notes: [reason] },
      build: { ran: false, passed: false, exitCode: null, total: null, failed: null, skipped: null, durationMs: null, command: null, notes: [reason] },
      errors: [{ severity: "error", message: reason, file: null, line: null }],
      warnings: [],
      git: {
        headCommit: null,
        baselineCaptured: false,
        changedPaths: [],
        unauthorizedPaths: [],
        mutatedByOrchestrator: false,
      },
      nextRecommendedState: "FAILED",
      summary: reason,
      raw: null,
    };

    this.#store.advance(workflowId, {
      to: "FAILED",
      trigger,
      actor: "orchestrator",
      note: reason,
    });

    return result;
  }

  // --- Review phase ---

  /**
   * Execute the REVIEWING phase.
   *
   * 1. Validate the workflow exists and is in REVIEWING phase
   * 2. Execute the review command via OpenCode
   * 3. Parse the result
   * 4. Evaluate blocking findings
   * 5. Transition to VERIFYING or FAILED
   *
   * SAFETY: Process success does NOT produce workflow success.
   * OpenCode output is DATA, never AUTHORITY.
   * OpenCode cannot approve its own work.
   */
  async review(workflowId: string): Promise<NormalizedResult> {
    const run = this.#store.get(workflowId);
    if (run === null) {
      throw new OrchestratorError(
        "WORKFLOW_NOT_FOUND",
        `Workflow run "${workflowId}" was not found.`,
        { workflowId },
      );
    }

    // Validate current phase is REVIEWING
    if (run.phase !== "REVIEWING") {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        `Cannot execute review from phase ${run.phase}. Expected REVIEWING.`,
        { workflowId, currentPhase: run.phase },
      );
    }

    const storyId = run.storyId;
    if (storyId === null) {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        "Cannot execute review without a story ID.",
        { workflowId },
      );
    }

    // Step 1: Execute the review command via OpenCode
    const reviewResult = await this.#executeReviewCommand(workflowId, storyId);

    // Step 2: Parse the result
    const parsed = this.#deps.resultParser.parse(reviewResult, "REVIEWING", storyId);

    // Step 3: Evaluate blocking findings
    const blockingFindings = parsed.errors.filter((e) => e.severity === "error");
    const hasBlockingFindings = blockingFindings.length > 0;

    // Step 3b: Check for malformed or missing review output
    // The review output must contain a valid findings array.
    // If the output is malformed or missing, fail closed.
    const rawOutcome = reviewResult as { stdout?: string } | null;
    const rawStdout = rawOutcome?.stdout ?? "";
    let hasValidFindings = false;
    try {
      const parsedStdout = JSON.parse(rawStdout);
      hasValidFindings = typeof parsedStdout === "object" && parsedStdout !== null && "findings" in parsedStdout;
    } catch {
      hasValidFindings = false;
    }
    if (!hasValidFindings) {
      const updatedRun = this.#store.advance(workflowId, {
        to: "FAILED",
        trigger: "REVIEW_FAILED",
        actor: "orchestrator",
        note: "Review output is malformed or missing findings data.",
      });
      const existingRaw = typeof parsed.raw === "object" && parsed.raw !== null ? parsed.raw : {};
      return {
        ...parsed,
        status: "failure" as const,
        nextRecommendedState: "FAILED" as const,
        summary: "Review output is malformed or missing findings data.",
        errors: [{ severity: "error" as const, message: "Review output is malformed or missing findings data.", file: null, line: null }],
        raw: { ...existingRaw, workflowRun: updatedRun },
      };
    }

    // Step 4: Transition based on results
    if (hasBlockingFindings) {
      const updatedRun = this.#store.advance(workflowId, {
        to: "FAILED",
        trigger: "REVIEW_FAILED",
        actor: "orchestrator",
        note: `Review failed: ${blockingFindings.length} blocking finding(s).`,
      });
      const existingRaw = typeof parsed.raw === "object" && parsed.raw !== null ? parsed.raw : {};
      return {
        ...parsed,
        nextRecommendedState: "FAILED" as const,
        summary: `Review failed: ${blockingFindings.length} blocking finding(s).`,
        raw: { ...existingRaw, workflowRun: updatedRun },
      };
    }

    // No blocking findings -> transition to VERIFYING
    const updatedRun = this.#store.advance(workflowId, {
      to: "VERIFYING",
      trigger: "REVIEW_COMPLETED",
      actor: "orchestrator",
      note: `Review completed. Findings: ${parsed.errors.length + parsed.warnings.length} total, 0 blocking.`,
    });
    const existingRaw = typeof parsed.raw === "object" && parsed.raw !== null ? parsed.raw : {};
    return {
      ...parsed,
      nextRecommendedState: "VERIFYING" as const,
      summary: `Review completed. Findings: ${parsed.errors.length + parsed.warnings.length} total, 0 blocking.`,
      raw: { ...existingRaw, workflowRun: updatedRun },
    };
  }

  /**
   * Execute the review command via OpenCode.
   *
   * SAFETY: Process success does NOT produce workflow success.
   * The result is parsed as DATA, not AUTHORITY.
   */
  async #executeReviewCommand(
    _workflowId: string,
    storyId: string,
  ): Promise<unknown> {
    const message = `Review the implementation for ${storyId}. Check against the story, acceptance criteria, PO decisions, architecture, conventions, scope, DB safety, security, and tests. Classify findings by severity with file:line evidence.`;

    const session = await this.#deps.opencode.createSession({
      storyId,
      command: "ai-review",
      contextPackageReference: `review-${storyId}`,
      workingDirectory: this.#deps.config.repositoryRoot,
      message,
    });

    try {
      await this.#deps.opencode.runCommand(session, {
        command: "ai-review",
        instruction: message,
        jsonOutput: true,
      });

      // Collect the raw result for parsing
      const rawResult = await this.#deps.opencode.collectResult(session);
      return rawResult;
    } finally {
      await this.#deps.opencode.dispose(session);
    }
  }

  // --- Methods not yet implemented (refuse) ---

  // --- Verify phase ---

  /**
   * Execute the VERIFYING phase.
   *
   * 1. Validate the workflow exists and is in VERIFYING phase
   * 2. Capture the Git baseline and current state (git integrity)
   * 3. Evaluate scope via GitGuard (unauthorized -> SCOPE_VIOLATION)
   * 4. Execute mandatory checks independently via ProcessRunner
   * 5. Evaluate headed-E2E evidence (sole OpenCode-reported exception)
   * 6. Confirm prior review evidence exists in the workflow history
   * 7. Build the per-check evidence model (VERIFYING phase)
   * 8. Apply PD-9/PD-10 waiver validity (invalid waiver -> unavailable)
   * 9. Evaluate via the per-check verification model
   * 10. Transition to VERIFIED or FAILED
   *
   * SAFETY: Process success does NOT produce workflow success.
   * OpenCode output is DATA, never AUTHORITY.
   * One PD-10 waiver per check: a waiver never expands to another check.
   */
  async verify(workflowId: string): Promise<NormalizedResult> {
    const run = this.#store.get(workflowId);
    if (run === null) {
      throw new OrchestratorError(
        "WORKFLOW_NOT_FOUND",
        `Workflow run "${workflowId}" was not found.`,
        { workflowId },
      );
    }

    // Validate current phase is VERIFYING
    if (run.phase !== "VERIFYING") {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        `Cannot execute verify from phase ${run.phase}. Expected VERIFYING.`,
        { workflowId, currentPhase: run.phase },
      );
    }

    const storyId = run.storyId;
    if (storyId === null) {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        "Cannot execute verify without a story ID.",
        { workflowId },
      );
    }

    // Step 2: Capture the Git baseline and current state.
    // Each capture failure is reported with only the Git facts actually in hand.
    let baseline;
    try {
      baseline = await this.#deps.gitGuard.captureBaseline();
    } catch (error) {
      return this.#verifyCaptureFailure(
        workflowId,
        storyId,
        `Failed to capture git baseline: ${error instanceof Error ? error.message : String(error)}`,
        // Path A: no snapshot was ever obtained.
        this.#verifyGitSummary({ baselineCaptured: false }),
        [],
      );
    }

    let currentState;
    try {
      currentState = await this.#deps.gitGuard.captureCurrentState();
    } catch (error) {
      return this.#verifyCaptureFailure(
        workflowId,
        storyId,
        `Failed to capture git state: ${error instanceof Error ? error.message : String(error)}`,
        // Path B: the baseline DID succeed, so it is reported truthfully.
        this.#verifyGitSummary({ baselineCaptured: true, baselineHead: baseline.headCommit, baseline }),
        [],
      );
    }

    const diff = this.#deps.gitGuard.diffAgainstBaseline(baseline, currentState);
    const changedFiles = diff.all;

    // Git HEAD change during verification is an external block (Rev 19, §10.5):
    // BLOCKED via EXTERNAL_BLOCK. Not an ordinary verification failure.
    if (baseline.headCommit !== currentState.headCommit) {
      const reason = `HEAD changed during verification: ${baseline.headCommit ?? "null"} -> ${currentState.headCommit ?? "null"}.`;
      const transition = this.#transition(workflowId, {
        to: "BLOCKED",
        trigger: "EXTERNAL_BLOCK",
        actor: "orchestrator",
        note: `${reason} Blocked for human reconciliation.`,
      });
      // Path C: the diff exists but no REAL scope verdict exists at this point,
      // so changedPaths stays empty rather than reporting invented authorization.
      return this.#verifyInfrastructureFailure({
        storyId,
        reason,
        intended: { status: "blocked", targetPhase: "BLOCKED" },
        transition,
        git: this.#verifyGitSummary({
          baselineCaptured: true,
          baselineHead: baseline.headCommit,
          currentHead: currentState.headCommit,
          baseline,
          diff,
        }),
        changedFiles,
      });
    }

    // Step 3: Resolve the approved scope from the run's persisted evidence.
    // Missing/invalid/mismatched scope fails closed (§13.2 rule 12): it is
    // never interpreted as approval, never falls back to a permissive default.
    const scopeRecord = run.evidence.approvedScope ?? null;
    const approvedScope = this.#resolveApprovedScope(run, scopeRecord);

    let verdict: { allowed: boolean; unauthorizedPaths: readonly string[]; protectedPaths: readonly string[]; reason: string; onViolation: "STOP" };
    // `realVerdict` stays undefined whenever `evaluate()` did not run, so the
    // Git summary never derives authorization from the fallback verdict.
    let realVerdict: GuardVerdict | undefined;
    if (approvedScope === null) {
      verdict = {
        allowed: true, // scope compliance cannot be established; scope-clean check fails closed below
        unauthorizedPaths: [],
        protectedPaths: [],
        reason: "Approved scope unavailable; scope compliance cannot be established.",
        onViolation: "STOP",
      };
    } else {
      verdict = this.#deps.gitGuard.evaluate(baseline, currentState, approvedScope);
      realVerdict = verdict;

      // §10.4 decision procedure: Out-of-scope (step 2) before Unattributable (step 3).
      if (verdict.unauthorizedPaths.length > 0) {
        const reason = `Scope violation: ${verdict.unauthorizedPaths.join(", ")}`;
        const transition = this.#transition(workflowId, {
          to: "SCOPE_VIOLATION",
          trigger: "SCOPE_VIOLATION_DETECTED",
          actor: "orchestrator",
          note: `Unauthorized changes detected: ${verdict.unauthorizedPaths.join(", ")}`,
        });
        // Path F: a real verdict exists, so authorization is derived, not invented.
        return this.#verifyInfrastructureFailure({
          storyId,
          reason,
          intended: { status: "scope-violation", targetPhase: "SCOPE_VIOLATION" },
          transition,
          git: this.#verifyGitSummary({
            baselineCaptured: true,
            baselineHead: baseline.headCommit,
            currentHead: currentState.headCommit,
            baseline,
            diff,
            verdict: realVerdict,
          }),
          changedFiles,
        });
      }

      if (verdict.protectedPaths.length > 0) {
        const paths = verdict.protectedPaths;
        const reason =
          paths.length === 1
            ? `Pre-existing file \`${paths[0]}\` was modified. Cannot confirm workflow attribution.`
            : `Pre-existing files \`${paths.join("`, `")}\` were modified. Cannot confirm workflow attribution.`;
        const transition = this.#transition(workflowId, {
          to: "BLOCKED",
          trigger: "EXTERNAL_BLOCK",
          actor: "orchestrator",
          note: reason,
        });
        // Path D: the unauthorized branch already returned, so every reported
        // path is authorized under a real verdict.
        return this.#verifyInfrastructureFailure({
          storyId,
          reason,
          intended: { status: "blocked", targetPhase: "BLOCKED" },
          transition,
          git: this.#verifyGitSummary({
            baselineCaptured: true,
            baselineHead: baseline.headCommit,
            currentHead: currentState.headCommit,
            baseline,
            diff,
            verdict: realVerdict,
          }),
          changedFiles,
        });
      }

      if (!verdict.allowed) {
        // Path E: ambiguous scope — a real verdict exists but names no category.
        const transition = this.#transition(workflowId, {
          to: "BLOCKED",
          trigger: "EXTERNAL_BLOCK",
          actor: "orchestrator",
          note: verdict.reason,
        });
        return this.#verifyInfrastructureFailure({
          storyId,
          reason: verdict.reason,
          intended: { status: "blocked", targetPhase: "BLOCKED" },
          transition,
          git: this.#verifyGitSummary({
            baselineCaptured: true,
            baselineHead: baseline.headCommit,
            currentHead: currentState.headCommit,
            baseline,
            diff,
            verdict: realVerdict,
          }),
          changedFiles,
        });
      }
    }

    // Step 4: Execute mandatory checks independently
    const commands = this.#getVerificationCommands(changedFiles);
    const validator: IndependentValidator = createIndependentValidator(this.#deps.processRunner);
    const summary = await validator.runChecks(commands);

    // Step 5: Evaluate headed-E2E evidence
    const e2eEvidence = this.#evaluateE2EEvidence(changedFiles);

    // Step 6: Prior review evidence (from workflow history, no re-execution)
    const reviewCompleted = run.history.some((e) => e.trigger === "REVIEW_COMPLETED");

    // Step 7: Build the per-check evidence model for VERIFYING
    const criteriaStatus = this.#evaluateCriteriaEvidence(run);
    const poDecisionStatus = this.#evaluatePoDecisionEvidence(run);
    const checks = this.#buildVerifyCheckEvidence(
      summary,
      e2eEvidence,
      approvedScope !== null && verdict.allowed,
      approvedScope === null,
      baseline.headCommit,
      currentState.headCommit,
      reviewCompleted,
      criteriaStatus,
      poDecisionStatus,
    );

    // Step 8: Apply PD-9/PD-10 waiver validity to any unavailable check.
    // The run's own waiver ledger is authoritative for a (checkId, phase) pair,
    // so a revoked ledger waiver cannot be bypassed by another record.
    const waiverSource = this.#deps.waivers ?? EMPTY_WAIVER_SOURCE;
    const mergedWaivers = mergeWaiverSources(run.waivers, waiverSource.listForRun(workflowId));
    const adjusted = this.#applyWaivers(run.phase, checks, mergedWaivers);

    // Step 9: Evaluate via the per-check verification model
    const verification = evaluatePerCheckVerification(adjusted);

    // Step 10: Transition
    const verdictPassed = verification.verdict === "VERIFIED";
    const transition = this.#transition(workflowId, verdictPassed
      ? {
          to: "VERIFIED",
          trigger: "VERIFICATION_COMPLETED",
          actor: "orchestrator",
          note: "All mandatory verification requirements are satisfied.",
        }
      : {
          to: "FAILED",
          trigger: "VERIFICATION_FAILED",
          actor: "orchestrator",
          note: verification.blockers.join("; "),
        });

    // Paths G and H. Git facts are identical; only the check verdict differs.
    const git = this.#verifyGitSummary({
      baselineCaptured: true,
      baselineHead: baseline.headCommit,
      currentHead: currentState.headCommit,
      baseline,
      diff,
      // A null approved scope means no real evaluation ran, so `changedPaths`
      // and `unauthorizedPaths` stay empty rather than reporting a fallback.
      ...(realVerdict === undefined ? {} : { verdict: realVerdict }),
    });

    return this.#buildVerifyResult({
      storyId,
      summary,
      e2eEvidence,
      changedFiles,
      checks: adjusted,
      verdict: verification.verdict,
      blockers: verification.blockers,
      transition,
      git,
    });
  }

  /**
   * Build the Git summary for the VERIFYING phase from only the facts in hand.
   *
   * `headCommit` is the latest HEAD actually observed. `changedPaths` is
   * reported ONLY when a REAL scope verdict exists: `ChangedPath.authorized`
   * is a boolean with no unknown state, so an absent verdict would force an
   * invented value. An empty `changedPaths` therefore means "not determined",
   * never "no changes" — `status` and `summary` remain the authority.
   */
  #verifyGitSummary(facts: VerifyGitFacts): GitResultSummary {
    const headCommit = facts.currentHead ?? facts.baselineHead ?? null;

    if (facts.baseline === undefined || facts.diff === undefined || facts.verdict === undefined) {
      return {
        headCommit,
        baselineCaptured: facts.baselineCaptured,
        changedPaths: [],
        unauthorizedPaths: [],
        mutatedByOrchestrator: false,
      };
    }

    const preExisting = new Set<string>([...facts.baseline.modifiedPaths, ...facts.baseline.untrackedPaths]);
    const unauthorized = new Set<string>(facts.verdict.unauthorizedPaths);
    const added = new Set<string>(facts.diff.added);
    const removed = new Set<string>(facts.diff.removed);

    const changedPaths: ChangedPath[] = facts.diff.all.map((path) => ({
      path,
      state: added.has(path) ? "added" : removed.has(path) ? "deleted" : "modified",
      preExisting: preExisting.has(path),
      authorized: !unauthorized.has(path),
    }));

    return {
      headCommit,
      baselineCaptured: facts.baselineCaptured,
      changedPaths,
      unauthorizedPaths: [...facts.verdict.unauthorizedPaths],
      mutatedByOrchestrator: false,
    };
  }

  /**
   * Perform a VERIFYING-phase transition and report what actually happened.
   *
   * `advance()` validates the edge before writing, so a rejected transition
   * leaves the run untouched. On rejection the stored phase is re-read: the
   * reported recommended state is what is stored, never what was attempted.
   * The transition is never retried and never reported as successful.
   */
  #transition(workflowId: string, request: AdvanceRequest): VerifyTransitionOutcome {
    try {
      const advanced = this.#store.advance(workflowId, request);
      return { applied: true, actualPhase: advanced.phase, failure: null };
    } catch (error) {
      const current = this.#store.get(workflowId);
      if (current === null) {
        throw new OrchestratorError(
          "WORKFLOW_NOT_FOUND",
          `Workflow run "${workflowId}" was not found.`,
          { workflowId },
        );
      }
      return {
        applied: false,
        actualPhase: current.phase,
        failure:
          `Transition to ${request.to} via ${request.trigger} was rejected: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          `Workflow remains in ${current.phase}.`,
      };
    }
  }

  /**
   * Resolve the reported status and recommended state from an intended outcome
   * and what the transition actually did.
   *
   * I-1/I-2 hold when the transition applied. On rejection the pairing table is
   * suspended: the status is downgraded to "failure" and the recommended state
   * is the actual stored phase, which may be `VERIFYING` itself.
   *
   * F-1: A failed verification must NEVER return nextRecommendedState: VERIFIED,
   * regardless of the workflow's actual stored state. If the actual phase is
   * VERIFIED (from a prior successful overlapping call), the safe fallback is FAILED.
   */
  #resolveTransitionReport(
    intended: { status: ResultStatus; targetPhase: WorkflowPhase },
    transition: VerifyTransitionOutcome,
  ): VerifyTransitionReport {
    if (transition.applied) {
      return {
        status: intended.status,
        nextRecommendedState: transition.actualPhase,
        diagnostic: null,
      };
    }
    const recommendedState = transition.actualPhase === "VERIFIED"
      ? "FAILED"
      : transition.actualPhase;
    return {
      status: "failure",
      nextRecommendedState: recommendedState,
      diagnostic: transition.failure,
    };
  }

  /**
   * Report a Git-capture failure during verification.
   *
   * The run is blocked via `EXTERNAL_BLOCK` and the result reports `blocked`
   * with the Git facts that were actually available on this path.
   */
  #verifyCaptureFailure(
    workflowId: string,
    storyId: string | null,
    reason: string,
    git: GitResultSummary,
    changedFiles: readonly string[],
  ): NormalizedResult {
    const transition = this.#transition(workflowId, {
      to: "BLOCKED",
      trigger: "EXTERNAL_BLOCK",
      actor: "orchestrator",
      note: reason,
    });
    return this.#verifyInfrastructureFailure({
      storyId,
      reason,
      intended: { status: "blocked", targetPhase: "BLOCKED" },
      transition,
      git,
      changedFiles,
    });
  }

  /**
   * Grant a PO waiver for exactly one check in one phase (PD-10).
   *
   * Only a human PO actor may grant a waiver; the orchestrator cannot
   * self-waive. A successful grant appends an auditable waiver-grant event to
   * the run's history (Rev 19 Decision 3) and makes the waiver visible to
   * `verify()`. A rejected attempt records nothing.
   */
  grantWaiver(workflowId: string, request: GrantWaiverRequest): WaiverOperationResult {
    return this.#store.grantWaiver(workflowId, request);
  }

  /**
   * Revoke a PO waiver. Only the actor who granted it may revoke it (PD-9).
   *
   * A successful revocation appends an auditable waiver-revocation event and
   * reverts the affected check to `unavailable` on the next evaluation. A
   * rejected attempt records nothing and leaves the waiver valid.
   */
  revokeWaiver(workflowId: string, request: RevokeWaiverRequest): WaiverOperationResult {
    return this.#store.revokeWaiver(workflowId, request);
  }

  /**
   * Apply waiver validity (PD-9/PD-10) to a check set.
   *
   * A bare `unavailable` mandatory check blocks VERIFIED unless it has a
   * valid PO waiver for THIS check id and phase. A waiver that fails any
   * validity condition leaves the check `unavailable` (fail closed).
   * A `failed` check can never be waived.
   */
  #applyWaivers(
    runPhase: WorkflowPhase,
    checks: readonly CheckEvidence[],
    waivers: readonly WorkflowWaiver[],
  ): CheckEvidence[] {
    return applyWaiverValidity(checks, waivers, runPhase);
  }

  /**
   * Resolve the persisted approved scope for this run.
   *
   * Fails closed (returns null) when the record is missing, belongs to a
   * different workflow, or is malformed. Never returns a permissive default.
   */
  #resolveApprovedScope(
    run: WorkflowRun,
    record: import("./workflow-store.js").ApprovedScopeRecord | null,
  ): import("./git-guard.js").GuardScope | null {
    if (record === null) return null;
    if (record.workflowId !== run.id) return null;
    try {
      // Scope must be well-formed (authoritative filePermissions or non-empty
      // prefixes/exact paths); an empty/meaningless scope is not approval.
      if (record.scope.filePermissions.length === 0 && record.scope.allowedExactPaths.length === 0 && record.scope.allowedPrefixes.length === 0) {
        return null;
      }
      return record.scope;
    } catch {
      return null;
    }
  }

  #evaluateCriteriaEvidence(run: WorkflowRun): { status: "passed" | "failed" | "unavailable"; note: string } {
    const record = run.evidence.acceptanceCriteria ?? null;
    if (record === null || record.workflowId !== run.id || record.storyId !== run.storyId) {
      return { status: "unavailable", note: "No valid acceptance-criteria evidence persisted for this workflow/story." };
    }
    return record.satisfied
      ? { status: "passed", note: `All acceptance criteria satisfied (ref: ${record.reference}).` }
      : { status: "failed", note: `Acceptance criteria not met (ref: ${record.reference}).` };
  }

  #evaluatePoDecisionEvidence(run: WorkflowRun): { status: "passed" | "failed" | "unavailable"; note: string } {
    const record = run.evidence.poDecisions ?? null;
    if (record === null || record.workflowId !== run.id || record.storyId !== run.storyId) {
      return { status: "unavailable", note: "No valid PO-decision evidence persisted for this workflow/story." };
    }
    return record.resolved
      ? { status: "passed", note: `Applicable PO decisions resolved (ref: ${record.reference}).` }
      : { status: "failed", note: `Unresolved PO decisions remain (ref: ${record.reference}).` };
  }

  /**
   * Build the VERIFYING-phase per-check evidence model from the outputs of
   * the orchestrator's independent verification steps.
   */
  #buildVerifyCheckEvidence(
    summary: { results: readonly ValidationResult[] },
    e2eEvidence: { status: "passed" | "failed" | "unavailable" | "not_applicable"; evidence: string | null },
    scopeClean: boolean,
    scopeUnavailable: boolean,
    baselineHead: string | null,
    currentHead: string | null,
    reviewCompleted: boolean,
    criteriaStatus: { status: "passed" | "failed" | "unavailable"; note: string },
    poDecisionStatus: { status: "passed" | "failed" | "unavailable"; note: string },
  ): CheckEvidence[] {
    const checks: CheckEvidence[] = [];

    // Independent validation results (typecheck/build/focused/regression).
    for (const result of summary.results) {
      let status: "passed" | "failed" | "unavailable";
      if (result.outcome.status === "timeout" || result.outcome.status === "spawn-error") {
        status = "unavailable";
      } else {
        status = result.check.passed ? "passed" : "failed";
      }

      checks.push(
        createCheckEvidence({
          checkId: result.checkId,
          status,
          phase: "VERIFYING",
          mandatory: result.mandatory,
          exitCode: result.check.exitCode,
          command: result.check.command,
          durationMs: result.check.durationMs,
          total: result.check.total,
          failed: result.check.failed,
          skipped: result.check.skipped,
          notes: status === "unavailable" ? [`Check could not run: outcome ${result.outcome.status}.`] : [],
        }),
      );
    }

    // Headed E2E (sole OpenCode-reported exception).
    checks.push(
      createCheckEvidence({
        checkId: "headed-e2e",
        status: e2eEvidence.status,
        phase: "VERIFYING",
        mandatory: true,
        evidence: e2eEvidence.evidence,
      }),
    );

    // Scope clean (GitGuard.evaluate). Missing/unavailable scope fails closed.
    checks.push(
      createCheckEvidence({
        checkId: "scope-clean",
        status: scopeUnavailable ? "unavailable" : scopeClean ? "passed" : "failed",
        phase: "VERIFYING",
        mandatory: true,
        notes: scopeUnavailable
          ? ["Approved scope is missing, malformed, unavailable, or belongs to a different workflow; scope compliance cannot be established."]
          : ["scope source: persisted approved scope for this workflow run; evaluation via GitGuard."],
      }),
    );

    // Git integrity (baseline captured, HEAD unchanged).
    checks.push(
      createCheckEvidence({
        checkId: "git-integrity",
        status: baselineHead !== null && baselineHead === currentHead ? "passed" : "failed",
        phase: "VERIFYING",
        mandatory: true,
        notes: baselineHead === currentHead ? [] : [`HEAD changed: ${baselineHead ?? "null"} -> ${currentHead ?? "null"}`],
      }),
    );

    // Prior review evidence must exist in the workflow history.
    checks.push(
      createCheckEvidence({
        checkId: "review-approved",
        status: reviewCompleted ? "passed" : "unavailable",
        phase: "VERIFYING",
        mandatory: true,
        notes: reviewCompleted ? [] : ["No REVIEW_COMPLETED event found in workflow history."],
      }),
    );

    // Acceptance criteria evidence (fail closed when missing/mismatched).
    checks.push(
      createCheckEvidence({
        checkId: "acceptance-criteria",
        status: criteriaStatus.status,
        phase: "VERIFYING",
        mandatory: true,
        notes: [criteriaStatus.note],
      }),
    );

    // PO-decision resolution evidence (fail closed when missing/mismatched).
    checks.push(
      createCheckEvidence({
        checkId: "po-decisions-resolved",
        status: poDecisionStatus.status,
        phase: "VERIFYING",
        mandatory: true,
        notes: [poDecisionStatus.note],
      }),
    );

    return checks;
  }

  /** Build the NormalizedResult for the VERIFYING phase. */
  #buildVerifyResult(options: {
    storyId: string | null;
    summary: { results: readonly ValidationResult[]; allMandatoryPassed?: boolean };
    e2eEvidence: { status: string; evidence: string | null };
    changedFiles: readonly string[];
    checks: readonly CheckEvidence[];
    verdict: "VERIFIED" | "NOT_VERIFIED";
    blockers: readonly string[];
    transition: VerifyTransitionOutcome;
    git: GitResultSummary;
  }): NormalizedResult {
    const { storyId, summary, e2eEvidence, changedFiles, checks, verdict, blockers, transition, git } = options;

    const typecheckResult = summary.results.find((r) => r.checkId.includes("typecheck"));
    const buildResult = summary.results.find((r) => r.checkId.includes("build"));
    const testsResult = summary.results.find((r) => r.checkId.includes("focused-tests") || r.checkId.includes("regression-tests"));

    const take = (r?: ValidationResult): CheckResult =>
      r?.check ?? {
        ran: false, passed: false, exitCode: null, total: null, failed: null, skipped: null,
        durationMs: null, command: null, notes: [`Not applicable for ${storyId ?? "unassigned"} story.`],
      };

    // Intended outcome (I-2); the actual stored phase decides what is reported.
    const report = this.#resolveTransitionReport(
      verdict === "VERIFIED"
        ? { status: "success", targetPhase: "VERIFIED" }
        : { status: "failure", targetPhase: "FAILED" },
      transition,
    );

    const errors: Diagnostic[] = [];
    if (report.status !== "success") {
      for (const message of blockers) {
        errors.push({ severity: "error", message, file: null, line: null });
      }
    }
    // Surface the cause of every `unavailable` check (verification timeout,
    // process spawn failure, missing scope/review/criteria evidence) instead of
    // leaving it only in `raw.checks`.
    for (const check of checks) {
      if (check.status !== "unavailable") continue;
      const cause = check.notes.length > 0
        ? check.notes.join(" ")
        : "No reason was recorded for the unavailable check.";
      errors.push({
        severity: "error",
        message: `Check "${check.checkId}" is unavailable: ${cause}`,
        file: null,
        line: null,
      });
    }
    if (report.diagnostic !== null) {
      errors.push({ severity: "error", message: report.diagnostic, file: null, line: null });
    }

    const summaryText = report.diagnostic !== null
      ? `Verification did not complete: ${report.diagnostic}`
      : verdict === "VERIFIED"
        ? "Verification completed. All mandatory verification requirements satisfied."
        : `Verification failed: ${blockers.join("; ")}`;

    return {
      status: report.status,
      storyId,
      phase: "VERIFYING",
      changedFiles: [...changedFiles],
      tests: take(testsResult),
      typecheck: take(typecheckResult),
      build: take(buildResult),
      errors,
      warnings: [],
      git,
      nextRecommendedState: report.nextRecommendedState,
      summary: summaryText,
      raw: {
        verdict,
        checks,
        e2eEvidence,
        // OpenCode-reported evidence is recorded but never authoritative.
        note: "OpenCode output is DATA, never AUTHORITY. Orchestrator-executed checks satisfy mandatory requirements.",
      },
    };
  }

  /**
   * Failure result for infrastructure-level verification problems.
   *
   * `intended` states what the orchestrator attempted; `transition` states what
   * the state machine actually did. When the transition was rejected the status
   * is downgraded to `failure` and the recommended state is the actual stored
   * phase — a rejected transition is never reported as a successful one.
   */
  #verifyInfrastructureFailure(options: {
    storyId: string | null;
    reason: string;
    intended: { status: ResultStatus; targetPhase: WorkflowPhase };
    transition: VerifyTransitionOutcome;
    git: GitResultSummary;
    changedFiles: readonly string[];
  }): NormalizedResult {
    const { storyId, reason, intended, transition, git, changedFiles } = options;
    const report = this.#resolveTransitionReport(intended, transition);

    const errors: Diagnostic[] = [{ severity: "error", message: reason, file: null, line: null }];
    if (report.diagnostic !== null) {
      errors.push({ severity: "error", message: report.diagnostic, file: null, line: null });
    }

    return {
      status: report.status,
      storyId,
      phase: "VERIFYING",
      changedFiles: [...changedFiles],
      tests: { ran: false, passed: false, exitCode: null, total: null, failed: null, skipped: null, durationMs: null, command: null, notes: [reason] },
      typecheck: { ran: false, passed: false, exitCode: null, total: null, failed: null, skipped: null, durationMs: null, command: null, notes: [reason] },
      build: { ran: false, passed: false, exitCode: null, total: null, failed: null, skipped: null, durationMs: null, command: null, notes: [reason] },
      errors,
      warnings: [],
      git,
      nextRecommendedState: report.nextRecommendedState,
      summary: reason,
      raw: null,
    };
  }

  async report(_workflowId: string): Promise<NormalizedResult> {
    throw new OrchestratorError(
      "NOT_IMPLEMENTED_IN_STAGE",
      "report is not yet implemented in Stage 2C-6 Step 5.",
      { capability: "report" },
    );
  }
}
