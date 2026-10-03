/**
 * Stage 2A — Workflow state machine.
 *
 * This module is the safety spine of the orchestrator. It is pure: it declares the
 * lifecycle, declares the legal edges, and refuses illegal transitions. It performs
 * no I/O, spawns nothing, and knows nothing about AI Teacher.
 *
 * LIFECYCLE
 * ---------
 *   REQUESTED
 *     -> PLANNING
 *     -> PLAN_READY
 *     -> WAITING_FOR_APPROVAL
 *     -> BUILDING
 *     -> TESTING
 *     -> REVIEWING
 *     -> VERIFYING
 *     -> VERIFIED
 *
 * TERMINAL / ERROR STATES
 * -----------------------
 *   BLOCKED, FAILED, REJECTED, SCOPE_VIOLATION, PO_DECISION_REQUIRED
 *
 * HARD RULE
 * ---------
 * `PLAN_READY -> BUILDING` is NOT an edge. The only edge into `BUILDING` originates
 * at `WAITING_FOR_APPROVAL` and is only ever driven by the `APPROVAL_GRANTED`
 * trigger, which in turn can only be produced by a recorded human decision
 * (see `approval-gate.ts`). There is no auto-approval path anywhere in this file.
 */

import { InvalidTransitionError, type OrchestratorErrorCode } from "./errors.js";
import type { CheckEvidence } from "./result-parser.js";
import { evaluatePerCheckVerification } from "./result-parser.js";

/** Non-terminal, forward-moving phases. */
export const ACTIVE_PHASES = [
  "REQUESTED",
  "PLANNING",
  "PLAN_READY",
  "WAITING_FOR_APPROVAL",
  "BUILDING",
  "TESTING",
  "REVIEWING",
  "VERIFYING",
  "VERIFIED",
] as const;

export type ActivePhase = (typeof ACTIVE_PHASES)[number];

/** Terminal phases. No outgoing edges exist from any of these. */
export const TERMINAL_PHASES = [
  "BLOCKED",
  "FAILED",
  "REJECTED",
  "SCOPE_VIOLATION",
  "PO_DECISION_REQUIRED",
] as const;

export type TerminalPhase = (typeof TERMINAL_PHASES)[number];

/** Every phase the orchestrator can occupy. */
export type WorkflowPhase = ActivePhase | TerminalPhase;

export const ALL_PHASES: readonly WorkflowPhase[] = [...ACTIVE_PHASES, ...TERMINAL_PHASES];

/** `VERIFIED` is the only success terminal; the other terminals are all failures. */
export const SUCCESS_PHASES: readonly WorkflowPhase[] = ["VERIFIED"];

/**
 * The events that can cause a transition. A trigger is always produced by an
 * explicit, auditable action — never inferred, defaulted, or time-based.
 */
export const TRANSITION_TRIGGERS = [
  // Forward path
  "PLAN_REQUESTED",
  "PLAN_PRODUCED",
  "APPROVAL_REQUESTED",
  /** The ONLY trigger that can enter `BUILDING`. */
  "APPROVAL_GRANTED",
  "BUILD_PRODUCED",
  "TESTS_COMPLETED",
  "REVIEW_COMPLETED",
  "VERIFICATION_COMPLETED",
  // Human / governance
  "APPROVAL_REJECTED",
  "STORY_AMBIGUOUS",
  "DRAFT_ID_COLLISION",
  "SCOPE_VIOLATION_DETECTED",
  "PO_DECISION_REQUIRED",
  "EXTERNAL_BLOCK",
  "GUARD_VIOLATION",
  "HARD_FAILURE",
  // Failure results of the verification chain
  "TESTS_FAILED",
  "REVIEW_FAILED",
  "VERIFICATION_FAILED",
] as const;

export type TransitionTrigger = (typeof TRANSITION_TRIGGERS)[number];

export interface TransitionEdge {
  readonly to: WorkflowPhase;
  readonly triggers: readonly TransitionTrigger[];
}

/**
 * The complete transition graph.
 *
 * Written out explicitly rather than generated so that a reviewer can audit every
 * edge in one place. Any phase missing from `TERMINAL_OUT` has no outgoing edges.
 */
