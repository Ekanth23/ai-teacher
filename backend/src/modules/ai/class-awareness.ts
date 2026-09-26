import type { ModelLearningProfile } from "./learning-context.types.js";

/**
 * US-121 class-aware presentation policy (locked Decision #6).
 *
 * Class/grade determines the expected educational level, and the authoritative
 * class already reaches the model through the existing US-118 -> US-119 context
 * chain. This module therefore derives only *whether* an educational level is
 * available, and reuses the resolved US-119 curriculum-availability signal
 * exactly as it was already computed.
 *
 * Decision #6 boundaries enforced here:
 * - Class determines the educational level, never the curriculum scope. This
 *   module never resolves, widens, or reorders board, subject, chapter, topic.
 * - Class never changes Epic 10 output. The Epic 10 contribution is limited to
 *   the names of the profile sections the model can already see, taken from the
 *   post-budget projection.
 * - No new class model, no new measure, and no invented class requirement. A
 *   numeric grade value is never read, converted, or banded; the policy carries
 *   no number of any kind.
 * - When no educational level is resolved the policy stays UNRESOLVED so the
 *   prompt layer can forbid assuming a level.
 *
 * The policy is label-free on purpose: the class and grade labels are already
 * rendered by the existing student scope data path, so no additional free text,
 * lookup identity, or redaction surface is introduced here.
 *
 * Derived at request time and never stored. This module performs no I/O, holds
 * no state, and calls nothing.
 */
export type ClassAwarenessStatus = "RESOLVED" | "UNRESOLVED";

export interface ClassAwarenessPolicy {
  status: ClassAwarenessStatus;
  /** True when a class label or a grade label is present in the scope data. */
  educationalLevelAvailable: boolean;
  /**
   * Mirrors the authoritative-curriculum signal already resolved by US-119.
   * Deliberately not a new enumeration and deliberately not re-resolved here.
   */
  authoritativeCurriculum: "AVAILABLE" | "UNAVAILABLE";
  /**
   * Section names of the post-budget model learning profile, in a deterministic
   * order. Names only: no titles, counts, scores, or student data.
   */
  learningProfileSections: string[];
}

export interface ClassAwarenessInput {
  /** Existing resolved class label from the board overlay or US-118 context. */
  effectiveClass: string | null;
  /** Existing authoritative grade-level label. Never parsed. */
  gradeLevel: string | null;
  /** Existing US-119 authoritative-curriculum availability. */
  curriculumAvailable: boolean;
  /** The post-budget model projection profile, when it is rendered. */
  modelLearningProfile: ModelLearningProfile | undefined;
}

function isPresent(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Deterministically derives the class-aware presentation policy.
 *
 * Pure and synchronous: identical input always yields an identical policy, and
 * the policy is discarded with the request.
 */
export function resolveClassAwareness(input: ClassAwarenessInput): ClassAwarenessPolicy {
  const educationalLevelAvailable = isPresent(input.effectiveClass) || isPresent(input.gradeLevel);
  const profile = input.modelLearningProfile;
  return {
    status: educationalLevelAvailable ? "RESOLVED" : "UNRESOLVED",
    educationalLevelAvailable,
    authoritativeCurriculum: input.curriculumAvailable ? "AVAILABLE" : "UNAVAILABLE",
    learningProfileSections: profile ? Object.keys(profile).sort() : [],
  };
}
