/**
 * Stage 2C — Real Git Guard implementation.
 *
 * PURPOSE
 * -------
 * Capture read-only git snapshots with content hashes, compare them, and
 * evaluate whether changes are authorized. Uses only read-only git commands.
 *
 * CONTRACT (Section 10)
 * ----------------------
 * - Prohibited operations: add, am, checkout, clean, commit, merge, mv, pull,
 *   push, rebase, reset, restore, revert, rm, stash, switch
 * - Permitted read-only operations: diff, log, rev-parse, status, ls-files
 * - Content hashes for pre-existing modified and untracked files
 * - Complete path set comparison (baseline union current)
 * - Protected-file rule: pre-existing modified/untracked files that change
 *   during execution are BLOCKED
 * - filePermissions precedence: when non-empty, authoritative
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  GitBaseline,
  GitCurrentState,
  GitGuard,
  GitSnapshot,
  GuardScope,
  GuardVerdict,
  PathChangeSet,
} from "./git-guard.js";
import {
  diffSnapshots,
  evaluateGuard,
  assertReadOnlyGitInvocation,
} from "./git-guard.js";
import type { ProcessRunner, ProcessExecutionOutcome } from "./opencode-process.js";

/** Result of a git command execution. */
interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Options for the Git Guard implementation. */
export interface GitGuardOptions {
  /** Working directory for git commands. */
  readonly workingDirectory: string;
  /** Git command to use. Defaults to "git". */
  readonly gitCommand?: string;
  /** Process runner for executing git commands. */
  readonly processRunner: ProcessRunner;
  /** Injectable for tests. */
  readonly readFile?: (filePath: string) => string | null;
}

/**
 * Execute a git command and return the result.
 *
 * Only read-only commands are permitted. All commands are validated against
 * the deny-list before execution. Uses the injected ProcessRunner for all
 * process execution.
 */
async function executeGitCommand(
  options: GitGuardOptions,
  args: readonly string[],
): Promise<GitCommandResult> {
  const subcommand = args[0] ?? "";
  assertReadOnlyGitInvocation(subcommand);

  const command = options.gitCommand ?? "git";
  const outcome: ProcessExecutionOutcome = await options.processRunner.run({
    command,
    args: [...args],
    cwd: options.workingDirectory,
    timeoutMs: 30_000,
    env: process.env,
    maxOutputBytes: 4 * 1024 * 1024,
    killGraceMs: 2_000,
  });

  return {
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    exitCode: outcome.status === "success" ? 0 : (outcome.exitCode ?? 1),
  };
}

/**
 * Calculate the SHA-256 hash of file content.
 *
 * Returns null if the file cannot be read.
 */
