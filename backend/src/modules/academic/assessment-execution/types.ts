export type AssessmentAttemptStatus = "IN_PROGRESS" | "SUBMITTED";

export type AssessmentOption = {
  key: string;
  text: string;
};

export type AssessmentQuestionRow = {
  id: string;
  organization_id: string;
  assessment_event_id: string;
  sequence_number: number;
  question_type: string;
  question_text: string;
  options: AssessmentOption[];
  correct_option_key: string;
  marks: number | string;
  explanation: string | null;
  created_at: string;
  updated_at: string;
};

export type AssessmentAttemptRow = {
  id: string;
  organization_id: string;
  assessment_event_id: string;
  student_id: string;
  status: AssessmentAttemptStatus;
  started_at: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssessmentResultRow = {
  id: string;
  organization_id: string;
  assessment_event_id: string;
  attempt_id: string;
  student_id: string;
  score: number | string;
  max_score: number | string;
  percentage: number | string;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

export type CreateAssessmentQuestionInput = {
  questionText: unknown;
  questionType: unknown;
  options: unknown;
  correctOptionKey: unknown;
  marks: unknown;
  explanation: unknown;
  sequenceNumber: unknown;
};

export type UpdateAssessmentQuestionInput = {
  questionText: unknown;
  questionType: unknown;
  options: unknown;
  correctOptionKey: unknown;
  marks: unknown;
  explanation: unknown;
  sequenceNumber: unknown;
};

export type SaveAssessmentAnswersInput = {
  answers: { questionId: string; selectedOption: string }[];
};
