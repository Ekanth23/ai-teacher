/**
 * OpenCode adapter boundary.
 *
 * PURPOSE
 * -------
 * The seam between the orchestrator and OpenCode. Everything the orchestrator will
 * ever need from OpenCode is declared here as an interface, so the transport can
 * change without redesigning the orchestrator.
 *
 * STAGE 2A (committed at 3cf89b2)
 * -----------------------------
 * Interface only. Every method threw `NotImplementedInStageError`.
 *
 * STAGE 2B (this file's current state)
 * ------------------------------------
 * `OpenCodeCliClient` is a real `opencode run` CLI adapter. `StubOpenCodeClient`
 * is retained so the orchestrator can still be constructed with no OpenCode
 * available (for example in tests or on a machine without the CLI).
 *
 * `opencode-executable.ts` resolves the command to a NATIVELY SPAWNABLE
 * executable. `opencode-process.ts` owns the only `spawn` call in the codebase.
 * There is no HTTP client, no server mode, and no shell anywhere in this path.
 *
 * Stage 1 governance lives in `.opencode/ai-workflow-rules.md` and remains
 * authoritative. This adapter is a *transport*, not a second rule set. The
 * adapter must not restate, reinterpret, or compete with Stage 1 rules.
 */

import type { OpenCodeAdapterConfig } from "./config.js";
import {
  NotImplementedInStageError,
  OpenCodeExecutableUnresolvedError,
  OpenCodeSessionUnavailableError,
  OrchestratorError,
} from "./errors.js";
import { resolveOpenCodeExecutable, type ExecutableResolution } from "./opencode-executable.js";
import { createProcessRunner, type ProcessExecutionOutcome, type ProcessRunner } from "./opencode-process.js";

/** Stage that owns the CLI adapter. */
export const ADAPTER_IMPLEMENTED_STAGE = "Stage 2B" as const;

/** Stage expected to own automatic workflow execution. */
export const WORKFLOW_PLANNED_STAGE = "Stage 2C" as const;

/** Which Stage 1 command an invocation corresponds to. */
export type OpenCodeCommandName = "ai-plan" | "ai-build" | "ai-test" | "ai-review" | "ai-verify";

export const OPENCODE_COMMAND_NAMES: readonly OpenCodeCommandName[] = [
  "ai-plan",
  "ai-build",
  "ai-test",
  "ai-review",
  "ai-verify",
];

/**
 * OpenCode flags the orchestrator refuses to pass.
 *
 * - `--auto` makes OpenCode auto-approve permissions. The orchestrator owns
 *   approval; delegating it to the child process would break the
 *   `NO APPROVAL -> NO BUILD` invariant. Never passed.
 * - `--server` / `--standalone` would introduce server or network behaviour.
 *   Stage 2B is a local CLI adapter only. Never passed.
 *
 * Guarded in `assertNoForbiddenFlags()` and covered by tests.
 */
export const FORBIDDEN_OPENCODE_FLAGS: readonly string[] = Object.freeze([
  "--auto",
  "--server",
  "--standalone",
]);

/** Opaque handle to an OpenCode session. Contains no credentials. */
export interface OpenCodeSessionRef {
  readonly sessionId: string;
  /**
   * Stage 2B extension: the provider session id reported by OpenCode, or `null`
   * when OpenCode did not report one. It is never invented. Callers that need to
   * continue a session must supply a real id.
   */
  readonly providerSessionId: string | null;
  readonly createdForStoryId: string | null;
  readonly startedAt: string;
}

export interface CreateSessionRequest {
  readonly storyId: string | null;
  readonly command: OpenCodeCommandName;
  /** A path/reference to a prepared context package. Stage 2A prepares none. */
  readonly contextPackageReference: string | null;
  readonly workingDirectory: string;
  /**
   * Stage 2B extension: the message handed to `opencode run`. Required because
   * `opencode run` is message-driven. Passed as ONE argument, never interpolated
   * into a command string.
   */
  readonly message: string;
}

export interface ContinueSessionRequest {
  readonly command: OpenCodeCommandName;
  /** Free-text instruction. Must not restate or invent product decisions. */
  readonly instruction: string;
  /**
   * Stage 2B extension: explicit session id, used when the session reference does
   * not carry one.
   */
  readonly sessionId?: string | null;
}

