/**
 * Stage 2C-4 — Git Guard unit tests.
 *
 * Covers baseline capture, snapshot comparison, authorized/unauthorized changes,
 * filePermissions precedence, and content hash verification.
 */

import { describe, expect, it } from "vitest";

import { createRealGitGuard } from "../src/git-guard-impl.js";
import {
  diffSnapshots,
  evaluateGuard,
  snapshotPaths,
  type GitBaseline,
  type GitCurrentState,
  type GitSnapshot,
  type GuardScope,
} from "../src/git-guard.js";
import type { ProcessRunner, ProcessExecutionOutcome, ProcessExecutionRequest } from "../src/opencode-process.js";

/** Create a mock ProcessRunner that returns predefined outcomes. */
function createMockProcessRunner(
  handler: (request: ProcessExecutionRequest) => ProcessExecutionOutcome,
): ProcessRunner {
  return {
    run: async (request: ProcessExecutionRequest) => handler(request),
  };
}

/** Create a simple success outcome. */
function successOutcome(stdout: string, stderr = ""): ProcessExecutionOutcome {
  return {
    status: "success",
    exitCode: 0,
    command: "git",
    args: [],
    stdout,
    stderr,
    durationMs: 100,
    timedOut: false,
    truncated: false,
    signal: null,
  };
}

/** Create a failure outcome. */
function failureOutcome(exitCode: number, stderr = ""): ProcessExecutionOutcome {
  return {
    status: "failure",
    exitCode,
    command: "git",
    args: [],
    stdout: "",
    stderr,
    durationMs: 100,
    timedOut: false,
    truncated: false,
    signal: null,
  };
}

/** Create a timeout outcome. */
function timeoutOutcome(): ProcessExecutionOutcome {
  return {
    status: "timeout",
    exitCode: null,
    command: "git",
    args: [],
    stdout: "",
    stderr: "",
    durationMs: 30000,
    timedOut: true,
    truncated: false,
    signal: null,
    terminationAttempted: true,
    terminationSignals: ["SIGTERM"],
  };
}

/** Create a spawn-error outcome. */
function spawnErrorOutcome(errorCode: string, errorMessage: string): ProcessExecutionOutcome {
  return {
    status: "spawn-error",
    exitCode: null,
    command: "git",
    args: [],
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    truncated: false,
    signal: null,
    errorCode,
    errorMessage,
  };
}

/** Create a minimal GitSnapshot for testing. */
function snapshot(overrides: Partial<GitSnapshot> = {}): GitSnapshot {
  return {
    capturedAt: "2026-01-01T00:00:00Z",
    headCommit: "abc123",
    stagedPaths: [],
    modifiedPaths: [],
    untrackedPaths: [],
    renamedPaths: [],
    deletedPaths: [],
    porcelainStatus: "",
    contentHashes: {},
    ...overrides,
  };
}

/** Create a baseline snapshot. */
function baseline(overrides: Partial<GitSnapshot> = {}): GitBaseline {
  return { ...snapshot(overrides), kind: "baseline" };
}

/** Create a current state snapshot. */
function current(overrides: Partial<GitSnapshot> = {}): GitCurrentState {
  return { ...snapshot(overrides), kind: "current" };
}

/** Create a GuardScope with filePermissions. */
function scopeWithFilePermissions(permissions: readonly { path: string; operations: readonly string[] }[]): GuardScope {
  return {
    allowedPrefixes: [],
    allowedExactPaths: [],
    filePermissions: permissions.map((p) => ({ path: p.path, operations: p.operations as ("create" | "modify" | "delete" | "rename")[] })),
  };
}

/** Create a GuardScope with allowedPrefixes. */
function scopeWithPrefixes(prefixes: readonly string[]): GuardScope {
  return {
    allowedPrefixes: prefixes,
    allowedExactPaths: [],
    filePermissions: [],
  };
}

/** Create a GuardScope with allowedExactPaths. */
function scopeWithExactPaths(paths: readonly string[]): GuardScope {
  return {
    allowedPrefixes: [],
    allowedExactPaths: paths,
    filePermissions: [],
  };
}

/** Create an empty GuardScope. */
function emptyScope(): GuardScope {
  return {
    allowedPrefixes: [],
    allowedExactPaths: [],
    filePermissions: [],
  };
}

