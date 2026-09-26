import { normalizeBoardRequestText } from "./board-request-parser.js";

/**
 * A language the system may recognize. `name` is a display label and `code` is
 * the authoritative platform/syllabus code (for example "English" / "EN").
 */
export interface LanguageIdentity {
  name: string;
  code: string | null;
}

export type LanguageRequestIntent =
  | "NO_LANGUAGE_REQUEST"
  | "CURRENT_RESPONSE_LANGUAGE";

export type LanguageRequestReason =
  | "MULTIPLE_LANGUAGE_TARGETS"
  | "UNRESOLVED_LANGUAGE_TARGET"
  | null;

export interface LanguageRequestParseResult {
  normalizedText: string;
  intent: LanguageRequestIntent;
  /** Exact match against the supplied authoritative vocabulary. */
  language: LanguageIdentity | null;
  /**
   * Display target for a language that is not present in the supplied
   * authoritative vocabulary (Decision #117). This is still a current-response
   * selection only and is never persisted (Decision #116).
   */
  requestedTarget: string | null;
  /**
   * A language-request construction is present but the target could not be
   * confidently identified as a language. The server asserts no language name;
   * the existing AI/model pipeline resolves it (Decision #118) under the
   * Decision #117 guard.
   */
  unverifiedExplicitRequest: boolean;
  /** True when more than one distinct language target was requested. */
  ambiguous: boolean;
  reason: LanguageRequestReason;
}

/**
 * Words that terminate a candidate target without making it a language name.
 *
 * A target is the noun phrase that names a language, so any word that starts a
 * new clause, continues the sentence, or refers to the student ends the target
 * instead of extending it. Without these terminators a target would absorb the
 * rest of the question ("in French with more examples" -> "French with").
 */
const TARGET_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "answer",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "both",
  "brief",
  "but",
  "by",
  "can",
  "could",
  "depth",
  "detail",
  "did",
  "do",
  "does",
  "either",
  "explain",
  "for",
  "from",
  "give",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "his",
  "i",
  "if",
  "in",
  "instead",
  "into",
  "is",
  "it",
  "its",
  "keep",
  "language",
  "may",
  "me",
  "medium",
  "might",
  "must",
  "my",
  "no",
  "not",
  "now",
  "of",
  "on",
  "only",
  "or",
  "ours",
  "please",
  "reply",
  "respond",
  "response",
  "send",
  "she",
  "should",
  "short",
  "show",
  "simple",
  "so",
  "some",
  "style",
  "such",
  "terms",
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
  "translate",
  "us",
  "use",
  "using",
  "very",
  "via",
  "way",
  "we",
  "were",
  "what",
  "when",
  "which",
  "while",
  "who",
  "will",
  "with",
  "would",
  "write",
  "yes",
  "you",
  "your",
]);

/**
 * English non-language qualifiers: depth, length, simplicity, manner, quantity,
 * format, and audience. They describe HOW an answer should read, never WHICH
 * language it is in, so a target built from them is not a language request.
 *
 * This list contains no language name by design. It is a non-language
 * vocabulary, never a language dictionary, vocabulary, or detection list, and
 * Decision #119's authoritative syllabus capability list remains the only
 * language vocabulary in the system.
 */
const NON_LANGUAGE_QUALIFIER = new Set([
  // depth and completeness
  "detailed",
  "details",
  "deeply",
  "extensive",
  "extensively",
  "thorough",
  "thoroughly",
  // length and size
  "concise",
  "elaborate",
  "full",
  "fully",
  "longer",
  "longest",
  "shorter",
  "shortest",
  // simplicity and clarity
  "easier",
  "easiest",
  "easily",
  "easy",
  "friendly",
  "layman",
  "like",
  "nicely",
  "plain",
  "plainly",
  "properly",
  "simpler",
  "simplest",
  "straightforward",
  // manner
  "additional",
  "again",
  "better",
  "best",
  "carefully",
  "correctly",
  "exactly",
  "extra",
  "fast",
  "mainly",
  "more",
  "most",
  "mostly",
  "quickly",
  "slowly",
  "worse",
  "worst",
  // quantity
  "couple",
  "eight",
  "few",
  "five",
  "four",
  "many",
  "multiple",
  "nine",
  "one",
  "seven",
  "several",
  "single",
  "six",
  "ten",
  "three",
  "twice",
  "two",
  // format and presentation
  "bullet",
  "bullets",
  "diagram",
  "example",
  "examples",
  "form",
  "format",
  "level",
  "levels",
  "line",
  "lines",
  "list",
  "paragraph",
  "paragraphs",
  "part",
  "parts",
  "picture",
  "point",
  "points",
  "sentence",
  "sentences",
  "step",
  "steps",
  "table",
  "tone",
  "version",
  "word",
  "words",
  // audience and register
  "adult",
  "adults",
  "beginner",
  "beginners",
  "child",
  "children",
  "everyday",
  "general",
  "kid",
  "kids",
  "ordinary",
  "student",
  "students",
  // quality
  "good",
  "great",
  "hard",
  "harder",
  "highest",
  "high",
  "low",
  "lower",
  "lowest",
  "nice",
  "school",
]);

