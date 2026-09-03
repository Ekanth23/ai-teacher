import type { JsonObject } from "../calendar/types.js";

export type AssessmentEventStatus = "DRAFT" | "SCHEDULED" | "COMPLETED" | "CANCELLED";
export type AssessmentSchemeStatus = "DRAFT" | "VALIDATED" | "PUBLISHED" | "RETIRED";

export type CreateAssessmentSchemeInput = {
  boardId: string;
  academicYearId?: string | null;
  schemeCode: string;
  name: string;
  version: string;
  sourceMetadata?: JsonObject;
  metadata?: JsonObject;
};
export type AssessmentType = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};
export type AssessmentSchemeDetail = {
  id: string;
  board_id: string;
  academic_year_id: string | null;
  scheme_code: string;
  name: string;
  version: string;
  status: AssessmentSchemeStatus;
  source_metadata: JsonObject;
  metadata: JsonObject;
  components: AssessmentSchemeComponent[];
};
export type AssessmentSchemeComponent = {
  id: string;
  assessment_scheme_version_id: string;
  assessment_type_id: string;
  code: string;
  name: string;
  maximum_marks: number | string | null;
  weightage: number | string | null;
  duration_minutes: number | null;
  sequence_number: number;
  is_required: boolean;
  assessment_method: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};
export type CreateAssessmentSchemeComponentInput = {
  schemeId: string;
  assessmentTypeId: string;
  code: string;
  name: string;
  maximumMarks?: number | null;
  weightage?: number | null;
  durationMinutes?: number | null;
  sequenceNumber?: number;
  isRequired?: boolean;
  assessmentMethod?: string | null;
  metadata?: JsonObject;
};
export type CreateAssessmentEventInput = {
  organizationId?: string;
  academicYearId: string;
  classId: string;
  subjectId?: string | null;
  calendarId?: string | null;
  calendarPeriodId?: string | null;
  assessmentSchemeVersionId?: string | null;
  assessmentTypeId?: string | null;
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
  status?: AssessmentEventStatus;
  metadata?: JsonObject;
};
export type UpdateAssessmentEventInput = Partial<Pick<CreateAssessmentEventInput, "subjectId" | "calendarId" | "calendarPeriodId" | "assessmentSchemeVersionId" | "assessmentTypeId" | "title" | "scheduledStart" | "scheduledEnd" | "metadata">>;
export type CreateAssessmentPortionInput = {
  assessmentEventId: string;
  curriculumStructureId: string;
  curriculumNodeId?: string | null;
  sourceType?: string;
  metadata?: JsonObject;
};