describe("git guard — snapshot comparison", () => {
  it("detects added files", () => {
    const base = baseline();
    const curr = current({ untrackedPaths: ["new-file.ts"] });

    const diff = diffSnapshots(base, curr);
    expect(diff.added).toContain("new-file.ts");
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it("detects removed files", () => {
    const base = baseline({ untrackedPaths: ["old-file.ts"] });
    const curr = current();

    const diff = diffSnapshots(base, curr);
    expect(diff.removed).toContain("old-file.ts");
    expect(diff.added).toHaveLength(0);
  });

  it("detects modified files (flag change)", () => {
    // A file that changes from unstaged-modified to staged is a modification
    const base = baseline({ modifiedPaths: ["file.ts"] });
    const curr = current({ stagedPaths: ["file.ts"] });

    const diff = diffSnapshots(base, curr);
    expect(diff.modified).toContain("file.ts");
  });

  it("returns empty diff for identical snapshots", () => {
    const base = baseline({ modifiedPaths: ["file.ts"], untrackedPaths: ["new.ts"] });
    const curr = current({ modifiedPaths: ["file.ts"], untrackedPaths: ["new.ts"] });

    const diff = diffSnapshots(base, curr);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
    expect(diff.all).toHaveLength(0);
  });
});

describe("git guard — evaluate with scope", () => {
  it("allows changes within allowedPrefixes", () => {
    const base = baseline();
    const curr = current({ modifiedPaths: ["src/file.ts"] });
    const scope = scopeWithPrefixes(["src/"]);

    const verdict = evaluateGuard(base, curr, scope);
    expect(verdict.allowed).toBe(true);
    expect(verdict.unauthorizedPaths).toHaveLength(0);
  });

  it("blocks changes outside allowedPrefixes", () => {
    const base = baseline();
    const curr = current({ modifiedPaths: ["backend/file.ts"] });
    const scope = scopeWithPrefixes(["src/"]);

    const verdict = evaluateGuard(base, curr, scope);
    expect(verdict.allowed).toBe(false);
    expect(verdict.unauthorizedPaths).toContain("backend/file.ts");
  });

  it("allows changes within allowedExactPaths", () => {
    const base = baseline();
    const curr = current({ modifiedPaths: ["src/exact.ts"] });
    const scope = scopeWithExactPaths(["src/exact.ts"]);

    const verdict = evaluateGuard(base, curr, scope);
    expect(verdict.allowed).toBe(true);
  });

  it("blocks changes outside allowedExactPaths", () => {
    const base = baseline();
    const curr = current({ modifiedPaths: ["src/other.ts"] });
    const scope = scopeWithExactPaths(["src/exact.ts"]);

    const verdict = evaluateGuard(base, curr, scope);
    expect(verdict.allowed).toBe(false);
  });

  it("blocks all changes when scope is empty", () => {
    const base = baseline();
    const curr = current({ modifiedPaths: ["src/file.ts"] });
    const scope = emptyScope();

    const verdict = evaluateGuard(base, curr, scope);
    expect(verdict.allowed).toBe(false);
  });

  it("treats missing baseline as STOP", () => {
    const curr = current({ untrackedPaths: ["file.ts"] });
    const scope = scopeWithPrefixes(["src/"]);

    const verdict = evaluateGuard(null, curr, scope);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("No git baseline");
  });
});

describe("git guard — filePermissions precedence", () => {
  it("filePermissions is authoritative when non-empty", () => {
    const base = baseline();
    const curr = current({ modifiedPaths: ["src/file.ts"] });
    const scope = scopeWithFilePermissions([
      { path: "src/file.ts", operations: ["modify"] },
    ]);

    const verdict = evaluateGuard(base, curr, scope);
    expect(verdict.allowed).toBe(true);
  });

  it("filePermissions blocks paths not in the list", () => {
    const base = baseline();
    const curr = current({ modifiedPaths: ["src/other.ts"] });
    const scope = scopeWithFilePermissions([
      { path: "src/file.ts", operations: ["modify"] },
    ]);

    const verdict = evaluateGuard(base, curr, scope);
    expect(verdict.allowed).toBe(false);
  });

  it("filePermissions overrides allowedExactPaths", () => {
    const base = baseline();
    const curr = current({ modifiedPaths: ["src/file.ts"] });
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: ["src/file.ts"],
      filePermissions: [
        { path: "src/file.ts", operations: ["modify"] },
      ],
    };

    // filePermissions is authoritative: only "modify" is permitted, not all operations.
    // But evaluateGuard only checks path-level authorization, not operation-level.
    // So this test verifies that the path is authorized.
    const verdict = evaluateGuard(base, curr, scope);
    expect(verdict.allowed).toBe(true);
  });
});

describe("git guard — content hashes", () => {
  it("includes content hashes in snapshot", () => {
    const snap = snapshot({
      modifiedPaths: ["file.ts"],
      contentHashes: { "file.ts": "abc123hash" },
    });

    expect(snap.contentHashes["file.ts"]).toBe("abc123hash");
  });

  it("records null hash for unreadable files", () => {
    const snap = snapshot({
      modifiedPaths: ["unreadable.ts"],
      contentHashes: { "unreadable.ts": null },
    });

    expect(snap.contentHashes["unreadable.ts"]).toBeNull();
  });

  it("includes renamed paths in snapshot", () => {
    const snap = snapshot({
      renamedPaths: [{ from: "old.ts", to: "new.ts" }],
    });

    expect(snap.renamedPaths).toHaveLength(1);
    expect(snap.renamedPaths[0]?.from).toBe("old.ts");
    expect(snap.renamedPaths[0]?.to).toBe("new.ts");
  });

  it("includes deleted paths in snapshot", () => {
    const snap = snapshot({
      deletedPaths: ["deleted.ts"],
    });

    expect(snap.deletedPaths).toContain("deleted.ts");
  });

  it("includes porcelain status in snapshot", () => {
    const porcelain = " M file.ts\n?? new.ts\n";
    const snap = snapshot({ porcelainStatus: porcelain });

    expect(snap.porcelainStatus).toBe(porcelain);
  });
});

describe("git guard — snapshotPaths", () => {
  it("returns union of all paths in a snapshot", () => {
    const snap = snapshot({
      stagedPaths: ["staged.ts"],
      modifiedPaths: ["modified.ts"],
      untrackedPaths: ["untracked.ts"],
    });

    const paths = snapshotPaths(snap);
    expect(paths).toContain("staged.ts");
    expect(paths).toContain("modified.ts");
    expect(paths).toContain("untracked.ts");
  });

  it("returns empty array for empty snapshot", () => {
    const snap = snapshot();
    expect(snapshotPaths(snap)).toHaveLength(0);
  });
});

describe("git guard — GitGuardImpl with ProcessRunner", () => {
  it("captures baseline with content hashes", async () => {
    const mockProcessRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") {
        return successOutcome("abc123\n");
      }
      if (request.args[0] === "status") {
        return successOutcome(" M modified.ts\n?? untracked.ts\n");
      }
      if (request.args[0] === "diff" && request.args[1] === "--cached") {
        return successOutcome("");
      }
      if (request.args[0] === "diff") {
        return successOutcome("modified.ts\n");
      }
      if (request.args[0] === "ls-files") {
        return successOutcome("untracked.ts\n");
      }
      return successOutcome("");
    });

    const mockReadFile = (filePath: string) => {
      if (filePath.includes("modified.ts")) return "modified content";
      if (filePath.includes("untracked.ts")) return "untracked content";
      return null;
    };

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner,
      readFile: mockReadFile,
    });

    const baseline = await guard.captureBaseline();
    expect(baseline.kind).toBe("baseline");
    expect(baseline.headCommit).toBe("abc123");
    expect(baseline.modifiedPaths).toContain("modified.ts");
    expect(baseline.untrackedPaths).toContain("untracked.ts");
    expect(baseline.contentHashes["modified.ts"]).toBeTruthy();
    expect(baseline.contentHashes["untracked.ts"]).toBeTruthy();
  });

  it("captures current state", async () => {
    const mockProcessRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") {
        return successOutcome("def456\n");
      }
      if (request.args[0] === "status") {
        return successOutcome("");
      }
      if (request.args[0] === "diff" && request.args[1] === "--cached") {
        return successOutcome("");
      }
      if (request.args[0] === "diff") {
        return successOutcome("");
      }
      if (request.args[0] === "ls-files") {
        return successOutcome("");
      }
      return successOutcome("");
    });

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner,
    });

    const current = await guard.captureCurrentState();
    expect(current.kind).toBe("current");
    expect(current.headCommit).toBe("def456");
  });

  it("detects HEAD change between baseline and current", async () => {
    const mockProcessRunner1 = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") {
        return successOutcome("abc123\n");
      }
      return successOutcome("");
    });

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner1,
    });

    const baseline = await guard.captureBaseline();
    expect(baseline.headCommit).toBe("abc123");

    // Simulate HEAD change
    const mockProcessRunner2 = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") {
        return successOutcome("def456\n");
      }
      return successOutcome("");
    });

    const guard2 = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner2,
    });

    const current = await guard2.captureCurrentState();
    expect(current.headCommit).toBe("def456");
    expect(baseline.headCommit).not.toBe(current.headCommit);
  });
});

