export type JsonObject = Record<string, unknown>;

export type LearningResourceType =
  | "TEXTBOOK"
  | "TEACHER_NOTES"
  | "WORKSHEET"
  | "ASSIGNMENT"
  | "QUESTION_BANK"
  | "PREVIOUS_YEAR_PAPER"
  | "MOCK_TEST"
  | "SYLLABUS_DOCUMENT"
  | "FORMULA_SHEET"
  | "OTHER";

export type LearningResourceVisibility = "ORGANIZATION" | "CLASS" | "PRIVATE";
export type LearningResourceStatus = "DRAFT" | "PENDING_APPROVAL" | "PUBLISHED" | "ARCHIVED";

export type LearningResource = {
  id: string;
  organization_id: string;
  curriculum_node_id: string | null;
  class_id: string | null;
  resource_type: LearningResourceType;
  title: string;
  description: string | null;
  language_code: string | null;
  file_url: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  visibility: LearningResourceVisibility;
  status: LearningResourceStatus;
  metadata: JsonObject;
  created_by_user_id: string;
  approved_by_user_id: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateLearningResourceInput = {
  curriculumNodeId?: string | null;
  classId?: string | null;
  resourceType: LearningResourceType;
  title: string;
  description?: string | null;
  languageCode?: string | null;
  fileUrl: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  visibility?: LearningResourceVisibility;
  metadata?: JsonObject;
};

export type UpdateLearningResourceInput = Partial<CreateLearningResourceInput>;

export type ListLearningResourceFilters = {
  curriculumNodeId?: string;
  classId?: string;
  resourceType?: string;
  status?: string;
};
