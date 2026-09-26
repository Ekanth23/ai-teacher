import type { SubjectTopicLevel, SubjectTopicRequestOutcome } from "./board-response.types.js";
import { LearningContextService } from "./learning-context.service.js";
import type {
  ContextEntity,
  LearningHierarchyResolution,
} from "./learning-context.types.js";
import {
  parseSubjectTopicRequest,
  type SubjectTopicCandidate,
} from "./subject-topic-request-parser.js";

/**
 * US-122 current-question subject/chapter/topic resolution seam (Decision #120).
 *
 * This seam owns one job: when a student explicitly names a subject, chapter, or
 * topic in the current question, attempt an authoritative resolution for the
 * current response.
 *
 * It creates no second hierarchy. It delegates to the existing authoritative
 * resolver, which is unchanged, and reuses the existing repository predicates
 * (organization, active class, designated authoritative syllabus, class-subject
 * relationship, active and date-effective curriculum versions, exact
 * name/code/title match). Therefore:
 * - curriculum membership is only ever established by an explicit authoritative
 *   relationship (locked Decision #86);
 * - ambiguous and unresolved states are preserved, never guessed (Decision #120
 *   requirement 6);
 * - nothing is created as a side effect: this file performs no write of any kind
 *   (requirements 7 and Persistence);
 * - conversation free-text labels stay lookup hints, never proof (requirement 8);
 * - history never participates in resolution (requirement 9).
 *
 * The result is request-scoped. It is never persisted, and it never mutates
 * conversation scope.
 */

export interface SubjectTopicResolutionInput {
  organizationId: string;
  /** The current student question, the only text inspected for an explicit request. */
  question: string;
  /** Already-resolved authoritative class for this response. */
  classId: string;
  /** Already-resolved designated authoritative syllabus for this response. */
  syllabusId: string;
  /** Existing conversation scope labels, used only for continuity and layering. */
  scope: {
    subject: string | null;
    chapter: string | null;
    topic: string | null;
  };
  /** Hierarchy already resolved for this response before any explicit request. */
  currentHierarchy: LearningHierarchyResolution;
}

export interface SubjectTopicResolution {
  /**
   * The hierarchy for the current response. Identical to `currentHierarchy` when
   * the question contains no explicit request or the request must not be applied.
   */
  hierarchy: LearningHierarchyResolution;
  outcome: SubjectTopicRequestOutcome;
  /** The hierarchy levels the student explicitly asked about. */
  requestedLevels: SubjectTopicLevel[];
}

const LEVEL_RANK: Record<SubjectTopicLevel, number> = { subject: 3, chapter: 2, topic: 1 };

function entityFor(
  hierarchy: LearningHierarchyResolution,
  level: SubjectTopicLevel
): ContextEntity {
  return level === "subject"
    ? hierarchy.subject
    : level === "chapter"
      ? hierarchy.chapter
      : hierarchy.topic;
}

function levelState(entity: ContextEntity): "RESOLVED" | "AMBIGUOUS" | "SOURCE_UNAVAILABLE" | "UNRESOLVED" {
  if (entity.status === "resolved") return "RESOLVED";
  if (entity.resolutionError === "SOURCE_UNAVAILABLE") return "SOURCE_UNAVAILABLE";
  if (entity.resolutionError?.startsWith("AMBIGUOUS_")) return "AMBIGUOUS";
  return "UNRESOLVED";
}

/**
 * Layer explicit requests over the existing scope labels. An explicit label wins
 * at its own level; a level the student did not name keeps its existing label so
 * an unrelated resolved scope value is never silently discarded. A level the
 * student named but whose label is unusable keeps no label, because locked
 * Decision #98 requires an unresolved new request to be retained as unresolved
 * rather than replaced by an unrelated entity.
 */
function layeredScope(
  scope: SubjectTopicResolutionInput["scope"],
  candidates: SubjectTopicCandidate[]
): SubjectTopicResolutionInput["scope"] {
  const explicit = new Map<SubjectTopicLevel, string | null>();
  for (const candidate of candidates) {
    const label = candidate.label.trim() ? candidate.label : null;
    const existing = explicit.get(candidate.level);
    if (existing === undefined || (existing === null && label !== null)) {
      explicit.set(candidate.level, label);
    }
  }
  const pick = (level: SubjectTopicLevel) =>
    explicit.has(level) ? explicit.get(level) ?? null : scope[level];
  return { subject: pick("subject"), chapter: pick("chapter"), topic: pick("topic") };
}

export class SubjectTopicResolutionService {
  constructor(
    private readonly learningContext: Pick<LearningContextService, "resolveCurriculumScope">
  ) {}

  /**
   * Attempts authoritative resolution for an explicit current-question
   * subject/chapter/topic request. Read-only and request-scoped.
   */
  async resolve(input: SubjectTopicResolutionInput): Promise<SubjectTopicResolution> {
    const parsed = parseSubjectTopicRequest(input.question);
    if (parsed.candidates.length === 0) {
      // No explicit request: the already-resolved hierarchy is returned unchanged
      // so a response without one is identical to the pre-US-122 behaviour.
      return {
        hierarchy: input.currentHierarchy,
        outcome: parsed.ambiguous ? "AMBIGUOUS" : "NONE",
        requestedLevels: [],
      };
    }
    if (parsed.ambiguous) {
      // More than one explicit target: never choose between them, and never
      // replace the existing hierarchy.
      return {
        hierarchy: input.currentHierarchy,
        outcome: "AMBIGUOUS",
        requestedLevels: [],
      };
    }

    const requestedLevels = [...new Set(parsed.candidates.map((item) => item.level))].sort(
      (left, right) => LEVEL_RANK[right] - LEVEL_RANK[left]
    );
    const usable = parsed.candidates.some((item) => item.label.trim().length > 0);
    if (!usable) {
      // An explicit request whose target cannot be looked up stays unresolved.
      return {
        hierarchy: input.currentHierarchy,
        outcome: "UNRESOLVED",
        requestedLevels,
      };
    }

    let hierarchy: LearningHierarchyResolution;
    try {
      hierarchy = await this.learningContext.resolveCurriculumScope({
        organizationId: input.organizationId,
        classId: input.classId,
        syllabusId: input.syllabusId,
        scope: layeredScope(input.scope, parsed.candidates),
      });
    } catch {
      // The authoritative source could not be consulted. No relationship is
      // fabricated and the existing hierarchy is preserved.
      return {
        hierarchy: input.currentHierarchy,
        outcome: "SOURCE_UNAVAILABLE",
        requestedLevels,
      };
    }

    const states = requestedLevels.map((level) => levelState(entityFor(hierarchy, level)));
    const outcome: SubjectTopicRequestOutcome = states.includes("AMBIGUOUS")
      ? "AMBIGUOUS"
      : states.includes("SOURCE_UNAVAILABLE")
        ? "SOURCE_UNAVAILABLE"
        : states.every((state) => state === "RESOLVED")
          ? "RESOLVED"
          : "UNRESOLVED";

    if (outcome !== "RESOLVED") {
      // A request that could not be authoritatively resolved must not silently
      // replace unrelated existing scope (Decision #120 follow-up rules).
      return { hierarchy: input.currentHierarchy, outcome, requestedLevels };
    }
    return { hierarchy, outcome, requestedLevels };
  }
}
