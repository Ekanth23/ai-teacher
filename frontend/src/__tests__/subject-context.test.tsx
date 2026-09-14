import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SubjectContextPage from "../pages/SubjectContextPage";
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

function renderPage(route = "/learning/class-1/subjects/subject-1") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/learning/:classId/subjects/:subjectId"
          element={<SubjectContextPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Subject Context (SubjectContextPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading skeleton while fetching", () => {
    mockedGetClasses.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders subject name, code, class context, breadcrumb, and deferred chapters", async () => {
    mockedGetClasses.mockResolvedValue(classesFixture);
    mockedGetClassSubjects.mockResolvedValue(subjectsFixture);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Mathematics" })).toBeInTheDocument();
    expect(screen.getByText("MATH")).toBeInTheDocument();
    expect(screen.getByText("Class")).toBeInTheDocument();
    expect(screen.getByText("Section A")).toBeInTheDocument();
    expect(screen.getByText("Chapters will appear here")).toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("My Learning");
    expect(breadcrumb).toHaveTextContent("Grade 8");
    expect(breadcrumb).toHaveTextContent("Mathematics");
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
    expect(await screen.findByRole("heading", { name: "Mathematics" })).toBeInTheDocument();
  });

  it("does not fabricate data when the subjectId is not in the class", async () => {
    mockedGetClasses.mockResolvedValue(classesFixture);
    mockedGetClassSubjects.mockResolvedValue(subjectsFixture);
    renderPage("/learning/class-1/subjects/subject-unknown");

    expect(await screen.findByText("Subject not found")).toBeInTheDocument();
    expect(screen.queryByText("Chapters will appear here")).not.toBeInTheDocument();
    expect(screen.queryByText("MATH")).not.toBeInTheDocument();
  });

  it("does not fabricate data when the classId is unknown", async () => {
    mockedGetClasses.mockResolvedValue({ classes: [], total: 0 });
    renderPage("/learning/unknown-class/subjects/subject-1");

    expect(await screen.findByText("Class not found")).toBeInTheDocument();
    expect(screen.queryByText("Chapters will appear here")).not.toBeInTheDocument();
  });
});
