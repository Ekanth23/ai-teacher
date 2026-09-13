export type JsonObject = Record<string, unknown>;

export type PracticeType = "PRACTICE" | "QUIZ" | "SELF_ASSESSMENT";
export type PracticeStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type QuestionType = "MULTIPLE_CHOICE_SINGLE";

export type PracticeOption = {
  key: string;
  text: string;
};

export type PracticeRow = {
  id: string;
  organization_id: string;
  curriculum_node_id: string;
  title: string;
  description: string | null;
  practice_type: PracticeType;
  status: PracticeStatus;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type PracticeQuestionRow = {
  id: string;
  practice_id: string;
  sequence_number: number;
  question_type: QuestionType;
  question_text: string;
  options: PracticeOption[];
  correct_option_key: string;
  marks: number | string;
  explanation: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type CreatePracticeInput = {
  curriculumNodeId: string;
  title: string;
  description?: string | null;
  practiceType: PracticeType;
};

export type UpdatePracticeInput = {
  title?: string;
  description?: string | null;
  practiceType?: PracticeType;
};

export type CreateQuestionInput = {
  questionText: string;
  questionType?: QuestionType;
  options: PracticeOption[];
  correctOptionKey: string;
  marks?: number;
  explanation?: string | null;
  sequenceNumber?: number;
};

export type UpdateQuestionInput = {
  questionText?: string;
  questionType?: QuestionType;
  options?: PracticeOption[];
  correctOptionKey?: string;
  marks?: number;
  explanation?: string | null;
  sequenceNumber?: number;
};
