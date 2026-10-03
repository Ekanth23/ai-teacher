/**
 * Stage 2A — Orchestrator configuration.
 *
 * DESIGN RULES FOR THIS MODULE
 * ----------------------------
 * 1. No credentials. The orchestrator never reads, stores, or accepts API keys,
 *    tokens, passwords, or connection secrets — for OpenCode or anything else.
 * 2. No required connectivity. Loading a config must never open a socket, spawn a
 *    process, or contact a server. Stage 2A runs fully offline.
 * 3. Safe defaults. Every default is fail-safe: execution disabled, git mutation
 *    disabled, network disabled, approval automation disabled.
 */

import path from "node:path";

/** Delivery stages. */
export type OrchestratorStage = "2A" | "2B" | "2C" | "2D";

/**
 * Stage 2B is the active stage: the OpenCode CLI adapter is implemented.
 *
 * Workflow execution (`start`/`plan`/`build`/...) remains refused regardless of
 * this value; see `OrchestratorService`.
 */
export const DEFAULT_STAGE: OrchestratorStage = "2B";

/**
 * Execution mode.
 *
 * - `disabled` — refuse to invoke OpenCode at all (Stage 2A default).
 * - `dry-run`  — build plans and payloads but never execute (future opt-in).
 * - `live`     — execute (Stage 2B+ only, and still gated by approval).
 */
export type ExecutionMode = "disabled" | "dry-run" | "live";

/** Console verbosity. */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

/** Read-only references to existing repository governance documents. */
export interface GovernanceReferences {
  /**
   * Stage 1 workflow rules. Authoritative for OpenCode workflow rules.
   * The orchestrator REFERENCES this file; it never restates or competes with it.
   */
  readonly stage1OpenCodeRulesPath: string;
  /** Project-level agent instructions. */
  readonly projectInstructionsPath: string;
  /** Frozen Master Backlog. */
  readonly masterBacklogPath: string;
  /**
   * Directory holding PO decision records. Discovered dynamically at read time in
   * a later stage; never a hardcoded file list.
   */
  readonly poDecisionsDirectory: string;
}

export interface OpenCodeAdapterConfig {
  /**
   * Command or path used to reach the OpenCode CLI.
   *
   * Stage 2B resolves this to a NATIVELY SPAWNABLE executable. A `.cmd`/`.bat`
   * shim is never executed, because doing so would require a shell. See
   * `opencode-executable.ts`.
   */
  readonly command: string;
  /**
   * Explicit executable override from `OPENCODE_BIN`, or `null` to resolve
   * `command` on PATH. Never a shell command string.
   */
  readonly bin: string | null;
  /**
   * Optional OpenCode server URL. Declared for a future stage.
   * Stage 2A/2B never issue a request to it, and never validate it by connecting.
   * The Stage 2B adapter deliberately has no server mode.
   */
  readonly serverUrl: string | null;
  /** Working directory for adapter invocations (the repository root). */
  readonly workingDirectory: string;
  /** Per-invocation timeout for future stages. */
  readonly timeoutMs: number;
  /** Upper bound on captured stdout/stderr per invocation. */
  readonly maxOutputBytes: number;
  /** Grace period between the polite kill and the forced kill. */
  readonly killGraceMs: number;
}

/**
 * The safety floor, as literal types.
 *
 * These four values are the fail-safe defaults and are typed as literals so that a
 * component declaring `readonly gitMutationEnabled: false` cannot be handed a
 * `true` without a type error. They are NOT env-driven and must never become
 * env-driven.
 */
export const SAFETY_LITERALS = Object.freeze({
  gitMutationEnabled: false,
  networkEnabled: false,
  approvalRequired: true,
  explicitApprovalOnly: true,
} as const);

export interface SafetyConfig {
  /** Always `false` in Stage 2A. The orchestrator never mutates git. */
  readonly gitMutationEnabled: typeof SAFETY_LITERALS.gitMutationEnabled;
  /** Always `false` in Stage 2A. The orchestrator makes no network calls. */
  readonly networkEnabled: typeof SAFETY_LITERALS.networkEnabled;
  /**
   * Always `true`. There is no configuration switch that disables the approval
   * gate. `PLAN_READY -> BUILDING` is unreachable without a recorded grant.
   */
  readonly approvalRequired: typeof SAFETY_LITERALS.approvalRequired;
  /**
   * Always `true`. There is no configuration switch that enables automatic
   * plan approval.
   */
  readonly explicitApprovalOnly: typeof SAFETY_LITERALS.explicitApprovalOnly;
}

