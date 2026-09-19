// Deterministic, synchronous evaluation for formal (scheduled) assessments
// (Backend Epic 9 Slice C, US-092). Pure and side-effect free so it can be
// unit-tested without a database.
//
// Phase 2 MVP rules (do NOT extend without PO approval):
// - MULTIPLE_CHOICE_SINGLE only; exact match on correct_option_key.
// - Correct -> full question marks; incorrect -> 0; unanswered -> 0.
// - No negative marking, no partial credit, no pass/fail.
// - score = sum of awarded marks; max_score = sum of all question marks.
// - percentage = (score / max_score) * 100, rounded to 2 decimals.
// - Zero-question / zero-max-score input is rejected by the caller before
//   evaluation; evaluateFormalAttempt throws INCONSISTENT_RESULT_DATA if a
//   persisted answer references an unknown question or an option that is not
//   one of the question's declared options.

import { AssessmentExecutionError } from "./validation.js";

export type FormalEvaluationQuestion = {
  id: string;
  marks: number;
  correctOptionKey: string;
  optionKeys: string[];
};

export type FormalEvaluationResult = {
  score: number;
  maxScore: number;
  percentage: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
};

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function evaluateFormalAttempt(
  questions: FormalEvaluationQuestion[],
  answers: ReadonlyMap<string, string | undefined>
): FormalEvaluationResult {
  let maxScore = 0;
  let score = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;

  for (const question of questions) {
    maxScore += question.marks;
    const selected = answers.get(question.id);

    if (selected === undefined || selected === null || selected === "") {
      unansweredCount += 1;
    } else {
      if (!question.optionKeys.includes(selected)) {
        const error = new AssessmentExecutionError(
          "Persisted assessment data is inconsistent and cannot be evaluated."
        );
        error.code = "INCONSISTENT_RESULT_DATA";
        throw error;
      }
      if (selected === question.correctOptionKey) {
        correctCount += 1;
        score += question.marks;
      } else {
        incorrectCount += 1;
      }
    }
  }

  // No partial credit, no negative marking.
  const percentage = maxScore === 0 ? 0 : round2((100 * score) / maxScore);

  return {
    score: round2(score),
    maxScore: round2(maxScore),
    percentage,
    correctCount,
    incorrectCount,
    unansweredCount,
  };
}
