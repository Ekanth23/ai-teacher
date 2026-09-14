import type { DashboardResponse } from "../../types/dashboard";
import { request } from "./client";

/**
 * GET /api/student/dashboard
 *
 * The authenticated student's identity and organization context are derived by
 * the backend from the bearer token — no student_id or organization_id is sent
 * from the client.
 */
export function getDashboard() {
  return request<DashboardResponse>("/api/student/dashboard");
}
