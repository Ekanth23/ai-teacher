/**
 * Stage 2A — CLI entry point.
 *
 * WHAT WORKS IN STAGE 2A
 * ----------------------
 *   orchestrator help
 *   orchestrator status
 *
 * WHAT DOES NOT WORK IN STAGE 2A (by design)
 * ------------------------------------------
 *   orchestrator plan | build | test | review | verify | approve | run
 *
 * Those commands exist in the command table so the CLI surface is reviewable now,
 * but each one refuses with a `NOT_IMPLEMENTED_IN_STAGE` error and a non-zero exit
 * code. None of them touches OpenCode, the repository, git, or the network.
 *
 * Zero runtime dependencies. Argument parsing is hand-rolled on purpose.
 */

import process from "node:process";
import { loadConfig, type ConfigOverrides, type LogLevel, type OrchestratorConfig } from "./config.js";
import { NotImplementedInStageError, OrchestratorError } from "./errors.js";
import { OpenCodeCliClient } from "./opencode-client.js";
import { resolveOpenCodeExecutable } from "./opencode-executable.js";
import { createProcessRunner } from "./opencode-process.js";
import { createOrchestrator } from "./orchestrator.js";
import { createConsoleReporter } from "./reporters/console-reporter.js";

/** Process exit codes. Distinct so a script can distinguish causes. */
export const EXIT_CODES = {
  ok: 0,
  error: 1,
  usage: 2,
  notImplemented: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  argv: process.argv,
};

interface CommandDefinition {
  readonly name: string;
  readonly summary: string;
  /** false means "declared for the future, refuses in Stage 2A". */
  readonly availableInStage2A: boolean;
  readonly usage: string;
}

export const COMMANDS: readonly CommandDefinition[] = Object.freeze([
  { name: "help", summary: "Show this help.", availableInStage2A: true, usage: "orchestrator help" },
  { name: "status", summary: "Show orchestrator stage, safety state, and state machine.", availableInStage2A: true, usage: "orchestrator status [--json]" },
  {
    name: "opencode-ping",
    summary: "Read-only connectivity probe: runs `opencode --version` through the Stage 2B CLI adapter.",
    availableInStage2A: true,
    usage: "orchestrator opencode-ping [--json]",
  },
  { name: "plan", summary: "Resolve a story and prepare a plan (Stage 2C).", availableInStage2A: false, usage: "orchestrator plan <US-###>" },
  { name: "approve", summary: "Record an explicit human approval decision (Stage 2C).", availableInStage2A: false, usage: "orchestrator approve <workflow-id> <grant|reject> --actor <id>" },
  { name: "build", summary: "Run the approved build (Stage 2C).", availableInStage2A: false, usage: "orchestrator build <workflow-id>" },
  { name: "test", summary: "Run tests and typecheck (Stage 2C).", availableInStage2A: false, usage: "orchestrator test <workflow-id>" },
  { name: "review", summary: "Run review agents (Stage 2C).", availableInStage2A: false, usage: "orchestrator review <workflow-id>" },
  { name: "verify", summary: "Verify the story against its governing criteria (Stage 2C).", availableInStage2A: false, usage: "orchestrator verify <workflow-id>" },
  { name: "run", summary: "Run the full workflow end to end (Stage 2C).", availableInStage2A: false, usage: "orchestrator run <US-###>" },
]);

const GLOBAL_FLAGS: readonly string[] = ["--json", "--log-level <level>", "--repo-root <path>", "--state-dir <path>"];

function renderHelp(io: CliIo): void {
  io.stdout("ai-orchestrator — AI Teacher Development Orchestrator (Stage 2A skeleton)");
  io.stdout("");
  io.stdout("This tool is a CONTROL layer between the human / ChatGPT PO and OpenCode.");
  io.stdout("It contains no AI Teacher product logic and it does not code on its own.");
  io.stdout("");
  io.stdout("Usage:");
  for (const command of COMMANDS) {
    const marker = command.availableInStage2A ? "  " : " *";
    io.stdout(`${marker} ${command.usage}`);
    io.stdout(`     ${command.summary}${command.availableInStage2A ? "" : " [NOT AVAILABLE IN STAGE 2A]"}`);
  }
  io.stdout("");
  io.stdout("Global flags:");
  for (const flag of GLOBAL_FLAGS) io.stdout(`  ${flag}`);
  io.stdout("");
  io.stdout("Stage 2B guarantees:");
  io.stdout("  - No shell is ever used to invoke the OpenCode CLI.");
  io.stdout("  - No workflow command (/ai-plan, /ai-build, ...) is executed.");
  io.stdout("  - The AI Teacher application is never modified.");
  io.stdout("  - Plans are never approved automatically.");
  io.stdout("  - No external API is called by the orchestrator.");
  io.stdout("  - Git is never mutated.");
  io.stdout("  - An OpenCode exit code of 0 is a process result, not a verified story.");
}

interface ParsedArgs {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly json: boolean;
  readonly overrides: ConfigOverrides;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  let json = false;
  const overrides: {
    repositoryRoot?: string;
    stateDirectory?: string;
    logLevel?: LogLevel;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--repo-root" || arg === "--state-dir" || arg === "--log-level") {
      const value = argv[index + 1];
      if (value === undefined) throw new OrchestratorError("USAGE_ERROR", `Missing value for ${arg}.`);
      index += 1;
      if (arg === "--repo-root") overrides.repositoryRoot = value;
      else if (arg === "--state-dir") overrides.stateDirectory = value;
      else overrides.logLevel = value as LogLevel;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new OrchestratorError("USAGE_ERROR", `Unknown flag: ${arg}`);
    }
    positionals.push(arg);
  }

  const command = positionals.shift();
  return { command, positionals, json, overrides };
}

