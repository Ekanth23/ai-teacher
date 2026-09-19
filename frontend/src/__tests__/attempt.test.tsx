import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AttemptPage from "../pages/AttemptPage";
import {
  getPractice,
  saveAttemptAnswers,
  submitAttempt,
} from "../services/api/practice";
import { ApiError } from "../services/api/errors";
import type {
  PracticeDetail,
  PracticeDetailResponse,
} from "../types/practice";

vi.mock("../services/api/practice", () => ({
  getPractices: vi.fn(),
  getPractice: vi.fn(),
  startPracticeAttempt: vi.fn(),
  saveAttemptAnswers: vi.fn(),
  submitAttempt: vi.fn(),
}));

const mockedGetPractice = vi.mocked(getPractice);
const mockedSaveAttemptAnswers = vi.mocked(saveAttemptAnswers);
const mockedSubmitAttempt = vi.mocked(submitAttempt);

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/practice/practice-1/attempt/attempt-1"]}>
      <Routes>
        <Route
          path="/practice/:practiceId/attempt/:attemptId"
          element={<AttemptPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Attempt player (AttemptPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetPractice.mockResolvedValue(practiceResponse);
    mockedSaveAttemptAnswers.mockResolvedValue({ answers: [] });
    mockedSubmitAttempt.mockResolvedValue({
      id: "attempt-1",
      status: "SUBMITTED",
      submitted_at: "2026-09-17T00:00:00.000Z",
    });
  });

  it("shows a loading state while fetching", () => {
    mockedGetPractice.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading your attempt…")).toBeInTheDocument();
  });

  it("shows an error state with retry when loading fails", async () => {
    const user = userEvent.setup();
    mockedGetPractice
      .mockRejectedValueOnce(
        new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
      )
      .mockResolvedValueOnce(practiceResponse);
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(
      await screen.findByRole("heading", { name: "Integers Quiz" }),
    ).toBeInTheDocument();
  });

  it("shows an unavailable state when the practice is not found", async () => {
    mockedGetPractice.mockRejectedValue(
      new ApiError("NOT_FOUND", "Practice was not found.", 404),
    );
    renderPage();
    expect(await screen.findByText("Practice unavailable")).toBeInTheDocument();
  });

  it("renders the player shell with progress and navigation", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Integers Quiz" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Question 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("0 of 2 answered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Submit Practice" }),
    ).toBeEnabled();
  });

  it("renders question text and options without protected answer fields", async () => {
    renderPage();

    expect(await screen.findByText("What is -3 + 5?")).toBeInTheDocument();
    for (const option of ["8", "2", "-2", "-8"]) {
      expect(screen.getByText(option)).toBeInTheDocument();
    }
    expect(
      screen.queryByText(/correct_option_key/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/correct answer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/explanation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
  });

  it("selects a single option and saves it via PUT", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("What is -3 + 5?");

    await user.click(screen.getByRole("radio", { name: /B\. 2/ }));
    expect(screen.getByRole("radio", { name: /B\. 2/ })).toBeChecked();

    await waitFor(() =>
      expect(mockedSaveAttemptAnswers).toHaveBeenCalledTimes(1),
    );
    expect(mockedSaveAttemptAnswers).toHaveBeenCalledWith("attempt-1", {
      answers: [{ question_id: "q-1", selected_option: "B" }],
    });
    expect(await screen.findByText("Answer saved")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 answered")).toBeInTheDocument();
  });

  it("changes the selection and saves the new option", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("What is -3 + 5?");

    await user.click(screen.getByRole("radio", { name: /B\. 2/ }));
    await waitFor(() =>
      expect(mockedSaveAttemptAnswers).toHaveBeenCalledTimes(1),
    );
    await user.click(screen.getByRole("radio", { name: /C\. -2/ }));

    expect(screen.getByRole("radio", { name: /C\. -2/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /B\. 2/ })).not.toBeChecked();
    await waitFor(() =>
      expect(mockedSaveAttemptAnswers).toHaveBeenCalledTimes(2),
    );
    expect(mockedSaveAttemptAnswers).toHaveBeenLastCalledWith("attempt-1", {
      answers: [{ question_id: "q-1", selected_option: "C" }],
    });
  });

  it("preserves the selection and offers retry when saving fails", async () => {
    const user = userEvent.setup();
    mockedSaveAttemptAnswers.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
    );
    renderPage();
    await screen.findByText("What is -3 + 5?");

    await user.click(screen.getByRole("radio", { name: /B\. 2/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the server.",
    );
    // Local selection is preserved despite the failure.
    expect(screen.getByRole("radio", { name: /B\. 2/ })).toBeChecked();

    mockedSaveAttemptAnswers.mockResolvedValue({ answers: [] });
    await user.click(screen.getByRole("button", { name: "Retry save" }));
    expect(await screen.findByText("Answer saved")).toBeInTheDocument();
  });

  it("navigates between questions and preserves selections", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("What is -3 + 5?");

    await user.click(screen.getByRole("radio", { name: /B\. 2/ }));
    await waitFor(() =>
      expect(mockedSaveAttemptAnswers).toHaveBeenCalledTimes(1),
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Question 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Choose the even number.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Question 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /B\. 2/ })).toBeChecked();
    expect(mockedSubmitAttempt).not.toHaveBeenCalled();
  });

  it("asks for confirmation showing the unanswered count; cancel does not submit", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("What is -3 + 5?");

    await user.click(screen.getByRole("button", { name: "Submit Practice" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Submission is final");
    expect(dialog).toHaveTextContent("You have 2 unanswered questions.");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockedSubmitAttempt).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("traps Tab focus inside the dialog and restores focus on Escape", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("What is -3 + 5?");

    await user.click(screen.getByRole("button", { name: "Submit Practice" }));
    await screen.findByRole("dialog");

    const confirm = screen.getByRole("button", { name: "Confirm Submit" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(confirm).toHaveFocus();

    await user.keyboard("{Tab}");
    expect(cancel).toHaveFocus();

    await user.keyboard("{Tab}");
    expect(confirm).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(cancel).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedSubmitAttempt).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Submit Practice" })).toHaveFocus();
  });

  it("submits on confirm, prevents duplicates, and shows the submitted state", async () => {
    const user = userEvent.setup();
    let resolveSubmit: (value: {
      id: string;
      status: "SUBMITTED";
      submitted_at: string;
    }) => void = () => {};
    mockedSubmitAttempt.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    renderPage();
    await screen.findByText("What is -3 + 5?");

    await user.click(screen.getByRole("button", { name: "Submit Practice" }));
    await user.click(screen.getByRole("button", { name: "Confirm Submit" }));

    expect(mockedSubmitAttempt).toHaveBeenCalledTimes(1);
    expect(mockedSubmitAttempt).toHaveBeenCalledWith("attempt-1");
    expect(screen.getByRole("button", { name: "Submit Practice" })).toBeDisabled();

    resolveSubmit({
      id: "attempt-1",
      status: "SUBMITTED",
      submitted_at: "2026-09-17T00:00:00.000Z",
    });

    expect(await screen.findByText("Practice submitted")).toBeInTheDocument();
    // No fabricated result data is displayed.
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View Results" }),
    ).toHaveAttribute("href", "/results");
  });

  it("shows a submit error with retry without losing selections", async () => {
    const user = userEvent.setup();
    mockedSubmitAttempt.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
    );
    renderPage();
    await screen.findByText("What is -3 + 5?");

    await user.click(screen.getByRole("radio", { name: /B\. 2/ }));
    await waitFor(() =>
      expect(mockedSaveAttemptAnswers).toHaveBeenCalledTimes(1),
    );

    await user.click(screen.getByRole("button", { name: "Submit Practice" }));
    await user.click(screen.getByRole("button", { name: "Confirm Submit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the server.",
    );

    mockedSubmitAttempt.mockResolvedValue({
      id: "attempt-1",
      status: "SUBMITTED",
      submitted_at: "2026-09-17T00:00:00.000Z",
    });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Practice submitted")).toBeInTheDocument();
    expect(
      within(screen.getByRole("status")).getByText(/Results will be available/),
    ).toBeInTheDocument();
  });

  it("disables answer controls after submission", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("What is -3 + 5?");

    await user.click(screen.getByRole("button", { name: "Submit Practice" }));
    await user.click(screen.getByRole("button", { name: "Confirm Submit" }));

    await screen.findByText("Practice submitted");
    expect(screen.queryByRole("radio", { name: /B\. 2/ })).not.toBeInTheDocument();
    expect(mockedSaveAttemptAnswers).not.toHaveBeenCalled();
  });
});