export interface RunCommandRequest extends ContinueSessionRequest {
  /** Additional CLI arguments. Validated against the forbidden-flag list. */
  readonly args?: readonly string[];
  /** Request machine-readable output. Defaults to `true` so results are parsable. */
  readonly jsonOutput?: boolean;
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
  /**
   * Stage 2B extension: the authoritative PROCESS outcome.
   *
   * `process.status` is the single source of truth. The scalar fields above are
   * convenience mirrors of it, kept so Stage 2A consumers keep working.
   *
   * IMPORTANT: `status === "success"` means the OpenCode PROCESS completed. It is
   * NOT a statement that an AI Teacher story was implemented, tested, reviewed,
   * or verified. See `result-parser.ts`.
   */
  readonly process: ProcessExecutionOutcome;
}

/** True only when the OpenCode PROCESS completed with exit code 0. */
export function isProcessSuccessful(result: OpenCodeTurnResult): boolean {
  return result.process.status === "success";
}

/**
 * The complete surface the orchestrator requires from OpenCode.
 *
 * Stage 2B implements this with `OpenCodeCliClient` (local `opencode run`, no
 * shell, no network). The orchestrator depends only on this interface, never on a
 * concrete transport.
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
  /** True only for the real Stage 2B CLI adapter. */
  readonly implemented: boolean;
  readonly canCreateSession: boolean;
  readonly canContinueSession: boolean;
  readonly canRunCommand: boolean;
  readonly canCollectResult: boolean;
  /** Always false in Stage 2A and Stage 2B. */
  readonly startsServer: false;
  /** Always false: the adapter performs no network I/O of its own. */
  readonly performsNetworkIo: false;
  /** True once a transport spawns a child process. */
  readonly spawnsProcesses: boolean;
  /** True when any shell is involved. Must remain false forever. */
  readonly usesShell: false;
}

/** Declared capabilities of the Stage 2A stub adapter. All false, by construction. */
export const STAGE_2A_CAPABILITIES: OpenCodeAdapterCapabilities = Object.freeze({
  implemented: false,
  canCreateSession: false,
  canContinueSession: false,
  canRunCommand: false,
  canCollectResult: false,
  startsServer: false,
  performsNetworkIo: false,
  spawnsProcesses: false,
  usesShell: false,
});

/** Declared capabilities of the Stage 2B CLI adapter. */
export const STAGE_2B_CAPABILITIES: OpenCodeAdapterCapabilities = Object.freeze({
  implemented: true,
  canCreateSession: true,
  canContinueSession: true,
  canRunCommand: true,
  canCollectResult: true,
  startsServer: false,
  performsNetworkIo: false,
  spawnsProcesses: true,
  usesShell: false,
});

/**
 * Stage 2A adapter. Every method fails loudly.
 *
 * Failing loudly is deliberate: a silent no-op would let a caller believe a
 * workflow ran when nothing happened. Retained in Stage 2B so the orchestrator can
 * still be constructed with no OpenCode available.
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
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.createSession", "Stage 2A", ADAPTER_IMPLEMENTED_STAGE));
  }

  continueSession(_session: OpenCodeSessionRef, _request: ContinueSessionRequest): Promise<OpenCodeTurnResult> {
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.continueSession", "Stage 2A", ADAPTER_IMPLEMENTED_STAGE));
  }

  runCommand(_session: OpenCodeSessionRef, _request: RunCommandRequest): Promise<OpenCodeTurnResult> {
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.runCommand", "Stage 2A", ADAPTER_IMPLEMENTED_STAGE));
  }

  collectResult(_session: OpenCodeSessionRef): Promise<unknown> {
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.collectResult", "Stage 2A", ADAPTER_IMPLEMENTED_STAGE));
  }

  dispose(_session: OpenCodeSessionRef): Promise<void> {
    return Promise.reject(new NotImplementedInStageError("OpenCodeClient.dispose", "Stage 2A", ADAPTER_IMPLEMENTED_STAGE));
  }
}

/* -------------------------------------------------------------------------- */
/* Stage 2B — real `opencode run` CLI adapter.                                  */
/* -------------------------------------------------------------------------- */

/**
 * Refuse any argument that would delegate authority to the child process or
 * introduce server/network behaviour.
 *
 * A message body is deliberately NOT treated as a flag: it is passed as its own
 * argv element, so content inside it can never be parsed as a flag.
 */
