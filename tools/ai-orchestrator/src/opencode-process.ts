/**
 * Stage 2B — Child-process execution layer for the OpenCode CLI adapter.
 *
 * This module is the ONLY place in the orchestrator that spawns a process.
 *
 * SAFETY RULES ENFORCED HERE
 * --------------------------
 * 1. `shell: false` always. No shell is ever involved, so no argument can be
 *    reinterpreted as shell syntax and no command string is ever assembled.
 * 2. The executable is an absolute path resolved by `opencode-executable.ts`.
 *    `command` is never a user, story, or prompt string.
 * 3. Arguments are passed as an array. There is no string concatenation anywhere.
 * 4. stdout and stderr are captured separately and never merged.
 * 5. A timeout is always armed and the child is terminated when it fires.
 * 6. Output is bounded. The child keeps being drained so it can never block on a
 *    full pipe, but memory growth is capped.
 * 7. A non-zero exit is a FAILURE. It is never converted into success.
 * 8. A spawn failure is a distinct outcome, never an empty success.
 *
 * SCOPE BOUNDARY
 * --------------
 * This module reports PROCESS outcomes only. Exit code 0 means "the OpenCode
 * process completed". It says nothing whatsoever about whether an AI Teacher user
 * story was implemented, tested, reviewed, or verified. Workflow verification is
 * owned by the orchestrator and its review/verification phases.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

/** The concrete child shape produced by `stdio: ["ignore", "pipe", "pipe"]`. */
type SpawnedChild = ChildProcessByStdio<null, Readable, Readable>;

/** The four process outcomes. This is a process taxonomy, not a workflow taxonomy. */
export type ProcessStatus = "success" | "failure" | "timeout" | "spawn-error";

export interface ProcessExecutionRequest {
  /** Absolute path to a native executable. Never a shell string. */
  readonly command: string;
  /** Argument vector. Passed to the OS verbatim, one element per argument. */
  readonly args: readonly string[];
  readonly cwd: string;
  /** Hard limit. The child is terminated when it elapses. */
  readonly timeoutMs: number;
  /** Environment for the child. Inherits the operator environment; adds no secrets of its own. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Upper bound on captured bytes per stream. */
  readonly maxOutputBytes: number;
  /** Grace period between the first kill signal and the forced kill. */
  readonly killGraceMs: number;
}

interface ProcessOutcomeBase {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** True only when the timeout fired. */
  readonly timedOut: boolean;
  /** True when output hit `maxOutputBytes` and was cut. */
  readonly truncated: boolean;
  readonly signal: NodeJS.Signals | null;
}

/** Process ran to completion and exited 0. Says nothing about workflow correctness. */
export interface ProcessSuccess extends ProcessOutcomeBase {
  readonly status: "success";
  readonly exitCode: 0;
}

/** Process ran to completion and did NOT exit 0. Never reported as success. */
export interface ProcessFailure extends ProcessOutcomeBase {
  readonly status: "failure";
  readonly exitCode: number | null;
}

/** Process exceeded `timeoutMs` and was terminated. */
export interface ProcessTimeout extends ProcessOutcomeBase {
  readonly status: "timeout";
  readonly exitCode: null;
  /** Always true: termination is part of the timeout contract, not best effort. */
  readonly terminationAttempted: true;
  readonly terminationSignals: readonly NodeJS.Signals[];
}

/** The executable could not be started at all (missing binary, EACCES, ...). */
export interface ProcessSpawnError extends ProcessOutcomeBase {
  readonly status: "spawn-error";
  readonly exitCode: null;
  readonly errorCode: string;
  readonly errorMessage: string;
}

export type ProcessExecutionOutcome =
  | ProcessSuccess
  | ProcessFailure
  | ProcessTimeout
  | ProcessSpawnError;

/** Injectable so tests never spawn a real process. */
export interface ProcessRunner {
  run(request: ProcessExecutionRequest): Promise<ProcessExecutionOutcome>;
}

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 2_000;

