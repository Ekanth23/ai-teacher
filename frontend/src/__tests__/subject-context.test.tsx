import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SubjectContextPage from "../pages/SubjectContextPage";
import {
  getClasses,
  getClassSubjects,
  getStructureChapters,
} from "../services/api/learning";
import { getDashboard } from "../services/api/dashboard";
import { ApiError } from "../services/api/errors";
import type { DashboardResponse } from "../types/dashboard";
import type {
  ClassListResponse,
  ClassSubjectsResponse,
  StructureChaptersResponse,
} from "../types/learning";

vi.mock("../services/api/learning", () => ({
  getClasses: vi.fn(),
  getClassSubjects: vi.fn(),
  getStructureChapters: vi.fn(),
}));

vi.mock("../services/api/dashboard", () => ({
  getDashboard: vi.fn(),
}));

const mockedGetClasses = vi.mocked(getClasses);
const mockedGetClassSubjects = vi.mocked(getClassSubjects);
const mockedGetDashboard = vi.mocked(getDashboard);
const mockedGetStructureChapters = vi.mocked(getStructureChapters);

const classesFixture: ClassListResponse = {
  classes: [{ id: "class-1", name: "Grade 8", section: "A" }],
  total: 1,
};

const subjectsFixture: ClassSubjectsResponse = {
  subjects: [{ id: "subject-1", name: "Mathematics", code: "MATH" }],
  total: 1,
};

const dashboardFixture: DashboardResponse = {
  student: { id: "student-1", full_name: "Test Student", grade_level: "8" },
  classes: classesFixture.classes,
  current_class: classesFixture.classes[0],
  subjects: subjectsFixture.subjects,
  recent_activity: [],
  learning_resources: [],
  curriculum_structures: [
    { id: "structure-1", class_id: "class-1", subject_id: "subject-1" },
  ],
  progress: null,
};

const chaptersFixture: StructureChaptersResponse = {
  chapters: [
    {
      id: "chapter-1",
      curriculum_structure_id: "structure-1",
      parent_node_id: null,
      node_type_id: "chapter-type-1",
      node_type_code: "CHAPTER",
      node_type_name: "Chapter",
      subject_id: "subject-1",
      title: "Number Systems",
      code: "CH-1",
      description: "Learn about real numbers.",
      sequence_number: 1,
      metadata: {},
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  total: 1,
};

function mockSubjectContextData() {
  mockedGetClasses.mockResolvedValue(classesFixture);
  mockedGetClassSubjects.mockResolvedValue(subjectsFixture);
  mockedGetDashboard.mockResolvedValue(dashboardFixture);
  mockedGetStructureChapters.mockResolvedValue(chaptersFixture);
}

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

  it("renders subject context and chapters from its only matching structure", async () => {
    mockSubjectContextData();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Mathematics" })).toBeInTheDocument();
    expect(screen.getByText("MATH")).toBeInTheDocument();
    expect(screen.getByText("Class")).toBeInTheDocument();
    expect(screen.getByText("Section A")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chapters" })).toBeInTheDocument();
    expect(screen.getByText("Number Systems")).toBeInTheDocument();
    expect(screen.getByText("CH-1")).toBeInTheDocument();
    expect(screen.getByText("Learn about real numbers.")).toBeInTheDocument();
    expect(mockedGetStructureChapters).toHaveBeenCalledWith("structure-1");
    expect(screen.getByRole("link", { name: /Number Systems/ })).toHaveAttribute(
      "href",
      "/learning/class-1/subjects/subject-1/chapters/chapter-1",
    );

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("My Learning");
    expect(breadcrumb).toHaveTextContent("Grade 8");
    expect(breadcrumb).toHaveTextContent("Mathematics");
  });

  it("shows an error state and retries", async () => {
    const user = userEvent.setup();
    mockSubjectContextData();
    mockedGetStructureChapters
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0))
      .mockResolvedValueOnce(chaptersFixture);

    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Mathematics" })).toBeInTheDocument();
    expect(await screen.findByText("Number Systems")).toBeInTheDocument();
  });

  it("shows an empty state when the subject has no matching structure", async () => {
    mockSubjectContextData();
    mockedGetDashboard.mockResolvedValue({
      ...dashboardFixture,
      curriculum_structures: [
        { id: "other-subject", class_id: "class-1", subject_id: "subject-2" },
        { id: "other-class", class_id: "class-2", subject_id: "subject-1" },
      ],
    });
    renderPage();

    expect(await screen.findByText("No chapters available")).toBeInTheDocument();
    expect(mockedGetStructureChapters).not.toHaveBeenCalled();
  });

  it("shows an empty state when the matching structure has no chapters", async () => {
    mockSubjectContextData();
    mockedGetStructureChapters.mockResolvedValue({ chapters: [], total: 0 });
    renderPage();

    expect(await screen.findByText("No chapters yet")).toBeInTheDocument();
  });

  it("does not select a structure when more than one matches the class and subject", async () => {
    mockSubjectContextData();
    mockedGetDashboard.mockResolvedValue({
      ...dashboardFixture,
      curriculum_structures: [
        ...dashboardFixture.curriculum_structures,
        { id: "structure-2", class_id: "class-1", subject_id: "subject-1" },
      ],
    });
    renderPage();

    expect(await screen.findByText("Chapters unavailable")).toBeInTheDocument();
    expect(mockedGetStructureChapters).not.toHaveBeenCalled();
  });

  it("does not fabricate data when the subjectId is not in the class", async () => {
    mockSubjectContextData();
    renderPage("/learning/class-1/subjects/subject-unknown");

    expect(await screen.findByText("Subject not found")).toBeInTheDocument();
    expect(screen.queryByText("Number Systems")).not.toBeInTheDocument();
    expect(screen.queryByText("MATH")).not.toBeInTheDocument();
    expect(mockedGetDashboard).not.toHaveBeenCalled();
  });

  it("does not fabricate data when the classId is unknown", async () => {
    mockSubjectContextData();
    mockedGetClasses.mockResolvedValue({ classes: [], total: 0 });
    renderPage("/learning/unknown-class/subjects/subject-1");

    expect(await screen.findByText("Class not found")).toBeInTheDocument();
    expect(screen.queryByText("Number Systems")).not.toBeInTheDocument();
    expect(mockedGetClassSubjects).not.toHaveBeenCalled();
    expect(mockedGetDashboard).not.toHaveBeenCalled();
  });
});
