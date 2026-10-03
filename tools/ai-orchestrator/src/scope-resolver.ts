/**
 * Stage 2C — Scope resolver.
 *
 * PURPOSE
 * -------
 * Convert an approved plan into a `GuardScope` with explicit file-operation
 * permissions. This is the bridge between the plan (what the human approved)
 * and the git guard (what the orchestrator enforces).
 *
 * CONTRACT (Section 9.1, 9.2)
 * ----------------------------
 * Path authorization does NOT implicitly authorize deletion or renaming. The
 * approved plan MUST explicitly declare which file operations are permitted
 * for each path.
 *
 * Scope authorization precedence:
 * 1. If `filePermissions` is non-empty, it is authoritative. Only paths listed
 *    are authorized, and only for the operations explicitly listed.
 * 2. If `filePermissions` is empty, `allowedExactPaths` and `allowedPrefixes`
 *    are used. All operations are permitted for authorized paths.
 * 3. If all three are empty, no paths are authorized (safe default).
 */

import type { GuardScope } from "./git-guard.js";

/** File operation types. */
export type FileOperation = "create" | "modify" | "delete" | "rename";

/** Explicit file-operation permission for a single path. */
export interface FilePermission {
  readonly path: string;
  readonly operations: readonly FileOperation[];
}

/** Authorized file scope derived from an approved plan. */
export interface ApprovedScope {
  /** Exact file paths that are authorized. */
  readonly allowedExactPaths: readonly string[];
  /** Path prefixes that are authorized. */
  readonly allowedPrefixes: readonly string[];
  /** Explicit file-operation permissions. */
  readonly filePermissions: readonly FilePermission[];
}

/** An approved plan with authorization information. */
export interface ApprovedPlan {
  readonly planId: string;
  readonly storyId: string;
  /** Authorized scope derived from the plan. */
  readonly scope: ApprovedScope;
}

/**
 * Resolve the effective GuardScope from an approved plan.
 *
 * When `filePermissions` is non-empty, it is authoritative and
 * `allowedExactPaths`/`allowedPrefixes` are ignored (set to empty).
 *
 * When `filePermissions` is empty, `allowedExactPaths` and `allowedPrefixes`
 * are used as-is, and all operations are permitted for authorized paths.
 */
export function resolveScope(plan: ApprovedPlan): GuardScope {
  const { scope } = plan;

  if (scope.filePermissions.length > 0) {
    // filePermissions is authoritative. Ignore allowedExactPaths/allowedPrefixes.
    return {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: scope.filePermissions.map((fp) => ({
        path: fp.path,
        operations: [...fp.operations],
      })),
    };
  }

  // Fallback: use allowedExactPaths and allowedPrefixes.
  return {
    allowedPrefixes: [...scope.allowedPrefixes],
    allowedExactPaths: [...scope.allowedExactPaths],
    filePermissions: [],
  };
}

/**
 * Check whether a path is authorized for a specific operation under the
 * effective scope.
 *
 * Returns `true` only when the path is authorized AND the operation is
 * permitted for that path.
 */
export function isPathAuthorized(
  scope: GuardScope,
  filePath: string,
  operation: FileOperation,
): boolean {
  const normalized = filePath.replace(/\\/g, "/");

  if (scope.filePermissions.length > 0) {
    // filePermissions is authoritative.
    const permission = scope.filePermissions.find(
      (fp) => fp.path.replace(/\\/g, "/") === normalized,
    );
    if (permission === undefined) {
      return false;
    }
    return permission.operations.includes(operation);
  }

  // Fallback: check allowedExactPaths and allowedPrefixes.
  const authorized =
    scope.allowedExactPaths.includes(normalized) ||
    scope.allowedPrefixes.some((prefix) => {
      const clean = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
      return clean === "" || normalized === clean || normalized.startsWith(`${clean}/`);
    });

  if (!authorized) {
    return false;
  }

  // In the fallback representation, all operations are permitted for authorized paths.
  return true;
}

/**
 * Check whether a path is authorized for any operation under the effective scope.
 *
 * Returns `true` when the path appears in the scope, regardless of which
 * operations are permitted.
 */
export function isPathInScope(scope: GuardScope, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");

  if (scope.filePermissions.length > 0) {
    return scope.filePermissions.some(
      (fp) => fp.path.replace(/\\/g, "/") === normalized,
    );
  }

  return (
    scope.allowedExactPaths.includes(normalized) ||
    scope.allowedPrefixes.some((prefix) => {
      const clean = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
      return clean === "" || normalized === clean || normalized.startsWith(`${clean}/`);
    })
  );
}

/**
 * Validate that a scope is well-formed.
 *
 * Returns `true` if the scope is valid. Throws an error with a descriptive
 * message if the scope is malformed.
 */
export function validateScope(scope: GuardScope): boolean {
  if (scope.filePermissions.length > 0) {
    // When filePermissions is non-empty, it must be authoritative.
    // allowedExactPaths and allowedPrefixes should be empty (they are ignored).
    for (const fp of scope.filePermissions) {
      if (fp.path.trim() === "") {
        throw new Error("Scope validation failed: file permission path cannot be empty.");
      }
      if (fp.operations.length === 0) {
        throw new Error(
          `Scope validation failed: file permission for "${fp.path}" has no operations. ` +
            `At least one operation must be declared.`,
        );
      }
    }
  }
  return true;
}