export const TRANSITION_GRAPH: Readonly<Record<WorkflowPhase, readonly TransitionEdge[]>> = {
  REQUESTED: [
    { to: "PLANNING", triggers: ["PLAN_REQUESTED"] },
    { to: "BLOCKED", triggers: ["EXTERNAL_BLOCK", "STORY_AMBIGUOUS", "DRAFT_ID_COLLISION"] },
    { to: "FAILED", triggers: ["HARD_FAILURE"] },
  ],
  PLANNING: [
    { to: "PLAN_READY", triggers: ["PLAN_PRODUCED"] },
    { to: "BLOCKED", triggers: ["EXTERNAL_BLOCK", "STORY_AMBIGUOUS", "DRAFT_ID_COLLISION", "PO_DECISION_REQUIRED"] },
    { to: "SCOPE_VIOLATION", triggers: ["SCOPE_VIOLATION_DETECTED"] },
    { to: "PO_DECISION_REQUIRED", triggers: ["PO_DECISION_REQUIRED"] },
    { to: "FAILED", triggers: ["HARD_FAILURE", "GUARD_VIOLATION"] },
  ],
  PLAN_READY: [
    // NOTE: there is deliberately no edge to BUILDING here.
    { to: "WAITING_FOR_APPROVAL", triggers: ["APPROVAL_REQUESTED"] },
    { to: "BLOCKED", triggers: ["EXTERNAL_BLOCK", "STORY_AMBIGUOUS", "DRAFT_ID_COLLISION"] },
    { to: "SCOPE_VIOLATION", triggers: ["SCOPE_VIOLATION_DETECTED"] },
    { to: "PO_DECISION_REQUIRED", triggers: ["PO_DECISION_REQUIRED"] },
    { to: "FAILED", triggers: ["HARD_FAILURE", "GUARD_VIOLATION"] },
  ],
  WAITING_FOR_APPROVAL: [
    { to: "BUILDING", triggers: ["APPROVAL_GRANTED"] },
    { to: "REJECTED", triggers: ["APPROVAL_REJECTED"] },
    { to: "BLOCKED", triggers: ["EXTERNAL_BLOCK", "STORY_AMBIGUOUS", "DRAFT_ID_COLLISION"] },
    { to: "SCOPE_VIOLATION", triggers: ["SCOPE_VIOLATION_DETECTED"] },
    { to: "PO_DECISION_REQUIRED", triggers: ["PO_DECISION_REQUIRED"] },
    { to: "FAILED", triggers: ["HARD_FAILURE", "GUARD_VIOLATION"] },
  ],
  BUILDING: [
    { to: "TESTING", triggers: ["BUILD_PRODUCED"] },
    { to: "BLOCKED", triggers: ["EXTERNAL_BLOCK"] },
    { to: "SCOPE_VIOLATION", triggers: ["SCOPE_VIOLATION_DETECTED"] },
    { to: "PO_DECISION_REQUIRED", triggers: ["PO_DECISION_REQUIRED"] },
    { to: "FAILED", triggers: ["HARD_FAILURE", "GUARD_VIOLATION", "TESTS_FAILED"] },
  ],
  TESTING: [
    { to: "REVIEWING", triggers: ["TESTS_COMPLETED"] },
    // TEST FAILURE -> NO VERIFIED. There is no edge from TESTING to VERIFYING on failure.
    { to: "FAILED", triggers: ["TESTS_FAILED", "HARD_FAILURE", "GUARD_VIOLATION"] },
    { to: "BLOCKED", triggers: ["EXTERNAL_BLOCK"] },
    { to: "SCOPE_VIOLATION", triggers: ["SCOPE_VIOLATION_DETECTED"] },
    { to: "PO_DECISION_REQUIRED", triggers: ["PO_DECISION_REQUIRED"] },
  ],
  REVIEWING: [
    { to: "VERIFYING", triggers: ["REVIEW_COMPLETED"] },
    // REVIEW FAILURE -> NO VERIFIED.
    { to: "FAILED", triggers: ["REVIEW_FAILED", "HARD_FAILURE", "GUARD_VIOLATION"] },
    { to: "BLOCKED", triggers: ["EXTERNAL_BLOCK"] },
    { to: "SCOPE_VIOLATION", triggers: ["SCOPE_VIOLATION_DETECTED"] },
    { to: "PO_DECISION_REQUIRED", triggers: ["PO_DECISION_REQUIRED"] },
  ],
  VERIFYING: [
    { to: "VERIFIED", triggers: ["VERIFICATION_COMPLETED"] },
    { to: "FAILED", triggers: ["VERIFICATION_FAILED", "HARD_FAILURE", "GUARD_VIOLATION"] },
    { to: "BLOCKED", triggers: ["EXTERNAL_BLOCK"] },
    { to: "SCOPE_VIOLATION", triggers: ["SCOPE_VIOLATION_DETECTED"] },
    { to: "PO_DECISION_REQUIRED", triggers: ["PO_DECISION_REQUIRED"] },
  ],
  VERIFIED: [],
  BLOCKED: [],
  FAILED: [],
  REJECTED: [],
  SCOPE_VIOLATION: [],
  PO_DECISION_REQUIRED: [],
};

