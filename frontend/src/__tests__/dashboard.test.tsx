import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardPage from "../pages/DashboardPage";
import { request } from "../services/api/client";
import { ApiError } from "../services/api/errors";
import type { DashboardResponse } from "../types/dashboard";

vi.mock("../services/api/client", () => ({
  request: vi.fn(),
}));

const mockedRequest = vi.mocked(request);

const fullFixture: DashboardResponse = {
  student: { id: "student-1", full_name: "Alice Student", grade_level: "8" },
  classes: [{ id: "class-1", name: "Class 8", section: "A" }],
  current_class: { id: "class-1", name: "Class 8", section: "A" },
  subjects: [
    { id: "subject-1", name: "Mathematics", code: "MATH" },
    { id: "subject-2", name: "Science", code: "SCI" },
  ],
  recent_activity: [],
  learning_resources: [],
  curriculum_structures: [],
  progress: null,
};

describe("student dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests the dashboard and renders welcome, current class, and subjects", async () => {
    mockedRequest.mockResolvedValue(fullFixture);

    render(<DashboardPage />);

    expect(
      await screen.findByText("Welcome back, Alice Student"),
    ).toBeInTheDocument();
    expect(screen.getByText("Class 8")).toBeInTheDocument();
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Science")).toBeInTheDocument();

    expect(mockedRequest).toHaveBeenCalledWith("/api/student/dashboard");
  });

  it("does not supply student or organization identity from the client", async () => {
    mockedRequest.mockResolvedValue(fullFixture);
    render(<DashboardPage />);
    await screen.findByText("Welcome back, Alice Student");

    const [path, options] = mockedRequest.mock.calls[0];
    expect(path).toBe("/api/student/dashboard");
    expect(options).toBeUndefined();
  });

  it("shows a loading skeleton while fetching", () => {
    mockedRequest.mockReturnValue(new Promise(() => {}));
    render(<DashboardPage />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state and retries", async () => {
    const user = userEvent.setup();
    mockedRequest
      .mockRejectedValueOnce(
        new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
      )
      .mockResolvedValueOnce(fullFixture);

    render(<DashboardPage />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(
      await screen.findByText("Welcome back, Alice Student"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there is no current class", async () => {
    mockedRequest.mockResolvedValue({
      ...fullFixture,
      current_class: null,
    });
    render(<DashboardPage />);
    expect(
      await screen.findByText("No current class selected"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no subjects", async () => {
    mockedRequest.mockResolvedValue({
      ...fullFixture,
      subjects: [],
    });
    render(<DashboardPage />);
    expect(await screen.findByText("No subjects yet")).toBeInTheDocument();
  });

  it("does not render school, teacher, homework, or academic-year concepts", async () => {
    mockedRequest.mockResolvedValue(fullFixture);
    render(<DashboardPage />);
    await screen.findByText("Welcome back, Alice Student");

    expect(screen.queryByText(/teacher/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/school/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/homework/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/academic year/i)).not.toBeInTheDocument();
  });

  it("provides a heading hierarchy for the core sections", async () => {
    mockedRequest.mockResolvedValue(fullFixture);
    render(<DashboardPage />);
    await screen.findByText("Welcome back, Alice Student");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Welcome back, Alice Student",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Current Class" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "My Subjects" }),
    ).toBeInTheDocument();
  });
});
