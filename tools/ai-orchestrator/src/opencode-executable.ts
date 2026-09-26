/**
 * Stage 2B — OpenCode executable resolution.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `opencode` is normally installed through npm, which puts a `.cmd`/`.bat` shim on
 * PATH. That shim CANNOT be executed safely:
 *
 *   - `spawn("opencode", { shell: false })` fails with ENOENT, because Node does
 *     not apply PATHEXT resolution.
 *   - `spawn("...\opencode.cmd", { shell: false })` fails with EINVAL, because
 *     Node refuses to execute a batch shim without a shell.
 *   - The only shell-free way to run it is `shell: true`, which is FORBIDDEN: it
 *     reinterprets argument content as shell syntax and reintroduces injection.
 *
 * So the adapter resolves a NATIVE EXECUTABLE and spawns that directly. This
 * module is pure filesystem/PATH logic. It never spawns, never uses a shell, and
 * never parses the contents of a shim file as shell text.
 *
 * RESOLUTION ORDER
 * ----------------
 *  1. An explicit `OPENCODE_BIN` value. Used as given.
 *  2. `<name>.exe` / `<name>.com` on PATH (Windows native executables).
 *  3. `<name>` with no extension on PATH (POSIX executables).
 *  4. A `.cmd`/`.bat` shim on PATH is NOT executed. Instead the shim's directory
 *     is probed, depth-limited, for a native `<name>.exe` beneath `node_modules`.
 *     npm's generated shims delegate to exactly such a binary.
 *  5. Otherwise resolution fails with an actionable, structured reason.
 */

import fs from "node:fs";
import path from "node:path";

/** Extensions Node can execute directly with `shell: false` on Windows. */
const WINDOWS_NATIVE_EXTENSIONS = [".exe", ".com"] as const;

/** Extensions that REQUIRE a shell. Never executed by the orchestrator. */
const SHELL_ONLY_EXTENSIONS = [".cmd", ".bat"] as const;

export type ExecutableSource =
  | "explicit-bin"
  | "path-native-windows"
  | "path-extensionless"
  | "npm-shim-native-binary";

export type ExecutableResolution =
  | { readonly kind: "resolved"; readonly path: string; readonly source: ExecutableSource }
  | { readonly kind: "unresolved"; readonly reason: string; readonly hint: string };

/** Minimal directory entry, so the probe can be fully injected in tests. */
export interface DirectoryEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

export interface ResolveExecutableOptions {
  /** Command name or path. Defaults to `opencode`. */
  readonly command: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Directory used to make relative paths absolute. */
  readonly cwd: string;
  /** Injected for tests. */
  readonly fileExists?: (candidate: string) => boolean;
  /** Injected for tests. */
  readonly isDirectory?: (candidate: string) => boolean;
  /** Injected for tests. */
  readonly readDirectory?: (directory: string) => readonly DirectoryEntry[];
}

function defaultFileExists(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function defaultIsDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function defaultReadDirectory(directory: string): readonly DirectoryEntry[] {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() }));
  } catch {
    return [];
  }
}

