/**
 * Stage 2A — Human approval boundary.
 *
 * THIS IS THE MOST IMPORTANT SAFETY FILE IN THE ORCHESTRATOR.
 *
 * Contract:
 *   NO APPROVAL -> NO BUILD.
 *
 * The `ApprovalGate` interface below deliberately has NO `autoApprove`, NO
 * `approveOnTimeout`, NO `defaultToApproved`, and NO non-interactive bypass member.
 * Adding one would be a breaking change to this architecture and must be rejected
 * in review. Plans are approved by a human (the PO) and by nothing else.
 *
 * Stage 2A implements no I/O here: the gate is an in-memory boundary. Recording an
 * approval durably is Stage 2B work.
 */

import { ApprovalRejectedError, ApprovalRequiredError } from "./errors.js";
import type { WorkflowPhase } from "./workflow.js";

/** The three approval states, named exactly as the Stage 2A specification requires. */
export type ApprovalDecision = "ApprovalRequired" | "ApprovalGranted" | "ApprovalRejected";

export const APPROVAL_DECISIONS: readonly ApprovalDecision[] = [
  "ApprovalRequired",
  "ApprovalGranted",
  "ApprovalRejected",
];

export function isApprovalDecision(value: string): value is ApprovalDecision {
  return (APPROVAL_DECISIONS as readonly string[]).includes(value);
}

/** Who/what asked for approval. Never auto-populated with an agent identity. */
export type ApprovalActorKind = "human" | "po" | "chatgpt-po";

export interface ApprovalActor {
  readonly kind: ApprovalActorKind;
  /** Opaque identifier supplied by the human operator. No credentials, ever. */
  readonly id: string;
  readonly displayName?: string;
}

export interface ApprovalRequest {
  readonly workflowId: string;
  readonly storyId: string | null;
  /** Where the plan can be read. Stage 2A records a reference, not plan content. */
  readonly planReference: string;
  readonly requestedAt: string;
  readonly summary: string;
}

export interface ApprovalRecord {
  readonly workflowId: string;
  readonly storyId: string | null;
  readonly decision: ApprovalDecision;
  readonly actor: ApprovalActor;
  readonly decidedAt: string;
  readonly note?: string;
}

/** Result of asking the gate whether work may start. */
export interface ApprovalGateVerdict {
  readonly allowed: boolean;
  readonly reason: string;
  readonly blockingPhase: WorkflowPhase | null;
}

export interface ApprovalGate {
  /** Raise the approval request. Moves nothing by itself. */
  request(request: ApprovalRequest): ApprovalRecord;
  /**
   * Record an explicit human decision. The only way to produce `ApprovalGranted`.
   * `stage`/`reason` are free-text provenance for the run log.
   */
  decide(workflowId: string, decision: ApprovalDecision, actor: ApprovalActor, note?: string): ApprovalRecord;
  /** Current record, or null when the workflow was never submitted for approval. */
  current(workflowId: string): ApprovalRecord | null;
  /**
   * The authoritative check. Returns a verdict; never mutates state.
   * Throws only for a malformed request.
   */
  assertBuildMayStart(workflowId: string, phase: WorkflowPhase): ApprovalGateVerdict;
}

/** Result of a gate evaluation, expressed without throwing so callers can report it. */
export interface ApprovalVerdict extends ApprovalGateVerdict {}

/**
 * Pure, in-memory Stage 2A gate.
 *
 * It exists to make the boundary testable and to guarantee that the *only* legal
 * route from `WAITING_FOR_APPROVAL` to `BUILDING` is a recorded human grant.
 */
export class InMemoryApprovalGate implements ApprovalGate {
  readonly #records = new Map<string, ApprovalRecord>();

  request(request: ApprovalRequest): ApprovalRecord {
    if (request.workflowId.trim() === "") {
      throw new ApprovalRequiredError("Approval request requires a workflow id.");
    }
    const pending: ApprovalRecord = {
      workflowId: request.workflowId,
      storyId: request.storyId,
      decision: "ApprovalRequired",
      actor: { kind: "human", id: "unassigned" },
      decidedAt: request.requestedAt,
      note: request.summary,
    };
    this.#records.set(request.workflowId, pending);
    return pending;
  }

