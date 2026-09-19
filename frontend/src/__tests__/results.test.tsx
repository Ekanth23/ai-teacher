import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ResultsPage from "../pages/ResultsPage";
import { getResults } from "../services/api/practice";
import { ApiError } from "../services/api/errors";
import type { ResultsHistoryResponse } from "../types/practice";

vi.mock("../services/api/practice", () => ({
  getPractices: vi.fn(),
  getPractice: vi.fn(),
  startPracticeAttempt: vi.fn(),
  saveAttemptAnswers: vi.fn(),
  submitAttempt: vi.fn(),
  getAttemptResult: vi.fn(),
  getResults: vi.fn(),
}));

const mockedGetResults = vi.mocked(getResults);

const historyFixture: ResultsHistoryResponse = {
  results: [
    {
      id: "attempt-2",
      practice: {
        id: "practice-1",
        title: "Integers Quiz",
        practice_type: "QUIZ",
        topic: "Integers",
      },
      status: "SUBMITTED",
      started_at: "2026-09-17T00:00:00.000Z",
      submitted_at: "2026-09-17T00:05:00.000Z",
      score: 3,
      max_score: 4,
      percentage: 75,
      correct_count: 2,
      incorrect_count: 1,
      unanswered_count: 0,
    },
    {
      id: "attempt-1",
      practice: {
        id: "practice-2",
        title: "Algebra Practice",
        practice_type: "PRACTICE",
        topic: null,
      },
      status: "SUBMITTED",
      started_at: "2026-09-16T00:00:00.000Z",
      submitted_at: "2026-09-16T00:05:00.000Z",
      score: 1,
      max_score: 4,
      percentage: 25,
      correct_count: 1,
      incorrect_count: 1,
      unanswered_count: 1,
    },
  ],
  total: 2,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/results"]}>
      <ResultsPage />
    </MemoryRouter>,
  );
}

describe("Results history (ResultsPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading skeleton while fetching", () => {
    mockedGetResults.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading your results…")).toBeInTheDocument();
  });

  it("fetches history from the student results API", async () => {
    mockedGetResults.mockResolvedValue(historyFixture);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(mockedGetResults).toHaveBeenCalledTimes(1);
    expect(mockedGetResults).toHaveBeenCalledWith();
  });

  it("renders backend summary values exactly as returned", async () => {
    mockedGetResults.mockResolvedValue(historyFixture);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Integers Quiz" })).toBeInTheDocument();
    expect(screen.getByText("3 of 4 · 75%")).toBeInTheDocument();
    expect(screen.getByText("2 correct · 1 incorrect · 0 unanswered")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Algebra Practice" })).toBeInTheDocument();
    expect(screen.getByText("1 of 4 · 25%")).toBeInTheDocument();
  });

  it("links each result to its detail page in returned order", async () => {
    mockedGetResults.mockResolvedValue(historyFixture);
    renderPage();

    const first = await screen.findByRole("link", { name: /Integers Quiz/ });
    expect(first).toHaveAttribute("href", "/results/attempt-2");
    const second = screen.getByRole("link", { name: /Algebra Practice/ });
    expect(second).toHaveAttribute("href", "/results/attempt-1");

    // Newest-first order is preserved as returned by the backend.
    const links = screen.getAllByRole("link", { name: /Quiz|Practice/ });
    expect(links[0]).toHaveAttribute("href", "/results/attempt-2");
    expect(links[1]).toHaveAttribute("href", "/results/attempt-1");
  });

  it("shows an empty state with a return action when no results exist", async () => {
    mockedGetResults.mockResolvedValue({ results: [], total: 0 });
    renderPage();

    expect(await screen.findByText("No results yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse Practice" }),
    ).toHaveAttribute("href", "/practice");
  });

  it("shows an error state and retries", async () => {
    const user = userEvent.setup();
    mockedGetResults
      .mockRejectedValueOnce(
        new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
      )
      .mockResolvedValueOnce(historyFixture);
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Integers Quiz" })).toBeInTheDocument();
  });
});
