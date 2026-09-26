import { describe, expect, it } from "vitest";
import { resolveClassAwareness } from "../../src/modules/ai/class-awareness.js";
import type { ModelLearningProfile } from "../../src/modules/ai/learning-context.types.js";

/**
 * A post-budget projection profile. Only two sections are present because the
 * token budget drops optional sections before the prompt is rendered.
 */
const budgetedProfile: ModelLearningProfile = {
  weak_topics: [
    { title: "Equivalent Fractions", performance: 42, answered_responses: 7 },
  ],
  strong_topics: [
    { title: "Types of Fractions", performance: 91, answered_responses: 11 },
  ],
};

function policy(overrides: {
  effectiveClass?: string | null;
  gradeLevel?: string | null;
  curriculumAvailable?: boolean;
  modelLearningProfile?: ModelLearningProfile | undefined;
} = {}) {
  return resolveClassAwareness({
    effectiveClass: overrides.effectiveClass ?? null,
    gradeLevel: overrides.gradeLevel ?? null,
    curriculumAvailable: overrides.curriculumAvailable ?? false,
    modelLearningProfile: overrides.modelLearningProfile,
  });
}

describe("US-121 class-aware presentation policy", () => {
  it("resolves an educational level from a resolved class", () => {
    expect(policy({ effectiveClass: "Class 8" })).toEqual({
      status: "RESOLVED",
      educationalLevelAvailable: true,
      authoritativeCurriculum: "UNAVAILABLE",
      learningProfileSections: [],
    });
  });

  it("resolves an educational level from the authoritative grade level alone", () => {
    // Decision #6 accepts class OR grade as the educational level.
    const resolved = policy({ gradeLevel: "8" });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.educationalLevelAvailable).toBe(true);
  });

  it("resolves when either the class or the grade is present", () => {
    for (const input of [
      { effectiveClass: "Class 8", gradeLevel: null },
      { effectiveClass: null, gradeLevel: "8" },
      { effectiveClass: "Class 8", gradeLevel: "8" },
      { effectiveClass: "  ", gradeLevel: "8" },
      { effectiveClass: "Class 8", gradeLevel: "   " },
    ]) {
      expect(policy(input).status, JSON.stringify(input)).toBe("RESOLVED");
    }
  });

  it("stays unresolved when neither a class nor a grade is resolved", () => {
    for (const input of [
      { effectiveClass: null, gradeLevel: null },
      { effectiveClass: "", gradeLevel: "" },
      { effectiveClass: "   ", gradeLevel: "\t" },
    ]) {
      const resolved = policy(input);
      expect(resolved.status, JSON.stringify(input)).toBe("UNRESOLVED");
      expect(resolved.educationalLevelAvailable, JSON.stringify(input)).toBe(false);
    }
  });

  it("mirrors the existing authoritative-curriculum availability signal", () => {
    expect(policy({ effectiveClass: "Class 8", curriculumAvailable: true }).authoritativeCurriculum).toBe(
      "AVAILABLE"
    );
    expect(policy({ effectiveClass: "Class 8", curriculumAvailable: false }).authoritativeCurriculum).toBe(
      "UNAVAILABLE"
    );
    // Availability is reported even when the class itself is unresolved, so the
    // prompt layer never has to re-resolve curriculum.
    expect(policy({ curriculumAvailable: true }).authoritativeCurriculum).toBe("AVAILABLE");
  });

  it("reports post-budget profile section names and nothing else", () => {
    const resolved = policy({
      effectiveClass: "Class 8",
      modelLearningProfile: budgetedProfile,
    });
    // Names only, deterministic order, and no dropped section.
    expect(resolved.learningProfileSections).toEqual(["strong_topics", "weak_topics"]);
    expect(policy({ effectiveClass: "Class 8" }).learningProfileSections).toEqual([]);
    expect(
      policy({ effectiveClass: "Class 8", modelLearningProfile: {} }).learningProfileSections
    ).toEqual([]);
  });

  it("copies no profile value, title, count, or score into the policy", () => {
    const resolved = policy({
      effectiveClass: "Class 8",
      modelLearningProfile: budgetedProfile,
    });
    const serialized = JSON.stringify(resolved);
    expect(serialized).not.toContain("Equivalent Fractions");
    expect(serialized).not.toContain("Types of Fractions");
    expect(serialized).not.toContain("42");
    expect(serialized).not.toContain("91");
    for (const section of resolved.learningProfileSections) {
      expect(typeof section).toBe("string");
    }
  });

  it("never derives a level, band, score, or classification from a grade value", () => {
    // Decision #6 must not become a grade-to-complexity table: every distinct
    // class or grade label yields exactly the same policy.
    const baseline = policy({ effectiveClass: "Class 8", gradeLevel: "8", curriculumAvailable: true });
    for (const input of [
      { effectiveClass: "Class 1", gradeLevel: "1" },
      { effectiveClass: "Class 5", gradeLevel: "5" },
      { effectiveClass: "Class 10", gradeLevel: "10" },
      { effectiveClass: "Class 12", gradeLevel: "12" },
      { effectiveClass: "Pre-Primary", gradeLevel: "KG" },
      { effectiveClass: "Class 8", gradeLevel: "12" },
    ]) {
      expect(policy({ ...input, curriculumAvailable: true }), JSON.stringify(input)).toEqual(baseline);
    }
  });

  it("exposes exactly the four presentation fields and no numeric measure", () => {
    const resolved = policy({
      effectiveClass: "Class 8",
      gradeLevel: "8",
      curriculumAvailable: true,
      modelLearningProfile: budgetedProfile,
    });
    expect(Object.keys(resolved).sort()).toEqual([
      "authoritativeCurriculum",
      "educationalLevelAvailable",
      "learningProfileSections",
      "status",
    ]);
    for (const value of Object.values(resolved)) {
      expect(typeof value).not.toBe("number");
    }
    // The policy is label-free, so it cannot carry an internal identifier.
    expect(JSON.stringify(resolved)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
  });

  it("contains no I/O, no write path, and no Epic 10 derivation", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFile } = require("node:fs/promises") as typeof import("node:fs/promises");
    const source = await readFile(
      new URL("../../src/modules/ai/class-awareness.ts", import.meta.url),
      "utf8"
    );

    // Pure projection: the only dependency is the existing US-118 projection type.
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("./learning-context.types.js");
    expect(imports[0]).toContain("import type");

    // No numeric conversion, so no grade value can become a level or a band.
    expect(source).not.toMatch(/parseInt|parseFloat|Number\(|Math\.|BigInt/);
    // No database, network, or provider call.
    expect(source).not.toMatch(/\b(?:insert|update|delete|pool|query|fetch|axios)\b/i);
    expect(source).not.toMatch(
      /\b(?:generate|provider|openai|anthropic|embedding|vector|completion)\b/i
    );
    // Epic 10 is consumed only as the existing projection; nothing is derived.
    expect(source).not.toMatch(/from\s+["'][^"']*progress/i);
  });
});
