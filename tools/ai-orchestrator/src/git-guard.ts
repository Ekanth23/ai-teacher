/**
 * Stage 2A — Git safety boundary.
 *
 * PURPOSE
 * -------
 * Protect pre-existing, unrelated work. The AI Teacher repository routinely carries
 * uncommitted changes that belong to someone else. The guard makes it structurally
 * impossible for the orchestrator to blur authorship of a change.
 *
 * STAGE 2A HARD RULES
 * -------------------
 * This module must not, and does not:
 *   - stage      (`git add`)
 *   - commit     (`git commit`)
 *   - stash      (`git stash`)
 *   - reset      (`git reset`)
 *   - clean      (`git clean`)
 *   - checkout   (`git checkout`)
 *   - restore / revert / merge / rebase / push / rm / mv
 *
 * It does not import a git library and does not spawn `git`. Every method that
 * would need to read the repository throws. Only *pure* snapshot math is
 * implemented, because that math needs no repository access and is what a reviewer
 * most needs to audit.
 *
 * SAFETY RULES ENCODED HERE
 * -------------------------
 *   UNAUTHORIZED FILE -> STOP
 *   PRE-EXISTING CHANGE -> PROTECTED (never attributed to the workflow, never touched)
 */

import { NotImplementedInStageError } from "./errors.js";
import type { ChangedPath, GitPathState } from "./result-parser.js";

/** Stage that is expected to implement repository access. */
export const GUARD_PLANNED_STAGE = "Stage 2B" as const;

/**
 * Git subcommands that mutate repository or index state. The orchestrator refuses
 * all of them. Listed here so Stage 2B has a single, testable deny-list.
 */
export const FORBIDDEN_GIT_SUBCOMMANDS: readonly string[] = Object.freeze([
  "add",
  "am",
  "checkout",
  "clean",
  "commit",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
]);

/** Read-only subcommands a future stage is allowed to use. */
export const ALLOWED_READONLY_GIT_SUBCOMMANDS: readonly string[] = Object.freeze([
  "diff",
  "log",
  "rev-parse",
  "status",
  "ls-files",
]);

/**
 * Fail-fast check used by any future git invocation wrapper.
 *
 * Pure. A future stage must call this before every `git` spawn.
 */
export function isReadOnlyGitInvocation(subcommand: string): boolean {
  const normalized = subcommand.trim().toLowerCase();
  if (FORBIDDEN_GIT_SUBCOMMANDS.includes(normalized)) return false;
  return ALLOWED_READONLY_GIT_SUBCOMMANDS.includes(normalized);
}

export function assertReadOnlyGitInvocation(subcommand: string): void {
  if (!isReadOnlyGitInvocation(subcommand)) {
    throw new NotImplementedInStageError(
      `git ${subcommand} (Stage 2A refuses all mutating git operations)`,
      "Stage 2A",
      GUARD_PLANNED_STAGE,
    );
  }
}

export interface GitSnapshot {
  readonly capturedAt: string;
  readonly headCommit: string | null;
  /** Tracked paths with staged changes. */
  readonly stagedPaths: readonly string[];
  /** Tracked paths modified in the working tree. */
  readonly modifiedPaths: readonly string[];
  /** Untracked paths. */
  readonly untrackedPaths: readonly string[];
}

/** A baseline is a snapshot taken before any workflow action. */
export type GitBaseline = GitSnapshot & { readonly kind: "baseline" };

/** A current snapshot taken after a workflow action. */
export type GitCurrentState = GitSnapshot & { readonly kind: "current" };

export interface PathChangeSet {
  readonly added: readonly string[];
  readonly modified: readonly string[];
  readonly removed: readonly string[];
  readonly all: readonly string[];
}

export interface GuardScope {
  /** Repository-relative path prefixes this workflow is authorized to touch. */
  readonly allowedPrefixes: readonly string[];
  /** Exact repository-relative paths this workflow is authorized to touch. */
  readonly allowedExactPaths: readonly string[];
}

