import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import PracticePage from "../pages/PracticePage";
import { getPractices } from "../services/api/practice";
import { ApiError } from "../services/api/errors";
import type { PracticeListResponse } from "../types/practice";

vi.mock("../services/api/practice", () => ({
  getPractices: vi.fn(),
  getPractice: vi.fn(),
  startPracticeAttempt: vi.fn(),
}));

const mockedGetPractices = vi.mocked(getPractices);

const practicesFixture: PracticeListResponse = {
  practices: [
    {
      id: "practice-1",
      title: "Integers Quiz",
      description: "Test your skills on integer operations.",
      practice_type: "QUIZ",
      topic: { id: "topic-1", name: "Integers" },
    },
    {
      id: "practice-2",
      title: "Life Mathematics Practice",
      description: null,
      practice_type: "SELF_ASSESSMENT",
      topic: { id: "topic-2", name: "Life Mathematics" },
    },
    {
      id: "practice-3",
      title: "Algebra Practice",
      description: "Drill on linear equations.",
      practice_type: "PRACTICE",
      topic: { id: "topic-3", name: "Algebra" },
    },
  ],
  total: 3,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/practice"]}>
      <PracticePage />
    </MemoryRouter>,
  );
}

describe("Practice discovery (PracticePage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading skeleton while fetching", () => {
    mockedGetPractices.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading your practices…")).toBeInTheDocument();
  });

  it("fetches the list from the student practices API", async () => {
    mockedGetPractices.mockResolvedValue(practicesFixture);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Practice" })).toBeInTheDocument();
    expect(mockedGetPractices).toHaveBeenCalledTimes(1);
    expect(mockedGetPractices).toHaveBeenCalledWith();
  });

  it("renders practice cards with title, description, and topic", async () => {
    mockedGetPractices.mockResolvedValue(practicesFixture);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Integers Quiz" })).toBeInTheDocument();
    expect(screen.getByText("Test your skills on integer operations.")).toBeInTheDocument();
    expect(screen.getByText("Integers")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Life Mathematics Practice" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Algebra Practice" })).toBeInTheDocument();
    expect(screen.getByText("Drill on linear equations.")).toBeInTheDocument();
  });

  it("renders a badge for each practice type", async () => {
    mockedGetPractices.mockResolvedValue(practicesFixture);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Integers Quiz" })).toBeInTheDocument();

    function cardOf(title: string) {
      const heading = screen.getByRole("heading", { name: title });
      return heading.closest("li") as HTMLElement;
    }

    expect(within(cardOf("Integers Quiz")).getByText("Quiz")).toBeInTheDocument();
    expect(
      within(cardOf("Life Mathematics Practice")).getByText("Self-assessment"),
    ).toBeInTheDocument();
    expect(within(cardOf("Algebra Practice")).getByText("Practice")).toBeInTheDocument();
  });

  it("shows an empty state when no practices are published", async () => {
    mockedGetPractices.mockResolvedValue({ practices: [], total: 0 });
    renderPage();

    expect(await screen.findByText("No practices yet")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Integers Quiz" })).not.toBeInTheDocument();
  });

  it("shows an error state and retries", async () => {
    const user = userEvent.setup();
    mockedGetPractices
      .mockRejectedValueOnce(
        new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
      )
      .mockResolvedValueOnce(practicesFixture);

    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Integers Quiz" })).toBeInTheDocument();
  });

  it("navigates each practice to its detail page", async () => {
    mockedGetPractices.mockResolvedValue(practicesFixture);
    renderPage();

    const link = await screen.findByRole("link", { name: /Integers Quiz/ });
    expect(link).toHaveAttribute("href", "/practice/practice-1");
  });
});