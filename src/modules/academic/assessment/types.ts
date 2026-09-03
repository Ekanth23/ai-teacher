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
export type CreateAssessmentPortionInput = {
  assessmentEventId: string;
  curriculumStructureId: string;
  curriculumNodeId?: string | null;
  sourceType?: string;
  metadata?: JsonObject;
};
