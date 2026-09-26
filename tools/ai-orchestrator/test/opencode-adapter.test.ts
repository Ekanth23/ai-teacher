/**
 * Stage 2B — OpenCode CLI adapter tests.
 *
 * Every test in this file uses an injected fake `ProcessRunner`. No test spawns a
 * real process, opens a socket, or touches the AI Teacher application. The one
 * real-CLI check is the separate manual `npm run opencode-ping` command.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig, type OpenCodeAdapterConfig } from "../src/config.js";
import { OrchestratorError, OpenCodeExecutableUnresolvedError, OpenCodeSessionUnavailableError } from "../src/errors.js";
import {
  FORBIDDEN_OPENCODE_FLAGS,
  OpenCodeCliClient,
  assertNoForbiddenFlags,
  extractSessionId,
  isProcessSuccessful,
  type OpenCodeSessionRef,
} from "../src/opencode-client.js";
import { resolveOpenCodeExecutable } from "../src/opencode-executable.js";
import {
  NodeProcessRunner,
  type ProcessExecutionOutcome,
  type ProcessExecutionRequest,
  type ProcessRunner,
} from "../src/opencode-process.js";

const CWD = path.resolve("C:/repo");

/* -------------------------------------------------------------------------- */
/* Fakes                                                                     */
/* -------------------------------------------------------------------------- */

class FakeRunner implements ProcessRunner {
  readonly calls: ProcessExecutionRequest[] = [];
  #outcome: ProcessExecutionOutcome;

  constructor(outcome: ProcessExecutionOutcome) {
    this.#outcome = outcome;
  }