export interface OrchestratorConfig {
  readonly stage: OrchestratorStage;
  readonly repositoryRoot: string;
  readonly stateDirectory: string;
  readonly executionMode: ExecutionMode;
  readonly logLevel: LogLevel;
  readonly opencode: OpenCodeAdapterConfig;
  readonly safety: SafetyConfig;
  readonly governance: GovernanceReferences;
}

/** Partial overrides accepted by {@link loadConfig}. */
export type ConfigOverrides = Partial<
  Pick<OrchestratorConfig, "stage" | "repositoryRoot" | "stateDirectory" | "executionMode" | "logLevel">
> & {
  readonly opencodeCommand?: string;
  readonly opencodeBin?: string;
  readonly opencodeServerUrl?: string | null;
  readonly opencodeTimeoutMs?: number;
  readonly opencodeMaxOutputBytes?: number;
};

/** Environment variables read by the orchestrator. No secrets are read. */
export const ENV_KEYS = {
  stage: "AI_ORCHESTRATOR_STAGE",
  repositoryRoot: "AI_ORCHESTRATOR_REPOSITORY_ROOT",
  stateDirectory: "AI_ORCHESTRATOR_STATE_DIR",
  executionMode: "AI_ORCHESTRATOR_EXECUTION_MODE",
  logLevel: "AI_ORCHESTRATOR_LOG_LEVEL",
  opencodeCommand: "AI_ORCHESTRATOR_OPENCODE_COMMAND",
  opencodeServerUrl: "AI_ORCHESTRATOR_OPENCODE_SERVER_URL",
  opencodeTimeoutMs: "AI_ORCHESTRATOR_OPENCODE_TIMEOUT_MS",
  /** Stage 2B: the OpenCode executable to resolve. Never a shell command string. */
  opencodeBin: "OPENCODE_BIN",
  /** Stage 2B: convenience alias for the same timeout. */
  opencodeTimeoutMsAlias: "OPENCODE_TIMEOUT_MS",
  /** Stage 2B: captured-output ceiling per stream. */
  opencodeMaxOutputBytes: "OPENCODE_MAX_OUTPUT_BYTES",
} as const;

/** Human-readable invariants asserted by this configuration. Documentation as code. */
export const CONFIG_INVARIANTS: readonly string[] = [
  "Workflow execution is implemented in Stage 2C; the orchestrator refuses it in earlier stages.",
  "The Stage 2B adapter spawns a native OpenCode executable with no shell involved.",
  "The adapter never performs a network request and never uses OpenCode server mode.",
  "No credentials, API keys, or tokens are read, stored, or accepted by the orchestrator.",
  "The orchestrator never mutates git state (no add, commit, stash, reset, clean, checkout).",
  "The approval gate is mandatory and cannot be disabled by configuration.",
  "Automatic plan approval does not exist and cannot be enabled by configuration.",
  "The OpenCode adapter is not an approval authority and cannot advance workflow state.",
  "A non-zero OpenCode exit code is never reported as success.",
  "Exit code 0 from OpenCode means the process completed, not that a story was verified.",
  "The orchestrator contains no AI Teacher product or business logic.",
];

const EXECUTION_MODES: readonly ExecutionMode[] = ["disabled", "dry-run", "live"];
const LOG_LEVELS: readonly LogLevel[] = ["silent", "error", "warn", "info", "debug"];

/** Directory containing this package's compiled entry point. */
function packageRoot(): string {
  // `import.meta.dirname` is available on Node >= 20.11 (engines are enforced).
  return path.resolve(import.meta.dirname, "..");
}

