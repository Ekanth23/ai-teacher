import type { DashboardClass, DashboardSubject } from "./dashboard";

/**
 * A student's active enrolled class. Reuses the exact class shape already
 * returned by the dashboard so the two surfaces stay consistent.
 */
export type StudentClassSummary = DashboardClass;

/**
 * A subject within a class. Reuses the exact subject shape already returned by
 * the dashboard (`{ id, name, code }`).
 */
export type SubjectSummary = DashboardSubject;

/** GET /api/student/classes */
export interface ClassListResponse {
  classes: StudentClassSummary[];
  total: number;
}

/** GET /api/student/classes/:classId/subjects */
export interface ClassSubjectsResponse {
  subjects: SubjectSummary[];
  total: number;
}

export interface Chapter {
  id: string;
  curriculum_structure_id: string;
  parent_node_id: string | null;
  node_type_id: string;
  node_type_code: string;
  node_type_name: string;
  subject_id: string | null;
  title: string;
  code: string | null;
  sequence_number: number | null;
  description: string | null;
  metadata: Record<string, unknown>;
  status: "ACTIVE" | "INACTIVE";
  created_at: string;
  updated_at: string;
}

/** GET /api/curriculum/structures/:structureId/chapters */
export interface StructureChaptersResponse {
  chapters: Chapter[];
  total: number;
}