export interface GuardVerdict {
  readonly allowed: boolean;
  /** Paths that changed and are not in scope. Non-empty means STOP. */
  readonly unauthorizedPaths: readonly string[];
  /**
   * Changed paths that were ALREADY dirty at baseline. They are never attributed
   * to the workflow and never reverted; they are surfaced for human review because
   * the workflow touched someone else's work.
   *
   * A pre-existing path that the workflow left untouched produces NO entry here —
   * it is not a change at all.
   */
  readonly protectedPaths: readonly string[];
  readonly reason: string;
  /** Always "STOP" when `allowed` is false. */
  readonly onViolation: "STOP";
}

export const GUARD_INVARIANTS: readonly string[] = [
  "The orchestrator never stages, commits, stashes, resets, cleans, or checks out.",
  "A baseline is captured before any workflow action and is never rewritten.",
  "Pre-existing modifications are protected and never attributed to the workflow.",
  "Any changed path outside the authorized scope is a STOP condition.",
  "A changed pre-existing path is reported for human review, never auto-reverted.",
];

export interface GitGuard {
  /** Capture the pre-workflow baseline. Read-only. */
  captureBaseline(): Promise<GitBaseline>;
  /** Capture the current state for comparison. Read-only. */
  captureCurrentState(): Promise<GitCurrentState>;
  /** Diff current state against a baseline. Pure once both snapshots exist. */
  diffAgainstBaseline(baseline: GitBaseline, current: GitCurrentState): PathChangeSet;
  /** Decide whether the observed changes are permitted. Pure. */
  evaluate(baseline: GitBaseline | null, current: GitCurrentState, scope: GuardScope): GuardVerdict;
}

/* -------------------------------------------------------------------------- */
/* Pure snapshot math — implemented in Stage 2A because it needs no I/O.       */
/* -------------------------------------------------------------------------- */

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}

/**
 * Every state a path is reported in by a single snapshot.
 *
 * A path can be in more than one list (e.g. untracked at baseline and later both
 * staged and modified). Comparing a single collapsed state would miss that
 * transition, so the diff compares the full flag set instead.
 */
function stateFlags(snapshot: GitSnapshot, path: string): readonly string[] {
  const flags: string[] = [];
  if (snapshot.untrackedPaths.includes(path)) flags.push("untracked");
  if (snapshot.stagedPaths.includes(path)) flags.push("staged");
  if (snapshot.modifiedPaths.includes(path)) flags.push("modified");
  return flags;
}

function sameFlags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((flag, index) => flag === b[index]);
}

/** Human-readable dominant state for reporting. */
function dominantState(flags: readonly string[]): GitPathState {
  const has = (flag: string) => flags.includes(flag);
  if (has("conflicted")) return "conflicted";
  if (has("staged") && has("modified")) return "modified";
  if (has("staged")) return "added";
  if (has("modified")) return "modified";
  if (has("deleted")) return "deleted";
  return "untracked";
}

/** Union of all paths a snapshot reports. */
export function snapshotPaths(snapshot: GitSnapshot): string[] {
  return uniqueSorted([...snapshot.stagedPaths, ...snapshot.modifiedPaths, ...snapshot.untrackedPaths]);
}

/** Pure path-set diff between two snapshots. */
export function diffSnapshots(baseline: GitSnapshot, current: GitSnapshot): PathChangeSet {
  const before = new Set(snapshotPaths(baseline));
  const after = new Set(snapshotPaths(current));

  const added = uniqueSorted([...after].filter((path) => !before.has(path)));
  const removed = uniqueSorted([...before].filter((path) => !after.has(path)));
  const modified = uniqueSorted(
    [...after].filter((path) => before.has(path) && !sameFlags(stateFlags(baseline, path), stateFlags(current, path))),
  );

  return { added, modified, removed, all: uniqueSorted([...added, ...modified, ...removed]) };
}

