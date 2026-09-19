import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import App from "../App";
import {
  renderWithProviders,
  seedAuthenticatedSession,
} from "../test/test-utils";
import { getPractices, getResults } from "../services/api/practice";
import { getConversations } from "../services/api/ai";

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

vi.mock("../services/api/practice", () => ({
  getPractices: vi.fn(),
  getPractice: vi.fn(),
  startPracticeAttempt: vi.fn(),
  saveAttemptAnswers: vi.fn(),
  submitAttempt: vi.fn(),
  getAttemptResult: vi.fn(),
  getResults: vi.fn(),
}));

vi.mock("../services/api/ai", () => ({
  createConversation: vi.fn(),
  getConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  sendReply: vi.fn(),
}));

const mockedGetPractices = vi.mocked(getPractices);
const mockedGetResults = vi.mocked(getResults);
const mockedGetConversations = vi.mocked(getConversations);

const protectedRoutes: Array<[string, string]> = [
  ["/profile", "Profile"],
];

describe("routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("renders the AI Teacher landing page when authenticated", async () => {
    mockedGetConversations.mockResolvedValue({
      status: "success",
      conversations: [],
      total: 0,
    });
    seedAuthenticatedSession();
    renderWithProviders(<App />, { route: "/ai-teacher" });
    expect(
      await screen.findByRole("heading", { name: "AI Teacher" }),
    ).toBeInTheDocument();
    expect(mockedGetConversations).toHaveBeenCalledTimes(1);
  });

  it("renders the results history page when authenticated", async () => {
    mockedGetResults.mockResolvedValue({ results: [], total: 0 });
    seedAuthenticatedSession();
    renderWithProviders(<App />, { route: "/results" });
    expect(
      await screen.findByRole("heading", { name: "Results" }),
    ).toBeInTheDocument();
    expect(mockedGetResults).toHaveBeenCalledTimes(1);
  });

  it("renders the practice discovery page when authenticated", async () => {
    mockedGetPractices.mockResolvedValue({ practices: [], total: 0 });
    seedAuthenticatedSession();
    renderWithProviders(<App />, { route: "/practice" });
    expect(
      await screen.findByRole("heading", { name: "Practice" }),
    ).toBeInTheDocument();
    expect(mockedGetPractices).toHaveBeenCalledTimes(1);
  });
});
