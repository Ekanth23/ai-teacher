import { describe, expect, it } from "vitest";
import {
  parseSubjectTopicRequest,
  type SubjectTopicCandidate,
} from "../../src/modules/ai/subject-topic-request-parser.js";

function detected(question: string): SubjectTopicCandidate[] {
  return parseSubjectTopicRequest(question).candidates;
}

function levelsAndLabels(question: string) {
  return detected(question).map((item) => `${item.level}:${item.label}`);
}

describe("US-122 explicit subject/chapter/topic request detection", () => {
  it("detects the object of an ordinary teaching request", () => {
    // Locked Decision #87/#97: a student-stated topic is an explicit request.
    for (const [question, level, label] of [
      ["Explain equivalent fractions.", "topic", "equivalent fractions"],
      ["Now teach me Photosynthesis", "topic", "Photosynthesis"],
      ["Tell me about photosynthesis", "topic", "photosynthesis"],
      ["Help me understand equivalent fractions", "topic", "equivalent fractions"],
      ["Describe the human heart", "topic", "human heart"],
      ["I have a doubt about quadratic equations", "topic", "quadratic equations"],
      ["Explain the water cycle", "topic", "water cycle"],
    ] as const) {
      const parsed = parseSubjectTopicRequest(question);
      expect(parsed.ambiguous, question).toBe(false);
      expect(parsed.candidates, question).toHaveLength(1);
      expect(parsed.candidates[0].level, question).toBe(level);
      expect(parsed.candidates[0].label, question).toBe(label);
    }
  });

  it("detects an explicit curriculum-level marker", () => {
    for (const [question, level, label] of [
      ["Subject Science", "subject", "Science"],
      ["Subject: Social Science", "subject", "Social Science"],
      ["topic: Equivalent Fractions", "topic", "Equivalent Fractions"],
      ["Topic equivalent fractions", "topic", "equivalent fractions"],
      ["lesson on photosynthesis", "chapter", "photosynthesis"],
    ] as const) {
      const parsed = parseSubjectTopicRequest(question);
      expect(parsed.candidates, question).toHaveLength(1);
      expect(parsed.candidates[0].level, question).toBe(level);
      expect(parsed.candidates[0].label, question).toBe(label);
    }
  });

  it("keeps a bare numeric curriculum reference as an explicit request", () => {
    // Locked Decision #88: "Chapter 5" is an explicit reference. It is carried
    // so the authoritative resolver can report it unresolved, never guessed.
    for (const question of ["Chapter 5", "chapter 5 please", "unit 3"]) {
      const parsed = parseSubjectTopicRequest(question);
      expect(parsed.ambiguous, question).toBe(false);
      expect(parsed.candidates.length, question).toBeGreaterThan(0);
    }
    expect(levelsAndLabels("Chapter 5")).toEqual(["chapter:5"]);
  });

  it("never treats a style qualifier, pronoun, or scope word as a request", () => {
    for (const question of [
      "Explain this in detail",
      "Explain this in short terms",
      "Explain this in two parts",
      "Explain this in Class 8",
      "Explain this",
      "What is a fraction?",
      "I have a doubt about the board exam",
      "Tell me about the syllabus",
      "Explain the chapter",
      "",
    ]) {
      const parsed = parseSubjectTopicRequest(question);
      expect(parsed.candidates, question).toEqual([]);
      expect(parsed.ambiguous, question).toBe(false);
      expect(parsed.reason, question).toBeNull();
    }
  });

  it("leaves an explicit language request to the US-120 parser", () => {
    // Subject/topic detection and language precedence stay independent.
    for (const question of ["Explain this in Tamil", "Respond in Spanish please"]) {
      expect(detected(question), question).toEqual([]);
    }
  });

  it("does not choose between two explicit targets", () => {
    // Locked Decision #61: an ambiguous explicit request is never guessed.
    const parsed = parseSubjectTopicRequest(
      "Explain photosynthesis, then tell me about respiration"
    );
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.candidates).toEqual([]);
    expect(parsed.reason).toBe("MULTIPLE_SUBJECT_TOPIC_TARGETS");
  });

  it("deduplicates one repeated target and keeps the most specific level", () => {
    const parsed = parseSubjectTopicRequest("Explain equivalent fractions in topic equivalent fractions");
    expect(parsed.ambiguous).toBe(false);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].level).toBe("topic");
  });

  it("never uses similarity, inference, or general knowledge to detect a target", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFile } = require("node:fs/promises") as typeof import("node:fs/promises");
    const source = await readFile(
      new URL("../../src/modules/ai/subject-topic-request-parser.ts", import.meta.url),
      "utf8"
    );

    // Guards run against executable code only. Prose may describe a prohibition,
    // so comments are stripped first; this makes the check stricter, not looser.
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");

    // The module is pure text analysis: it imports only the shared normalizer and
    // the shared level type, and it holds no vocabulary of curriculum names.
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(2);
    expect(source).toMatch(/board-request-parser\.js/);
    expect(source).toMatch(/board-response\.types\.js/);

    // No similarity, fuzzy, ranking, or model-based membership decision.
    expect(code).not.toMatch(
      /\b(?:levenshtein|jaccard|trigram|fuzzy|similarity|embedding|vector|nearest|classify|rank|score)\b/i
    );
    // No database, network, or provider call, and nothing is written.
    expect(code).not.toMatch(/\b(?:fetch|axios|pool|query|insert|update|delete|generate|provider)\b/i);
    expect(code).not.toMatch(/\bpersist[A-Z]/);
    expect(code).not.toMatch(/scope_subject|scope_topic/);
  });
});