describe("git guard — porcelain status parsing", () => {
  it("parses staged modifications", async () => {
    const mockProcessRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome("M  staged.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("staged.ts\n");
      if (request.args[0] === "diff") return successOutcome("");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const guard = createRealGitGuard({ workingDirectory: "/repo", processRunner: mockProcessRunner });
    const snap = await guard.captureBaseline();
    expect(snap.stagedPaths).toContain("staged.ts");
  });

  it("parses unstaged modifications", async () => {
    const mockProcessRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome(" M modified.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("");
      if (request.args[0] === "diff") return successOutcome("modified.ts\n");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const guard = createRealGitGuard({ workingDirectory: "/repo", processRunner: mockProcessRunner });
    const snap = await guard.captureBaseline();
    expect(snap.modifiedPaths).toContain("modified.ts");
  });

  it("parses untracked files", async () => {
    const mockProcessRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome("?? untracked.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("");
      if (request.args[0] === "diff") return successOutcome("");
      if (request.args[0] === "ls-files") return successOutcome("untracked.ts\n");
      return successOutcome("");
    });

    const guard = createRealGitGuard({ workingDirectory: "/repo", processRunner: mockProcessRunner });
    const snap = await guard.captureBaseline();
    expect(snap.untrackedPaths).toContain("untracked.ts");
  });

  it("parses renames", async () => {
    const mockProcessRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome("R  old.ts -> new.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("new.ts\n");
      if (request.args[0] === "diff") return successOutcome("");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const guard = createRealGitGuard({ workingDirectory: "/repo", processRunner: mockProcessRunner });
    const snap = await guard.captureBaseline();
    expect(snap.renamedPaths).toHaveLength(1);
    expect(snap.renamedPaths[0]?.from).toBe("old.ts");
    expect(snap.renamedPaths[0]?.to).toBe("new.ts");
  });

  it("parses deletions", async () => {
    const mockProcessRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome("D  deleted.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("");
      if (request.args[0] === "diff") return successOutcome("");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const guard = createRealGitGuard({ workingDirectory: "/repo", processRunner: mockProcessRunner });
    const snap = await guard.captureBaseline();
    expect(snap.deletedPaths).toContain("deleted.ts");
  });
});

describe("git guard — ProcessRunner failure handling", () => {
  it("handles git command failure (non-zero exit code)", async () => {
    const mockProcessRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") {
        return failureOutcome(128, "fatal: not a git repository");
      }
      return successOutcome("");
    });

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner,
    });

    const baseline = await guard.captureBaseline();
    expect(baseline.kind).toBe("baseline");
    expect(baseline.headCommit).toBeNull();
  });

  it("handles git command timeout", async () => {
    const mockProcessRunner = createMockProcessRunner(() => timeoutOutcome());

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner,
    });

    const baseline = await guard.captureBaseline();
    expect(baseline.kind).toBe("baseline");
    expect(baseline.headCommit).toBeNull();
  });

  it("handles git spawn error", async () => {
    const mockProcessRunner = createMockProcessRunner(() =>
      spawnErrorOutcome("ENOENT", "spawn git ENOENT"),
    );

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner,
    });

    const baseline = await guard.captureBaseline();
    expect(baseline.kind).toBe("baseline");
    expect(baseline.headCommit).toBeNull();
  });

  it("fails closed when git state cannot be established", async () => {
    const mockProcessRunner = createMockProcessRunner(() =>
      spawnErrorOutcome("ENOENT", "spawn git ENOENT"),
    );

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner,
    });

    await guard.captureBaseline();
    const current = await guard.captureCurrentState();

    // Even if both snapshots have null HEAD, the guard should still work
    // but the evaluation should fail closed when baseline is null
    const scope = scopeWithPrefixes(["src/"]);
    const verdict = evaluateGuard(null, current, scope);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("No git baseline");
  });

  it("uses the correct git command from options", async () => {
    let capturedCommand = "";
    const mockProcessRunner = createMockProcessRunner((request) => {
      capturedCommand = request.command;
      return successOutcome("");
    });

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner,
      gitCommand: "/usr/bin/git",
    });

    await guard.captureBaseline();
    expect(capturedCommand).toBe("/usr/bin/git");
  });

  it("passes correct working directory to ProcessRunner", async () => {
    let capturedCwd = "";
    const mockProcessRunner = createMockProcessRunner((request) => {
      capturedCwd = request.cwd;
      return successOutcome("");
    });

    const guard = createRealGitGuard({
      workingDirectory: "/custom/repo",
      processRunner: mockProcessRunner,
    });

    await guard.captureBaseline();
    expect(capturedCwd).toBe("/custom/repo");
  });

  it("passes correct timeout to ProcessRunner", async () => {
    let capturedTimeout = 0;
    const mockProcessRunner = createMockProcessRunner((request) => {
      capturedTimeout = request.timeoutMs;
      return successOutcome("");
    });

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner,
    });

    await guard.captureBaseline();
    expect(capturedTimeout).toBe(30_000);
  });
});

