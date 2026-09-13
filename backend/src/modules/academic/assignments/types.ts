export type AssignmentStatus = "DRAFT" | "PUBLISHED" | "OPEN" | "CLOSED";

export type Assignment = {
  id: string;
  organization_id: string;
  teacher_id: string;
  class_id: string;
  subject_id: string;
  curriculum_node_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  status: AssignmentStatus;
  created_at: string;
  updated_at: string;
};

// Student-facing projection: excludes internal tenant/teacher identifiers.
export type StudentAssignment = {
  id: string;
  class_id: string;
  subject_id: string;
  curriculum_node_id: string | null;
  title: string;
  description: string | null;
  status: AssignmentStatus;
  created_at: string;
  updated_at: string;
};

export type CreateAssignmentInput = {
  classId: string;
  subjectId: string;
  curriculumNodeId?: string | null;
  title: string;
  description?: string | null;
  dueAt?: string | null;
};

export type UpdateAssignmentInput = {
  title?: string;
  description?: string | null;
  classId?: string;
  subjectId?: string;
  curriculumNodeId?: string | null;
  dueAt?: string | null;
};

export type CreateSubmissionInput = {
  content: string;
};

export type SubmissionDecision = "ACCEPTED" | "REDO_REQUIRED";

export type ReviewSubmissionInput = {
  decision?: unknown;
};

export type FeedbackSubmissionInput = {
  feedback?: unknown;
};

// Student-facing submission projection: excludes the internal organization_id.
export type StudentSubmission = {
  id: string;
  assignment_id: string;
  student_id: string;
  content: string;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

// Student-facing completion state, derived from submission existence.
export type StudentAssignmentCompletion = {
  assignment_id: string;
  completed: boolean;
  completed_at: string | null;
};

// Teacher-facing submission projection (student identity included, no internal org id).
export type TeacherSubmission = {
  id: string;
  assignment_id: string;
  student_id: string;
  student_name: string;
  content: string;
  decision: string | null;
  feedback: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

// Student-facing overdue state, derived from due_at + submission existence.
export type StudentAssignmentOverdue = {
  assignment_id: string;
  overdue: boolean;
  due_at: string | null;
};
