import type { LearningResourcesResponse } from "../../types/learning";
import { me } from "./auth";
import { request } from "./client";
import { ApiError } from "./errors";

/**
 * Resolves the authenticated user's organization id from the session.
 *
 * The learning-resource list endpoint scopes by organization in the URL path.
 * The organization list comes from GET /api/auth/me (active memberships only);
 * the backend re-validates the caller's ACTIVE membership on every request, so
 * a wrong or stale id fails closed with 403.
 */
async function resolveOrganizationId(): Promise<string> {
  const { organizations } = await me();
  if (organizations.length === 0) {
    throw new ApiError(
      "ORGANIZATION_REQUIRED",
      "Organization context is required.",
      403,
    );
  }
  return organizations[0].id;
}

/**
 * GET /api/organizations/:organizationId/learning-resources?curriculum_node_id=…
 *
 * Approved (published) learning resources linked to a curriculum node, scoped
 * to the student's session organization. The backend applies the student
 * visibility rules — status PUBLISHED, visibility ORGANIZATION / own-PRIVATE /
 * CLASS-with-membership, and tenant isolation — so the client only supplies the
 * curriculum node id.
 */
export async function getLearningResourcesByNode(nodeId: string) {
  const organizationId = await resolveOrganizationId();
  return request<LearningResourcesResponse>(
    `/api/organizations/${organizationId}/learning-resources?curriculum_node_id=${encodeURIComponent(nodeId)}`,
  );
}