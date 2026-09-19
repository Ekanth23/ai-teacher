import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ResultDetailPage from "../pages/ResultDetailPage";
import {
  getAttemptResult,
  startPracticeAttempt,
} from "../services/api/practice";
import { ApiError } from "../services/api/errors";
import type {
  AttemptResultDetail,
  StartAttemptResponse,
} from "../types/practice";

vi.mock("../services/api/practice", () => ({
  getPractices: vi.fn(),
  getPractice: vi.fn(),
  startPracticeAttempt: vi.fn(),
  saveAttemptAnswers: vi.fn(),
  submitAttempt: vi.fn(),
  getAttemptResult: vi.fn(),
  getResults: vi.fn(),
}));

const mockedNavigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockedNavigate };
});

const mockedGetAttemptResult = vi.mocked(getAttemptResult);
const mockedStartPracticeAttempt = vi.mocked(startPracticeAttempt);

const resultFixture: AttemptResultDetail = {
  id: "attempt-1",
  practice: {
    id: "practice-1",
    title: "Integers Quiz",
    practice_type: "QUIZ",
    topic: "Integers",
  },
  status: "SUBMITTED",
  started_at: "2026-09-17T00:00:00.000Z",
  submitted_at: "2026-09-17T00:05:00.000Z",
  score: 1,
  max_score: 4,
  percentage: 25,
  correct_count: 1,
  incorrect_count: 1,
  unanswered_count: 1,
  questions: [
    {
      question_id: "q-1",
      question_text: "What is -3 + 5?",
      options: [
        { key: "A", text: "8" },
        { key: "B", text: "2" },
        { key: "C", text: "-2" },
        { key: "D", text: "-8" },
      ],
      selected_option: "B",
      correct_option: "B",
      is_correct: true,
      marks: 1,
      awarded_marks: 1,
      explanation: "Negative three plus five equals two.",
    },
    {
      question_id: "q-2",
      question_text: "Choose the even number.",
      options: [
        { key: "A", text: "3" },
        { key: "B", text: "5" },
        { key: "C", text: "6" },
        { key: "D", text: "7" },
      ],
      selected_option: "A",
      correct_option: "C",
      is_correct: false,
      marks: 1,
      awarded_marks: 0,
      explanation: null,
    },
    {
      question_id: "q-3",
      question_text: "10 - 3 = ?",
      options: [
        { key: "A", text: "7" },
        { key: "B", text: "6" },
        { key: "C", text: "13" },
      ],
      selected_option: null,
      correct_option: "A",
      is_correct: false,
      marks: 2,
      awarded_marks: 0,
      explanation: "Ten minus three equals seven.",
    },
  ],
};

const startAttemptResponse: StartAttemptResponse = {
  attempt: {
    id: "attempt-2",
    practice_id: "practice-1",
    status: "IN_PROGRESS",
    started_at: "2026-09-18T00:00:00.000Z",
  },
  questions: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/results/attempt-1"]}>
      <Routes>
        <Route path="/results/:attemptId" element={<ResultDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Result detail (ResultDetailPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockedGetAttemptResult.mockResolvedValue(resultFixture);
    mockedStartPracticeAttempt.mockResolvedValue(startAttemptResponse);
  });

  it("shows a loading skeleton while fetching", () => {
    mockedGetAttemptResult.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading this result…")).toBeInTheDocument();
  });

  it("renders the backend summary values exactly as returned", async () => {
    renderPage();

    expect(mockedGetAttemptResult).toHaveBeenCalledWith("attempt-1");
    expect(
      await screen.findByRole("heading", { name: "Integers Quiz" }),
    ).toBeInTheDocument();
    // Display-only: values match the fixture, nothing is derived client-side.
    expect(screen.getByText("1 of 4 · 25%")).toBeInTheDocument();
    expect(
      screen.getByText("1 correct · 1 incorrect · 1 unanswered"),
    ).toBeInTheDocument();
    expect(screen.getByText("Quiz")).toBeInTheDocument();
    expect(screen.getByText("Integers")).toBeInTheDocument();
  });

  it("renders per-question review with answers, correctness, marks, and explanation", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Question review" });

    expect(screen.getByText("What is -3 + 5?")).toBeInTheDocument();
    expect(screen.getByText("Correct")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 mark")).toBeInTheDocument();
    expect(
      screen.getByText("Negative three plus five equals two."),
    ).toBeInTheDocument();

    expect(screen.getByText("Choose the even number.")).toBeInTheDocument();
    expect(screen.getByText("Incorrect")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 mark")).toBeInTheDocument();
  });

  it("marks selected and correct options and flags unanswered questions", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Question review" });

    expect(screen.getByText("Unanswered")).toBeInTheDocument();
    expect(
      screen.getByText("You did not answer this question."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 of 2 marks")).toBeInTheDocument();
    expect(
      screen.getByText("Ten minus three equals seven."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("· Your answer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("· Correct answer").length).toBeGreaterThan(0);
  });

  it("shows an unavailable state for a missing result", async () => {
    mockedGetAttemptResult.mockRejectedValue(
      new ApiError("NOT_FOUND", "Result was not found.", 404),
    );
    renderPage();

    expect(await screen.findByText("Result unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to Results" }),
    ).toHaveAttribute("href", "/results");
  });

  it("shows an error state with retry on a generic failure", async () => {
    const user = userEvent.setup();
    mockedGetAttemptResult
      .mockRejectedValueOnce(
        new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
      )
      .mockResolvedValueOnce(resultFixture);
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(
      await screen.findByRole("heading", { name: "Integers Quiz" }),
    ).toBeInTheDocument();
  });

  it("starts the same practice again and navigates to the player", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Question review" });

    await user.click(screen.getByRole("button", { name: "Try Again" }));

    expect(mockedStartPracticeAttempt).toHaveBeenCalledTimes(1);
    expect(mockedStartPracticeAttempt).toHaveBeenCalledWith("practice-1");
    await waitFor(() =>
      expect(mockedNavigate).toHaveBeenCalledWith(
        "/practice/practice-1/attempt/attempt-2",
      ),
    );
    const handoff = JSON.parse(
      sessionStorage.getItem("ai-teacher:activeAttempt") ?? "{}",
    );
    expect(handoff).toEqual({
      attemptId: "attempt-2",
      practiceId: "practice-1",
    });
  });

  it("prevents duplicate Try Again clicks while starting", async () => {
    const user = userEvent.setup();
    let resolveStart: (value: StartAttemptResponse) => void = () => {};
    mockedStartPracticeAttempt.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Question review" });

    const tryAgain = screen.getByRole("button", { name: "Try Again" });
    await user.click(tryAgain);
    await user.click(tryAgain);

    expect(mockedStartPracticeAttempt).toHaveBeenCalledTimes(1);
    resolveStart(startAttemptResponse);
    await waitFor(() =>
      expect(mockedNavigate).toHaveBeenCalledWith(
        "/practice/practice-1/attempt/attempt-2",
      ),
    );
  });

  it("shows an inline error when Try Again fails", async () => {
    const user = userEvent.setup();
    mockedStartPracticeAttempt.mockRejectedValue(
      new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Question review" });

    await user.click(screen.getByRole("button", { name: "Try Again" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the server.",
    );
    expect(mockedNavigate).not.toHaveBeenCalled();
  });

  it("provides return navigation to results and practice", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Question review" });

    expect(
      screen.getByRole("link", { name: "Back to Results" }),
    ).toHaveAttribute("href", "/results");
    expect(
      screen.getByRole("link", { name: "Back to Practice" }),
    ).toHaveAttribute("href", "/practice");
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("Results");
  });
});
