/**
 * Stage 2A — OpenCode adapter boundary.
 *
 * PURPOSE
 * -------
 * Establish the seam between the orchestrator and OpenCode so Stage 2B can
 * implement invocation WITHOUT redesigning the orchestrator. Everything the
 * orchestrator will ever need from OpenCode is declared here as an interface.
 *
 * STAGE 2A HARD RULE
 * ------------------
 * Every method in this module throws `NotImplementedInStageError`. This module:
 *   - never runs `opencode run`
 *   - never runs `opencode serve`
 *   - never spawns any child process
 *   - never performs a network request (it does not even import an HTTP client)
 *
 * Stage 1 governance lives in `.opencode/ai-workflow-rules.md` and remains
 * authoritative. This adapter is a *transport*, not a second rule set. The
 * adapter must not restate, reinterpret, or compete with Stage 1 rules.
 */

import type { OpenCodeAdapterConfig } from "./config.js";
import { NotImplementedInStageError, OrchestratorError } from "./errors.js";

/** Stage that is expected to implement each adapter capability. */
export const ADAPTER_PLANNED_STAGE = "Stage 2B" as const;

/** Which Stage 1 command an invocation corresponds to. */
export type OpenCodeCommandName = "ai-plan" | "ai-build" | "ai-test" | "ai-review" | "ai-verify";

export const OPENCODE_COMMAND_NAMES: readonly OpenCodeCommandName[] = [
  "ai-plan",
  "ai-build",
  "ai-test",
  "ai-review",
  "ai-verify",
];

/** Opaque handle to an OpenCode session. Contains no credentials. */
export interface OpenCodeSessionRef {
  readonly sessionId: string;
  readonly providerSessionId: string;
  readonly createdForStoryId: string | null;
  readonly startedAt: string;
}

export interface CreateSessionRequest {
  readonly storyId: string | null;
  readonly command: OpenCodeCommandName;
  /** A path/reference to a prepared context package. Stage 2A prepares none. */
  readonly contextPackageReference: string | null;
  readonly workingDirectory: string;
}

export interface ContinueSessionRequest {
  readonly command: OpenCodeCommandName;
  /** Free-text instruction. Must not restate or invent product decisions. */
  readonly instruction: string;
}

export interface RunCommandRequest extends ContinueSessionRequest {
  /** Additional CLI arguments, validated by Stage 2B. Not interpreted in Stage 2A. */
  readonly args?: readonly string[];
}

export interface OpenCodeUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly modelId: string | null;
}

export interface OpenCodeTurnResult {
  readonly session: OpenCodeSessionRef;
  readonly command: OpenCodeCommandName;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly usage: OpenCodeUsage;
  readonly durationMs: number | null;
  readonly completed: boolean;
}

/**
 * The complete surface the orchestrator requires from OpenCode.
 *
 * Stage 2B implements this against either the OpenCode CLI or a local OpenCode
 * server. The orchestrator depends only on this interface, never on a concrete
 * transport.
 */
export interface OpenCodeClient {
  /** Start a fresh OpenCode session for a planning (or downstream) command. */
  createSession(request: CreateSessionRequest): Promise<OpenCodeSessionRef>;
  /** Continue an existing session with more instruction. */
  continueSession(session: OpenCodeSessionRef, request: ContinueSessionRequest): Promise<OpenCodeTurnResult>;
  /** Run a Stage 1 workflow command through OpenCode. */
  runCommand(session: OpenCodeSessionRef, request: RunCommandRequest): Promise<OpenCodeTurnResult>;
  /** Collect the normalized raw payload for later parsing by `result-parser.ts`. */
  collectResult(session: OpenCodeSessionRef): Promise<unknown>;
  /** Release the session/transport. Never mutates repository state. */
  dispose(session: OpenCodeSessionRef): Promise<void>;
}

export interface OpenCodeAdapterCapabilities {
  readonly implemented: false;
  readonly canCreateSession: false;
  readonly canContinueSession: false;
  readonly canRunCommand: false;
  readonly canCollectResult: false;
  readonly startsServer: false;
  readonly performsNetworkIo: false;
  readonly spawnsProcesses: false;
}

/** Declared capabilities of the Stage 2A adapter. All false, by construction. */
export const STAGE_2A_CAPABILITIES: OpenCodeAdapterCapabilities = Object.freeze({
  implemented: false,
  canCreateSession: false,
  canContinueSession: false,
  canRunCommand: false,
  canCollectResult: false,
  startsServer: false,
  performsNetworkIo: false,
  spawnsProcesses: false,
});

/**
 * Stage 2A adapter. Every method fails loudly.
 *
 * Failing loudly is deliberate: a silent no-op would let a caller believe a
 * workflow ran when nothing happened.
 */
export class StubOpenCodeClient implements OpenCodeClient {
  readonly #config: OpenCodeAdapterConfig;

  constructor(config: OpenCodeAdapterConfig) {
    this.#config = config;
  }

  /** Exposed for diagnostics only. The value is never used to spawn anything. */
  get config(): Readonly<OpenCodeAdapterConfig> {
    return this.#config;
  }

  createSession(_request: CreateSessionRequest): Promise<OpenCodeSessionRef> {
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.createSession", "Stage 2A", ADAPTER_PLANNED_STAGE));
  }

  continueSession(_session: OpenCodeSessionRef, _request: ContinueSessionRequest): Promise<OpenCodeTurnResult> {
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.continueSession", "Stage 2A", ADAPTER_PLANNED_STAGE));
  }

  runCommand(_session: OpenCodeSessionRef, _request: RunCommandRequest): Promise<OpenCodeTurnResult> {
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.runCommand", "Stage 2A", ADAPTER_PLANNED_STAGE));
  }

  collectResult(_session: OpenCodeSessionRef): Promise<unknown> {
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.collectResult", "Stage 2A", ADAPTER_PLANNED_STAGE));
  }

  dispose(_session: OpenCodeSessionRef): Promise<void> {
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.dispose", "Stage 2A", ADAPTER_PLANNED_STAGE));
  }
}

/** Factory. Stage 2B replaces the returned type; the interface stays identical. */
export function createOpenCodeClient(config: OpenCodeAdapterConfig): OpenCodeClient {
  return new StubOpenCodeClient(config);
}

/**
 * Last-line guard for the Stage 2A execution prohibition.
 *
 * Stage 2B keeps this check in front of every real invocation, so that a
 * misconfigured or leftover Stage 2A default can never reach the transport.
 */
export function assertOpenCodeInvocationAllowed(executionMode: string, stage: string): void {
  if (stage === "2A" || executionMode === "disabled") {
    throw new OrchestratorError(
      "CONFIG_INVALID",
      `OpenCode invocation is refused (stage=${stage}, executionMode=${executionMode}). Stage 2A does not execute OpenCode.`,
      { stage, executionMode },
    );
  }
}
