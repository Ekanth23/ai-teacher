/**
 * Stage 2C-1 — Scope resolver unit tests.
 *
 * Covers plan-to-scope conversion, explicit file operations, precedence rules,
 * and authorization checks.
 */

import { describe, expect, it } from "vitest";

import {
  isPathAuthorized,
  isPathInScope,
  resolveScope,
  validateScope,
  type ApprovedPlan,
} from "../src/scope-resolver.js";
import type { GuardScope } from "../src/git-guard.js";

describe("resolveScope", () => {
  it("returns filePermissions as authoritative when non-empty", () => {
    const plan: ApprovedPlan = {
      planId: "plan-1",
      storyId: "US-101",
      scope: {
        allowedExactPaths: ["src/old-file.ts"],
        allowedPrefixes: ["src/old-prefix/"],
        filePermissions: [
          { path: "src/new-file.ts", operations: ["create", "modify"] },
        ],
      },
    };

    const scope = resolveScope(plan);

    expect(scope.filePermissions).toHaveLength(1);
    expect(scope.filePermissions[0]?.path).toBe("src/new-file.ts");
    // When filePermissions is non-empty, allowedExactPaths and allowedPrefixes are ignored.
    expect(scope.allowedExactPaths).toHaveLength(0);
    expect(scope.allowedPrefixes).toHaveLength(0);
  });

  it("uses allowedExactPaths and allowedPrefixes when filePermissions is empty", () => {
    const plan: ApprovedPlan = {
      planId: "plan-1",
      storyId: "US-101",
      scope: {
        allowedExactPaths: ["src/exact.ts"],
        allowedPrefixes: ["src/prefix/"],
        filePermissions: [],
      },
    };

    const scope = resolveScope(plan);

    expect(scope.filePermissions).toHaveLength(0);
    expect(scope.allowedExactPaths).toContain("src/exact.ts");
    expect(scope.allowedPrefixes).toContain("src/prefix/");
  });

  it("returns empty scope when all fields are empty", () => {
    const plan: ApprovedPlan = {
      planId: "plan-1",
      storyId: "US-101",
      scope: {
        allowedExactPaths: [],
        allowedPrefixes: [],
        filePermissions: [],
      },
    };

    const scope = resolveScope(plan);

    expect(scope.filePermissions).toHaveLength(0);
    expect(scope.allowedExactPaths).toHaveLength(0);
    expect(scope.allowedPrefixes).toHaveLength(0);
  });
});

describe("isPathAuthorized", () => {
  it("authorizes a path in filePermissions with the correct operation", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: [
        { path: "src/file.ts", operations: ["create", "modify"] },
      ],
    };

    expect(isPathAuthorized(scope, "src/file.ts", "create")).toBe(true);
    expect(isPathAuthorized(scope, "src/file.ts", "modify")).toBe(true);
  });

  it("denies a path in filePermissions without the correct operation", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: [
        { path: "src/file.ts", operations: ["create", "modify"] },
      ],
    };

    expect(isPathAuthorized(scope, "src/file.ts", "delete")).toBe(false);
    expect(isPathAuthorized(scope, "src/file.ts", "rename")).toBe(false);
  });

  it("denies a path not in filePermissions", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: [
        { path: "src/file.ts", operations: ["create", "modify"] },
      ],
    };

    expect(isPathAuthorized(scope, "src/other.ts", "create")).toBe(false);
  });

  it("authorizes all operations for paths in allowedExactPaths (fallback)", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: ["src/exact.ts"],
      filePermissions: [],
    };

    expect(isPathAuthorized(scope, "src/exact.ts", "create")).toBe(true);
    expect(isPathAuthorized(scope, "src/exact.ts", "modify")).toBe(true);
    expect(isPathAuthorized(scope, "src/exact.ts", "delete")).toBe(true);
    expect(isPathAuthorized(scope, "src/exact.ts", "rename")).toBe(true);
  });

  it("authorizes all operations for paths under allowedPrefixes (fallback)", () => {
    const scope: GuardScope = {
      allowedPrefixes: ["src/"],
      allowedExactPaths: [],
      filePermissions: [],
    };

    expect(isPathAuthorized(scope, "src/any/file.ts", "create")).toBe(true);
    expect(isPathAuthorized(scope, "src/any/file.ts", "modify")).toBe(true);
    expect(isPathAuthorized(scope, "src/any/file.ts", "delete")).toBe(true);
    expect(isPathAuthorized(scope, "src/any/file.ts", "rename")).toBe(true);
  });

  it("denies paths outside allowedPrefixes (fallback)", () => {
    const scope: GuardScope = {
      allowedPrefixes: ["src/"],
      allowedExactPaths: [],
      filePermissions: [],
    };

    expect(isPathAuthorized(scope, "backend/file.ts", "modify")).toBe(false);
  });

  it("denies all paths when scope is empty", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: [],
    };

    expect(isPathAuthorized(scope, "src/file.ts", "create")).toBe(false);
  });

  it("normalizes Windows-style paths", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: [
        { path: "src/file.ts", operations: ["modify"] },
      ],
    };

    expect(isPathAuthorized(scope, "src\\file.ts", "modify")).toBe(true);
  });
});

