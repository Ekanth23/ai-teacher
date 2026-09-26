import { describe, expect, it } from "vitest";
import {
  findExactLanguage,
  parseLanguageRequest,
  type LanguageIdentity,
} from "../../src/modules/ai/language-request-parser.js";

const vocabulary: LanguageIdentity[] = [
  { name: "English", code: "EN" },
  { name: "Tamil", code: "TA" },
  { name: "Hindi", code: "HI" },
];

describe("US-120 explicit language request parsing", () => {
  it("recognizes an explicit current-response language request", () => {
    for (const question of [
      "Explain this in Tamil",
      "Can you explain this in Tamil?",
      "Use Tamil for this answer",
      "From now on, explain using Tamil",
    ]) {
      const parsed = parseLanguageRequest(question, vocabulary);
      expect(parsed.intent, question).toBe("CURRENT_RESPONSE_LANGUAGE");
      expect(parsed.ambiguous, question).toBe(false);
      expect(parsed.language?.name, question).toBe("Tamil");
    }
    expect(parseLanguageRequest("Explain this in English", vocabulary).language?.name).toBe(
      "English"
    );
  });

  it("matches only on an exact normalized name or code", () => {
    expect(parseLanguageRequest("Explain this in EN", vocabulary).language?.code).toBe("EN");
    expect(parseLanguageRequest("explain this in tamil", vocabulary).language?.name).toBe("Tamil");
    expect(parseLanguageRequest("Explain this in TAMIL", vocabulary).language?.name).toBe("Tamil");
    expect(parseLanguageRequest("Explain this in English.", vocabulary).language?.name).toBe("English");
    // Decision #119 clause 1a: an exact code or hyphen-delimited name is a
    // boundary-delimited exact match, not a substring match.
    expect(parseLanguageRequest("Explain this in Ta", vocabulary).language?.code).toBe("TA");
    expect(parseLanguageRequest("Explain this in Hindi-medium", vocabulary).language?.code).toBe(
      "HI"
    );
  });

  it("never fuzzy, semantic, or substring matches the authoritative vocabulary", () => {
    // The locked guarantee: a partial or near-miss name must never resolve to
    // an authoritative language. Such a target may only fall through to the
    // Decision #117 unavailable-language path, never to the vocabulary.
    for (const question of [
      "Explain this in Tamilnadu",
      "Explain this in Tam",
      "Explain this in Englishes",
      "Explain this in Hindis",
      "Explain this in Tamlish",
    ]) {
      expect(parseLanguageRequest(question, vocabulary).language, question).toBeNull();
    }
  });

  it("does not treat ordinary English qualifiers as a language request", () => {
    for (const question of [
      "Explain this in detail",
      "Explain this in short",
      "Explain this in simple terms",
      "Explain this in depth",
      "Explain this in my own words",
    ]) {
      expect(parseLanguageRequest(question, vocabulary).intent, question).toBe("NO_LANGUAGE_REQUEST");
    }
  });

  it("does not infer a language from educational scope words", () => {
    for (const question of [
      "Explain this in the board",
      "Explain this in the curriculum",
      "Explain this in medium",
      "Explain this in Class 8",
      "Explain this in the syllabus",
    ]) {
      expect(parseLanguageRequest(question, vocabulary).intent, question).toBe("NO_LANGUAGE_REQUEST");
    }
  });

  it("treats persistence wording as a current-response selection only", () => {
    // Decision #116: "From now on" wording must resolve identically to a plain
    // current-response request. The contract exposes no persistence intent.
    const persistent = parseLanguageRequest("From now on explain in Tamil", vocabulary);
    const plain = parseLanguageRequest("Explain this in Tamil", vocabulary);
    expect(persistent.intent).toBe("CURRENT_RESPONSE_LANGUAGE");
    expect(persistent.language).toEqual(plain.language);
    expect(persistent).not.toHaveProperty("persist");
    expect(persistent).not.toHaveProperty("duration");
  });

  it("marks an ambiguous multi-language request deterministically", () => {
    const parsed = parseLanguageRequest("Explain this in Tamil and then in Hindi", vocabulary);
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.reason).toBe("MULTIPLE_LANGUAGE_TARGETS");
    expect(parsed.intent).toBe("NO_LANGUAGE_REQUEST");
    expect(parsed.language).toBeNull();
    expect(parsed.requestedTarget).toBeNull();
  });

  it("honors an explicitly requested language outside the authoritative vocabulary", () => {
    // Decision #117: French is not in the syllabus capability list.
    const parsed = parseLanguageRequest("Explain this in French.", vocabulary);
    expect(parsed.intent).toBe("CURRENT_RESPONSE_LANGUAGE");
    expect(parsed.language).toBeNull();
    expect(parsed.requestedTarget).toBe("French");
    expect(parsed.reason).toBe("UNRESOLVED_LANGUAGE_TARGET");
  });

  it("honors explicit requests regardless of capitalization", () => {
    for (const question of [
      "Explain this in French",
      "EXPLAIN THIS IN FRENCH",
      "Explain this in Français",
      "Please explain in German.",
      "Respond in Spanish please",
      "Please answer in Español",
    ]) {
      const parsed = parseLanguageRequest(question, vocabulary);
      expect(parsed.intent, question).toBe("CURRENT_RESPONSE_LANGUAGE");
      expect(parsed.language ?? parsed.requestedTarget, question).toBeTruthy();
      expect(parsed.unverifiedExplicitRequest, question).toBe(false);
    }
  });

  it("honors a lowercase explicit request without asserting an unverified language", () => {
    // Decision #117 requires the request not be dropped; Decision #118 forbids
    // inventing or confidently assigning a language on insufficient evidence,
    // so an all-lowercase cased-script target is accepted and honored but not
    // named. The unavailable-language behavior is identical in every other
    // respect: current response only, availability UNAVAILABLE, no persistence.
    for (const question of [
      "explain this in french",
      "translate this to french",
      "explain fractions, french please",
      "explain this in modern standard arabic",
    ]) {
      const parsed = parseLanguageRequest(question, vocabulary);
      expect(parsed.intent, question).toBe("CURRENT_RESPONSE_LANGUAGE");
      expect(parsed.ambiguous, question).toBe(false);
      expect(parsed.language, question).toBeNull();
      expect(parsed.requestedTarget, question).toBeNull();
      expect(parsed.unverifiedExplicitRequest, question).toBe(true);
      expect(parsed.reason, question).toBe("UNRESOLVED_LANGUAGE_TARGET");
    }
  });

  it("honors caseless-script and combining-mark language requests", () => {
    for (const [question, target] of [
      ["Explain this in தமிழ்", "தமிழ்"],
      ["Explain this in हिन्दी", "हिन्दी"],
      ["Explain this in മലയാളം", "മലയാളം"],
      ["Explain this in 日本語", "日本語"],
      ["Explain this in العربية", "العربية"],
      ["Explain this in සිංහල", "සිංහල"],
      ["Explain this in Tiếng Việt", "Tiếng Việt"],
    ] as const) {
      const parsed = parseLanguageRequest(question, vocabulary);
      expect(parsed.intent, question).toBe("CURRENT_RESPONSE_LANGUAGE");
      expect(parsed.requestedTarget, question).toBe(target);
      expect(parsed.unverifiedExplicitRequest, question).toBe(false);
    }
  });

  it("recognizes additional explicit request constructions", () => {
    for (const question of [
      "Translate this to French.",
      "Translate this into French.",
      "Translate this to Tamil",
      "Explain fractions, French please",
      "Respond in Spanish please",
      "Answer in Telugu please",
      "Tell me in tamil what a fraction is",
      "Explain this in Tamil with more examples",
      "Explain this using Mandarin Chinese",
    ]) {
      const parsed = parseLanguageRequest(question, vocabulary);
      expect(parsed.intent, question).toBe("CURRENT_RESPONSE_LANGUAGE");
      expect(parsed.unverifiedExplicitRequest, question).toBe(false);
      expect(parsed.language?.name ?? parsed.requestedTarget, question).toBeTruthy();
    }
    expect(parseLanguageRequest("Translate this to French.", vocabulary).requestedTarget).toBe(
      "French"
    );
    expect(parseLanguageRequest("Translate this into French.", vocabulary).requestedTarget).toBe(
      "French"
    );
    expect(parseLanguageRequest("Translate this to Tamil", vocabulary).language?.name).toBe("Tamil");
    expect(parseLanguageRequest("Explain fractions, French please", vocabulary).requestedTarget).toBe(
      "French"
    );
    expect(
      parseLanguageRequest("Explain this using Mandarin Chinese", vocabulary).requestedTarget
    ).toBe("Mandarin Chinese");
  });

  it("keeps non-language targets out of the explicit request path", () => {
    // A false positive must never become an explicit language request: not as a
    // named target and not as an unverified request either.
    for (const question of [
      "Explain this in detail",
      "Explain this in short terms",
      "Explain this in medium",
      "Explain this in Class 8",
      "Explain this in more detail",
      "Explain this in full detail",
      "Explain this in great detail",
      "Explain this in simpler terms",
      "Explain this in shorter sentences",
      "Explain this in easy words",
      "Explain this in two parts",
      "Explain this in three bullet points",
      "Explain this in high school level",
      "Explain this in my own words",
      "Explain this step by step",
      "Show me the steps in solving this",
      "What is the capital of France?",
    ]) {
      const parsed = parseLanguageRequest(question, vocabulary);
      expect(parsed.intent, question).toBe("NO_LANGUAGE_REQUEST");
      expect(parsed.unverifiedExplicitRequest, question).toBe(false);
      expect(parsed.ambiguous, question).toBe(false);
      expect(parsed.language, question).toBeNull();
      expect(parsed.requestedTarget, question).toBeNull();
    }
  });

  it("skips a leading qualifier but never a determiner or scope word", () => {
    // "in general French" and "in easy Tamil" still name the requested language,
    // while "in a fraction" and "in the board" remain ordinary questions.
    expect(parseLanguageRequest("Explain this in general French", vocabulary).requestedTarget).toBe(
      "French"
    );
    expect(parseLanguageRequest("Explain this in easy Tamil", vocabulary).language?.name).toBe(
      "Tamil"
    );
    expect(parseLanguageRequest("Explain this in a fraction", vocabulary).intent).toBe(
      "NO_LANGUAGE_REQUEST"
    );
    expect(parseLanguageRequest("Explain this in the board", vocabulary).intent).toBe(
      "NO_LANGUAGE_REQUEST"
    );
  });

  it("marks two unavailable language targets as ambiguous", () => {
    const parsed = parseLanguageRequest("Explain this in French and then in German", vocabulary);
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.reason).toBe("MULTIPLE_LANGUAGE_TARGETS");
    expect(parsed.intent).toBe("NO_LANGUAGE_REQUEST");
    expect(parsed.requestedTarget).toBeNull();
  });

  it("supports a multi-word proper-noun language target", () => {
    const parsed = parseLanguageRequest("Explain this in Modern Standard Arabic", vocabulary);
    expect(parsed.requestedTarget).toBe("Modern Standard Arabic");
  });

  it("returns no request for an empty or unrelated question", () => {
    expect(parseLanguageRequest("", vocabulary).intent).toBe("NO_LANGUAGE_REQUEST");
    expect(parseLanguageRequest("What is a fraction?", vocabulary).intent).toBe(
      "NO_LANGUAGE_REQUEST"
    );
  });

  it("finds an exact language only through name or code", () => {
    expect(findExactLanguage("Tamil", vocabulary)?.code).toBe("TA");
    expect(findExactLanguage("ta", vocabulary)?.name).toBe("Tamil");
    expect(findExactLanguage("Tamilnadu", vocabulary)).toBeNull();
    expect(findExactLanguage("French", vocabulary)).toBeNull();
    expect(findExactLanguage(null, vocabulary)).toBeNull();
  });

  it("contains no language-detection dependency, persistence, or RAG side effect", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFile } = require("node:fs/promises") as typeof import("node:fs/promises");
    return readFile(
      new URL("../../src/modules/ai/language-request-parser.ts", import.meta.url),
      "utf8"
    ).then((source) => {
      expect(source).not.toMatch(
        /\b(?:langdetect|franc|guesslanguage|iso639|languageDetect|detectLanguage)\b/i
      );
      expect(source).not.toMatch(/\b(?:embedding|vector|ocr|openai|anthropic|upload)\b/i);
      // Decision #116: no persistence mechanism (documentation prose may mention
      // persistence, but no write path or stored-state field may exist).
      expect(source).not.toMatch(
        /updateConversationScope|applyBoardScopeMutation|scope_language|duration|persist[A-Z]/
      );
    });
  });
});
