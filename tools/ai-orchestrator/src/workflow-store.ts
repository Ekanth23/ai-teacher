/**
 * Stage 2C — In-memory workflow run storage.
 *
 * PURPOSE
 * -------
 * Provide the in-memory store for workflow runs. This is the single place where
 * workflow state is created, advanced, and audited. It enforces the state machine
 * graph and records every transition as an auditable event.
 *
 * PD-1: Workflow state is kept in memory. No persistence to `state/` is
 * implemented. A crash loses the run.
 *
 * PO DECISION 3 (APPROVED): From `PLANNING`, the `PO_DECISION_REQUIRED` trigger
 * MUST transition to `PO_DECISION_REQUIRED`, not `BLOCKED`. The underlying
 * `workflow.ts` graph lists this trigger in both edges; this store implements
 * the approved routing decision (Alternative B).
 */

import { TERMINAL_PHASES, transition, type WorkflowPhase, type TransitionTrigger } from "./workflow.js";
import { WorkflowNotFoundError } from "./errors.js";
import { isHumanPoActor, type WorkflowWaiver } from "./result-parser.js";
import type { GuardScope } from "./git-guard.js";

/** Persisted, approved scope for a workflow run. */
export interface ApprovedScopeRecord {
  readonly workflowId: string;
  readonly scope: GuardScope;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

/** Persisted acceptance-criteria evidence for a workflow run. */
export interface AcceptanceCriteriaRecord {
  readonly workflowId: string;
  readonly storyId: string;
  /** True only when every applicable acceptance criterion is satisfied. */
  readonly satisfied: boolean;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly reference: string;
}

/** Persisted PO-decision resolution evidence for a workflow run. */
export interface PoDecisionRecord {
  readonly workflowId: string;
  readonly storyId: string;
  /** True only when every applicable PO decision is resolved/approved. */
  readonly resolved: boolean;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly reference: string;
}

/** Evidence persisted on the workflow run for verification inputs. */
export interface RunEvidence {
  readonly approvedScope?: ApprovedScopeRecord;
  readonly acceptanceCriteria?: AcceptanceCriteriaRecord;
  readonly poDecisions?: PoDecisionRecord;
}

/**
 * Audit-trail kind for a `WorkflowEvent`.
 *
 * `transition` is an ordinary state-machine event. The two waiver kinds are
 * auditable waiver operations (Revision 19 Decision 3) and are NOT transitions:
 * they carry no trigger and never change a run's phase.
 */
export type WorkflowEventKind = "transition" | "waiver-grant" | "waiver-revocation";

/**
 * Auditable payload for a waiver grant/revocation entry (Rev 19 Decision 3).
 *
 * The granting/revoking actor and the timestamp live on the `WorkflowEvent`
 * itself (`actor`, `at`). This payload carries the check id, the phase, the
 * grant reason, and — for a revocation — the granting actor the revocation
 * matched (PD-9 grantor-only rule).
 */
export interface WorkflowWaiverAudit {
  readonly checkId: string;
  readonly phase: WorkflowPhase;
  /** Grant reason. `null` on revocation entries. */
  readonly reason: string | null;
  /** Revocation only: the granting actor this revocation matched (PD-9). */
  readonly grantedBy: string | null;
}

/** A recorded workflow event for audit trail. */
export interface WorkflowEvent {
  /** `transition` for state-machine events; waiver kinds for waiver operations. */
  readonly kind: WorkflowEventKind;
  readonly from: WorkflowPhase;
  readonly to: WorkflowPhase;
  /** `null` for waiver events: a waiver is not a transition trigger. */
  readonly trigger: TransitionTrigger | null;
  readonly at: string;
  /** Acting actor: the PO who granted or revoked the waiver. */
  readonly actor: string;
  readonly note: string | null;
  /** Non-null only for `waiver-grant` / `waiver-revocation` events. */
  readonly waiver: WorkflowWaiverAudit | null;
}

/** An event as supplied by a caller; the store stamps `at` and defaults. */
export type WorkflowEventInput = Omit<WorkflowEvent, "at" | "note" | "kind" | "waiver"> & {
  readonly kind?: WorkflowEventKind;
  readonly note?: string | null;
  readonly waiver?: WorkflowWaiverAudit | null;
};

/** In-memory representation of one workflow run. */
export interface WorkflowRun {
  readonly id: string;
  readonly storyId: string | null;
  readonly phase: WorkflowPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: readonly WorkflowEvent[];
  /** Persisted approval/verification evidence for this run. */
  readonly evidence: RunEvidence;
  /**
   * PO-recorded waivers held by this run. At most one record exists per
   * `(checkId, phase)` pair; a re-grant after revocation replaces the revoked
   * record, and the earlier grant/revocation stay in `history`.
   */
  readonly waivers: readonly WorkflowWaiver[];
}

/** Request to grant a PO waiver for exactly one check in one phase (PD-10). */
export interface GrantWaiverRequest {
  readonly checkId: string;
  readonly phase: WorkflowPhase;
  readonly actor: string;
  readonly reason: string;
}

/** Request to revoke a PO waiver. Only the granting actor may do so (PD-9). */
export interface RevokeWaiverRequest {
  readonly checkId: string;
  readonly phase: WorkflowPhase;
  readonly actor: string;
}

/** Outcome of a waiver grant/revocation attempt. */
export interface WaiverOperationResult {
  /** True only when the waiver was actually granted/revoked. */
  readonly ok: boolean;
  /** The stored waiver on success; `null` when the attempt was rejected. */
  readonly waiver: WorkflowWaiver | null;
  /** Why the attempt was rejected; `null` on success. */
  readonly reason: string | null;
}

/** Request to create a new workflow run. */
export interface CreateRunRequest {
  readonly storyId: string | null;
  readonly requestedBy: string;
  readonly intent: string;
}

/** Request to advance a workflow run to a new phase. */
export interface AdvanceRequest {
  readonly to: WorkflowPhase;
  readonly trigger: TransitionTrigger;
  readonly actor: string;
  readonly note?: string;
}

/** In-memory workflow store. */
export interface WorkflowStore {
  create(request: CreateRunRequest): WorkflowRun;
  get(workflowId: string): WorkflowRun | null;
  advance(workflowId: string, request: AdvanceRequest): WorkflowRun;
  recordEvent(workflowId: string, event: WorkflowEventInput): WorkflowRun;
  /** Merge persisted evidence (approved scope, criteria, PO decisions) onto a run. */
  recordEvidence(workflowId: string, evidence: RunEvidence): WorkflowRun;
  /**
   * Grant a PO waiver for exactly one check in one phase (PD-10) and record an
   * auditable waiver-grant event. Rejected attempts record nothing.
   */
  grantWaiver(workflowId: string, request: GrantWaiverRequest): WaiverOperationResult;
  /**
   * Revoke a PO waiver. Only the granting actor may revoke it (PD-9), and a
   * successful revocation records an auditable waiver-revocation event.
   * Rejected attempts record nothing.
   */
  revokeWaiver(workflowId: string, request: RevokeWaiverRequest): WaiverOperationResult;
  all(): readonly WorkflowRun[];
}

/**
 * Generate a unique workflow ID.
 *
 * Uses a monotonically increasing counter combined with a timestamp to ensure
 * uniqueness within a single process lifetime. Not a credential.
 */
let runCounter = 0;
function generateWorkflowId(): string {
  runCounter += 1;
  const timestamp = Date.now().toString(36);
  return `wf-${timestamp}-${runCounter.toString(36).padStart(4, "0")}`;
}

/**
 * Resolve the effective target phase for a transition, implementing the
 * approved PO Decision 3 routing.
 *
 * From `PLANNING`, the `PO_DECISION_REQUIRED` trigger MUST route to
 * `PO_DECISION_REQUIRED`, not `BLOCKED`. This is the approved Alternative B.
 */
function resolveEffectiveTarget(
  from: WorkflowPhase,
  to: WorkflowPhase,
  trigger: TransitionTrigger,
): WorkflowPhase {
  if (from === "PLANNING" && trigger === "PO_DECISION_REQUIRED") {
    return "PO_DECISION_REQUIRED";
  }
  return to;
}

/**
 * In-memory workflow store implementation.
 *
 * All state is held in a Map. No persistence. A crash loses all runs.
 */
export class InMemoryWorkflowStore implements WorkflowStore {
  readonly #runs = new Map<string, WorkflowRun>();

