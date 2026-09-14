import type {
  ClassSubjectsResponse,
  ClassListResponse,
} from "../../types/learning";
import { request } from "./client";

/**
 * GET /api/student/classes
 *
 * The authenticated student's active enrolled classes. Identity, organization,
 * and enrollment are derived by the backend — the client sends no student_id or
 * organization_id.
 */
export function getClasses() {
  return request<ClassListResponse>("/api/student/classes");
}

/**
 * GET /api/student/classes/:classId/subjects
 *
 * Subjects for a specific enrolled class. `classId` comes from the URL; the
 * backend remains authoritative for authorization.
 */
export function getClassSubjects(classId: string) {
  return request<ClassSubjectsResponse>(`/api/student/classes/${classId}/subjects`);
}