function pathEntries(env: Readonly<Record<string, string | undefined>>): string[] {
  const raw = env["PATH"] ?? env["Path"] ?? "";
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function extensionOf(candidate: string): string {
  return path.extname(candidate).toLowerCase();
}

function hasShellOnlyExtension(candidate: string): boolean {
  return (SHELL_ONLY_EXTENSIONS as readonly string[]).includes(extensionOf(candidate));
}

/** Directly spawnable with `shell: false`? */
function isDirectlySpawnable(candidate: string, platform: NodeJS.Platform): boolean {
  const ext = extensionOf(candidate);
  if (ext === "") return platform !== "win32";
  return (WINDOWS_NATIVE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Bounded search for the native binary an npm shim delegates to.
 *
 * This walks `node_modules` under the shim directory looking for a file named
 * `<name><nativeExt>`. It is a filename search only: shim file CONTENTS are never
 * read, parsed, or executed. Depth is bounded and the scan stops at the first
 * match so it stays cheap and predictable.
 */
function probeNpmShimNativeBinary(
  shimDir: string,
  name: string,
  fileExists: (candidate: string) => boolean,
  isDirectory: (candidate: string) => boolean,
  readDirectory: (directory: string) => readonly DirectoryEntry[],
  maxDepth = 6,
): string | null {
  const root = path.join(shimDir, "node_modules");
  if (!isDirectory(root)) return null;

  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    for (const entry of readDirectory(current.dir)) {
      const full = path.join(current.dir, entry.name);
      if (entry.isFile) {
        const base = entry.name.toLowerCase();
        for (const ext of WINDOWS_NATIVE_EXTENSIONS) {
          if (base === `${name}${ext}` && fileExists(full)) return full;
        }
        continue;
      }
      if (!entry.isDirectory) continue;
      // Never descend into a nested dependency tree: npm puts the shim target
      // directly under a package's own bin directory.
      if (entry.name === "node_modules") continue;
      if (current.depth >= maxDepth) continue;
      queue.push({ dir: full, depth: current.depth + 1 });
    }
  }
  return null;
}

/**
 * Resolve the OpenCode command to a natively spawnable absolute path.
 *
 * Pure: no spawn, no shell, no network, no mutation.
 */
export function resolveOpenCodeExecutable(options: ResolveExecutableOptions): ExecutableResolution {
  const fileExists = options.fileExists ?? defaultFileExists;
  const isDirectory = options.isDirectory ?? defaultIsDirectory;
  const readDirectory = options.readDirectory ?? defaultReadDirectory;
  const platform: NodeJS.Platform = process.platform;
  const rawCommand = options.command.trim();

  if (rawCommand.length === 0) {
    return {
      kind: "unresolved",
      reason: "The OpenCode command is empty.",
      hint: "Set OPENCODE_BIN to the OpenCode executable.",
    };
  }

  // 1. Explicit path (contains a separator) or a bare name that already exists as given.
  const directCandidate = path.isAbsolute(rawCommand)
    ? rawCommand
    : path.resolve(options.cwd, rawCommand);

  if (hasShellOnlyExtension(directCandidate)) {
    return {
      kind: "unresolved",
      reason: `"${rawCommand}" is a shell shim (${extensionOf(directCandidate)}). Shell shims cannot be executed safely.`,
      hint: "Set OPENCODE_BIN to the native OpenCode executable, for example the opencode.exe inside the npm package's bin directory.",
    };
  }

  if (fileExists(directCandidate) && isDirectlySpawnable(directCandidate, platform)) {
    return {
      kind: "resolved",
      path: path.resolve(directCandidate),
      source: rawCommand.includes("/") || rawCommand.includes("\\") ? "explicit-bin" : "path-extensionless",
    };
  }

  // 2/3. Search PATH for a directly spawnable candidate.
  const shimCandidates: string[] = [];

  for (const dir of pathEntries(options.env)) {
    for (const ext of WINDOWS_NATIVE_EXTENSIONS) {
      const candidate = path.join(dir, `${rawCommand}${ext}`);
      if (fileExists(candidate) && isDirectlySpawnable(candidate, platform)) {
        return { kind: "resolved", path: candidate, source: "path-native-windows" };
      }
    }

    const bare = path.join(dir, rawCommand);
    if (fileExists(bare) && isDirectlySpawnable(bare, platform)) {
      return { kind: "resolved", path: bare, source: "path-extensionless" };
    }

    for (const ext of SHELL_ONLY_EXTENSIONS) {
      const shim = path.join(dir, `${rawCommand}${ext}`);
      if (fileExists(shim)) shimCandidates.push(shim);
    }
  }

  // 4. A shell shim was found. Do NOT execute it. Probe for the native binary.
  for (const shim of shimCandidates) {
    const shimDir = path.dirname(shim);
    const native = probeNpmShimNativeBinary(shimDir, rawCommand, fileExists, isDirectory, readDirectory);
    if (native !== null) {
      return { kind: "resolved", path: native, source: "npm-shim-native-binary" };
    }
  }

  return {
    kind: "unresolved",
    reason:
      `Could not find a natively spawnable "${rawCommand}" executable on PATH` +
      (shimCandidates.length > 0
        ? ` (only shell shim(s) were found: ${shimCandidates.join(", ")}).`
        : "."),
    hint: "Set OPENCODE_BIN to the native OpenCode executable. The orchestrator never runs a command through a shell.",
  };
}