  create(request: CreateRunRequest): WorkflowRun {
    const now = new Date().toISOString();
    const run: WorkflowRun = {
      id: generateWorkflowId(),
      storyId: request.storyId,
      phase: "REQUESTED",
      createdAt: now,
      updatedAt: now,
      history: [],
      evidence: {},
      waivers: [],
    };
    this.#runs.set(run.id, run);
    return run;
  }

  get(workflowId: string): WorkflowRun | null {
    return this.#runs.get(workflowId) ?? null;
  }

  advance(workflowId: string, request: AdvanceRequest): WorkflowRun {
    const existing = this.#runs.get(workflowId);
    if (existing === undefined) {
      throw new WorkflowNotFoundError(workflowId);
    }

    const effectiveTarget = resolveEffectiveTarget(existing.phase, request.to, request.trigger);
    const newPhase = transition(existing.phase, effectiveTarget, request.trigger);

    const now = new Date().toISOString();
    const event: WorkflowEvent = {
      kind: "transition",
      from: existing.phase,
      to: newPhase,
      trigger: request.trigger,
      at: now,
      actor: request.actor,
      note: request.note ?? null,
      waiver: null,
    };

    const updated: WorkflowRun = {
      ...existing,
      phase: newPhase,
      updatedAt: now,
      history: [...existing.history, event],
    };

    this.#runs.set(workflowId, updated);
    return updated;
  }