export function defaultMaxOutputBytes(): number {
  return DEFAULT_MAX_OUTPUT_BYTES;
}

export function defaultKillGraceMs(): number {
  return DEFAULT_KILL_GRACE_MS;
}

class BoundedBuffer {
  #chunks: Buffer[] = [];
  #size = 0;
  #truncated = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    const remaining = this.limit - this.#size;
    if (remaining <= 0) {
      // Keep draining so the child never blocks on a full pipe, but store nothing.
      this.#truncated = true;
      return;
    }
    if (chunk.length <= remaining) {
      this.#chunks.push(chunk);
      this.#size += chunk.length;
      return;
    }
    this.#chunks.push(chunk.subarray(0, remaining));
    this.#size = this.limit;
    this.#truncated = true;
  }

  toString(): string {
    return Buffer.concat(this.#chunks).toString("utf8");
  }

  get truncated(): boolean {
    return this.#truncated;
  }
}

/**
 * Real process runner built on `node:child_process.spawn`.
 *
 * `shell` is explicitly `false` and must stay that way. It is asserted here so a
 * future edit cannot quietly reintroduce shell interpretation.
 */
export class NodeProcessRunner implements ProcessRunner {
  run(request: ProcessExecutionRequest): Promise<ProcessExecutionOutcome> {
    const startedAt = Date.now();
    const stdout = new BoundedBuffer(request.maxOutputBytes);
    const stderr = new BoundedBuffer(request.maxOutputBytes);

    return new Promise<ProcessExecutionOutcome>((resolve) => {
      let settled = false;
      let timedOut = false;
      const terminationSignals: NodeJS.Signals[] = [];
      let child: SpawnedChild | null = null;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminationSignals.push("SIGTERM");
        child?.kill("SIGTERM");
        // Escalate if the child ignores the polite signal.
        const forceHandle = setTimeout(() => {
          terminationSignals.push("SIGKILL");
          child?.kill("SIGKILL");
        }, request.killGraceMs);
        forceHandle.unref();
      }, request.timeoutMs);
      timeoutHandle.unref();

      const finish = (outcome: ProcessExecutionOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        resolve(outcome);
      };

      const base = (): ProcessOutcomeBase => ({
        command: request.command,
        args: [...request.args],
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
        signal: child?.signalCode ?? null,
      });

      try {
        child = spawn(request.command, [...request.args], {
          cwd: request.cwd,
          env: { ...request.env } as NodeJS.ProcessEnv,
          // Hard requirement. See the module header.
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        finish({
          status: "spawn-error",
          exitCode: null,
          ...base(),
          errorCode: err.code ?? "SPAWN_THREW",
          errorMessage: err.message,
        });
        return;
      }

      // Narrowed once, then used inside closures. `child` stays `null` only on the
      // throw path, which already returned above.
      const proc = child;
      if (proc === null) return;

      proc.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      proc.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

      proc.on("error", (error: NodeJS.ErrnoException) => {
        // A post-spawn `error` can mean the kill failed. The timeout branch below
        // already owns that case, so only unhandled spawn errors land here.
        if (timedOut) {
          finish({
            status: "timeout",
            exitCode: null,
            ...base(),
            terminationAttempted: true,
            terminationSignals: [...terminationSignals],
          });
          return;
        }
        finish({
          status: "spawn-error",
          exitCode: null,
          ...base(),
          errorCode: error.code ?? "SPAWN_ERROR",
          errorMessage: error.message,
        });
      });

      proc.on("close", (code: number | null) => {
        if (timedOut) {
          finish({
            status: "timeout",
            exitCode: null,
            ...base(),
            terminationAttempted: true,
            terminationSignals: [...terminationSignals],
          });
          return;
        }
        if (code === 0) {
          finish({ status: "success", exitCode: 0, ...base() });
          return;
        }
        // Non-zero exit OR death by signal. Both are failures. Never success.
        finish({ status: "failure", exitCode: code, ...base() });
      });
    });
  }
}

export function createProcessRunner(): ProcessRunner {
  return new NodeProcessRunner();
}
