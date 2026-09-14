import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LearningPage from "../pages/LearningPage";
import { getClasses } from "../services/api/learning";
import { ApiError } from "../services/api/errors";
import type { ClassListResponse } from "../types/learning";

vi.mock("../services/api/learning", () => ({
  getClasses: vi.fn(),
  getClassSubjects: vi.fn(),
}));

const mockedGetClasses = vi.mocked(getClasses);

const classesFixture: ClassListResponse = {
  classes: [{ id: "class-1", name: "Grade 8", section: "A" }],
  total: 1,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/learning"]}>
      <LearningPage />
    </MemoryRouter>,
  );
}

describe("My Class (LearningPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading skeleton while fetching", () => {
    mockedGetClasses.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading your classes…")).toBeInTheDocument();
  });

  it("renders enrolled classes with name, section, and current badge", async () => {
    mockedGetClasses.mockResolvedValue(classesFixture);
    renderPage();

    expect(await screen.findByRole("heading", { name: "My Learning" })).toBeInTheDocument();
    expect(screen.getByText("Grade 8")).toBeInTheDocument();
    expect(screen.getByText("Section A")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("shows an empty state when there are no classes", async () => {
    mockedGetClasses.mockResolvedValue({ classes: [], total: 0 });
    renderPage();
    expect(await screen.findByText("No classes yet")).toBeInTheDocument();
  });

  it("shows an error state and retries", async () => {
    const user = userEvent.setup();
    mockedGetClasses
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0))
      .mockResolvedValueOnce(classesFixture);

    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "My Learning" })).toBeInTheDocument();
  });

  it("navigates each class to its subject list", async () => {
    mockedGetClasses.mockResolvedValue(classesFixture);
    renderPage();

    const link = await screen.findByRole("link", { name: /Grade 8/ });
    expect(link).toHaveAttribute("href", "/learning/class-1");
  });
});