/** Default repository root: the package lives at `<repo>/tools/ai-orchestrator`. */
export function defaultRepositoryRoot(): string {
  return path.resolve(packageRoot(), "..", "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}

function pickEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const raw = pickString(source, key);
  if (raw === undefined) return undefined;
  const upper = raw.toLowerCase();
  const match = allowed.find((candidate) => candidate.toLowerCase() === upper);
  return match;
}

function pickPositiveInt(source: Record<string, unknown>, key: string): number | undefined {
  const raw = pickString(source, key);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Resolve configuration from explicit overrides then environment variables.
 *
 * Pure and offline: no filesystem writes, no process spawning, no network.
 */
export function loadConfig(overrides: ConfigOverrides = {}, env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  const repositoryRoot = path.resolve(
    overrides.repositoryRoot ?? env[ENV_KEYS.repositoryRoot] ?? defaultRepositoryRoot(),
  );

  const stateDirectory = path.resolve(
    overrides.stateDirectory ??
      env[ENV_KEYS.stateDirectory] ??
      path.join(repositoryRoot, "tools", "ai-orchestrator", "state"),
  );

  const stage = overrides.stage ?? pickEnum(env, ENV_KEYS.stage, ["2A", "2B", "2C", "2D"] as const) ?? DEFAULT_STAGE;

  const executionMode =
    overrides.executionMode ??
    pickEnum(env, ENV_KEYS.executionMode, EXECUTION_MODES) ??
    "disabled";

  const logLevel = overrides.logLevel ?? pickEnum(env, ENV_KEYS.logLevel, LOG_LEVELS) ?? "info";

  const opencodeCommand =
    overrides.opencodeCommand ?? env[ENV_KEYS.opencodeCommand] ?? "opencode";

  /**
   * `OPENCODE_BIN` wins over the generic command name. It is an executable path,
   * never a command string with arguments.
   */
  const opencodeBin = overrides.opencodeBin ?? pickString(env, ENV_KEYS.opencodeBin);

  const opencodeServerUrlRaw = pickString(env, ENV_KEYS.opencodeServerUrl);
  const opencodeServerUrl =
    overrides.opencodeServerUrl !== undefined ? overrides.opencodeServerUrl : (opencodeServerUrlRaw ?? null);

  const opencodeTimeoutMs =
    overrides.opencodeTimeoutMs ??
    pickPositiveInt(env, ENV_KEYS.opencodeTimeoutMs) ??
    pickPositiveInt(env, ENV_KEYS.opencodeTimeoutMsAlias) ??
    600_000;

  const opencodeMaxOutputBytes =
    overrides.opencodeMaxOutputBytes ?? pickPositiveInt(env, ENV_KEYS.opencodeMaxOutputBytes) ?? 4 * 1024 * 1024;

  const config: OrchestratorConfig = {
    stage,
    repositoryRoot,
    stateDirectory,
    executionMode,
    logLevel,
    opencode: {
      // `bin` is the explicit executable override; when unset the adapter resolves
      // `command` to a native binary via PATH.
      command: opencodeBin ?? opencodeCommand,
      bin: opencodeBin ?? null,
      serverUrl: opencodeServerUrl,
      workingDirectory: repositoryRoot,
      timeoutMs: opencodeTimeoutMs,
      maxOutputBytes: opencodeMaxOutputBytes,
      killGraceMs: 2_000,
    },
    safety: {
      // Single source of truth for the fail-safe floor; see SAFETY_LITERALS.
      ...SAFETY_LITERALS,
    },
    governance: {
      stage1OpenCodeRulesPath: path.join(repositoryRoot, ".opencode", "ai-workflow-rules.md"),
      projectInstructionsPath: path.join(repositoryRoot, "AGENTS.md"),
      masterBacklogPath: path.join(
        repositoryRoot,
        "AI_Teacher_16_Epic_Master_PO_User_Story_Backlog_Draft_2.0_FINAL_CONSOLIDATED.txt",
      ),
      poDecisionsDirectory: path.join(repositoryRoot, "Docs"),
    },
  };

  assertConfigIsSafe(config);
  return config;
}

/**
 * Fail-fast structural validation of the resolved config.
 *
 * Deliberately does NOT touch the filesystem, git, or the network, so that
 * `orchestrator status` stays a pure, offline smoke test.
 */
export function assertConfigIsSafe(config: OrchestratorConfig): void {
  if (config.safety.approvalRequired !== true || config.safety.explicitApprovalOnly !== true) {
    throw new Error("Orchestrator safety invariants violated: the approval gate must always be required.");
  }
  if (config.safety.gitMutationEnabled) {
    throw new Error("Orchestrator safety invariants violated: git mutation must remain disabled.");
  }
  if (config.safety.networkEnabled) {
    throw new Error("Orchestrator safety invariants violated: network access must remain disabled.");
  }
  if (config.stage === "2A" && config.executionMode === "live") {
    throw new Error("Orchestrator safety invariants violated: Stage 2A cannot run in live execution mode.");
  }
  if (config.stage === "2B" && config.executionMode === "live") {
    throw new Error("Orchestrator safety invariants violated: Stage 2B cannot run in live execution mode. Workflow execution is Stage 2C.");
  }
  if (config.executionMode === "live" && config.safety.approvalRequired !== true) {
    throw new Error("Orchestrator safety invariants violated: live execution requires the approval gate.");
  }
  if (!isRecord(config.opencode)) {
    throw new Error("Orchestrator safety invariants violated: malformed OpenCode adapter config.");
  }
}

/** The orchestrator package directory (`tools/ai-orchestrator`). */
export function orchestratorPackageRoot(): string {
  return packageRoot();
}

/** Unused-shape guard so `isRecord` remains exercised by the config surface. */
export const CONFIG_GUARD_HELPERS = { isRecord } as const;
