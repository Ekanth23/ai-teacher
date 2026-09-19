import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PracticeDetailPage from "../pages/PracticeDetailPage";
import { getPractice, startPracticeAttempt } from "../services/api/practice";
import { ApiError } from "../services/api/errors";
import type {
  PracticeDetail,
  PracticeDetailResponse,
  StartAttemptResponse,
} from "../types/practice";

vi.mock("../services/api/practice", () => ({
  getPractices: vi.fn(),
  getPractice: vi.fn(),
  startPracticeAttempt: vi.fn(),
  saveAttemptAnswers: vi.fn(),
  submitAttempt: vi.fn(),
}));

const mockedNavigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockedNavigate };
});

const mockedGetPractice = vi.mocked(getPractice);
const mockedStartPracticeAttempt = vi.mocked(startPracticeAttempt);

const practiceFixture: PracticeDetail = {
  id: "practice-1",
  title: "Integers Quiz",
  description: "Test your skills on integer operations.",
  practice_type: "QUIZ",
  topic: { id: "topic-1", name: "Integers" },
  question_count: 2,
  questions: [
    {
      id: "q-1",
      sequence_number: 1,
      question_text: "What is -3 + 5?",
      options: [
        { key: "A", text: "8" },
        { key: "B", text: "2" },
        { key: "C", text: "-2" },
        { key: "D", text: "-8" },
      ],
      marks: 1,
    },
    {
      id: "q-2",
      sequence_number: 2,
      question_text: "Choose the even number.",
      options: [
        { key: "A", text: "3" },
        { key: "B", text: "5" },
        { key: "C", text: "6" },
        { key: "D", text: "7" },
      ],
      marks: 2,
    },
  ],
};

const practiceResponse: PracticeDetailResponse = { practice: practiceFixture };

const startAttemptResponse: StartAttemptResponse = {
  attempt: {
    id: "attempt-1",
    practice_id: "practice-1",
    status: "IN_PROGRESS",
    started_at: "2026-09-17T00:00:00.000Z",
  },
  questions: practiceFixture.questions,
};

function renderPage(route = "/practice/practice-1") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/practice/:practiceId"
          element={<PracticeDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Practice detail (PracticeDetailPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("shows a loading skeleton while fetching", () => {
    mockedGetPractice.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading practice…")).toBeInTheDocument();
  });

  it("renders the practice's canonical fields and breadcrumb", async () => {
    mockedGetPractice.mockResolvedValue(practiceResponse);
    renderPage();

    expect(mockedGetPractice).toHaveBeenCalledWith("practice-1");
    expect(await screen.findByRole("heading", { name: "Integers Quiz" })).toBeInTheDocument();
    expect(screen.getByText("Test your skills on integer operations.")).toBeInTheDocument();
    expect(screen.getByText("Quiz")).toBeInTheDocument();
    expect(screen.getByText(/Integers · 2 questions/)).toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("Practice");
    expect(breadcrumb).toHaveTextContent("Integers Quiz");
    expect(screen.getByRole("link", { name: "Practice" })).toHaveAttribute(
      "href",
      "/practice",
    );
  });

  it("renders the safe question preview without any answer fields", async () => {
    mockedGetPractice.mockResolvedValue(practiceResponse);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Questions" })).toBeInTheDocument();
    expect(screen.getByText("What is -3 + 5?")).toBeInTheDocument();
    expect(screen.getByText("Choose the even number.")).toBeInTheDocument();
    expect(screen.getByText("1 mark")).toBeInTheDocument();
    expect(screen.getByText("2 marks")).toBeInTheDocument();
    for (const option of ["8", "2", "-2", "-8", "3", "5", "6", "7"]) {
      expect(screen.getByText(option)).toBeInTheDocument();
    }

    expect(
      screen.queryByText(/correct_option_key/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/correct answer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/explanation/i)).not.toBeInTheDocument();
    expect(screen.getByText("Preview only — answers are only revealed after you submit."))
      .toBeInTheDocument();
  });

  it("starts an attempt, keeps the handoff, and navigates to the player", async () => {
    const user = userEvent.setup();
    mockedGetPractice.mockResolvedValue(practiceResponse);
    mockedStartPracticeAttempt.mockResolvedValue(startAttemptResponse);
    renderPage();

    expect(await screen.findByRole("button", { name: "Start Practice" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start Practice" }));

    expect(mockedStartPracticeAttempt).toHaveBeenCalledTimes(1);
    expect(mockedStartPracticeAttempt).toHaveBeenCalledWith("practice-1");

    const handoff = JSON.parse(
      sessionStorage.getItem("ai-teacher:activeAttempt") ?? "{}",
    );
    expect(handoff).toEqual({ attemptId: "attempt-1", practiceId: "practice-1" });
    expect(mockedNavigate).toHaveBeenCalledTimes(1);
    expect(mockedNavigate).toHaveBeenCalledWith(
      "/practice/practice-1/attempt/attempt-1",
    );
  });

  it("disables the start button and prevents duplicates while starting", async () => {
    const user = userEvent.setup();
    mockedGetPractice.mockResolvedValue(practiceResponse);
    let resolveStart: (value: StartAttemptResponse) => void = () => {};
    mockedStartPracticeAttempt.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    renderPage();

    const startButton = await screen.findByRole("button", { name: "Start Practice" });
    await user.click(startButton);

    expect(screen.getByRole("button", { name: "Start Practice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start Practice" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(mockedStartPracticeAttempt).toHaveBeenCalledTimes(1);

    resolveStart(startAttemptResponse);
    expect(mockedStartPracticeAttempt).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockedNavigate).toHaveBeenCalledWith(
        "/practice/practice-1/attempt/attempt-1",
      ),
    );
  });

  it("shows an inline error and keeps the button usable when starting fails", async () => {
    const user = userEvent.setup();
    mockedGetPractice.mockResolvedValue(practiceResponse);
    mockedStartPracticeAttempt.mockRejectedValue(
      new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
    );
    renderPage();

    expect(await screen.findByRole("button", { name: "Start Practice" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start Practice" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the server.",
    );
    expect(screen.getByRole("button", { name: "Start Practice" })).toBeEnabled();
  });

  it("shows an unavailable state when the practice is not found", async () => {
    mockedGetPractice.mockRejectedValue(
      new ApiError("NOT_FOUND", "Practice was not found.", 404),
    );
    renderPage("/practice/missing");

    expect(await screen.findByText("Practice unavailable")).toBeInTheDocument();
  });

  it("shows an error state with retry on a generic failure", async () => {
    const user = userEvent.setup();
    mockedGetPractice
      .mockRejectedValueOnce(
        new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
      )
      .mockResolvedValueOnce(practiceResponse);
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Integers Quiz" })).toBeInTheDocument();
  });
});