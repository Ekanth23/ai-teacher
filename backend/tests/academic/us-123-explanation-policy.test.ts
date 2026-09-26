import { describe, expect, it } from "vitest";
import {
  EXPLANATION_ADAPTATION_DIMENSIONS,
  resolveExplanationPolicy,
  type ExplanationPolicyInput,
} from "../../src/modules/ai/explanation-policy.js";
import type { ClassAwarenessPolicy } from "../../src/modules/ai/class-awareness.js";
import type { ModelLearningProfile } from "../../src/modules/ai/learning-context.types.js";

/**
 * US-123 explanation adaptation policy (locked Decision #8).
 *
 * The policy is a request-time availability statement over context that US-118
 * through US-122 already resolved. These tests pin the three properties the
 * locked decision depends on: it mirrors rather than re-derives, it carries no
 * number or label, and it introduces no classification of the student's
 * request.
 */

const RESOLVED_CLASS: ClassAwarenessPolicy = {
  status: "RESOLVED",
  educationalLevelAvailable: true,
  authoritativeCurriculum: "AVAILABLE",
  learningProfileSections: ["weak_topics"],
};

const UNRESOLVED_CLASS: ClassAwarenessPolicy = {
  status: "UNRESOLVED",
  educationalLevelAvailable: false,
  authoritativeCurriculum: "UNAVAILABLE",
  learningProfileSections: [],
};

const budgetedProfile: ModelLearningProfile = {
  weak_topics: [{ title: "Equivalent Fractions", performance: 42, answered_responses: 7 }],
};

function input(overrides: Partial<ExplanationPolicyInput> = {}): ExplanationPolicyInput {
  return {
    classAwareness: RESOLVED_CLASS,
    curriculumGrounded: true,
    medium: "English",
    responseLanguage: "English",
    subject: "Mathematics",
    chapter: "Fractions",
    topic: "Equivalent Fractions",
    learningProfile: budgetedProfile,
    continuity: true,
    ...overrides,
  };
}

const ALL_DIMENSIONS = [...EXPLANATION_ADAPTATION_DIMENSIONS];

const CONDITIONAL_RULES: Array<[string, Partial<ExplanationPolicyInput>]> = [
  ["EDUCATIONAL_LEVEL", { classAwareness: UNRESOLVED_CLASS }],
  ["BOARD", { curriculumGrounded: false }],
  ["MEDIUM_LANGUAGE", { medium: null, responseLanguage: null }],
  ["SUBJECT", { subject: null }],
  ["CHAPTER_TOPIC", { chapter: null, topic: null }],
  ["LEARNING_PROFILE", { learningProfile: undefined }],
  ["CONVERSATION_HISTORY", { continuity: false }],
];