export function assertNoForbiddenFlags(args: readonly string[]): void {
  for (const arg of args) {
    const normalized = arg.trim();
    if (FORBIDDEN_OPENCODE_FLAGS.includes(normalized)) {
      throw new OrchestratorError(
        "CONFIG_INVALID",
        `Refusing to pass "${normalized}" to OpenCode. The orchestrator owns approval and never uses OpenCode server mode.`,
        { flag: normalized },
      );
    }
  }
}

export interface OpenCodeCliClientOptions {
  readonly config: OpenCodeAdapterConfig;
  readonly processRunner: ProcessRunner;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Injected for tests. */
  readonly resolveExecutable?: typeof resolveOpenCodeExecutable;
}

/**
 * Real Stage 2B adapter: spawns the local `opencode` executable.
 *
 * It is a TRANSPORT. It does not decide anything:
 *   - it never grants or implies approval;
 *   - it never advances a workflow state;
 *   - it never interprets exit code 0 as story verification.
 */
export class OpenCodeCliClient implements OpenCodeClient {
  readonly #config: OpenCodeAdapterConfig;
  readonly #runner: ProcessRunner;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #resolve: typeof resolveOpenCodeExecutable;
  readonly #turns = new Map<string, ProcessExecutionOutcome>();

  constructor(options: OpenCodeCliClientOptions) {
    this.#config = options.config;
    this.#runner = options.processRunner;
    this.#env = options.env;
    this.#resolve = options.resolveExecutable ?? resolveOpenCodeExecutable;
  }

  get capabilities(): OpenCodeAdapterCapabilities {
    return STAGE_2B_CAPABILITIES;
  }

  /** Resolve the executable, or fail with an actionable structured reason. */
  resolveExecutablePath(cwd: string = this.#config.workingDirectory): ExecutableResolution {
    return this.#resolve({
      command: this.#config.bin ?? this.#config.command,
      env: this.#env,
      cwd,
    });
  }

  async createSession(request: CreateSessionRequest): Promise<OpenCodeSessionRef> {
    const session: OpenCodeSessionRef = {
      sessionId: `ocs_${hashish(request.storyId ?? "unassigned")}`,
      providerSessionId: null,
      createdForStoryId: request.storyId,
      startedAt: new Date().toISOString(),
    };

    // The first turn of a session is the create turn. Its outcome is retained so
    // `collectResult` can return the raw process payload afterwards.
    const outcome = await this.#invoke(request.workingDirectory, [
      ...baseArgs(request.command, true),
      request.message,
    ]);
    this.#turns.set(session.sessionId, outcome);

    return { ...session, providerSessionId: extractSessionId(outcome) };
  }

  async continueSession(session: OpenCodeSessionRef, request: ContinueSessionRequest): Promise<OpenCodeTurnResult> {
    const sessionId = request.sessionId ?? session.providerSessionId;
    if (sessionId === null || sessionId === undefined || sessionId.length === 0) {
      throw new OpenCodeSessionUnavailableError(
        "Cannot continue an OpenCode session without a real session id. The adapter never invents one; pass sessionId explicitly.",
        { orchestratorSession: session.sessionId },
      );
    }
    return this.#runTurn(session, request.command, [...baseArgs(request.command, true), "--session", sessionId, request.instruction]);
  }

  async runCommand(session: OpenCodeSessionRef, request: RunCommandRequest): Promise<OpenCodeTurnResult> {
    const extra = request.args ?? [];
    assertNoForbiddenFlags(extra);

    const sessionId = request.sessionId ?? session.providerSessionId;
    const sessionArgs =
      sessionId === null || sessionId === undefined || sessionId.length === 0 ? [] : ["--session", sessionId];

    const jsonOutput = request.jsonOutput ?? true;
    return this.#runTurn(session, request.command, [...baseArgs(request.command, jsonOutput), ...sessionArgs, ...extra, request.instruction]);
  }

  /**
   * Return the retained raw process payload for a session.
   *
   * This is the PROCESS payload, not a workflow result. `result-parser.ts` owns
   * any interpretation, and Stage 2B leaves that stubbed.
   *
   * Declared `async` deliberately: every failure must surface as a rejection, not
   * as a synchronous throw, so a `.catch()` caller cannot miss it.
   */
  async collectResult(session: OpenCodeSessionRef): Promise<unknown> {
    const outcome = this.#turns.get(session.sessionId);
    if (outcome === undefined) {
      throw new OpenCodeSessionUnavailableError(
        `No captured process payload for orchestrator session "${session.sessionId}".`,
        { orchestratorSession: session.sessionId },
      );
    }
    return outcome;
  }

  /**
   * Release the retained payload.
   *
   * A CLI process is not long-lived, so there is nothing to shut down. This
   * deliberately performs no git or filesystem mutation.
   */
  async dispose(session: OpenCodeSessionRef): Promise<void> {
    this.#turns.delete(session.sessionId);
  }

  /**
   * Read-only connectivity probe: runs `opencode --version`.
   *
   * This is the Stage 2B smoke path. It performs no model call, no network
   * request, and no file modification. The argument vector is hardcoded here and
   * cannot be influenced by a caller.
   */
  async probeVersion(): Promise<ProcessExecutionOutcome> {
    return this.#invoke(this.#config.workingDirectory, ["--version"]);
  }

  async #runTurn(
    session: OpenCodeSessionRef,
    command: OpenCodeCommandName,
    args: readonly string[],
  ): Promise<OpenCodeTurnResult> {
    assertNoForbiddenFlags(args);
    const outcome = await this.#invoke(this.#config.workingDirectory, args);
    this.#turns.set(session.sessionId, outcome);

    return {
      session: { ...session, providerSessionId: extractSessionId(outcome) ?? session.providerSessionId },
      command,
      exitCode: outcome.status === "spawn-error" || outcome.status === "timeout" ? null : outcome.exitCode,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      usage: { inputTokens: null, outputTokens: null, costUsd: null, modelId: null },
      durationMs: outcome.durationMs,
      // "completed" means the process finished, whatever the verdict.
      completed: outcome.status !== "spawn-error" && outcome.status !== "timeout",
      process: outcome,
    };
  }

  async #invoke(cwd: string, args: readonly string[]): Promise<ProcessExecutionOutcome> {
    assertNoForbiddenFlags(args);

    const resolution = this.resolveExecutablePath(cwd);
    if (resolution.kind === "unresolved") {
      throw new OpenCodeExecutableUnresolvedError(resolution.reason, resolution.hint);
    }

    return this.#runner.run({
      command: resolution.path,
      // Copied into a fresh array: the runner never receives caller-owned state.
      args: [...args],
      cwd,
      timeoutMs: this.#config.timeoutMs,
      env: this.#env,
      maxOutputBytes: this.#config.maxOutputBytes,
      killGraceMs: this.#config.killGraceMs,
    });
  }
}

