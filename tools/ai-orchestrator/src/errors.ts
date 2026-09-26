/**
 * Stage 2A — Orchestrator error types.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The proposed Stage 2A file list did not include a shared error module, but the
 * "not implemented in Stage 2A" signal is raised by the OpenCode adapter, the git
 * guard, the story resolver, the result parser, the orchestrator service, and the
 * workflow state machine. Declaring it once here avoids five divergent copies and
 * avoids a circular import between `orchestrator.ts` and its own dependencies.
 * This is the only intentional addition to the proposed structure.
 *
 * The orchestrator is development automation infrastructure. These types carry
 * process/governance failures only. They never carry AI Teacher product behavior.
 */

/** Stable, machine-readable classification for every orchestrator failure. */
export type OrchestratorErrorCode =
  | "USAGE_ERROR"
  | "CONFIG_INVALID"
  | "NOT_IMPLEMENTED_IN_STAGE"
  | "OPENCODE_EXECUTABLE_UNRESOLVED"
  | "OPENCODE_SESSION_UNAVAILABLE"
  | "INVALID_TRANSITION"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_REJECTED"
  | "STORY_AMBIGUOUS"
  | "STORY_COLLISION"
  | "STORY_RETIRED"
  | "STORY_NOT_FOUND"
  | "SCOPE_VIOLATION"
  | "PO_DECISION_REQUIRED"
  | "GUARD_VIOLATION"
  | "TEST_FAILURE"
  | "REVIEW_FAILURE"
  | "VERIFICATION_FAILURE";

/** Base class for all orchestrator failures. */
export class OrchestratorError extends Error {
  readonly code: OrchestratorErrorCode;
  readonly details: Readonly<Record<string, string>>;

  constructor(
    code: OrchestratorErrorCode,
    message: string,
    details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * Raised by every capability that is deliberately not built yet.
 *
 * Stage 2A is architecture and skeleton only. A stub must fail loudly and
 * explicitly rather than silently no-op, so that no caller can mistake an
 * unimplemented capability for a successful run.
 */
export class NotImplementedInStageError extends OrchestratorError {
  readonly capability: string;
  readonly stage: string;

  constructor(capability: string, stage: string, plannedStage: string) {
    super(
      "NOT_IMPLEMENTED_IN_STAGE",
      `Capability "${capability}" is not implemented in ${stage}. It is planned for ${plannedStage}.`,
      { capability, stage, plannedStage },
    );
    this.name = "NotImplementedInStageError";
    this.capability = capability;
    this.stage = stage;
  }
}

/** Raised when a requested workflow transition is not a legal edge of the state machine. */
export class InvalidTransitionError extends OrchestratorError {
  readonly from: string;
  readonly to: string;
  readonly trigger: string;

  constructor(from: string, to: string, trigger: string, reason: string) {
    super("INVALID_TRANSITION", `Illegal transition ${from} -> ${to} (${trigger}): ${reason}`, {
      from,
      to,
      trigger,
      reason,
    });
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
    this.trigger = trigger;
  }
}

/**
 * Raised whenever work would start without a recorded human approval.
 *
 * This is the single most important safety boundary in the orchestrator:
 * NO APPROVAL -> NO BUILD.
 */
export class ApprovalRequiredError extends OrchestratorError {
  constructor(reason: string, details: Readonly<Record<string, string>> = {}) {
    super("APPROVAL_REQUIRED", reason, details);
    this.name = "ApprovalRequiredError";
  }
}

/** Raised when a human explicitly rejected a plan, story, or workflow. */
export class ApprovalRejectedError extends OrchestratorError {
  constructor(reason: string, details: Readonly<Record<string, string>> = {}) {
    super("APPROVAL_REJECTED", reason, details);
    this.name = "ApprovalRejectedError";
  }
}

/**
 * Raised when the OpenCode CLI cannot be resolved to a natively spawnable
 * executable. The orchestrator refuses to fall back to a shell.
 */
export class OpenCodeExecutableUnresolvedError extends OrchestratorError {
  readonly hint: string;

  constructor(reason: string, hint: string) {
    super("OPENCODE_EXECUTABLE_UNRESOLVED", reason, { hint });
    this.name = "OpenCodeExecutableUnresolvedError";
    this.hint = hint;
  }
}

/**
 * Raised when a session-continuing operation is attempted without a usable
 * OpenCode session id. The adapter never invents one.
 */
export class OpenCodeSessionUnavailableError extends OrchestratorError {
  constructor(message: string, details: Readonly<Record<string, string>> = {}) {
    super("OPENCODE_SESSION_UNAVAILABLE", message, details);
    this.name = "OpenCodeSessionUnavailableError";
  }
}

/** Raised when the git guard detects unauthorized or unsafe repository changes. */export class GuardViolationError extends OrchestratorError {
  readonly unauthorizedPaths: readonly string[];

  constructor(reason: string, unauthorizedPaths: readonly string[] = []) {
    super("GUARD_VIOLATION", reason, { count: String(unauthorizedPaths.length) });
    this.name = "GuardViolationError";
    this.unauthorizedPaths = Object.freeze([...unauthorizedPaths]);
  }
}