  recordEvent(workflowId: string, event: WorkflowEventInput): WorkflowRun {
    const existing = this.#runs.get(workflowId);
    if (existing === undefined) {
      throw new WorkflowNotFoundError(workflowId);
    }

    const now = new Date().toISOString();
    const fullEvent: WorkflowEvent = {
      kind: event.kind ?? "transition",
      from: event.from,
      to: event.to,
      trigger: event.trigger,
      at: now,
      actor: event.actor,
      note: event.note ?? null,
      waiver: event.waiver ?? null,
    };

    const updated: WorkflowRun = {
      ...existing,
      updatedAt: now,
      history: [...existing.history, fullEvent],
    };

    this.#runs.set(workflowId, updated);
    return updated;
  }

  recordEvidence(workflowId: string, evidence: RunEvidence): WorkflowRun {
    const existing = this.#runs.get(workflowId);
    if (existing === undefined) {
      throw new WorkflowNotFoundError(workflowId);
    }

    const updated: WorkflowRun = {
      ...existing,
      updatedAt: new Date().toISOString(),
      evidence: { ...existing.evidence, ...evidence },
    };

    this.#runs.set(workflowId, updated);
    return updated;
  }

  all(): readonly WorkflowRun[] {
    return [...this.#runs.values()];
  }

  /**
   * Grant a PO waiver for exactly one check in one phase (PD-10) and append an
   * auditable waiver-grant event (Rev 19 Decision 3).
   *
   * The waiver record and its event are written in a single map update, so no
   * caller can observe one without the other. Every rejection returns before
   * anything is constructed or written: a rejected attempt leaves the waiver
   * ledger, the event history and `updatedAt` untouched, and records nothing.
   */
  grantWaiver(workflowId: string, request: GrantWaiverRequest): WaiverOperationResult {
    const existing = this.#runs.get(workflowId);
    if (existing === undefined) {
      throw new WorkflowNotFoundError(workflowId);
    }

    if ((TERMINAL_PHASES as readonly string[]).includes(existing.phase)) {
      return reject(`Workflow run is terminal (${existing.phase}); waivers are invalid once the run ends.`);
    }

    if (!isHumanPoActor(request.actor)) {
      return reject(`Waiver actor "${request.actor}" is not a human PO.`);
    }

    if (request.reason.trim().length === 0) {
      return reject("A waiver requires a non-empty reason.");
    }

    const existingRecord = existing.waivers.find(
      (w) => w.checkId === request.checkId && w.phase === request.phase,
    );
    if (existingRecord !== undefined && existingRecord.revokedBy === null) {
      return reject(
        `An active waiver already exists for "${request.checkId}" @ ${request.phase} (PD-10). Revoke it before granting another.`,
      );
    }

    const now = new Date().toISOString();
    const waiver: WorkflowWaiver = {
      checkId: request.checkId,
      phase: request.phase,
      actor: request.actor,
      reason: request.reason,
      grantedAt: now,
      revokedBy: null,
      revokedAt: null,
    };

    // A re-grant after revocation replaces the revoked record; the ledger keeps
    // at most one record per (checkId, phase) so source precedence stays
    // deterministic. Earlier grants/revocations remain in `history`.
    const waivers = [
      ...existing.waivers.filter((w) => !(w.checkId === request.checkId && w.phase === request.phase)),
      waiver,
    ];

    const event: WorkflowEvent = {
      kind: "waiver-grant",
      from: existing.phase,
      to: existing.phase,
      trigger: null,
      at: now,
      actor: request.actor,
      note: `Waiver granted for "${request.checkId}" @ ${request.phase}: ${request.reason}`,
      waiver: { checkId: request.checkId, phase: request.phase, reason: request.reason, grantedBy: null },
    };

    this.#runs.set(workflowId, {
      ...existing,
      updatedAt: now,
      waivers,
      history: [...existing.history, event],
    });