describe("US-123 explanation adaptation policy", () => {
  it("enumerates exactly the seven adaptation inputs of locked Decision #8", () => {
    // Decision #8: class, board, medium/language, subject, chapter/topic,
    // Epic 10 learning context, conversation history.
    expect(ALL_DIMENSIONS).toEqual([
      "EDUCATIONAL_LEVEL",
      "BOARD",
      "MEDIUM_LANGUAGE",
      "SUBJECT",
      "CHAPTER_TOPIC",
      "LEARNING_PROFILE",
      "CONVERSATION_HISTORY",
    ]);
  });

  it("reports every dimension when all resolved context is available", () => {
    expect(resolveExplanationPolicy(input())).toEqual({
      dimensions: ALL_DIMENSIONS,
      curriculumGrounded: true,
      continuity: true,
    });
  });

  it("keeps a deterministic dimension order regardless of input ordering", () => {
    const forward = resolveExplanationPolicy(input());
    const reversed = resolveExplanationPolicy({
      continuity: true,
      learningProfile: budgetedProfile,
      topic: "Equivalent Fractions",
      chapter: "Fractions",
      subject: "Mathematics",
      responseLanguage: "English",
      medium: "English",
      curriculumGrounded: true,
      classAwareness: RESOLVED_CLASS,
    });

    expect(forward).toEqual(reversed);
    // The order comes from the frozen constant, never from the caller's key order.
    expect(forward.dimensions).toEqual(ALL_DIMENSIONS);
  });

  it("reports no dimension when no context was resolved", () => {
    // The compatibility shape: a request with no learning context and no board
    // overlay still receives the always-on explanation rules, and nothing else.
    const policy = resolveExplanationPolicy(
      input({
        classAwareness: UNRESOLVED_CLASS,
        curriculumGrounded: false,
        medium: null,
        responseLanguage: null,
        subject: null,
        chapter: null,
        topic: null,
        learningProfile: undefined,
        continuity: false,
      })
    );

    expect(policy).toEqual({
      dimensions: [],
      curriculumGrounded: false,
      continuity: false,
    });
  });

  it.each(CONDITIONAL_RULES)("drops only the %s dimension", (dimension, overrides) => {
    const policy = resolveExplanationPolicy(input(overrides));

    expect(policy.dimensions).not.toContain(dimension);
    expect(policy.dimensions).toEqual(
      ALL_DIMENSIONS.filter((candidate) => candidate !== dimension)
    );
  });

  it("consumes the US-121 class policy instead of re-deriving the level", () => {
    // Decision #6: the educational level is US-121's to resolve. US-123 has no
    // grade input of its own and cannot disagree about whether a level exists.
    expect(resolveExplanationPolicy(input()).dimensions).toContain("EDUCATIONAL_LEVEL");
    expect(
      resolveExplanationPolicy(input({ classAwareness: UNRESOLVED_CLASS })).dimensions
    ).not.toContain("EDUCATIONAL_LEVEL");
  });

  it("mirrors the US-119 curriculum signal without re-resolving it", () => {
    // `curriculumGrounded` is a boolean mirror of the already-resolved
    // CURRICULUM_GROUNDED response mode, exactly as ClassAwarenessPolicy mirrors
    // the same signal. It is deliberately not a new enumeration.
    for (const curriculumGrounded of [true, false]) {
      const policy = resolveExplanationPolicy(input({ curriculumGrounded }));
      expect(policy.curriculumGrounded).toBe(curriculumGrounded);
      expect(typeof policy.curriculumGrounded).toBe("boolean");
      // The board dimension and the mirror always agree.
      expect(policy.dimensions.includes("BOARD")).toBe(curriculumGrounded);
    }
  });

  it("treats a resolved board label without evidence as no board adaptation", () => {
    // Decision #64 grants a curriculum-relevant example rule only when
    // authoritative resources provide one. A bare board label grants nothing.
    const policy = resolveExplanationPolicy(input({ curriculumGrounded: false }));

    expect(policy.dimensions).not.toContain("BOARD");
    expect(policy.curriculumGrounded).toBe(false);
  });

  it("resolves the medium/language dimension from either side alone", () => {
    expect(
      resolveExplanationPolicy(input({ responseLanguage: null })).dimensions
    ).toContain("MEDIUM_LANGUAGE");
    expect(
      resolveExplanationPolicy(input({ medium: null })).dimensions
    ).toContain("MEDIUM_LANGUAGE");
    expect(
      resolveExplanationPolicy(input({ medium: null, responseLanguage: null })).dimensions
    ).not.toContain("MEDIUM_LANGUAGE");
  });

  it("separates the subject dimension from the chapter/topic dimension", () => {
    expect(
      resolveExplanationPolicy(input({ chapter: null, topic: null })).dimensions
    ).toContain("SUBJECT");
    expect(
      resolveExplanationPolicy(input({ subject: null, chapter: null, topic: null })).dimensions
    ).not.toContain("SUBJECT");
    expect(
      resolveExplanationPolicy(input({ subject: null, topic: null })).dimensions
    ).toContain("CHAPTER_TOPIC");
  });

  it("treats an empty or whitespace label as unresolved", () => {
    const policy = resolveExplanationPolicy(
      input({
        medium: "   ",
        responseLanguage: "",
        subject: "  ",
        chapter: "\t",
        topic: " ",
      })
    );

    expect(policy.dimensions).not.toContain("MEDIUM_LANGUAGE");
    expect(policy.dimensions).not.toContain("SUBJECT");
    expect(policy.dimensions).not.toContain("CHAPTER_TOPIC");
  });

  it("ignores a learning profile that carries no rendered section", () => {
    // The token budget drops optional sections, and an emptied profile must not
    // keep a rule alive that points at nothing the model can read.
    expect(resolveExplanationPolicy(input({ learningProfile: {} })).dimensions).not.toContain(
      "LEARNING_PROFILE"
    );
    expect(resolveExplanationPolicy(input()).dimensions).toContain("LEARNING_PROFILE");
  });

  it("carries no number, threshold, or numeric classification", () => {
    // Decision #8: no new mastery/understanding score or learning metric. The
    // policy must hold no number of any kind, exactly as ClassAwarenessPolicy
    // deliberately carries none.
    for (const source of [
      input(),
      input({ classAwareness: UNRESOLVED_CLASS, curriculumGrounded: false, continuity: false }),
    ]) {
      const policy = resolveExplanationPolicy(source);
      const values = [
        ...policy.dimensions,
        policy.curriculumGrounded,
        policy.continuity,
      ].filter((value) => typeof value === "number");
      expect(values).toEqual([]);
      expect(JSON.stringify(policy)).not.toMatch(/\d/);
    }
  });

  it("carries no label, identifier, or free text of any kind", () => {
    const policy = resolveExplanationPolicy(input());
    const serialized = JSON.stringify(policy);

    for (const label of [
      "Class 8",
      "CBSE",
      "English",
      "Mathematics",
      "Fractions",
      "Equivalent Fractions",
      "weak_topics",
      "Equivalent Fractions, performance",
    ]) {
      expect(serialized, label).not.toContain(label);
    }
    expect(serialized).not.toMatch(/00000000-0000-4000-8000-[0-9a-f]{12}/i);
    expect(serialized).not.toMatch(/https?:\/\//i);
  });

  it("never mutates its input and never inspects a student question", () => {
    // The policy has no question parameter at all: Decision #8 states the
    // behavior unconditionally, so no request classification is derived here.
    const source = input();
    const snapshot = structuredClone(source);

    resolveExplanationPolicy(source);

    expect(source).toEqual(snapshot);
    expect(
      Object.keys(input()).some((key) => /question|prompt|text|message/i.test(key))
    ).toBe(false);
  });

  it("is pure: identical input yields an identical policy", () => {
    const source = input();

    expect(resolveExplanationPolicy(source)).toEqual(resolveExplanationPolicy(source));
    expect(resolveExplanationPolicy(input())).not.toBe(resolveExplanationPolicy(input()));
  });
});