function runStatus(io: CliIo, overrides: ConfigOverrides, json: boolean): ExitCode {
  const config: OrchestratorConfig = loadConfig(overrides, io.env);
  const reporter = createConsoleReporter({
    logLevel: config.logLevel,
    sink: json ? () => {} : io.stdout,
  });
  const orchestrator = createOrchestrator(reporter, { config });
  const status = orchestrator.getStatus();

  if (json) {
    io.stdout(JSON.stringify(status, null, 2));
  } else {
    reporter.status(status);
  }
  return EXIT_CODES.ok;
}

function refuse(io: CliIo, commandName: string): ExitCode {
  const error = new NotImplementedInStageError(`cli:${commandName}`, "Stage 2B", "Stage 2C");
  io.stderr(`${error.name} [${error.code}] ${error.message}`);
  io.stderr("Stage 2B implements the OpenCode CLI adapter only. It does not execute workflows or modify the application.");
  return EXIT_CODES.notImplemented;
}

/**
 * Stage 2B read-only connectivity probe.
 *
 * Runs `opencode --version` through the real CLI adapter. This is the safe
 * end-to-end proof that orchestrator -> adapter -> child process -> captured
 * stdout/stderr/exit code -> structured result works.
 *
 * It performs NO model call, NO network request, and NO file modification, and it
 * touches no AI Teacher application code. The argument vector is fixed inside the
 * adapter and cannot be influenced by the caller.
 */
async function runOpenCodePing(io: CliIo, overrides: ConfigOverrides, json: boolean): Promise<ExitCode> {
  const config = loadConfig(overrides, io.env);
  const resolution = resolveOpenCodeExecutable({
    command: config.opencode.bin ?? config.opencode.command,
    env: io.env,
    cwd: config.opencode.workingDirectory,
  });

  if (resolution.kind === "unresolved") {
    io.stderr(`OPENCODE_EXECUTABLE_UNRESOLVED ${resolution.reason}`);
    io.stderr(`hint: ${resolution.hint}`);
    return EXIT_CODES.error;
  }

  const client = new OpenCodeCliClient({
    config: config.opencode,
    processRunner: createProcessRunner(),
    env: io.env,
  });

  const outcome = await client.probeVersion();
  const stdout = outcome.stdout.trim();

  if (json) {
    io.stdout(JSON.stringify({ resolvedFrom: resolution.source, outcome }, null, 2));
  } else {
    io.stdout("orchestrator opencode-ping (read-only Stage 2B connectivity probe)");
    io.stdout(`  executable      : ${resolution.path}`);
    io.stdout(`  resolved via    : ${resolution.source}`);
    io.stdout(`  process status  : ${outcome.status}`);
    io.stdout(`  exit code       : ${outcome.status === "spawn-error" || outcome.status === "timeout" ? "n/a" : outcome.exitCode}`);
    io.stdout(`  duration        : ${outcome.durationMs} ms`);
    io.stdout(`  timed out       : ${outcome.timedOut}`);
    io.stdout(`  stdout          : ${stdout.length > 0 ? stdout : "(empty)"}`);
    io.stdout(`  stderr          : ${outcome.stderr.trim().length > 0 ? outcome.stderr.trim() : "(empty)"}`);
    io.stdout("");
    io.stdout("  NOTE: process success is NOT workflow verification. No story was implemented,");
    io.stdout("  tested, reviewed, or verified by this probe.");
  }

  // A non-zero exit, a timeout, or a spawn failure is reported as a failure.
  return outcome.status === "success" ? EXIT_CODES.ok : EXIT_CODES.error;
}

/** Programmatic entry point. Returns an exit code instead of calling `process.exit`. */
export function run(io: CliIo = defaultIo): ExitCode | Promise<ExitCode> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(io.argv.slice(2));
  } catch (error) {
    io.stderr(`USAGE_ERROR ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_CODES.usage;
  }

  const command = parsed.command ?? "help";
  const definition = COMMANDS.find((entry) => entry.name === command);

  if (definition === undefined) {
    io.stderr(`USAGE_ERROR Unknown command: ${command}`);
    io.stderr(`Available commands: ${COMMANDS.map((entry) => entry.name).join(", ")}`);
    return EXIT_CODES.usage;
  }

  try {
    switch (command) {
      case "help":
        renderHelp(io);
        return EXIT_CODES.ok;
      case "status":
        return runStatus(io, parsed.overrides, parsed.json);
      case "opencode-ping":
        return runOpenCodePing(io, parsed.overrides, parsed.json).catch((error: unknown) => {
          io.stderr(`ERROR ${error instanceof Error ? error.message : String(error)}`);
          return EXIT_CODES.error;
        });
      default:
        if (!definition.availableInStage2A) {
          io.stderr(`USAGE_ERROR ${definition.usage}`);
          return refuse(io, definition.name);
        }
        return EXIT_CODES.usage;
    }
  } catch (error) {
    if (error instanceof NotImplementedInStageError) {
      io.stderr(`${error.name} [${error.code}] ${error.message}`);
      return EXIT_CODES.notImplemented;
    }
    if (error instanceof OrchestratorError) {
      io.stderr(`${error.name} [${error.code}] ${error.message}`);
      return EXIT_CODES.error;
    }
    io.stderr(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_CODES.error;
  }
}

/** Node entry guard. Keeps the module importable for tests and tooling. */
export function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === new URL(`file://${entry.replace(/\\/g, "/")}`).href;
}

if (isDirectExecution()) {
  const result = run(defaultIo);
  if (result instanceof Promise) {
    void result.then((code) => {
      process.exitCode = code;
    });
  } else {
    process.exitCode = result;
  }
}