function isAuthorized(path: string, scope: GuardScope): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (scope.allowedExactPaths.includes(normalized)) return true;
  return scope.allowedPrefixes.some((prefix) => {
    const clean = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
    return clean === "" || normalized === clean || normalized.startsWith(`${clean}/`);
  });
}

/**
 * Pure guard evaluation.
 *
 * `baseline === null` is treated as unsafe-by-default: with no baseline, no path
 * can be distinguished as pre-existing, so nothing is treated as authorized.
 */
export function evaluateGuard(
  baseline: GitBaseline | null,
  current: GitCurrentState,
  scope: GuardScope,
): GuardVerdict {
  const beforePaths = new Set(baseline === null ? [] : snapshotPaths(baseline));
  const changes = baseline === null
    ? { added: snapshotPaths(current), modified: [], removed: [], all: snapshotPaths(current) }
    : diffSnapshots(baseline, current);

  const protectedPaths = changes.all.filter((path) => beforePaths.has(path));
  const unauthorizedPaths = changes.all.filter((path) => !isAuthorized(path, scope));

  if (baseline === null) {
    return {
      allowed: false,
      unauthorizedPaths,
      protectedPaths,
      reason: "No git baseline was captured. UNAUTHORIZED FILE -> STOP.",
      onViolation: "STOP",
    };
  }

  if (unauthorizedPaths.length > 0) {
    return {
      allowed: false,
      unauthorizedPaths,
      protectedPaths,
      reason: `${unauthorizedPaths.length} changed path(s) fall outside the authorized scope. UNAUTHORIZED FILE -> STOP.`,
      onViolation: "STOP",
    };
  }

  return {
    allowed: true,
    unauthorizedPaths,
    protectedPaths,
    reason:
      protectedPaths.length > 0
        ? `All changes are in scope, but ${protectedPaths.length} pre-existing path(s) were also modified and require human review.`
        : "All changes are in scope and no pre-existing path was modified.",
    onViolation: "STOP",
  };
}

/** Convert a guard verdict into the changed-path model used by `result-parser.ts`. */
export function toChangedPaths(
  current: GitCurrentState,
  baseline: GitBaseline | null,
  scope: GuardScope,
): ChangedPath[] {
  const beforePaths = new Set(baseline === null ? [] : snapshotPaths(baseline));
  const changes = baseline === null
    ? { added: snapshotPaths(current), modified: [], removed: [], all: snapshotPaths(current) }
    : diffSnapshots(baseline, current);

  return changes.all.map((path) => ({
    path,
    state: dominantState(stateFlags(current, path)),
    preExisting: beforePaths.has(path),
    authorized: isAuthorized(path, scope),
  }));
}

/* -------------------------------------------------------------------------- */
/* Stage 2A guard — repository access is stubbed.                              */
/* -------------------------------------------------------------------------- */

/**
 * Stage 2A guard.
 *
 * Snapshot math works; anything that would read the repository throws. Nothing
 * here mutates git, and nothing here ever will without a separately approved
 * change.
 */
export class Stage2AGitGuard implements GitGuard {
  captureBaseline(): Promise<GitBaseline> {
    return Promise.reject(new NotImplementedInStageError("GitGuard.captureBaseline", "Stage 2A", GUARD_PLANNED_STAGE));
  }

  captureCurrentState(): Promise<GitCurrentState> {
    return Promise.reject(new NotImplementedInStageError("GitGuard.captureCurrentState", "Stage 2A", GUARD_PLANNED_STAGE));
  }

  diffAgainstBaseline(baseline: GitBaseline, current: GitCurrentState): PathChangeSet {
    return diffSnapshots(baseline, current);
  }

  evaluate(baseline: GitBaseline | null, current: GitCurrentState, scope: GuardScope): GuardVerdict {
    return evaluateGuard(baseline, current, scope);
  }
}

export function createGitGuard(): GitGuard {
  return new Stage2AGitGuard();
}
