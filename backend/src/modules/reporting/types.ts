export type MetricAvailability = {
  value: number | null;
  available: boolean;
  reason?: string;
};

export type ReportConfiguration = {
  scope?: {
    grades?: string[];
    classIds?: string[];
    subjectIds?: string[];
  };
  filters?: {
    dateRange?: {
      from?: string;
      to?: string;
    };
    statuses?: string[];
  };
  metrics?: string[];
  groupBy?: "grade" | "class" | "subject";
  sort?: {
    field?: string;
    direction?: "asc" | "desc";
  };
};

export type ReportDefinition = {
  id: string;
  organization_id: string;
  created_by_user_id: string;
  name: string;
  description: string | null;
  configuration: ReportConfiguration;
  status: string;
  created_at: string;
  updated_at: string;
};

export type CreateReportDefinitionInput = {
  name: string;
  description?: string | null;
  configuration?: ReportConfiguration;
};

export type UpdateReportDefinitionInput = {
  name?: string;
  description?: string | null;
  configuration?: ReportConfiguration;
  status?: "ACTIVE" | "INACTIVE";
};

export type GradeSummary = {
  grade: string;
  students: number;
  enrollments: number;
};

export type ClassSummary = {
  id: string;
  name: string;
  section: string | null;
  academic_year: string | null;
  students: number;
  subjects: number;
  teachers: number;
  upcoming_assessments: number;
};

export type SubjectSummary = {
  id: string;
  name: string;
  code: string | null;
  classes: number;
  upcoming_assessments: number;
};

export type UpcomingAssessment = {
  id: string;
  title: string;
  class_id: string;
  class_name: string;
  subject_name: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
};

export type DataAvailability = {
  key: string;
  available: boolean;
  reason: string;
};