/** `opencode run` argument prefix. Machine-readable output is the default. */
function baseArgs(_command: OpenCodeCommandName, jsonOutput: boolean): string[] {
  return jsonOutput ? ["run", "--format", "json"] : ["run"];
}

/**
 * Best-effort extraction of an OpenCode session id from `--format json` output.
 *
 * Defensive by design: any parse problem yields `null`. The adapter NEVER invents
 * a session id, so a failure here degrades to "cannot continue" rather than to a
 * wrong session.
 */
export function extractSessionId(outcome: ProcessExecutionOutcome): string | null {
  if (outcome.status === "spawn-error") return null;
  const text = outcome.stdout;
  if (text.trim().length === 0) return null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const found = findSessionKey(parsed, 0);
    if (found !== null) return found;
  }
  return null;
}

const SESSION_KEYS = ["sessionID", "sessionId", "session_id"] as const;

function findSessionKey(value: unknown, depth: number): string | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSessionKey(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of SESSION_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  for (const nested of Object.values(record)) {
    const found = findSessionKey(nested, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** Stable, non-cryptographic id. Not a credential and not derived from secrets. */
function hashish(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Factory.
 *
 * Stage 2B returns the real CLI adapter. Callers that must not touch a process pass
 * no runner, or construct `StubOpenCodeClient` directly.
 */
export function createOpenCodeClient(
  config: OpenCodeAdapterConfig,
  runner: ProcessRunner = createProcessRunner(),
): OpenCodeClient {
  return new OpenCodeCliClient({ config, processRunner: runner, env: process.env });
}

/**
 * Last-line guard in front of every real WORKFLOW invocation.
 *
 * The Stage 2B CLI adapter may be constructed and may run a read-only version
 * probe, but it must never be used to execute a workflow command unless the
 * orchestrator is explicitly in a live, post-Stage-2A configuration. This keeps a
 * leftover Stage 2A default from ever reaching the transport.
 *
 * This function is NOT an approval check. Approval lives in `approval-gate.ts`
 * and is unaffected by Stage 2B.
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