export function isActivePhase(value: string): value is ActivePhase {
  return (ACTIVE_PHASES as readonly string[]).includes(value);
}

export function isTerminalPhase(value: string): value is TerminalPhase {
  return (TERMINAL_PHASES as readonly string[]).includes(value);
}

export function isWorkflowPhase(value: string): value is WorkflowPhase {
  return (ALL_PHASES as readonly string[]).includes(value);
}

export function isSuccessPhase(value: WorkflowPhase): boolean {
  return SUCCESS_PHASES.includes(value);
}

export function isTerminalPhaseValue(value: WorkflowPhase): boolean {
  return isTerminalPhase(value);
}

/** Returns the legal edges leaving `phase`. */
export function outgoingEdges(phase: WorkflowPhase): readonly TransitionEdge[] {
  return TRANSITION_GRAPH[phase] ?? [];
}

/** Returns every phase reachable in one legal step. */
export function nextPhases(phase: WorkflowPhase): readonly WorkflowPhase[] {
  return outgoingEdges(phase).map((edge) => edge.to);
}

/** True when `to` is reachable from `from` using `trigger`. */
export function canTransition(from: WorkflowPhase, to: WorkflowPhase, trigger: TransitionTrigger): boolean {
  return outgoingEdges(from).some((edge) => edge.to === to && edge.triggers.includes(trigger));
}

/**
 * Validate a transition, throwing when it is not a legal edge.
 *
 * This is the single choke point every caller must use to move a workflow.
 */
export function assertTransition(from: WorkflowPhase, to: WorkflowPhase, trigger: TransitionTrigger): void {
  if (isTerminalPhaseValue(from)) {
    throw new InvalidTransitionError(
      from,
      to,
      trigger,
      `${from} is terminal and has no outgoing transitions.`,
    );
  }
  if (canTransition(from, to, trigger)) return;

  const legal = nextPhases(from);
  const reason =
    legal.length === 0
      ? `${from} has no outgoing transitions.`
      : `legal targets are [${legal.join(", ")}].`;
  throw new InvalidTransitionError(from, to, trigger, reason);
}

/** Pure transition function. Returns the next phase or throws. */
export function transition(from: WorkflowPhase, to: WorkflowPhase, trigger: TransitionTrigger): WorkflowPhase {
  assertTransition(from, to, trigger);
  return to;
}

/**
 * The only supported reason a workflow may enter `BUILDING`.
 *
 * Encodes NO APPROVAL -> NO BUILD as data, so a future Stage 2B implementation
 * cannot bypass it by constructing the phase directly.
 */
export const ONLY_APPROVED_TRIGGERS: readonly TransitionTrigger[] = ["APPROVAL_GRANTED"];

