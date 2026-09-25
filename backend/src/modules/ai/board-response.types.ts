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