  decide(workflowId: string, decision: ApprovalDecision, actor: ApprovalActor, note?: string): ApprovalRecord {
    if (actor.kind !== "human" && actor.kind !== "po" && actor.kind !== "chatgpt-po") {
      throw new ApprovalRequiredError("Only a human or PO actor may decide an approval.");
    }
    const existing = this.#records.get(workflowId);
    if (existing === undefined) {
      throw new ApprovalRequiredError(`No approval request exists for workflow "${workflowId}".`);
    }
    const decidedAt = new Date().toISOString();
    const record: ApprovalRecord = {
      workflowId,
      storyId: existing.storyId,
      decision,
      actor,
      decidedAt,
      ...(note === undefined ? {} : { note }),
    };
    this.#records.set(workflowId, record);
    return record;
  }

  current(workflowId: string): ApprovalRecord | null {
    return this.#records.get(workflowId) ?? null;
  }

  assertBuildMayStart(workflowId: string, phase: WorkflowPhase): ApprovalGateVerdict {
    return evaluateBuildPermission(phase, this.current(workflowId));
  }
}

/**
 * The single authorization function for starting build work.
 *
 * Pure. Stage 2A does not call it during any command, but every future caller must.
 */
export function evaluateBuildPermission(
  phase: WorkflowPhase,
  record: ApprovalRecord | null,
): ApprovalGateVerdict {
  if (phase === "BUILDING" || phase === "TESTING" || phase === "REVIEWING" || phase === "VERIFYING" || phase === "VERIFIED") {
    // Downstream phases can only be reached through BUILDING, which already
    // required approval. Reaching one of them without a grant is a violation.
    if (record?.decision !== "ApprovalGranted") {
      return {
        allowed: false,
        reason: `Phase ${phase} requires a recorded ApprovalGranted decision. NONE FOUND.`,
        blockingPhase: "WAITING_FOR_APPROVAL",
      };
    }
    return { allowed: true, reason: "Approved plan; work may proceed.", blockingPhase: null };
  }

  if (phase !== "WAITING_FOR_APPROVAL") {
    return {
      allowed: false,
      reason: `Build cannot start from phase ${phase}. The workflow must be WAITING_FOR_APPROVAL.`,
      blockingPhase: "WAITING_FOR_APPROVAL",
    };
  }

  if (record === null) {
    return {
      allowed: false,
      reason: "No approval record exists. NO APPROVAL -> NO BUILD.",
      blockingPhase: "WAITING_FOR_APPROVAL",
    };
  }

  switch (record.decision) {
    case "ApprovalGranted":
      return { allowed: true, reason: "Approval was explicitly granted by a human.", blockingPhase: null };
    case "ApprovalRejected":
      return {
        allowed: false,
        reason: "Approval was explicitly rejected by a human.",
        blockingPhase: "REJECTED",
      };
    case "ApprovalRequired":
    default:
      return {
        allowed: false,
        reason: "Approval is still pending. NO APPROVAL -> NO BUILD.",
        blockingPhase: "WAITING_FOR_APPROVAL",
      };
  }
}

/** Throwing convenience wrapper for callers that prefer an exception to a verdict. */
export function assertApprovalToBuild(phase: WorkflowPhase, record: ApprovalRecord | null): void {
  const verdict = evaluateBuildPermission(phase, record);
  if (verdict.allowed) return;
  if (verdict.blockingPhase === "REJECTED") {
    throw new ApprovalRejectedError(verdict.reason);
  }
  throw new ApprovalRequiredError(verdict.reason);
}

/** Documented non-goals. Present as code so a reviewer can see the omissions. */
export const APPROVAL_GATE_NON_GOALS: readonly string[] = [
  "No automatic approval.",
  "No timeout-based approval.",
  "No non-interactive / unattended approval.",
  "No environment variable that can grant approval.",
  "No agent identity that may grant approval.",
  "No plan auto-advance from PLAN_READY to BUILDING.",
];
