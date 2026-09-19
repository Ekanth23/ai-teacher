import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../services/api/client";
import { me } from "../services/api/auth";
import { getLearningResourcesByNode } from "../services/api/resources";
import type { AuthUser, OrganizationSummary } from "../types/auth";

vi.mock("../services/api/client", () => ({
  request: vi.fn(),
}));

vi.mock("../services/api/auth", () => ({
  me: vi.fn(),
}));

const mockedRequest = vi.mocked(request);
const mockedMe = vi.mocked(me);

const testUser: AuthUser = {
  id: "user-1",
  full_name: "Test Student",
  email: "student@example.com",
  phone: null,
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00.000Z",
};

const activeOrganization: OrganizationSummary = {
  id: "org-1",
  name: "Example School",
  slug: "example-school",
  type: "SCHOOL",
  membership_status: "ACTIVE",
  role_name: "STUDENT",
};

describe("learning resources API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the session organization and lists resources for a curriculum node", async () => {
    mockedMe.mockResolvedValue({ user: testUser, organizations: [activeOrganization] });
    mockedRequest.mockResolvedValue({ learningResources: [], total: 0 });

    await getLearningResourcesByNode("topic-1");

    expect(mockedMe).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/organizations/org-1/learning-resources?curriculum_node_id=topic-1",
    );
  });

  it("URL-encodes the curriculum node id in the filter", async () => {
    mockedMe.mockResolvedValue({ user: testUser, organizations: [activeOrganization] });
    mockedRequest.mockResolvedValue({ learningResources: [], total: 0 });

    await getLearningResourcesByNode("topic id/1");

    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/organizations/org-1/learning-resources?curriculum_node_id=topic%20id%2F1",
    );
  });

  it("throws when the session has no active organization", async () => {
    mockedMe.mockResolvedValue({ user: testUser, organizations: [] });

    await expect(getLearningResourcesByNode("topic-1")).rejects.toMatchObject({
      code: "ORGANIZATION_REQUIRED",
      status: 403,
    });
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});