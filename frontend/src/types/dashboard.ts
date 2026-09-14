/** Student dashboard response as returned by GET /api/student/dashboard. */

export interface DashboardStudent {
  id: string;
  full_name: string;
  grade_level: string | null;
}

export interface DashboardClass {
  id: string;
  name: string;
  section: string | null;
}

export interface DashboardSubject {
  id: string;
  name: string;
  code: string | null;
}

export interface RecentActivityItem {
  id: string;
  subject: string | null;
  topic: string | null;
  updated_at: string;
}

export interface LearningResource {
  id: string;
  resource_type: string;
  title: string;
  description: string | null;
  language_code: string | null;
  file_url: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  curriculum_node_id: string | null;
  class_id: string | null;
}

export interface CurriculumStructure {
  id: string;
  class_id: string;
  subject_id: string | null;
}

export interface DashboardResponse {
  student: DashboardStudent;
  classes: DashboardClass[];
  current_class: DashboardClass | null;
  subjects: DashboardSubject[];
  recent_activity: RecentActivityItem[];
  learning_resources: LearningResource[];
  curriculum_structures: CurriculumStructure[];
  // No authoritative per-student progress source exists yet (backend returns null).
  progress: null;
}