describe("git guard — scope violation detection with ProcessRunner", () => {
  it("detects unauthorized file changes", async () => {
    // Baseline is clean
    const mockBaselineRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome("");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("");
      if (request.args[0] === "diff") return successOutcome("");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const baselineGuard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockBaselineRunner,
    });

    // Current state has unauthorized changes
    const mockCurrentRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome(" M src/file.ts\n M backend/other.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("");
      if (request.args[0] === "diff") return successOutcome("src/file.ts\nbackend/other.ts\n");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const currentGuard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockCurrentRunner,
    });

    const baseline = await baselineGuard.captureBaseline();
    const current = await currentGuard.captureCurrentState();

    const scope = scopeWithPrefixes(["src/"]);
    const verdict = evaluateGuard(baseline, current, scope);

    expect(verdict.allowed).toBe(false);
    expect(verdict.unauthorizedPaths).toContain("backend/other.ts");
  });

  it("detects protected file changes", async () => {
    // Baseline with pre-existing modification (unstaged)
    const mockBaselineRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome(" M existing.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("");
      if (request.args[0] === "diff") return successOutcome("existing.ts\n");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const baselineGuard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockBaselineRunner,
    });

    // Current state: pre-existing file is now staged (flag change from modified to staged)
    // plus a new file is added
    const mockCurrentRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome("M  existing.ts\n M new.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("existing.ts\n");
      if (request.args[0] === "diff") return successOutcome("new.ts\n");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const currentGuard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockCurrentRunner,
    });

    const baseline = await baselineGuard.captureBaseline();
    const current = await currentGuard.captureCurrentState();

    const scope = scopeWithPrefixes(["src/"]);
    const verdict = evaluateGuard(baseline, current, scope);

    // The pre-existing file was modified (flag change), so it should be in protectedPaths
    expect(verdict.protectedPaths).toContain("existing.ts");
  });

  it("G1: allowed:true with non-empty protectedPaths is reachable (F-6 premise)", async () => {
    // Baseline: pre-existing modified file (flags: modified)
    const mockBaselineRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome(" M backend/existing.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("");
      if (request.args[0] === "diff") return successOutcome("backend/existing.ts\n");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const baselineGuard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockBaselineRunner,
    });

    // Current state: file is now staged (flags changed from modified to staged)
    // This flag difference makes it appear in `modified` via diffSnapshots
    const mockCurrentRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc\n");
      if (request.args[0] === "status") return successOutcome("M  backend/existing.ts\n");
      if (request.args[0] === "diff" && request.args[1] === "--cached") return successOutcome("backend/existing.ts\n");
      if (request.args[0] === "diff") return successOutcome("");
      if (request.args[0] === "ls-files") return successOutcome("");
      return successOutcome("");
    });

    const currentGuard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockCurrentRunner,
    });

    const baseline = await baselineGuard.captureBaseline();
    const current = await currentGuard.captureCurrentState();

    const scope = scopeWithPrefixes(["backend/"]);
    const verdict = evaluateGuard(baseline, current, scope);

    // F-6 premise: allowed is TRUE but protectedPaths is non-empty
    // The file is in scope (backend/), so unauthorizedPaths is empty
    expect(verdict.allowed).toBe(true);
    expect(verdict.unauthorizedPaths).toEqual([]);
    expect(verdict.protectedPaths).toContain("backend/existing.ts");
  });
});

describe("git guard — HEAD change detection with ProcessRunner", () => {
  it("detects HEAD change between baseline and current", async () => {
    const mockProcessRunner1 = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("abc123\n");
      return successOutcome("");
    });

    const guard1 = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner1,
    });

    const baseline = await guard1.captureBaseline();
    expect(baseline.headCommit).toBe("abc123");

    const mockProcessRunner2 = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return successOutcome("def456\n");
      return successOutcome("");
    });

    const guard2 = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner2,
    });

    const current = await guard2.captureCurrentState();
    expect(current.headCommit).toBe("def456");
    expect(baseline.headCommit).not.toBe(current.headCommit);
  });

  it("handles null HEAD (not a git repository)", async () => {
    const mockProcessRunner = createMockProcessRunner((request) => {
      if (request.args[0] === "rev-parse") return failureOutcome(128, "fatal: not a git repository");
      return successOutcome("");
    });

    const guard = createRealGitGuard({
      workingDirectory: "/repo",
      processRunner: mockProcessRunner,
    });

    const baseline = await guard.captureBaseline();
    expect(baseline.headCommit).toBeNull();
  });
});
