export type AttemptStatus = "IN_PROGRESS" | "SUBMITTED";

export type PracticeAttemptRow = {
  id: string;
  organization_id: string;
  practice_id: string;
  student_id: string;
  status: AttemptStatus;
  started_at: string;
  submitted_at: string | null;
  score: number | string | null;
  max_score: number | string | null;
  percentage: number | string | null;
  correct_count: number | null;
  incorrect_count: number | null;
  unanswered_count: number | null;
  created_at: string;
  updated_at: string;
};

export type SaveAnswersItem = {
  questionId: string;
  selectedOption: string;
};

export type SaveAnswersInput = {
  answers: SaveAnswersItem[];
};
