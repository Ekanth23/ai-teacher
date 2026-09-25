import type { LearningProfile } from "../progress/types.js";

/**
 * Internal US-118 contract.  This object is assembled at request time and is
 * never persisted.  IDs are retained only for server-side resolution and
 * observability; the model projection strips them.
 */
export const LEARNING_CONTEXT_CONTRACT_VERSION = "1" as const;

export type ContextResolutionStatus = "resolved" | "unresolved";

export type ContextSource =
  | "authenticated_student"
  | "explicit_enrollment"
  | "authoritative_syllabus"
  | "class_subject_relationship"
  | "authoritative_curriculum_hierarchy"
  | "conversation_scope"
  | "active_branch_history"
  | "unresolved";

export type ContextUnresolvedReason =
  | "NO_CURRENT_SELECTION"
  | "INVALID_CURRENT_SELECTION"
  | "NO_ACTIVE_ENROLLMENT"
  | "INACTIVE_ENROLLMENT"
  | "INACTIVE_CLASS"
  | "NO_AUTHORITATIVE_SYLLABUS"
  | "MULTIPLE_AUTHORITATIVE_SYLLABI"
  | "NO_SUBJECT"
  | "NO_CHAPTER"
  | "NO_TOPIC"
  | "AMBIGUOUS_SUBJECT"
  | "AMBIGUOUS_CHAPTER"
  | "AMBIGUOUS_TOPIC"
  | "SOURCE_UNAVAILABLE"
  | "NOT_PROVIDED";

export interface ContextEntity {
  /** Internal lookup identity; never rendered into the LLM prompt. */
  id: string | null;
  name: string | null;
  code: string | null;
  status: ContextResolutionStatus;
  source: ContextSource;
  resolutionError?: ContextUnresolvedReason;
  /** Additional safe provenance labels, if present. */
  section?: string | null;
  academicYear?: string | null;
}

export interface EnrollmentContext {
  id: string | null;
  classId: string | null;
  academicYear: string | null;
  status: ContextResolutionStatus;
  enrollmentStatus: string | null;
  source: ContextSource;
  resolutionError?: ContextUnresolvedReason;
}

export interface StudentContext {
  /** Internal identity; excluded from model projection. */
  id: string;
  gradeLevel: string | null;
}

export interface ConversationContext {
  /** Internal identity; excluded from model projection. */
  conversationId: string;
  branchId: string | null;
  branchName: string | null;
  isActiveBranch: boolean;
  /** Conversation labels are continuity context, not curriculum proof. */
  subjectLabel: string | null;
  chapterLabel: string | null;
  topicLabel: string | null;
  boardLabel: string | null;
  classLabel: string | null;
  languageLabel: string | null;
  mediumLabel: string | null;
  history: ContextMessage[];
  historyTruncated: boolean;
}

export interface ContextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ContextAssemblyComponent {
  status: "resolved" | "unresolved" | "loaded" | "empty" | "skipped" | "failed";
  count?: number;
  reason?: ContextUnresolvedReason | "SOURCE_ERROR";
}

export interface ContextAssemblyReport {
  enrollment: ContextAssemblyComponent;
  currentClass: ContextAssemblyComponent;
  syllabus: ContextAssemblyComponent;
  subject: ContextAssemblyComponent;
  chapter: ContextAssemblyComponent;
  topic: ContextAssemblyComponent;
  learningProfile: ContextAssemblyComponent;
  history: ContextAssemblyComponent;
}

export interface ContextAssemblyMetadata {
  /** Per-request trace identity; not persisted. */
  assemblyId: string;
  assembledAt: string;
  durationMs: number;
  freshness: "request_time";
}

export interface StudentLearningContext {
  contractVersion: typeof LEARNING_CONTEXT_CONTRACT_VERSION;
  student: StudentContext;
  currentEnrollment: EnrollmentContext;
  currentClass: ContextEntity;
  authoritativeSyllabus: ContextEntity & {
    classId: string | null;
    multipleCount?: number;
  };
  board: ContextEntity;
  medium: ContextEntity;
  /** Languages explicitly associated with the authoritative syllabus. */
  languages: ContextEntity[];
  subject: ContextEntity;
  chapter: ContextEntity;
  topic: ContextEntity;
  /** Complete Epic 10 output remains available internally only. */
  learningProfile: LearningProfile | null;
  /** Safe, budgeted projection reused by the prompt layer. */
  modelContext?: ModelStudentLearningContext;
  conversation: ConversationContext;
  assembly: ContextAssemblyMetadata;
  components: ContextAssemblyReport;
}

export interface LearningContextBuildInput {
  organizationId: string;
  studentId: string;
  studentGrade?: string | null;
  conversationId: string;
  branchId?: string | null;
  branchName?: string | null;
  isActiveBranch?: boolean;
  history: ContextMessage[];
  scope?: {
    subject?: string | null;
    chapter?: string | null;
    topic?: string | null;
    board?: string | null;
    class?: string | null;
    language?: string | null;
    medium?: string | null;
  };
}

export interface ModelLearningProfile {
  subject_progress?: Array<{
    name: string;
    code?: string | null;
    completed: number;
    available: number;
    percentage: number | null;
  }>;
  chapter_progress?: Array<{
    title: string;
    subject?: string | null;
    completed: number;
    available: number;
    percentage: number | null;
  }>;
  topic_progress?: Array<{
    title: string;
    chapter?: string | null;
    completed: number;
    available: number;
    percentage: number | null;
  }>;
  strong_topics?: Array<{
    title: string;
    performance: number;
    answered_responses: number;
  }>;
  weak_topics?: Array<{
    title: string;
    performance: number;
    answered_responses: number;
  }>;
  unfinished_learning?: Array<{
    title: string;
    completed: number;
    available: number;
    status: "COMPLETED" | "UNFINISHED" | null;
  }>;
  practice_performance?: Array<{
    practice_title: string;
    topic: string | null;
    percentage: number;
    correct_count: number;
    incorrect_count: number;
    unanswered_count: number;
  }>;
  formal_assessment_performance?: Array<{
    assessment_title: string;
    topics: string[];
    percentage: number;
    correct_count: number;
    incorrect_count: number;
    unanswered_count: number;
  }>;
}

export interface ModelStudentLearningContext {
  currentClass?: string;
  board?: string;
  medium?: string;
  languages?: string[];
  subject?: string;
  chapter?: string;
  topic?: string;
  learningProfile?: ModelLearningProfile;
  conversationHistory: ContextMessage[];
}

export function unresolvedEntity(
  reason: ContextUnresolvedReason,
  source: ContextSource = "unresolved"
): ContextEntity {
  return {
    id: null,
    name: null,
    code: null,
    status: "unresolved",
    source,
    resolutionError: reason,
  };
}

export function resolvedEntity(
  values: {
    id: string;
    name: string | null;
    code?: string | null;
    source: ContextSource;
    section?: string | null;
    academicYear?: string | null;
  }
): ContextEntity {
  return {
    id: values.id,
    name: values.name,
    code: values.code ?? null,
    status: "resolved",
    source: values.source,
    ...(values.section !== undefined ? { section: values.section } : {}),
    ...(values.academicYear !== undefined ? { academicYear: values.academicYear } : {}),
  };
}
