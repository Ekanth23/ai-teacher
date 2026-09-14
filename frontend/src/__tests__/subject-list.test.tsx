import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SubjectListPage from "../pages/SubjectListPage";
import { getClasses, getClassSubjects } from "../services/api/learning";
import { ApiError } from "../services/api/errors";
import type { ClassListResponse, ClassSubjectsResponse } from "../types/learning";

vi.mock("../services/api/learning", () => ({
  getClasses: vi.fn(),
  getClassSubjects: vi.fn(),
}));

const mockedGetClasses = vi.mocked(getClasses);
const mockedGetClassSubjects = vi.mocked(getClassSubjects);

const classesFixture: ClassListResponse = {
  classes: [{ id: "class-1", name: "Grade 8", section: "A" }],
  total: 1,
};

const subjectsFixture: ClassSubjectsResponse = {
  subjects: [{ id: "subject-1", name: "Mathematics", code: "MATH" }],
  total: 1,
};

function renderPage(route = "/learning/class-1") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/learning/:classId" element={<SubjectListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Subject List (SubjectListPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading skeleton while fetching", () => {
    mockedGetClasses.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the class context and its subjects with breadcrumb", async () => {
    mockedGetClasses.mockResolvedValue(classesFixture);
    mockedGetClassSubjects.mockResolvedValue(subjectsFixture);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Grade 8" })).toBeInTheDocument();
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("MATH")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("My Learning");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Grade 8");
  });

  it("shows an empty state when the class has no subjects", async () => {
    mockedGetClasses.mockResolvedValue(classesFixture);
    mockedGetClassSubjects.mockResolvedValue({ subjects: [], total: 0 });
    renderPage();
    expect(await screen.findByText("No subjects yet")).toBeInTheDocument();
  });

  it("shows an error state and retries", async () => {
    const user = userEvent.setup();
    mockedGetClasses.mockResolvedValue(classesFixture);
    mockedGetClassSubjects
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0))
      .mockResolvedValueOnce(subjectsFixture);

    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Grade 8" })).toBeInTheDocument();
  });

  it("navigates each subject to its subject context", async () => {
    mockedGetClasses.mockResolvedValue(classesFixture);
    mockedGetClassSubjects.mockResolvedValue(subjectsFixture);
    renderPage();

    const link = await screen.findByRole("link", { name: /Mathematics/ });
    expect(link).toHaveAttribute("href", "/learning/class-1/subjects/subject-1");
  });

  it("does not fabricate data for an unknown classId", async () => {
    mockedGetClasses.mockResolvedValue({ classes: [], total: 0 });
    renderPage("/learning/unknown-class");

    expect(await screen.findByText("Class not found")).toBeInTheDocument();
    expect(screen.queryByText("No subjects yet")).not.toBeInTheDocument();
    expect(mockedGetClassSubjects).not.toHaveBeenCalled();
  });
});
