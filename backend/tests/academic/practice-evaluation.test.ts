import { describe, expect, it } from "vitest";
import { evaluateAttempt, type EvaluationQuestion } from "../../src/modules/practice/evaluation.js";

// Pure, deterministic, server-side evaluation. Unlike the phase041/phase085
// integration suites, these tests have no database dependency and can run
// without PostgreSQL.

const QUESTIONS: EvaluationQuestion[] = [
  { id: "q0", marks: 1, correctOptionKey: "C" },
  { id: "q1", marks: 1, correctOptionKey: "B" },
  { id: "q2", marks: 2, correctOptionKey: "A" },
];

function mapOf(entries: [string, string][]): ReadonlyMap<string, string | undefined> {
  return new Map(entries);
}

describe("evaluateAttempt", () => {
  it("awards zero for an empty/unanswered attempt", () => {
    const result = evaluateAttempt(QUESTIONS, mapOf([]));
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(4);
    expect(result.percentage).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.incorrectCount).toBe(0);
    expect(result.unansweredCount).toBe(3);
  });

  it("awards full marks when every answer is correct", () => {
    const result = evaluateAttempt(QUESTIONS, mapOf([["q0", "C"], ["q1", "B"], ["q2", "A"]]));
    expect(result.score).toBe(4);
    expect(result.maxScore).toBe(4);
    expect(result.percentage).toBe(100);
    expect(result.correctCount).toBe(3);
    expect(result.incorrectCount).toBe(0);
    expect(result.unansweredCount).toBe(0);
  });

  it("awards zero when every answer is incorrect", () => {
    const result = evaluateAttempt(QUESTIONS, mapOf([["q0", "A"], ["q1", "A"], ["q2", "B"]]));
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(4);
    expect(result.percentage).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.incorrectCount).toBe(3);
    expect(result.unansweredCount).toBe(0);
  });

  it("evaluates a mixed answer set deterministically", () => {
    // q0 correct (1), q1 incorrect (0), q2 unanswered (0)
    const result = evaluateAttempt(QUESTIONS, mapOf([["q0", "C"], ["q1", "A"]]));
    expect(result.score).toBe(1);
    expect(result.maxScore).toBe(4);
    expect(result.percentage).toBe(25);
    expect(result.correctCount).toBe(1);
    expect(result.incorrectCount).toBe(1);
    expect(result.unansweredCount).toBe(1);
  });

  it("evaluates a partially answered attempt (partial credit none)", () => {
    // only q2 correct (2), q0/q1 unanswered
    const result = evaluateAttempt(QUESTIONS, mapOf([["q2", "A"]]));
    expect(result.score).toBe(2);
    expect(result.maxScore).toBe(4);
    expect(result.percentage).toBe(50);
    expect(result.correctCount).toBe(1);
    expect(result.incorrectCount).toBe(0);
    expect(result.unansweredCount).toBe(2);
  });

  it("handles zero max-score (no questions) safely as percentage 0", () => {
    const result = evaluateAttempt([], mapOf([]));
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(0);
    expect(result.percentage).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.incorrectCount).toBe(0);
    expect(result.unansweredCount).toBe(0);
  });

  it("treats an empty-string answer as unanswered", () => {
    const result = evaluateAttempt(QUESTIONS, mapOf([["q0", ""]]));
    expect(result.unansweredCount).toBe(3);
    expect(result.incorrectCount).toBe(0);
  });

  it("rounds percentage to two decimals", () => {
    // 1 mark from a max of 3 -> 33.33%
    const result = evaluateAttempt([{ id: "a", marks: 1, correctOptionKey: "A" }, { id: "b", marks: 2, correctOptionKey: "B" }], mapOf([["a", "A"]]));
    expect(result.percentage).toBe(33.33);
  });
});