/**
 * Words that describe educational scope rather than a language. US-120 must
 * never infer a language from these and must never mutate them.
 */
const SCOPE_WORD =
  /\b(?:board|syllabus|curriculum|medium|class|grade|subject|chapter|topic|term|marks?)\b/iu;

const MAX_TARGET_TOKENS = 3;

/** A token is cased when its script distinguishes upper from lower case. */
const HAS_CASED_CHARACTER = /[\p{Ll}\p{Lu}]/u;
const FIRST_CASED_CHARACTER = /[\p{Ll}\p{Lu}]/u;
/** Letters, combining marks, apostrophes and hyphens only. */
const DISALLOWED_TOKEN_CHARACTER = /[^\p{L}\p{M}'-]/u;
const HAS_DIGIT = /\p{N}/u;
const HAS_LETTER = /\p{L}/u;
/**
 * Structural (not lexical) exclusion of English adverbial and gerund forms in a
 * cased script: no language name ends in "-ing" or "-ly" in Latin script, so a
 * cased lowercase adverb or gerund ("briefly", "solving") is a manner qualifier
 * rather than a language name. A caseless script has no lowercase form, so it is
 * never affected.
 */
const LOWERCASE_NON_NAME_FORM = /\p{Ll}(?:ing|ly)$/u;

/**
 * A target ends at the next clause boundary, so a language target can never
 * absorb the rest of the question ("in French with more examples" -> "French").
 */
const TARGET_CLAUSE_BOUNDARY =
  "\\s+(?:in|into|on|at|by|with|using|via|to|for|from|of|and|or|then|so|but|if|when|while|please|instead|ok|okay)\\b|[,.;:!?]|$";

/** Explicit language-request constructions. None of these is a bare "in X". */
const REQUEST_CONSTRUCTIONS = [
  /\buse\s+(.+?)\s+for\b/giu,
  /\btranslate\b[^,.!?;]*?\b(?:in)?to\s+(.+)/giu,
  new RegExp(
    `\\b(?:in|using|with)\\s+([\\p{L}\\p{M}][\\p{L}\\p{M}' -]*?)(?=${TARGET_CLAUSE_BOUNDARY})`,
    "giu"
  ),
  /(?:\b|^|[,.;:!?]\s+)([\p{L}][\p{L}\p{M}'-]*)\s+(?:please|instead|ok|okay)\b/gu,
];

/** Suffixes that mark a lowercase token as a deliberate language reference. */
const DELIBERATE_LANGUAGE_SUFFIX = /\b(?:language|medium)\s*$/iu;

type TargetConfidence = "CONFIDENT" | "UNVERIFIED" | "NONE";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function languageAliases(language: LanguageIdentity): string[] {
  return [
    ...new Set(
      [language.name, language.code]
        .map((value) => normalizeBoardRequestText(value ?? ""))
        .filter(Boolean)
    ),
  ];
}

function mentionsAlias(text: string, alias: string): boolean {
  if (!alias) return false;
  const escaped = escapeRegExp(alias).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(text);
}

export function findExactLanguage(
  label: string | null | undefined,
  languages: LanguageIdentity[]
): LanguageIdentity | null {
  const normalized = normalizeBoardRequestText(label ?? "");
  if (!normalized) return null;
  for (const language of languages) {
    if (languageAliases(language).some((alias) => mentionsAlias(normalized, alias))) {
      return language;
    }
  }
  return null;
}

/** Trims a raw candidate to a bounded, non-stop-word, non-qualifier sequence. */
function trimTarget(raw: string): string {
  const tokens = raw
    .split(/[\s,.;:!?()[\]{}"'`]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    const normalized = normalizeBoardRequestText(token);
    if (TARGET_STOP_WORDS.has(normalized)) break;
    // A qualifier describes the answer, not the language. A leading qualifier is
    // skipped ("in general French") and any later qualifier ends the target
    // ("in full detail", "in two parts"), so a phrase built only from
    // qualifiers is never an explicit language request.
    if (NON_LANGUAGE_QUALIFIER.has(normalized)) {
      if (kept.length === 0) continue;
      break;
    }
    kept.push(token);
    if (kept.length >= MAX_TARGET_TOKENS) break;
  }
  while (
    kept.length > 0 &&
    TARGET_STOP_WORDS.has(normalizeBoardRequestText(kept[kept.length - 1]))
  ) {
    kept.pop();
  }
  return kept.join(" ").trim();
}

/**
 * Classifies a single candidate token without any language vocabulary,
 * dictionary, fuzzy matching, or detection dependency.
 *
 * A token is accepted when it carries no non-language signal at all: a
 * non-language qualifier word, a scope word, a digit, or a character outside
 * letters and combining marks rejects it outright, so an obvious non-language
 * target never becomes an explicit language request.
 *
 * An accepted token is CONFIDENT when its script provides a name signal: a
 * caseless script ("தமிழ்", "हिन्दी", "മലയാളം", "日本語", "العربية"), where
 * capitalization carries no signal either way, or a cased script whose first
 * cased character is uppercase ("French", "Français", "Modern Standard Arabic").
 * An all-lowercase token in a cased script is UNVERIFIED: the request is
 * accepted and never dropped, but the server does not assert a language name it
 * cannot corroborate, so the existing pipeline resolves it (Decision #118)
 * under the Decision #117 honoring guard.
 */
function classifyTargetToken(token: string): TargetConfidence {
  if (HAS_DIGIT.test(token)) return "NONE";
  if (!HAS_LETTER.test(token)) return "NONE";
  if (DISALLOWED_TOKEN_CHARACTER.test(token)) return "NONE";
  const normalized = normalizeBoardRequestText(token);
  if (TARGET_STOP_WORDS.has(normalized)) return "NONE";
  if (NON_LANGUAGE_QUALIFIER.has(normalized)) return "NONE";
  if (SCOPE_WORD.test(token)) return "NONE";
  // A caseless script provides no capitalization signal; the token is taken as
  // written rather than rejected for lacking an uppercase initial.
  if (!HAS_CASED_CHARACTER.test(token)) return "CONFIDENT";
  // An English adverb or gerund in a cased script is a manner qualifier.
  if (LOWERCASE_NON_NAME_FORM.test(token)) return "NONE";
  const first = FIRST_CASED_CHARACTER.exec(token);
  if (!first) return "CONFIDENT";
  const character = first[0];
  return character === character.toUpperCase() && character !== character.toLowerCase()
    ? "CONFIDENT"
    : "UNVERIFIED";
}

function classifyTarget(raw: string): TargetConfidence {
  const tokens = raw.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > MAX_TARGET_TOKENS) return "NONE";
  if (SCOPE_WORD.test(raw)) return "NONE";
  if (tokens.some((token) => classifyTargetToken(token) === "NONE")) return "NONE";
  return tokens.every((token) => classifyTargetToken(token) === "CONFIDENT")
    ? "CONFIDENT"
    : "UNVERIFIED";
}

function hasLanguageContextPhrase(text: string, alias: string): boolean {
  const escaped = escapeRegExp(alias).replace(/\s+/g, "\\s+");
  return [
    new RegExp(`\\b(?:in|using|with)\\s+${escaped}\\b`, "u"),
    new RegExp(`\\buse\\s+${escaped}\\s+for\\b`, "u"),
    new RegExp(`\\b${escaped}\\s+(?:language|medium)\\b`, "u"),
  ].some((pattern) => pattern.test(text));
}

/**
 * Collects explicit language-request targets from the original, case-preserving
 * text. A candidate is kept only when at least one token classifies as
 * CONFIDENT or UNVERIFIED, or when the target explicitly ends in "language" or
 * "medium" so a deliberate lowercase reference is never dropped.
 */
function collectExplicitTargets(originalText: string): string[] {
  const found: string[] = [];
  for (const pattern of REQUEST_CONSTRUCTIONS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(originalText)) !== null) {
      const raw = trimTarget(match[1] ?? "");
      if (raw && classifyTarget(raw) !== "NONE") found.push(raw);
      else if (raw && DELIBERATE_LANGUAGE_SUFFIX.test(raw)) found.push(raw);
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return found;
}

function result(
  normalizedText: string,
  intent: LanguageRequestIntent,
  values: Partial<Omit<LanguageRequestParseResult, "intent" | "normalizedText">> = {}
): LanguageRequestParseResult {
  return {
    intent,
    normalizedText,
    language: values.language ?? null,
    requestedTarget: values.requestedTarget ?? null,
    unverifiedExplicitRequest: values.unverifiedExplicitRequest ?? false,
    ambiguous: values.ambiguous ?? false,
    reason: values.reason ?? null,
  };
}

/**
 * Deterministically classifies an explicit response-language request.
 *
 * Matching is exact and normalized: the supplied authoritative vocabulary is
 * matched by name or code only. No fuzzy, semantic, keyword-similarity, board,
 * class, medium, location, profile, or LLM inference is performed.
 *
 * A candidate target token is script-aware and mark-aware: it is accepted when
 * it contains no uppercase codepoint at all (lowercase Latin, or a caseless
 * script such as Tamil, Devanagari, Malayalam, Han or Arabic) or when its first
 * cased character is uppercase. Non-language qualifiers, scope words, digits,
 * and characters outside letters and combining marks reject a token outright,
 * so "in detail", "in short terms", "in medium", and "in Class 8" never become
 * language requests.
 *
 * Decision #117: when an accepted target is absent from the authoritative
 * syllabus language capability list, the request is still honored for the
 * current response only. A name-confident target is reported through
 * `requestedTarget`; a lowercase cased-script target the server cannot
 * corroborate is reported through `unverifiedExplicitRequest` so that no
 * language name is invented (Decision #118).
 *
 * There is deliberately no persistence intent in this contract. Decision #116
 * makes US-120 language selection request-scoped, so wording such as
 * "From now on explain in Tamil" resolves to exactly the same current-response
 * selection as "Explain this in Tamil".
 */
export function parseLanguageRequest(
  question: string,
  languages: LanguageIdentity[]
): LanguageRequestParseResult {
  const original = question ?? "";
  const normalizedText = normalizeBoardRequestText(original);
  if (!normalizedText) return result(normalizedText, "NO_LANGUAGE_REQUEST");

  const vocabulary = languages.filter(
    (language) => language.name && languageAliases(language).length > 0
  );

  // An exact authoritative-vocabulary match is accepted only in a language
  // request construction, and only when the target is unambiguous.
  const vocabularyMatches = vocabulary.filter((language) =>
    languageAliases(language).some(
      (alias) => mentionsAlias(normalizedText, alias) && hasLanguageContextPhrase(normalizedText, alias)
    )
  );
  if (vocabularyMatches.length > 1) {
    return result(normalizedText, "NO_LANGUAGE_REQUEST", {
      ambiguous: true,
      reason: "MULTIPLE_LANGUAGE_TARGETS",
    });
  }
  if (vocabularyMatches.length === 1) {
    return result(normalizedText, "CURRENT_RESPONSE_LANGUAGE", {
      language: vocabularyMatches[0],
    });
  }

  const targets = collectExplicitTargets(original);
  if (targets.length === 0) return result(normalizedText, "NO_LANGUAGE_REQUEST");

  const distinct = [...new Set(targets.map((target) => normalizeBoardRequestText(target)))];
  if (distinct.length > 1) {
    return result(normalizedText, "NO_LANGUAGE_REQUEST", {
      ambiguous: true,
      reason: "MULTIPLE_LANGUAGE_TARGETS",
    });
  }

  const target = targets[0];
  const matched = findExactLanguage(target, vocabulary);
  if (matched) {
    return result(normalizedText, "CURRENT_RESPONSE_LANGUAGE", { language: matched });
  }

  // Decision #117: an explicitly requested language outside the authoritative
  // vocabulary is still honored for the current response only.
  if (classifyTarget(target) === "CONFIDENT") {
    return result(normalizedText, "CURRENT_RESPONSE_LANGUAGE", {
      requestedTarget: target,
      reason: "UNRESOLVED_LANGUAGE_TARGET",
    });
  }

  // The request is real but the target is not confidently a language name. The
  // server asserts no language; the existing model pipeline resolves it under
  // the same Decision #117 guard.
  return result(normalizedText, "CURRENT_RESPONSE_LANGUAGE", {
    unverifiedExplicitRequest: true,
    reason: "UNRESOLVED_LANGUAGE_TARGET",
  });
}
