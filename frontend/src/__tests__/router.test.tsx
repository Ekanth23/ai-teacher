import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import App from "../App";
import {
  renderWithProviders,
  seedAuthenticatedSession,
} from "../test/test-utils";

vi.mock("../services/api/auth", () => ({
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  me: vi.fn().mockResolvedValue({
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      full_name: "Test Student",
      email: "student@example.com",
      phone: null,
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    organizations: [],
  }),
}));

const protectedRoutes: Array<[string, string]> = [
  ["/practice", "Practice"],
  ["/results", "Results"],
  ["/ai-teacher", "AI Teacher"],
  ["/profile", "Profile"],
];

describe("routes", () => {
  it.each(protectedRoutes)(
    "renders the %s placeholder when authenticated",
    async (route, heading) => {
      seedAuthenticatedSession();
      renderWithProviders(<App />, { route });
      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeInTheDocument();
    },
  );
});