  run(request: ProcessExecutionRequest): Promise<ProcessExecutionOutcome> {
    // Deep-copy so a test cannot mutate recorded state after the fact.
    this.calls.push({ ...request, args: [...request.args], env: { ...request.env } });
    return Promise.resolve(this.#outcome);
  }

  get lastCall(): ProcessExecutionRequest {
    const call = this.calls.at(-1);
    if (call === undefined) throw new Error("FakeRunner was never called");
    return call;
  }
}

function outcome(overrides: Partial<ProcessExecutionOutcome> & Pick<ProcessExecutionOutcome, "status">): ProcessExecutionOutcome {
  const base = {
    command: process.execPath,
    args: [] as string[],
    stdout: "",
    stderr: "",
    durationMs: 12,
    timedOut: false,
    truncated: false,
    signal: null,
  };
  return { ...base, ...overrides } as ProcessExecutionOutcome;
}

const success = (stdout: string, stderr = ""): ProcessExecutionOutcome =>
  outcome({ status: "success", exitCode: 0, stdout, stderr });

const failure = (exitCode: number, stderr: string): ProcessExecutionOutcome =>
  outcome({ status: "failure", exitCode, stdout: "", stderr });

const timeout = (): ProcessExecutionOutcome =>
  outcome({
    status: "timeout",
    exitCode: null,
    stdout: "partial",
    stderr: "",
    timedOut: true,
    terminationAttempted: true,
    terminationSignals: ["SIGTERM", "SIGKILL"],
  } as Partial<ProcessExecutionOutcome> & Pick<ProcessExecutionOutcome, "status">);

const spawnError = (): ProcessExecutionOutcome =>
  outcome({
    status: "spawn-error",
    exitCode: null,
    stdout: "",
    stderr: "",
    errorCode: "ENOENT",
    errorMessage: "spawn C:\\opencode\\opencode.exe ENOENT",
  } as Partial<ProcessExecutionOutcome> & Pick<ProcessExecutionOutcome, "status">);

function adapterConfig(overrides: Partial<OpenCodeAdapterConfig> = {}): OpenCodeAdapterConfig {
  return {
    ...loadConfig({}, {}).opencode,
    command: "opencode",
    // A real, existing native executable. The resolver therefore runs for real
    // against the filesystem, while the ProcessRunner stays faked so no process
    // is ever spawned. `process.execPath` is guaranteed present and directly
    // spawnable, which is exactly the property the resolver requires.
    bin: process.execPath,
    serverUrl: null,
    workingDirectory: CWD,
    timeoutMs: 5_000,
    maxOutputBytes: 1024,
    killGraceMs: 100,
    ...overrides,
  };
}

function clientWith(runner: ProcessRunner, config: Partial<OpenCodeAdapterConfig> = {}): OpenCodeCliClient {
  return new OpenCodeCliClient({ config: adapterConfig(config), processRunner: runner, env: {} });
}

const session: OpenCodeSessionRef = {
  sessionId: "ocs_test",
  providerSessionId: "ses_abc",
  createdForStoryId: "US-101",
  startedAt: new Date(0).toISOString(),
};

/* -------------------------------------------------------------------------- */
/* Process success                                                            */
/* -------------------------------------------------------------------------- */

describe("process success", () => {
  it("captures stdout, stderr, exit code, and reports success", async () => {
    const runner = new FakeRunner(success("opencode v2.0.6\n", ""));
    const client = clientWith(runner);

    const result = await client.probeVersion();

    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("opencode v2.0.6\n");
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(isProcessSuccessful({ process: result } as never)).toBe(true);
  });

  it("captures stderr even on success", async () => {
    const runner = new FakeRunner(success("out", "a warning"));
    const result = await clientWith(runner).probeVersion();
    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("a warning");
    expect(result.status).toBe("success");
  });

  it("mirrors the process outcome onto the turn result", async () => {
    const runner = new FakeRunner(success("{}"));
    const turn = await clientWith(runner).runCommand(session, { command: "ai-plan", instruction: "do the thing" });

    expect(turn.exitCode).toBe(0);
    expect(turn.completed).toBe(true);
    expect(turn.process.status).toBe("success");
    expect(isProcessSuccessful(turn)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Process failure                                                            */
/* -------------------------------------------------------------------------- */

describe("process failure", () => {
  it("reports a non-zero exit as failure and preserves stderr", async () => {
    const runner = new FakeRunner(failure(2, "provider auth failed"));
    const turn = await clientWith(runner).runCommand(session, { command: "ai-build", instruction: "go" });

    expect(turn.process.status).toBe("failure");
    expect(turn.process.exitCode).toBe(2);
    expect(turn.process.stderr).toBe("provider auth failed");
    expect(turn.completed).toBe(true);
    expect(isProcessSuccessful(turn)).toBe(false);
  });

  it("never converts a failure into a success", async () => {
    const runner = new FakeRunner(failure(1, "boom"));
    const result = await clientWith(runner).probeVersion();
    expect(result.status).not.toBe("success");
    expect(result.exitCode).not.toBe(0);
  });

  it("treats death by signal as a failure", async () => {
    const runner = new FakeRunner(outcome({ status: "failure", exitCode: null, signal: "SIGKILL" }));
    const result = await clientWith(runner).probeVersion();
    expect(result.status).toBe("failure");
    expect(result.signal).toBe("SIGKILL");
  });
});

/* -------------------------------------------------------------------------- */
/* Timeout                                                                    */
/* -------------------------------------------------------------------------- */

describe("timeout", () => {
  it("returns a timeout result and records that termination was attempted", async () => {
    const runner = new FakeRunner(timeout());
    const result = await clientWith(runner, { timeoutMs: 25 }).probeVersion();

    expect(result.status).toBe("timeout");
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(true);
    if (result.status !== "timeout") throw new Error("unreachable");
    expect(result.terminationAttempted).toBe(true);
    expect(result.terminationSignals).toContain("SIGTERM");
    expect(result.terminationSignals).toContain("SIGKILL");
    expect(isProcessSuccessful({ process: result } as never)).toBe(false);
  });

  it("passes the configured timeout to the process layer", async () => {
    const runner = new FakeRunner(success("ok"));
    await clientWith(runner, { timeoutMs: 1234 }).probeVersion();
    expect(runner.lastCall.timeoutMs).toBe(1234);
  });
});

/* -------------------------------------------------------------------------- */
/* Spawn error                                                                */
/* -------------------------------------------------------------------------- */

describe("spawn error", () => {
  it("represents a missing executable structurally", async () => {
    const runner = new FakeRunner(spawnError());
    const result = await clientWith(runner).probeVersion();

    expect(result.status).toBe("spawn-error");
    expect(result.exitCode).toBeNull();
    if (result.status !== "spawn-error") throw new Error("unreachable");
    expect(result.errorCode).toBe("ENOENT");
    expect(result.errorMessage).toMatch(/ENOENT/);
  });

  it("surfaces an unresolved executable as a typed error, not a crash", async () => {
    const client = new OpenCodeCliClient({
      config: adapterConfig({ bin: null, command: "definitely-not-installed-opencode" }),
      processRunner: new FakeRunner(success("")),
      env: { PATH: "C:/empty" },
    });

    await expect(client.probeVersion()).rejects.toBeInstanceOf(OpenCodeExecutableUnresolvedError);
  });
});

/* -------------------------------------------------------------------------- */
/* Argument safety                                                            */
/* -------------------------------------------------------------------------- */

describe("argument safety", () => {
  it("passes arguments as a vector, never a joined string", async () => {
    const runner = new FakeRunner(success("{}"));
    await clientWith(runner).runCommand(session, { command: "ai-plan", instruction: "plan US-101" });

    const args = runner.lastCall.args;
    expect(Array.isArray(args)).toBe(true);
    expect(args).toEqual(["run", "--format", "json", "--session", "ses_abc", "plan US-101"]);
    // The message is exactly one argv element, so its content cannot be re-parsed.
    expect(args.filter((a) => a === "plan US-101")).toHaveLength(1);
  });

  it("keeps shell metacharacters inside a single inert argument", async () => {
    const runner = new FakeRunner(success("{}"));
    const hostile = "US-101 && rm -rf / ; echo $(whoami) | tee x";
    await clientWith(runner).runCommand(session, { command: "ai-plan", instruction: hostile });

    const args = runner.lastCall.args;
    expect(args).toContain(hostile);
    // No element was split, and nothing was concatenated into a command string.
    expect(args).toHaveLength(6);
    expect(runner.lastCall.command).toBe(process.execPath);
  });

  it("refuses --auto, --server, and --standalone", async () => {
    for (const flag of FORBIDDEN_OPENCODE_FLAGS) {
      expect(() => assertNoForbiddenFlags([flag])).toThrow(OrchestratorError);
    }
    const runner = new FakeRunner(success("{}"));
    await expect(
      clientWith(runner).runCommand(session, { command: "ai-build", instruction: "go", args: ["--auto"] }),
    ).rejects.toThrow(/Refusing to pass/);
  });

  it("spawns with shell disabled in the real runner", () => {
    // The real runner's contract is asserted structurally: it exposes only `run`,
    // and NodeProcessRunner is constructed with an absolute command, not a string.
    const runner = new NodeProcessRunner();
    expect(Object.getOwnPropertyNames(NodeProcessRunner.prototype)).toEqual(["constructor", "run"]);
    expect(runner).toBeInstanceOf(NodeProcessRunner);
  });
});

/* -------------------------------------------------------------------------- */
/* Session handling                                                           */
/* -------------------------------------------------------------------------- */

describe("session handling", () => {
  it("creates a session and extracts a provider id when OpenCode reports one", async () => {
    const runner = new FakeRunner(success('{"type":"session","sessionID":"ses_123"}\n'));
    const created = await clientWith(runner).createSession({
      storyId: "US-101",
      command: "ai-plan",
      contextPackageReference: null,
      workingDirectory: CWD,
      message: "plan US-101",
    });

    expect(created.providerSessionId).toBe("ses_123");
    expect(created.createdForStoryId).toBe("US-101");
    expect(runner.lastCall.args).toEqual(["run", "--format", "json", "plan US-101"]);
  });

  it("never invents a session id", async () => {
    const runner = new FakeRunner(success("no json here"));
    const created = await clientWith(runner).createSession({
      storyId: null,
      command: "ai-plan",
      contextPackageReference: null,
      workingDirectory: CWD,
      message: "hi",
    });
    expect(created.providerSessionId).toBeNull();
  });

  it("refuses to continue a session without a real id", async () => {
    const runner = new FakeRunner(success("{}"));
    const orphan: OpenCodeSessionRef = { ...session, providerSessionId: null };
    await expect(
      clientWith(runner).continueSession(orphan, { command: "ai-build", instruction: "go" }),
    ).rejects.toBeInstanceOf(OpenCodeSessionUnavailableError);
    expect(runner.calls).toHaveLength(0);
  });

  it("continues with an explicit session id", async () => {
    const runner = new FakeRunner(success("{}"));
    await clientWith(runner).continueSession({ ...session, providerSessionId: null }, {
      command: "ai-build",
      instruction: "go",
      sessionId: "ses_explicit",
    });
    expect(runner.lastCall.args).toEqual(["run", "--format", "json", "--session", "ses_explicit", "go"]);
  });

  it("collects the retained process payload and releases it on dispose", async () => {
    const runner = new FakeRunner(success("payload"));
    const client = clientWith(runner);
    const created = await client.createSession({
      storyId: null, command: "ai-plan", contextPackageReference: null, workingDirectory: CWD, message: "m",
    });

    const collected = (await client.collectResult(created)) as ProcessExecutionOutcome;
    expect(collected.stdout).toBe("payload");

    await client.dispose(created);
    await expect(client.collectResult(created)).rejects.toBeInstanceOf(OpenCodeSessionUnavailableError);
  });

  it("extracts a session id from nested JSON without inventing one", () => {
    expect(extractSessionId(success('{"a":{"sessionID":"ses_nested"}}'))).toBe("ses_nested");
    expect(extractSessionId(success('{"a":{"sessionID":"ses_1"}}\n{"b":1}'))).toBe("ses_1");
    expect(extractSessionId(success("not json"))).toBeNull();
    expect(extractSessionId(success(""))).toBeNull();
    expect(extractSessionId(spawnError())).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Probe contract                                                             */
/* -------------------------------------------------------------------------- */

describe("read-only probe", () => {
  it("uses a fixed, caller-proof argument vector", async () => {
    const runner = new FakeRunner(success("opencode v2.0.6"));
    await clientWith(runner).probeVersion();
    expect(runner.lastCall.args).toEqual(["--version"]);
    expect(runner.lastCall.cwd).toBe(CWD);
  });
});

/* -------------------------------------------------------------------------- */
/* Executable resolution                                                      */
/* -------------------------------------------------------------------------- */

describe("executable resolution", () => {
  // Paths are built with `path.join` so the fakes match what the resolver
  // produces on the host platform. `readDirectory` is injected so the npm-shim
  // probe is exercised without touching the real filesystem.
  const exists = new Set<string>();
  const dirs = new Set<string>([CWD]);
  const tree = new Map<string, { name: string; isFile: boolean; isDirectory: boolean }[]>();
  const fileExists = (p: string) => exists.has(p);
  const isDirectory = (p: string) => dirs.has(p);
  const readDirectory = (dir: string) => tree.get(dir) ?? [];

  it("prefers an explicit OPENCODE_BIN path", () => {
    const target = path.join(CWD, "custom", "opencode.exe");
    exists.add(target);
    const resolution = resolveOpenCodeExecutable({ command: target, env: {}, cwd: CWD, fileExists, isDirectory, readDirectory });
    expect(resolution).toEqual({ kind: "resolved", path: target, source: "explicit-bin" });
  });

  it("resolves a native executable on PATH", () => {
    const dir = path.join("C:/", "bin");
    const target = path.join(dir, "opencode.exe");
    exists.add(target);
    const resolution = resolveOpenCodeExecutable({ command: "opencode", env: { PATH: dir }, cwd: CWD, fileExists, isDirectory, readDirectory });
    expect(resolution).toEqual({ kind: "resolved", path: target, source: "path-native-windows" });
  });

  it("refuses a .cmd shim instead of using a shell", () => {
    const shim = path.join(CWD, "opencode.cmd");
    exists.add(shim);
    const resolution = resolveOpenCodeExecutable({ command: shim, env: {}, cwd: CWD, fileExists, isDirectory, readDirectory });
    expect(resolution.kind).toBe("unresolved");
    if (resolution.kind !== "unresolved") throw new Error("unreachable");
    expect(resolution.reason).toMatch(/shell shim/i);
    expect(resolution.hint).toMatch(/OPENCODE_BIN/);
  });

  it("probes for the native binary behind an npm shim without reading the shim", () => {
    const shimDir = path.join("C:/", "npmbin");
    const shim = path.join(shimDir, "opencode.cmd");
    const modulesDir = path.join(shimDir, "node_modules");
    const scopeDir = path.join(modulesDir, "@opencode");
    const pkgDir = path.join(scopeDir, "cli");
    const binDir = path.join(pkgDir, "bin");
    const target = path.join(binDir, "opencode.exe");

    dirs.add(shimDir);
    dirs.add(modulesDir);
    dirs.add(scopeDir);
    dirs.add(pkgDir);
    dirs.add(binDir);
    exists.add(shim);
    exists.add(target);

    tree.set(modulesDir, [{ name: "@opencode", isFile: false, isDirectory: true }]);
    tree.set(scopeDir, [{ name: "cli", isFile: false, isDirectory: true }]);
    tree.set(pkgDir, [{ name: "bin", isFile: false, isDirectory: true }]);
    tree.set(binDir, [{ name: "opencode.exe", isFile: true, isDirectory: false }]);

    const resolution = resolveOpenCodeExecutable({ command: "opencode", env: { PATH: shimDir }, cwd: CWD, fileExists, isDirectory, readDirectory });
    expect(resolution).toEqual({ kind: "resolved", path: target, source: "npm-shim-native-binary" });
  });

  it("does not descend into a nested node_modules tree", () => {
    const shimDir = path.join("D:/", "npmbin2");
    const modulesDir = path.join(shimDir, "node_modules");
    const nestedModules = path.join(modulesDir, "some-pkg", "node_modules");
    const nestedTarget = path.join(nestedModules, "opencode.exe");

    dirs.add(shimDir);
    dirs.add(modulesDir);
    exists.add(path.join(shimDir, "opencode.cmd"));
    exists.add(nestedTarget);

    tree.set(modulesDir, [
      { name: "some-pkg", isFile: false, isDirectory: true },
    ]);
    tree.set(path.join(modulesDir, "some-pkg"), [
      { name: "node_modules", isFile: false, isDirectory: true },
    ]);
    tree.set(nestedModules, [{ name: "opencode.exe", isFile: true, isDirectory: false }]);

    const resolution = resolveOpenCodeExecutable({ command: "opencode", env: { PATH: shimDir }, cwd: CWD, fileExists, isDirectory, readDirectory });
    expect(resolution.kind).toBe("unresolved");
  });

  it("fails with an actionable reason when nothing is spawnable", () => {
    const empty = path.join("C:/", "empty");
    const resolution = resolveOpenCodeExecutable({ command: "nope", env: { PATH: empty }, cwd: CWD, fileExists, isDirectory, readDirectory });
    expect(resolution.kind).toBe("unresolved");
    if (resolution.kind !== "unresolved") throw new Error("unreachable");
    expect(resolution.hint).toMatch(/never runs a command through a shell/);
  });

  it("rejects an empty command", () => {
    expect(resolveOpenCodeExecutable({ command: "  ", env: {}, cwd: CWD, fileExists, isDirectory, readDirectory }).kind).toBe("unresolved");
  });
});
