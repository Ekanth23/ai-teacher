// Deterministic, synchronous evaluation for Phase 1 practice attempts.
// Pure and side-effect free so it can be unit-tested without a database.

export type EvaluationQuestion = {
  id: string;
  marks: number;
  correctOptionKey: string;
};

export type EvaluationResult = {
  maxScore: number;
  score: number;
  percentage: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
};

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function evaluateAttempt(
  questions: EvaluationQuestion[],
  answers: ReadonlyMap<string, string | undefined>
): EvaluationResult {
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
    } else if (selected === question.correctOptionKey) {
      correctCount += 1;
      score += question.marks;
    } else {
      incorrectCount += 1;
    }
  }

  // No partial credit, no negative marking, no adaptive scoring.
  const percentage = maxScore === 0 ? 0 : round2((100 * score) / maxScore);

  return {
    maxScore,
    score,
    percentage,
    correctCount,
    incorrectCount,
    unansweredCount,
  };
}
