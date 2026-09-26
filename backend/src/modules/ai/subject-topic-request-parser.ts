import { normalizeBoardRequestText } from "./board-request-parser.js";
import type { SubjectTopicLevel } from "./board-response.types.js";

/**
 * US-122 explicit subject/chapter/topic request detection (Decision #120).
 *
 * Detection is deterministic and construction-based, exactly like the US-119
 * board request parser and the US-120 language request parser. This module never
 * decides curriculum membership: it only extracts the candidate label a student
 * explicitly asked about so the existing authoritative resolver can attempt a
 * resolution. No LLM reasoning, semantic similarity, keyword similarity, fuzzy
 * matching, or general-knowledge inference is used or permitted here, and locked
 * Decision #86 keeps names as identifiers and search hints only.
 *
 * A candidate label is a lookup key. It is never rendered to the model as an
 * authoritative claim, and it never creates a curriculum entity, mapping, or
 * persistent record.
 */

/** Maximum tokens kept from a candidate phrase. */
const MAX_LABEL_TOKENS = 4;

/**
 * Words that make a candidate a response-style qualifier, pronoun, question word,
 * or curriculum-scope term rather than a subject/chapter/topic name.
 */
const LABEL_STOP_WORDS = new Set([
  "a",
  "according",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "both",
  "brief",
  "but",
  "by",
  "can",
  "could",
  "detail",
  "did",
  "do",
  "does",
  "explain",
  "for",
  "from",
  "give",
  "has",
  "have",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "like",
  "me",
  "might",
  "more",
  "most",
  "much",
  "must",
  "my",
  "need",
  "no",
  "not",
  "now",
  "of",
  "on",
  "one",
  "only",
  "or",
  "other",
  "our",
  "out",
  "per",
  "please",
  "same",
  "shall",
  "she",
  "should",
  "show",
  "simple",
  "so",
  "some",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "understand",
  "up",
  "us",
  "using",
  "very",
  "versus",
  "vs",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/**
 * Educational scope words. These describe the context, never a subject, chapter,
 * or topic name, so a candidate containing one is rejected.
 */
const SCOPE_TERM =
  /\b(?:board|syllabus|curriculum|medium|language|class|grade|standard|mark|marks|exam|test|term|chapter|topic|subject|unit|lesson)\b/iu;

const HAS_DIGIT = /\p{N}/u;
const HAS_LETTER = /\p{L}/u;

/**
 * Explicit curriculum-term markers. "Chapter 5", "topic: Equivalent Fractions"
 * and "Subject Science" name a hierarchy level directly.
 */
const MARKED_REQUEST =
  /\b(chapter|topic|subject|unit|lesson)s?\s*(?:number\s*)?(?::|-|is|was|on|of)?\s+([^,.!?;]{1,80})/giu;

/**
 * Teaching verbs. The object of the verb is the explicitly requested concept.
 * These are the ordinary "Explain X" / "Teach me X" forms of locked Decisions
 * #87, #97 and #99.
 */
const TEACHING_REQUEST =
  /\b(?:explain|teach|describe|define|illustrate|walk me through|help me (?:understand|with)|tell me about|show me how)\s+(?:me\s+|us\s+|the\s+|a\s+|an\s+|about\s+|how to\s+|why\s+)?([^,.!?;]{1,80})/giu;

/** "A question about X" names a concept explicitly. */
const ABOUT_REQUEST = /\b(?:question|questions|doubt|help)\s+(?:is\s+)?about\s+([^,.!?;]{1,80})/giu;

export interface SubjectTopicCandidate {
  level: SubjectTopicLevel;
  /** Authoritative lookup key only. Never a rendered claim. */
  label: string;
}

export type SubjectTopicRequestReason =
  | "MULTIPLE_SUBJECT_TOPIC_TARGETS"
  | "MISSING_SUBJECT_TOPIC_TARGET"
  | null;

export interface SubjectTopicRequestParseResult {
  normalizedText: string;
  candidates: SubjectTopicCandidate[];
  /** True when the question names more than one distinct subject/topic target. */
  ambiguous: boolean;
  reason: SubjectTopicRequestReason;
}

function levelFor(marker: string): SubjectTopicLevel {
  const value = marker.toLowerCase();
  if (value.startsWith("subject")) return "subject";
  if (value.startsWith("chapter") || value.startsWith("unit") || value.startsWith("lesson")) {
    return "chapter";
  }
  return "topic";
}

/**
 * Trims a raw candidate to a bounded, non-stop-word phrase and reports whether a
 * curriculum level could plausibly be named. A numeric-only reference survives
 * for the explicit marker forms, where "Chapter 5" is itself the explicit request
 * that locked Decision #88 requires be resolved rather than guessed; the
 * authoritative resolver matches titles, so such a reference simply resolves as
 * unresolved.
 */
function normalizeCandidateLabel(raw: string, options: { allowNumeric: boolean }): string | null {
  const tokens = raw
    .split(/[\s,.;:!?()[\]{}"'`]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    if (LABEL_STOP_WORDS.has(normalizeBoardRequestText(token))) break;
    kept.push(token);
    if (kept.length >= MAX_LABEL_TOKENS) break;
  }
  while (
    kept.length > 0 &&
    LABEL_STOP_WORDS.has(normalizeBoardRequestText(kept[kept.length - 1]))
  ) {
    kept.pop();
  }
  const label = kept.join(" ").trim();
  if (!label) return null;
  if (options.allowNumeric && HAS_DIGIT.test(label)) return label;
  if (!HAS_LETTER.test(label)) return null;
  if (HAS_DIGIT.test(label)) return null;
  if (SCOPE_TERM.test(label)) return null;
  return label;
}

interface CollectOptions {
  /** Capture group holding the candidate label. */
  labelGroup: number;
  /** Fixed level, or null when the level comes from the marker word. */
  level: SubjectTopicLevel | null;
  /** Capture group holding the marker word, when the pattern has one. */
  markerGroup?: number;
  /** Whether a numeric reference may stand as the label. */
  allowNumeric: boolean;
}

function collect(
  pattern: RegExp,
  originalText: string,
  options: CollectOptions
): SubjectTopicCandidate[] {
  const found: SubjectTopicCandidate[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(originalText)) !== null) {
    const marker = options.markerGroup === undefined ? undefined : match[options.markerGroup];
    const label = normalizeCandidateLabel(match[options.labelGroup] ?? "", {
      allowNumeric: options.allowNumeric,
    });
    const level = options.level ?? levelFor(marker ?? "");
    if (label) {
      found.push({ level, label });
    } else if (marker) {
      // An explicit marker whose target cannot form a usable label is still an
      // explicit request. It is carried with an empty label so the seam reports
      // it as unresolved instead of silently dropping the student's request.
      found.push({ level, label: "" });
    }
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return found;
}

/**
 * Deterministically detects an explicit subject/chapter/topic request.
 *
 * Every candidate is only a lookup key. Membership is established exclusively by
 * the existing authoritative resolver (Decision #120 requirements 3-6).
 */
export function parseSubjectTopicRequest(question: string): SubjectTopicRequestParseResult {
  const original = question ?? "";
  const normalizedText = normalizeBoardRequestText(original);
  if (!normalizedText) {
    return { normalizedText, candidates: [], ambiguous: false, reason: null };
  }

  const marked = collect(MARKED_REQUEST, original, {
    labelGroup: 2,
    level: null,
    markerGroup: 1,
    allowNumeric: true,
  });
  const teaching = collect(TEACHING_REQUEST, original, {
    labelGroup: 1,
    level: "topic",
    allowNumeric: false,
  });
  const about = collect(ABOUT_REQUEST, original, {
    labelGroup: 1,
    level: "topic",
    allowNumeric: false,
  });

  // Explicit markers win over the generic teaching-object form for the same text.
  const byLabel = new Map<string, SubjectTopicCandidate>();
  for (const candidate of [...marked, ...teaching, ...about]) {
    const key = normalizeBoardRequestText(candidate.label);
    if (!key) continue;
    const existing = byLabel.get(key);
    if (!existing) {
      byLabel.set(key, candidate);
      continue;
    }
    // Keep the most specific level for a repeated label.
    const specificity = (level: SubjectTopicLevel) =>
      level === "subject" ? 3 : level === "chapter" ? 2 : 1;
    if (specificity(candidate.level) > specificity(existing.level)) byLabel.set(key, candidate);
  }

  const distinctLabels = new Set(
    [...byLabel.values()].map((candidate) => normalizeBoardRequestText(candidate.label))
  );
  if (distinctLabels.size > 1) {
    // More than one explicit target: the system must not choose between them.
    return {
      normalizedText,
      candidates: [],
      ambiguous: true,
      reason: "MULTIPLE_SUBJECT_TOPIC_TARGETS",
    };
  }

  const candidates = [...byLabel.values()];
  if (candidates.length === 0) {
    return { normalizedText, candidates: [], ambiguous: false, reason: null };
  }
  return { normalizedText, candidates, ambiguous: false, reason: null };
}