describe("isPathInScope", () => {
  it("returns true for paths in filePermissions", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: [
        { path: "src/file.ts", operations: ["modify"] },
      ],
    };

    expect(isPathInScope(scope, "src/file.ts")).toBe(true);
    expect(isPathInScope(scope, "src/other.ts")).toBe(false);
  });

  it("returns true for paths in allowedExactPaths", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: ["src/exact.ts"],
      filePermissions: [],
    };

    expect(isPathInScope(scope, "src/exact.ts")).toBe(true);
    expect(isPathInScope(scope, "src/other.ts")).toBe(false);
  });

  it("returns true for paths under allowedPrefixes", () => {
    const scope: GuardScope = {
      allowedPrefixes: ["src/"],
      allowedExactPaths: [],
      filePermissions: [],
    };

    expect(isPathInScope(scope, "src/any/file.ts")).toBe(true);
    expect(isPathInScope(scope, "backend/file.ts")).toBe(false);
  });
});

describe("validateScope", () => {
  it("accepts a valid scope with filePermissions", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: [
        { path: "src/file.ts", operations: ["create", "modify"] },
      ],
    };

    expect(validateScope(scope)).toBe(true);
  });

  it("accepts a valid scope with allowedExactPaths", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: ["src/exact.ts"],
      filePermissions: [],
    };

    expect(validateScope(scope)).toBe(true);
  });

  it("rejects a file permission with an empty path", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: [
        { path: "", operations: ["create"] },
      ],
    };

    expect(() => validateScope(scope)).toThrow(/path cannot be empty/);
  });

  it("rejects a file permission with no operations", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: [],
      filePermissions: [
        { path: "src/file.ts", operations: [] },
      ],
    };

    expect(() => validateScope(scope)).toThrow(/no operations/);
  });
});

describe("scope precedence (Section 9.2)", () => {
  it("filePermissions overrides allowedExactPaths", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: ["src/file.ts"],
      filePermissions: [
        { path: "src/file.ts", operations: ["modify"] },
      ],
    };

    // filePermissions is authoritative: only "modify" is permitted.
    expect(isPathAuthorized(scope, "src/file.ts", "modify")).toBe(true);
    expect(isPathAuthorized(scope, "src/file.ts", "create")).toBe(false);
    expect(isPathAuthorized(scope, "src/file.ts", "delete")).toBe(false);
  });

  it("filePermissions overrides allowedPrefixes", () => {
    const scope: GuardScope = {
      allowedPrefixes: ["src/"],
      allowedExactPaths: [],
      filePermissions: [
        { path: "src/file.ts", operations: ["modify"] },
      ],
    };

    // filePermissions is authoritative: only "src/file.ts" is in scope.
    expect(isPathInScope(scope, "src/file.ts")).toBe(true);
    expect(isPathInScope(scope, "src/other.ts")).toBe(false);
  });

  it("path in filePermissions AND allowedExactPaths: filePermissions wins", () => {
    const scope: GuardScope = {
      allowedPrefixes: [],
      allowedExactPaths: ["src/file.ts"],
      filePermissions: [
        { path: "src/file.ts", operations: ["modify"] },
      ],
    };

    // filePermissions wins: only "modify" is permitted, not all operations.
    expect(isPathAuthorized(scope, "src/file.ts", "modify")).toBe(true);
    expect(isPathAuthorized(scope, "src/file.ts", "delete")).toBe(false);
  });
});
