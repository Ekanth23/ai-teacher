import type { ClassAwarenessPolicy } from "./class-awareness.js";
import type { ModelLearningProfile } from "./learning-context.types.js";

/**
 * US-123 step-by-step explanation adaptation policy (locked Decision #8).
 *
 * Decision #8 requires the AI to "explain sequentially, provide examples,
 * adapt depth/complexity using class, board, medium/language, subject,
 * chapter/topic, Epic 10 learning context, conversation history", to use
 * authoritative curriculum where available, and to introduce "no new
 * mastery/understanding score or learning metric".
 *
 * This module is the request-time, read-only counterpart of that decision. It
 * exists for the same reason as the US-121 `class-awareness.ts` seam: the
 * already-resolved context must be turned into an explicit, testable statement
 * of *which* adaptation inputs the model can actually see, so the prompt layer
 * can be conditional and the adaptation can never be asserted against context
 * the model was not shown.
 *
 * Decision #8 boundaries enforced here:
 * - The policy is an *availability* statement only. It resolves no curriculum
 *   entity, re-runs no request parser, and inspects no student text, so it can
 *   neither create nor imply curriculum membership (locked Decisions #86, #87,
 *   #120).
 * - Every dimension is a name for context that an earlier locked decision
 *   already resolved. Nothing here is a score, level, band, threshold, or
 *   classification, and the policy carries no number of any kind. Epic 10
 *   output is consumed exactly as the US-118 post-budget projection rendered it
 *   and is never recalculated, restated, or re-derived.
 * - The educational level and the Epic 10 profile contribution are *consumed*
 *   from the existing `ClassAwarenessPolicy` (locked Decision #6) rather than
 *   re-derived, so US-123 cannot disagree with US-121 about either.
 * - `curriculumGrounded` is a deliberate boolean mirror of the authoritative
 *   curriculum signal US-119 already resolved (`responseMode`). It is
 *   intentionally not a new enumeration and is never re-resolved here, exactly
 *   as `ClassAwarenessPolicy.authoritativeCurriculum` mirrors the same signal.
 * - The policy is label-free on purpose. Class, board, medium, language,
 *   subject, chapter, and topic labels are already rendered by the existing
 *   `student_scope_data` path, so this module adds no free text, no lookup
 *   identity, and no redaction surface.
 *
 * Derived at request time and never stored. This module performs no I/O, holds
 * no state, calls nothing, and cannot fail.
 */

/**
 * The seven adaptation inputs enumerated by locked Decision #8, in that order.
 * A dimension is present only when the model is actually shown that context for
 * the current response.
 */
export const EXPLANATION_ADAPTATION_DIMENSIONS = [
  /** Class/grade expected educational level. Locked Decision #6, resolved by US-121. */
  "EDUCATIONAL_LEVEL",
  /** Authoritative board curriculum and its evidence. Locked Decision #3, resolved by US-119. */
  "BOARD",
  /** Educational medium and resolved response language. Locked Decision #5, resolved by US-120. */
  "MEDIUM_LANGUAGE",
  /** Authoritative subject. Locked Decision #7, resolved by US-119/US-122. */
  "SUBJECT",
  /** Authoritative chapter/topic. Locked Decision #7, resolved by US-119/US-122. */
  "CHAPTER_TOPIC",
  /** Epic 10 learning context, as the US-118 post-budget projection rendered it. */
  "LEARNING_PROFILE",
  /** Conversation history used for continuity only. Locked Decisions #11 and #15. */
  "CONVERSATION_HISTORY",
] as const;

export type ExplanationAdaptationDimension = (typeof EXPLANATION_ADAPTATION_DIMENSIONS)[number];

/**
 * Request-scoped, number-free explanation policy.
 *
 * `dimensions` names which already-resolved context the explanation may adapt
 * to. It is not a ranking, a priority, a difficulty, or a measure.
 */
export interface ExplanationPolicy {
  /** Decision #8 adaptation inputs actually available for this response. */
  dimensions: ExplanationAdaptationDimension[];
  /**
   * Boolean mirror of the US-119 authoritative-curriculum signal
   * (`responseMode === "CURRICULUM_GROUNDED"`). Deliberately not a new
   * enumeration and deliberately not re-resolved here.
   */
  curriculumGrounded: boolean;
  /** True when prior turns are rendered, so a follow-up can continue the concept. */
  continuity: boolean;
}

/**
 * Already-resolved inputs only. Every value here is computed by an earlier
 * locked decision and passed in by the prompt layer; nothing is looked up.
 */
export interface ExplanationPolicyInput {
  /** Existing US-121 policy. Consumed, never re-derived. */
  classAwareness: ClassAwarenessPolicy;
  /** Existing US-119 authoritative-curriculum signal, passed in as a boolean. */
  curriculumGrounded: boolean;
  /** Existing resolved educational medium label. */
  medium: string | null;
  /** Existing US-120 resolved request-time response language. */
  responseLanguage: string | null;
  /** Existing resolved authoritative subject label. */
  subject: string | null;
  /** Existing resolved authoritative chapter label. */
  chapter: string | null;
  /** Existing resolved authoritative topic label. */
  topic: string | null;
  /**
   * The post-budget model learning profile, and only when the prompt actually
   * renders it. The complete internal Epic 10 profile must never be passed here:
   * it is deliberately withheld when the board overlay diverges, and a rule
   * conditioned on unseen context would assert more than the model can read.
   */
  learningProfile: ModelLearningProfile | undefined;
  /** True when conversation history is rendered for this response. */
  continuity: boolean;
}

function isPresent(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasProfile(profile: ModelLearningProfile | undefined): boolean {
  return Boolean(profile) && Object.keys(profile as ModelLearningProfile).length > 0;
}

/**
 * Deterministically derives the US-123 explanation adaptation policy.
 *
 * Pure and synchronous: identical input always yields an identical policy, and
 * the policy is discarded with the request.
 */
export function resolveExplanationPolicy(input: ExplanationPolicyInput): ExplanationPolicy {
  // Decision #8 enumerates the adaptation inputs. Presence is decided purely by
  // whether the context was resolved upstream, never by this module.
  const available: Record<ExplanationAdaptationDimension, boolean> = {
    EDUCATIONAL_LEVEL: input.classAwareness.status === "RESOLVED",
    // The board dimension is the authoritative-curriculum signal US-119 already
    // resolved. A board label with no authoritative evidence is covered by the
    // existing US-119 general-answer rule and grants no curriculum example rule.
    BOARD: input.curriculumGrounded,
    MEDIUM_LANGUAGE: isPresent(input.medium) || isPresent(input.responseLanguage),
    SUBJECT: isPresent(input.subject),
    CHAPTER_TOPIC: isPresent(input.chapter) || isPresent(input.topic),
    LEARNING_PROFILE: hasProfile(input.learningProfile),
    CONVERSATION_HISTORY: input.continuity,
  };

  return {
    // Filtered from the frozen constant, so the order is always deterministic.
    dimensions: EXPLANATION_ADAPTATION_DIMENSIONS.filter(
      (dimension) => available[dimension]
    ),
    curriculumGrounded: input.curriculumGrounded,
    continuity: input.continuity,
  };
}