function hashFileContent(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Parse porcelain status output.
 *
 * Returns staged paths, modified paths, untracked paths, renamed paths,
 * and deleted paths.
 */
function parsePorcelainStatus(porcelain: string): {
  stagedPaths: string[];
  modifiedPaths: string[];
  untrackedPaths: string[];
  renamedPaths: { from: string; to: string }[];
  deletedPaths: string[];
} {
  const stagedPaths: string[] = [];
  const modifiedPaths: string[] = [];
  const untrackedPaths: string[] = [];
  const renamedPaths: { from: string; to: string }[] = [];
  const deletedPaths: string[] = [];

  for (const line of porcelain.split("\n")) {
    if (line.trim().length === 0) continue;

    // Porcelain format: XY PATH or XY ORIG_PATH -> NEW_PATH
    const status = line.slice(0, 2);
    const rest = line.slice(3).trim();

    if (rest.length === 0) continue;

    const x = status[0] ?? " "; // staged status
    const y = status[1] ?? " "; // unstaged status

    // Handle renames: R  OLD_PATH -> NEW_PATH
    if (x === "R" || y === "R") {
      const arrowIndex = rest.indexOf(" -> ");
      if (arrowIndex !== -1) {
        const from = rest.slice(0, arrowIndex).trim();
        const to = rest.slice(arrowIndex + 4).trim();
        renamedPaths.push({ from, to });
        stagedPaths.push(to);
        continue;
      }
    }

    // Handle deletions
    if (x === "D" || y === "D") {
      deletedPaths.push(rest);
      if (x === "D") stagedPaths.push(rest);
      if (y === "D") modifiedPaths.push(rest);
      continue;
    }

    // Handle untracked
    if (x === "?" && y === "?") {
      untrackedPaths.push(rest);
      continue;
    }

    // Handle staged changes
    if (x !== " " && x !== "?") {
      stagedPaths.push(rest);
    }

    // Handle unstaged modifications
    if (y !== " " && y !== "?") {
      modifiedPaths.push(rest);
    }
  }

  return { stagedPaths, modifiedPaths, untrackedPaths, renamedPaths, deletedPaths };
}

/**
 * Capture a git snapshot with content hashes.
 *
 * Uses read-only git commands: rev-parse, status, diff, ls-files.
 */
async function captureSnapshot(
  options: GitGuardOptions,
  kind: "baseline" | "current",
): Promise<GitSnapshot> {
  const now = new Date().toISOString();

  // 1. Get HEAD commit
  const headResult = await executeGitCommand(options, ["rev-parse", "HEAD"]);
  const headCommit = headResult.exitCode === 0 ? headResult.stdout.trim() : null;

  // 2. Get porcelain status
  const statusResult = await executeGitCommand(options, ["status", "--porcelain=v1"]);
  const porcelain = statusResult.stdout;

  // 3. Get staged paths
  const stagedResult = await executeGitCommand(options, ["diff", "--cached", "--name-only"]);
  const stagedPaths = stagedResult.exitCode === 0
    ? stagedResult.stdout.split("\n").map((p) => p.trim()).filter((p) => p.length > 0)
    : [];

  // 4. Get unstaged modified paths
  const modifiedResult = await executeGitCommand(options, ["diff", "--name-only"]);
  const modifiedPaths = modifiedResult.exitCode === 0
    ? modifiedResult.stdout.split("\n").map((p) => p.trim()).filter((p) => p.length > 0)
    : [];

  // 5. Get untracked paths
  const untrackedResult = await executeGitCommand(options, ["ls-files", "--others", "--exclude-standard"]);
  const untrackedPaths = untrackedResult.exitCode === 0
    ? untrackedResult.stdout.split("\n").map((p) => p.trim()).filter((p) => p.length > 0)
    : [];

  // 6. Parse porcelain for renames and deletions
  const parsed = parsePorcelainStatus(porcelain);

  // 7. Calculate content hashes for pre-existing modified and untracked files
  const contentHashes: Record<string, string | null> = {};
  const pathsToHash = [...modifiedPaths, ...untrackedPaths, ...parsed.deletedPaths];

  for (const filePath of pathsToHash) {
    const absolutePath = path.resolve(options.workingDirectory, filePath);
    const hash = options.readFile
      ? (options.readFile(absolutePath) === null ? null : createHash("sha256").update(options.readFile(absolutePath)!).digest("hex"))
      : hashFileContent(absolutePath);
    contentHashes[filePath] = hash;
  }

  return {
    capturedAt: now,
    headCommit,
    stagedPaths: [...stagedPaths, ...parsed.stagedPaths],
    modifiedPaths: [...modifiedPaths, ...parsed.modifiedPaths],
    untrackedPaths: [...untrackedPaths, ...parsed.untrackedPaths],
    renamedPaths: parsed.renamedPaths,
    deletedPaths: parsed.deletedPaths,
    porcelainStatus: porcelain,
    contentHashes,
    kind,
  } as GitSnapshot & { readonly kind: "baseline" | "current" };
}

/**
 * Real Git Guard implementation.
 *
 * Captures read-only git snapshots with content hashes, compares them, and
 * evaluates whether changes are authorized.
 */
export class GitGuardImpl implements GitGuard {
  readonly #options: GitGuardOptions;

  constructor(options: GitGuardOptions) {
    this.#options = options;
  }

  async captureBaseline(): Promise<GitBaseline> {
    return captureSnapshot(this.#options, "baseline") as Promise<GitBaseline>;
  }

  async captureCurrentState(): Promise<GitCurrentState> {
    return captureSnapshot(this.#options, "current") as Promise<GitCurrentState>;
  }

  diffAgainstBaseline(baseline: GitBaseline, current: GitCurrentState): PathChangeSet {
    return diffSnapshots(baseline, current);
  }

  evaluate(baseline: GitBaseline | null, current: GitCurrentState, scope: GuardScope): GuardVerdict {
    return evaluateGuard(baseline, current, scope);
  }
}

/**
 * Factory for the real Git Guard.
 */
export function createRealGitGuard(options: GitGuardOptions): GitGuard {
  return new GitGuardImpl(options);
}

/**
 * Factory for the real Git Guard with a ProcessRunner.
 *
 * This is the production factory that wires the Git Guard to the orchestrator's
 * ProcessRunner. The ProcessRunner is the single process execution site.
 */
export function createProcessRunnerGitGuard(options: {
  readonly workingDirectory: string;
  readonly processRunner: ProcessRunner;
  readonly gitCommand?: string;
  readonly readFile?: (filePath: string) => string | null;
}): GitGuard {
  return new GitGuardImpl({
    workingDirectory: options.workingDirectory,
    processRunner: options.processRunner,
    ...(options.gitCommand !== undefined ? { gitCommand: options.gitCommand } : {}),
    ...(options.readFile !== undefined ? { readFile: options.readFile } : {}),
  });
}
