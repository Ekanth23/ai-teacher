// Backend Epic 10 Slice A (US-097/US-098/US-099) — derived practice-completion
// progress. Query-only: no storage, no migration. Progress is a COVERAGE
// metric (completed published practices / available published practices)
// and must never be derived from score/percentage (PO Decision #1, #11).

export type AvailablePractice = {
  practice_id: string;
  topic_id: string;
  topic_title: string;
  chapter_id: string | null;
  chapter_title: string | null;
  subject_id: string | null;
  subject_name: string | null;
  subject_code: string | null;
};

export type TopicProgress = {
  id: string;
  title: string;
  chapter_id: string | null;
  completed: number;
  available: number;
  // Null when there is nothing to measure (zero available published
  // practices): "no progress data", never a fabricated 0%.
  percentage: number | null;
};

export type ChapterProgress = {
  id: string;
  title: string;
  subject_id: string | null;
  completed: number;
  available: number;
  percentage: number | null;
};

export type SubjectProgress = {
  id: string;
  name: string;
  code: string | null;
  completed: number;
  available: number;
  percentage: number | null;
};

export type StudentProgress = {
  subjects: SubjectProgress[];
  chapters: ChapterProgress[];
  topics: TopicProgress[];
};

export type HomeworkState = "ON_TIME" | "LATE" | "PENDING" | "OVERDUE";

export type HomeworkPerformance = {
  on_time: number;
  late: number;
  pending: number;
  overdue: number;
  total: number;
};

export type HomeworkAssignmentRow = {
  assignment_id: string;
  due_at: string | null;
  submitted_at: string | null;
};

export type PracticePerformanceResult = {
  attempt_id: string;
  practice_id: string;
  practice_title: string;
  practice_type: string;
  topic: string | null;
  score: number;
  max_score: number;
  percentage: number;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  submitted_at: string;
};

export type FormalPerformanceResult = {
  result_id: string;
  attempt_id: string;
  assessment_event_id: string;
  assessment_title: string;
  subject_id: string | null;
  topics: string[];
  score: number;
  max_score: number;
  percentage: number;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  submitted_at: string;
};

export type AssessmentPerformance = {
  practice_results: PracticePerformanceResult[];
  formal_assessment_results: FormalPerformanceResult[];
};

export type WeakTopic = {
  id: string;
  title: string;
  chapter_id: string | null;
  performance: number;
  answered_responses: number;
};

export type WeakTopicsResponse = {
  weak_topics: WeakTopic[];
};

export type StrongTopic = {
  id: string;
  title: string;
  chapter_id: string | null;
  performance: number;
  answered_responses: number;
};

export type StrongTopicsResponse = {
  strong_topics: StrongTopic[];
};

export type UnfinishedTopicStatus = "COMPLETED" | "UNFINISHED";

export type UnfinishedTopic = {
  id: string;
  title: string;
  chapter_id: string | null;
  completed: number;
  available: number;
  // Null when the topic has no available PUBLISHED practices ("no available
  // learning coverage", never UNFINISHED). Mirrors the Slice A
  // percentage-null convention.
  status: UnfinishedTopicStatus | null;
};

export type UnfinishedLearningResponse = {
  topics: UnfinishedTopic[];
};

export type RepeatedMistakeConcept = {
  id: string;
  name: string;
  code: string | null;
};

export type RepeatedMistake = {
  concept: RepeatedMistakeConcept;
  incorrect_responses: number;
  distinct_questions: number;
  distinct_attempts: number;
};

export type RepeatedMistakesResponse = {
  repeated_mistakes: RepeatedMistake[];
};

// US-106: aggregated learning profile (Decision #8). Composition only: each
// section reuses the corresponding US-097-105 getter output unchanged.
export type LearningProfile = {
  subject_progress: { subjects: SubjectProgress[] };
  chapter_progress: { chapters: ChapterProgress[] };
  topic_progress: { topics: TopicProgress[] };
  homework_performance: HomeworkPerformance;
  practice_performance: { practice_results: PracticePerformanceResult[] };
  formal_assessment_performance: { formal_assessment_results: FormalPerformanceResult[] };
  strong_topics: { strong_topics: StrongTopic[] };
  weak_topics: { weak_topics: WeakTopic[] };
  unfinished_learning: { topics: UnfinishedTopic[] };
  repeated_mistakes: { repeated_mistakes: RepeatedMistake[] };
};

export type ConceptAnswerRow = {
  attempt_scope: "PRACTICE" | "FORMAL";
  attempt_id: string;
  question_scope: "PRACTICE" | "FORMAL";
  question_id: string;
  concept_id: string;
  concept_name: string;
  concept_code: string | null;
  selected_option: string;
  correct_option_key: string;
};

export type TopicAnswerRow = {
  attempt_id: string;
  topic_id: string;
  topic_title: string;
  chapter_id: string | null;
  selected_option: string;
  correct_option_key: string;
};