    return { ok: true, waiver, reason: null };
  }

  /**
   * Revoke a PO waiver and append an auditable waiver-revocation event
   * (Rev 19 Decision 3, PD-9).
   *
   * Only the granting actor may revoke; any other actor is rejected and the
   * waiver stays valid. As with `grantWaiver`, the record update and the event
   * land in a single map write, and rejections write nothing at all.
   */
  revokeWaiver(workflowId: string, request: RevokeWaiverRequest): WaiverOperationResult {
    const existing = this.#runs.get(workflowId);
    if (existing === undefined) {
      throw new WorkflowNotFoundError(workflowId);
    }

    if ((TERMINAL_PHASES as readonly string[]).includes(existing.phase)) {
      return reject(`Workflow run is terminal (${existing.phase}); waivers are invalid once the run ends.`);
    }

    if (!isHumanPoActor(request.actor)) {
      return reject(`Waiver actor "${request.actor}" is not a human PO.`);
    }

    const record = existing.waivers.find((w) => w.checkId === request.checkId && w.phase === request.phase);
    if (record === undefined) {
      return reject(`No waiver exists for "${request.checkId}" @ ${request.phase}.`);
    }

    if (record.revokedBy !== null) {
      return reject(`Waiver for "${request.checkId}" @ ${request.phase} was already revoked by "${record.revokedBy}".`);
    }

    if (record.actor !== request.actor) {
      // PD-9: only the granting actor may revoke. The waiver stays valid.
      return reject(
        `Only the granting actor "${record.actor}" may revoke this waiver; "${request.actor}" may not. The waiver remains valid.`,
      );
    }

    const now = new Date().toISOString();
    const waiver: WorkflowWaiver = { ...record, revokedBy: request.actor, revokedAt: now };

    const event: WorkflowEvent = {
      kind: "waiver-revocation",
      from: existing.phase,
      to: existing.phase,
      trigger: null,
      at: now,
      actor: request.actor,
      note: `Waiver revoked for "${request.checkId}" @ ${request.phase}.`,
      waiver: { checkId: request.checkId, phase: request.phase, reason: null, grantedBy: record.actor },
    };

    this.#runs.set(workflowId, {
      ...existing,
      updatedAt: now,
      waivers: existing.waivers.map((w) => (w === record ? waiver : w)),
      history: [...existing.history, event],
    });

    return { ok: true, waiver, reason: null };
  }
}

/** Rejection result for a refused waiver operation. Records nothing. */
function reject(reason: string): WaiverOperationResult {
  return { ok: false, waiver: null, reason };
}

/**
 * Factory for the default workflow store.
 */
export function createWorkflowStore(): WorkflowStore {
  return new InMemoryWorkflowStore();
}
