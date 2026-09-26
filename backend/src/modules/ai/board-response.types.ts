export const BOARD_REQUEST_INTENTS = [
  "NO_BOARD_REQUEST",
  "CURRENT_RESPONSE_BOARD",
  "CONVERSATION_BOARD_SCOPE",
  "RESTORE_NORMAL_BOARD",
  "CLARIFY_BOARD",
  "CROSS_BOARD_COMPARISON",
] as const;

export type BoardRequestIntent = (typeof BOARD_REQUEST_INTENTS)[number];

export type BoardScopeDuration =
  | "CURRENT_RESPONSE"
  | "CONVERSATION"
  | "NORMAL_BOARD"
  | "INHERITED"
  | "NONE";

export const BOARD_RESPONSE_MODES = [
  "CURRICULUM_GROUNDED",
  "GENERAL_EDUCATIONAL",
  "TARGETED_CLARIFICATION",
  "SOURCE_CONFLICT",
  "CROSS_BOARD_COMPARISON",
] as const;

export type BoardResponseMode = (typeof BOARD_RESPONSE_MODES)[number];

export type BoardEvidenceStatus = "AVAILABLE" | "NONE" | "CONFLICT";

export type BoardEvidenceAuthority =
  | "AUTHORITATIVE_CURRICULUM"
  | "APPROVED_PUBLISHED_RESOURCE";

/** Active global board identity used only for exact deterministic matching. */
export interface ActiveBoardIdentity {
  id: string;
  name: string;
  code: string;
}

export interface BoardRequestParseResult {
  intent: BoardRequestIntent;
  normalizedText: string;
  board: ActiveBoardIdentity | null;
  comparisonBoards: ActiveBoardIdentity[];
  unresolvedTarget: string | null;
  reason:
    | "MISSING_BOARD_TARGET"
    | "UNRESOLVED_BOARD_TARGET"
    | "MULTIPLE_BOARD_TARGETS"
    | null;
}

/** Model-safe curriculum evidence. Internal IDs and source locations never enter this contract. */
export interface BoardEvidenceProjection {
  authority: BoardEvidenceAuthority;
  sourceKind: "CURRICULUM_NODE" | "CURRICULUM_ELEMENT" | "LEARNING_RESOURCE";
  sourceLabel: string;
  content: string;
}

export interface BoardComparisonProjection {
  board: string;
  status: "RESOLVED" | "UNRESOLVED";
  class?: string;
  subject?: string;
  chapter?: string;
  topic?: string;
  evidenceStatus: BoardEvidenceStatus;
  evidence: BoardEvidenceProjection[];
}

/**
 * US-120 server-resolved response-language source.
 *
 * The "current-question language" precedence tier is intentionally absent: it is
 * determined by the model inside the existing AI response pipeline (Decision
 * #118), so the server never asserts it.
 */
export type ResponseLanguageSource = "EXPLICIT_REQUEST" | "CONFIGURED";

/**
 * US-120 response-language availability against the authoritative syllabus
 * language capability list.
 *
 * "UNAVAILABLE" is also used when availability cannot be confirmed because no
 * authoritative syllabus was resolved (Decision #119 clause 1b), so that the
 * model never asserts curriculum-language alignment it cannot prove.
 */
export type ResponseLanguageAvailability = "AVAILABLE" | "UNAVAILABLE" | "UNRESOLVED";

/** A level of the authoritative curriculum hierarchy. */
export type SubjectTopicLevel = "subject" | "chapter" | "topic";

/**
 * US-122 outcome of an explicit subject/chapter/topic request in the current
 * question (Decision #120).
 *
 * - RESOLVED: the explicitly requested level resolved against an authoritative
 *   relationship and is the curriculum context for this response only.
 * - UNRESOLVED: no authoritative relationship exists. The request stays
 *   unresolved and may only be answered as general education.
 * - AMBIGUOUS: several authoritative candidates exist; the system must not
 *   guess, and a minimum targeted clarification may be requested.
 * - SOURCE_UNAVAILABLE: the authoritative source could not be consulted; no
 *   curriculum relationship may be fabricated.
 * - NONE: the question contained no explicit subject/chapter/topic request.
 */
export type SubjectTopicRequestOutcome =
  | "NONE"
  | "RESOLVED"
  | "UNRESOLVED"
  | "AMBIGUOUS"
  | "SOURCE_UNAVAILABLE";

export type BoardResolutionReason =
  | "NO_EFFECTIVE_BOARD"
  | "BOARD_NOT_FOUND"
  | "NO_AUTHORITATIVE_BOARD_CONTEXT"
  | "MULTIPLE_AUTHORITATIVE_BOARD_CONTEXTS"
  | "MULTIPLE_BOARD_TARGETS"
  | "MISSING_BOARD_TARGET"
  | "AUTHORITATIVE_SOURCE_CONFLICT"
  | null;

/**
 * Provider-safe request overlay for US-119. This object contains no database,
 * organization, student, provider, ownership, URL, or secret metadata.
 */
export interface BoardResponseContext {
  intent: BoardRequestIntent;
  duration: BoardScopeDuration;
  responseMode: BoardResponseMode;
  resolutionReason: BoardResolutionReason;
  effectiveBoard: string | null;
  effectiveClass: string | null;
  medium: string | null;
  languages: string[];
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  requestedBoard: string | null;
  evidenceStatus: BoardEvidenceStatus;
  evidence: BoardEvidenceProjection[];
  sourceLabels: string[];
  comparisonBoards: BoardComparisonProjection[];
  generalKnowledgePolicy: "ENRICHMENT_ONLY" | "GENERAL_ONLY";
  /**
   * US-120 request-time response language. Display string only; never an
   * internal, tenant, student, or ownership identifier. Request-scoped and
   * never persisted (Decision #116).
   *
   * Optional so that pre-US-119 context fixtures remain valid; the board
   * response service always populates all three fields.
   */
  responseLanguage?: string | null;
  responseLanguageSource?: ResponseLanguageSource | null;
  responseLanguageAvailability?: ResponseLanguageAvailability;
  /**
   * US-122 explicit subject/chapter/topic request outcome. Present only when the
   * current question actually contained an explicit request, so a response
   * without one is byte-identical to the pre-US-122 contract.
   *
   * Request-scoped and never persisted (Decision #120). The levels themselves are
   * never carried here: an internal lookup identity must not cross into the
   * provider-safe contract.
   */
  subjectTopicRequestOutcome?: Exclude<SubjectTopicRequestOutcome, "NONE">;
}

export interface BoardScopeMutation {
  board: string | null;
  class: string | null;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  language: string | null;
  medium: string | null;
}

export interface BoardResponseResolution {
  context: BoardResponseContext;
  /** Present only when this original request may atomically mutate conversation scope. */
  scopeMutation: BoardScopeMutation | null;
}