/** Evidence required before `VERIFIED` may be reached. */
export interface VerificationEvidence {
  /** Target suite must have passed. TEST FAILURE -> NO VERIFIED. */
  readonly testsPassed: boolean;
  /** Review must have approved. REVIEW FAILURE -> NO VERIFIED. */
  readonly reviewApproved: boolean;
  /** Any entry stops the workflow. UNAUTHORIZED FILE -> STOP. */
  readonly guardViolations: readonly string[];
  /** Typecheck must have passed when the story touches TypeScript. */
  readonly typecheckPassed: boolean;
  /**
   * Stage 2C extension: per-check evidence model.
   *
   * When present, this is the authoritative evidence model. The boolean fields
   * above are derived from this model for backward compatibility.
   */
  readonly checks?: readonly CheckEvidence[];
}

export interface GateDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly stopWith: WorkflowPhase | null;
  readonly errorCode: OrchestratorErrorCode | null;
}

/**
 * Evaluate whether `VERIFIED` may be entered.
 *
 * Pure function. Stage 2A never calls it, but it exists now so the safety rule is
 * designed rather than retrofitted.
 *
 * Stage 2C extension: When per-check evidence is present, it is the authoritative
 * evidence model. The boolean fields are derived from it for backward compatibility.
 */
export function evaluateVerification(evidence: VerificationEvidence): GateDecision {
  // Stage 2C: Use per-check evidence when available
  if (evidence.checks !== undefined && evidence.checks.length > 0) {
    return evaluatePerCheckGateDecision(evidence.checks);
  }

  // Stage 2A/2B: Use boolean evidence model
  if (evidence.guardViolations.length > 0) {
    return {
      allowed: false,
      reason: `Git guard reported ${evidence.guardViolations.length} unauthorized change(s).`,
      stopWith: "FAILED",
      errorCode: "GUARD_VIOLATION",
    };
  }
  if (!evidence.testsPassed) {
    return {
      allowed: false,
      reason: "Tests did not pass. TEST FAILURE -> NO VERIFIED.",
      stopWith: "FAILED",
      errorCode: "TEST_FAILURE",
    };
  }
  if (!evidence.reviewApproved) {
    return {
      allowed: false,
      reason: "Review did not approve. REVIEW FAILURE -> NO VERIFIED.",
      stopWith: "FAILED",
      errorCode: "REVIEW_FAILURE",
    };
  }
  if (!evidence.typecheckPassed) {
    return {
      allowed: false,
      reason: "Typecheck did not pass.",
      stopWith: "FAILED",
      errorCode: "VERIFICATION_FAILURE",
    };
  }
  return {
    allowed: true,
    reason: "All verification evidence is green.",
    stopWith: null,
    errorCode: null,
  };
}

/**
 * Convert per-check evidence to a GateDecision.
 *
 * Stage 2C extension. Uses the per-check evidence model to produce a gate decision.
 */
function evaluatePerCheckGateDecision(checks: readonly CheckEvidence[]): GateDecision {
  const result = evaluatePerCheckVerification(checks);

  if (result.verdict === "VERIFIED") {
    return {
      allowed: true,
      reason: "All verification evidence is green.",
      stopWith: null,
      errorCode: null,
    };
  }

  return {
    allowed: false,
    reason: result.blockers.join("; "),
    stopWith: "FAILED",
    errorCode: "VERIFICATION_FAILURE",
  };
}

/** Compact, printable description of the state machine for `orchestrator status`. */
export interface StateMachineSummary {
  readonly phases: readonly WorkflowPhase[];
  readonly activePhases: readonly ActivePhase[];
  readonly terminalPhases: readonly TerminalPhase[];
  readonly successPhases: readonly WorkflowPhase[];
  readonly edges: readonly { readonly from: WorkflowPhase; readonly to: WorkflowPhase; readonly triggers: readonly TransitionTrigger[] }[];
  readonly buildRequiresApproval: true;
}

export function describeStateMachine(): StateMachineSummary {
  const edges: { from: WorkflowPhase; to: WorkflowPhase; triggers: readonly TransitionTrigger[] }[] = [];
  for (const from of ALL_PHASES) {
    for (const edge of outgoingEdges(from)) {
      edges.push({ from, to: edge.to, triggers: edge.triggers });
    }
  }
  return {
    phases: ALL_PHASES,
    activePhases: ACTIVE_PHASES,
    terminalPhases: TERMINAL_PHASES,
    successPhases: SUCCESS_PHASES,
    edges,
    buildRequiresApproval: true,
  };
}
