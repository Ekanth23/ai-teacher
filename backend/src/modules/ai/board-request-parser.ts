import type {
  ActiveBoardIdentity,
  BoardRequestParseResult,
} from "./board-response.types.js";

const COMPARISON_CUE = /\b(compare|comparison|differences?|differ|versus|vs)\b/;
const RESTORE_ACTION =
  /\b(restore|switch|change|go|get|back|return|reset|use)\b/;
const CLARIFICATION_REQUEST =
  /\b(explain|describe|teach|answer|help|show|continue|summari[sz]e|review|use|switch|change)\b/;
const INFORMATION_ABOUT_BOARD =
  /\b(what|which|who|when|where|why|define|meaning|tell me about|explain what|explain who)\b/;
const PERSISTENCE_CUE =
  /\b(from now on|in this conversation|for this conversation|throughout this conversation|for (?:all )?(?:future|subsequent|following) (?:messages|responses|replies)|switch (?:(?:this )?conversation(?: s board)? )?to|change (?:(?:this )?conversation(?: s board)? )?to)\b/;

function normalizePunctuation(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeBoardRequestText(value: string): string {
  return normalizePunctuation(value ?? "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasesForBoard(board: ActiveBoardIdentity): string[] {
  return [...new Set([board.name, board.code].map(normalizePunctuation).filter(Boolean))];
}

function mentionsAlias(text: string, alias: string): boolean {
  if (!alias) return false;
  const escaped = escapeRegExp(alias).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(text);
}

export function findExactActiveBoard(
  label: string,
  activeBoards: ActiveBoardIdentity[]
): ActiveBoardIdentity | null {
  const normalized = normalizeBoardRequestText(label);
  if (!normalized) return null;
  return (
    activeBoards.find((board) =>
      aliasesForBoard(board).some((alias) => mentionsAlias(normalized, alias))
    ) ?? null
  );
}

function boardMentions(
  text: string,
  boards: ActiveBoardIdentity[]
): Array<{ board: ActiveBoardIdentity; alias: string }> {
  const found: Array<{ board: ActiveBoardIdentity; alias: string }> = [];
  for (const board of boards) {
    const alias = aliasesForBoard(board).find((candidate) => mentionsAlias(text, candidate));
    if (alias) found.push({ board, alias });
  }
  return found;
}

function hasBoardContextPhrase(text: string, alias: string): boolean {
  const escaped = escapeRegExp(alias).replace(/\s+/g, "\\s+");
  return [
    new RegExp(`\\b(?:using|according to|under|in|for)\\s+${escaped}\\b`, "u"),
    new RegExp(`\\buse\\s+${escaped}\\b`, "u"),
    new RegExp(`\\b${escaped}\\s+(?:approach|curriculum|syllabus|context|style)\\b`, "u"),
    new RegExp(`\\b(?:explain|describe|teach|answer)\\s+${escaped}\\b`, "u"),
    new RegExp(`\\b(?:switch|change|set)\\s+(?:(?:this )?conversation(?: s board)? )?to\\s+${escaped}\\b`, "u"),
  ].some((pattern) => pattern.test(text));
}

function isRestoreRequest(text: string): boolean {
  if (!/\b(?:normal|default|configured) board\b/.test(text)) return false;
  if (INFORMATION_ABOUT_BOARD.test(text) && !/\b(switch|change|restore|go back|return|reset)\b/.test(text)) {
    return false;
  }
  return RESTORE_ACTION.test(text) || /^(?:my |the )?(?:normal|default|configured) board\b/.test(text);
}

function unresolvedTarget(
  text: string,
  originalText: string,
  knownBoards: ActiveBoardIdentity[]
): string | null {
  const anotherBoard = text.match(
    /\b(?:use|switch(?: (?:this )?conversation)? to|change(?: (?:this )?conversation)? to|according to)\s+(?:another|different|other|unknown)\s+board\b/u
  );
  if (anotherBoard) return null;

  const target = text.match(
    /\b(?:using|according to|under|switch(?: (?:this )?conversation)? to|change(?: (?:this )?conversation)? to)\s+([^,.!?;]+)/u
  )?.[1]?.trim();
  if (!target) return null;

  const knownAlias = knownBoards.some((board) =>
    aliasesForBoard(board).some((alias) => mentionsAlias(target, alias))
  );
  if (knownAlias) return null;

  const originalTarget = originalText.match(
    /\b(?:using|according to|under|switch(?: (?:this )?conversation)? to|change(?: (?:this )?conversation)? to)\s+([^,.!?;]+)/i
  )?.[1]?.trim();
  const containsBoardWord = /\bboard|syllabus|curriculum\b/u.test(target);
  const looksLikeCode = Boolean(originalTarget && /^[A-Z0-9][A-Z0-9._-]{1,15}$/.test(originalTarget));
  const candidate = originalTarget ?? target;
  return containsBoardWord || looksLikeCode ? candidate : null;
}

function result(
  normalizedText: string,
  intent: BoardRequestParseResult["intent"],
  values: Partial<Omit<BoardRequestParseResult, "intent" | "normalizedText">> = {}
): BoardRequestParseResult {
  return {
    intent,
    normalizedText,
    board: values.board ?? null,
    comparisonBoards: values.comparisonBoards ?? [],
    unresolvedTarget: values.unresolvedTarget ?? null,
    reason: values.reason ?? null,
  };
}

/**
 * Deterministically classifies board intent using only exact active board
 * names/codes. No fuzzy, semantic, keyword-similarity, location, profile, or
 * LLM inference is performed.
 */
export function parseBoardRequest(
  question: string,
  activeBoards: ActiveBoardIdentity[]
): BoardRequestParseResult {
  const normalizedText = normalizeBoardRequestText(question);
  if (!normalizedText) return result(normalizedText, "NO_BOARD_REQUEST");

  if (isRestoreRequest(normalizedText)) {
    return result(normalizedText, "RESTORE_NORMAL_BOARD");
  }

  const boards = activeBoards.filter((board) => board.id && board.name && board.code);
  const found = boardMentions(normalizedText, boards);
  const uniqueBoards = [...new Map(found.map((item) => [item.board.id, item])).values()];

  if (uniqueBoards.length > 1) {
    if (COMPARISON_CUE.test(normalizedText)) {
      return result(normalizedText, "CROSS_BOARD_COMPARISON", {
        comparisonBoards: uniqueBoards.map((item) => item.board),
      });
    }
    return result(normalizedText, "CLARIFY_BOARD", {
      reason: "MULTIPLE_BOARD_TARGETS",
    });
  }

  const mention = found[0];
  if (mention && hasBoardContextPhrase(normalizedText, mention.alias)) {
    if (PERSISTENCE_CUE.test(normalizedText) || /^now\s+.*\b(?:according to|using|under)\b/u.test(normalizedText)) {
      return result(normalizedText, "CONVERSATION_BOARD_SCOPE", { board: mention.board });
    }
    return result(normalizedText, "CURRENT_RESPONSE_BOARD", { board: mention.board });
  }

  const missingOrUnknown = unresolvedTarget(normalizedText, question, boards);
  if (missingOrUnknown === null && /\b(?:another|different|other|unknown)\s+board\b/u.test(normalizedText)) {
    return result(normalizedText, "CLARIFY_BOARD", {
      reason: "MISSING_BOARD_TARGET",
    });
  }
  if (missingOrUnknown !== null) {
    return result(normalizedText, "CLARIFY_BOARD", {
      unresolvedTarget: missingOrUnknown,
      reason: "UNRESOLVED_BOARD_TARGET",
    });
  }
  if (
    CLARIFICATION_REQUEST.test(normalizedText) &&
    /\b(?:local|school|regional) board\b/u.test(normalizedText)
  ) {
    return result(normalizedText, "CLARIFY_BOARD", {
      reason: "MISSING_BOARD_TARGET",
    });
  }

  return result(normalizedText, "NO_BOARD_REQUEST");
}
