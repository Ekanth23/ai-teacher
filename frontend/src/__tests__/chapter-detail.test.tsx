import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ChapterDetailPage from "../pages/ChapterDetailPage";
import { getDashboard } from "../services/api/dashboard";
import { ApiError } from "../services/api/errors";
import {
  getChapter,
  getChapterTopics,
  getClasses,
  getClassSubjects,
} from "../services/api/learning";
import type { DashboardResponse } from "../types/dashboard";
import type {
  ChapterResponse,
  ChapterTopicsResponse,
  ClassListResponse,
  ClassSubjectsResponse,
} from "../types/learning";

vi.mock("../services/api/learning", () => ({
  getChapter: vi.fn(),
  getChapterTopics: vi.fn(),
  getClasses: vi.fn(),
  getClassSubjects: vi.fn(),
}));

vi.mock("../services/api/dashboard", () => ({
  getDashboard: vi.fn(),
}));

const mockedGetChapter = vi.mocked(getChapter);
const mockedGetChapterTopics = vi.mocked(getChapterTopics);
const mockedGetClasses = vi.mocked(getClasses);
const mockedGetClassSubjects = vi.mocked(getClassSubjects);
const mockedGetDashboard = vi.mocked(getDashboard);

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

const chapterFixture: ChapterResponse = {
  chapter: {
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
};

const topicsFixture: ChapterTopicsResponse = {
  topics: [
    {
      id: "topic-1",
      curriculum_structure_id: "structure-1",
      parent_node_id: "chapter-1",
      node_type_id: "topic-type-1",
      node_type_code: "TOPIC",
      node_type_name: "Topic",
      subject_id: "subject-1",
      title: "Integers",
      code: "T-1",
      description: "Operations on integers.",
      sequence_number: 1,
      metadata: {},
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  total: 1,
};

function mockChapterContext() {
  mockedGetClasses.mockResolvedValue(classesFixture);
  mockedGetClassSubjects.mockResolvedValue(subjectsFixture);
  mockedGetDashboard.mockResolvedValue(dashboardFixture);
  mockedGetChapter.mockResolvedValue(chapterFixture);
  mockedGetChapterTopics.mockResolvedValue(topicsFixture);
}

function renderPage(
  route = "/learning/class-1/subjects/subject-1/chapters/chapter-1",
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/learning/:classId/subjects/:subjectId/chapters/:chapterId"
          element={<ChapterDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Chapter Detail (ChapterDetailPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the chapter's canonical display fields and four-level breadcrumb", async () => {
    mockChapterContext();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Number Systems" })).toBeInTheDocument();
    expect(screen.getByText("CH-1")).toBeInTheDocument();
    expect(screen.getByText("Learn about real numbers.")).toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("My Learning");
    expect(breadcrumb).toHaveTextContent("Grade 8");
    expect(breadcrumb).toHaveTextContent("Mathematics");
    expect(breadcrumb).toHaveTextContent("Number Systems");
    expect(screen.getByRole("link", { name: "My Learning" })).toHaveAttribute("href", "/learning");
    expect(screen.getByRole("link", { name: "Grade 8" })).toHaveAttribute(
      "href",
      "/learning/class-1",
    );
    expect(screen.getByRole("link", { name: "Mathematics" })).toHaveAttribute(
      "href",
      "/learning/class-1/subjects/subject-1",
    );
    expect(screen.getByText("Number Systems", { selector: "[aria-current=page]" })).toBeInTheDocument();
  });

  it("renders the real topics belonging to the authorized chapter", async () => {
    mockChapterContext();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Topics" })).toBeInTheDocument();
    expect(mockedGetChapterTopics).toHaveBeenCalledWith("chapter-1");
    expect(screen.getByRole("heading", { name: "Integers" })).toBeInTheDocument();
    expect(screen.getByText("T-1")).toBeInTheDocument();
    expect(screen.getByText("Operations on integers.")).toBeInTheDocument();
  });

  it("links each topic to its learning-resource topic page", async () => {
    mockChapterContext();
    renderPage();

    const link = await screen.findByRole("link", { name: /Integers/ });
    expect(link).toHaveAttribute(
      "href",
      "/learning/class-1/subjects/subject-1/chapters/chapter-1/topics/topic-1",
    );
  });

  it("shows an empty state when the chapter has no topics", async () => {
    mockChapterContext();
    mockedGetChapterTopics.mockResolvedValue({ topics: [], total: 0 });
    renderPage();

    expect(await screen.findByText("No topics yet")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Integers" })).not.toBeInTheDocument();
  });

  it("shows an API error and retries the topics request", async () => {
    const user = userEvent.setup();
    mockChapterContext();
    mockedGetChapterTopics
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0))
      .mockResolvedValueOnce(topicsFixture);
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Integers" })).toBeInTheDocument();
  });

  it("does not request topics when the chapter is unavailable", async () => {
    mockChapterContext();
    mockedGetChapter.mockRejectedValue(new ApiError("NOT_FOUND", "Chapter was not found.", 404));
    renderPage();

    expect(await screen.findByText("Chapter not found")).toBeInTheDocument();
    expect(mockedGetChapterTopics).not.toHaveBeenCalled();
  });

  it("shows a loading status while fetching", () => {
    mockedGetClasses.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading chapter…");
  });

  it("omits optional code and description when they are not returned", async () => {
    mockChapterContext();
    mockedGetChapter.mockResolvedValue({
      chapter: { ...chapterFixture.chapter, code: null, description: null },
    });
    renderPage();

    expect(await screen.findByRole("heading", { name: "Number Systems" })).toBeInTheDocument();
    expect(screen.queryByText("CH-1")).not.toBeInTheDocument();
    expect(screen.queryByText("Learn about real numbers.")).not.toBeInTheDocument();
  });

  it("shows an API error and retries the chapter request", async () => {
    const user = userEvent.setup();
    mockChapterContext();
    mockedGetChapter
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0))
      .mockResolvedValueOnce(chapterFixture);
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Number Systems" })).toBeInTheDocument();
  });

  it("shows an unavailable state when the chapter is not found", async () => {
    mockChapterContext();
    mockedGetChapter.mockRejectedValue(new ApiError("NOT_FOUND", "Chapter was not found.", 404));
    renderPage();

    expect(await screen.findByText("Chapter not found")).toBeInTheDocument();
    expect(screen.queryByText("Learn about real numbers.")).not.toBeInTheDocument();
  });

  it("rejects an invalid class context without requesting chapter data", async () => {
    mockChapterContext();
    mockedGetClasses.mockResolvedValue({ classes: [], total: 0 });
    renderPage();

    expect(await screen.findByText("Class not found")).toBeInTheDocument();
    expect(mockedGetChapter).not.toHaveBeenCalled();
    expect(mockedGetChapterTopics).not.toHaveBeenCalled();
  });

  it("rejects an invalid subject context without requesting chapter data", async () => {
    mockChapterContext();
    mockedGetClassSubjects.mockResolvedValue({ subjects: [], total: 0 });
    renderPage();

    expect(await screen.findByText("Subject not found")).toBeInTheDocument();
    expect(mockedGetChapter).not.toHaveBeenCalled();
    expect(mockedGetChapterTopics).not.toHaveBeenCalled();
  });

  it("shows an unavailable state when the subject has no matching structure", async () => {
    mockChapterContext();
    mockedGetDashboard.mockResolvedValue({
      ...dashboardFixture,
      curriculum_structures: [],
    });
    renderPage();

    expect(await screen.findByText("Chapter not available")).toBeInTheDocument();
    expect(mockedGetChapter).not.toHaveBeenCalled();
    expect(mockedGetChapterTopics).not.toHaveBeenCalled();
  });

  it("does not select a chapter structure when more than one matches", async () => {
    mockChapterContext();
    mockedGetDashboard.mockResolvedValue({
      ...dashboardFixture,
      curriculum_structures: [
        ...dashboardFixture.curriculum_structures,
        { id: "structure-2", class_id: "class-1", subject_id: "subject-1" },
      ],
    });
    renderPage();

    expect(await screen.findByText("Chapter unavailable")).toBeInTheDocument();
    expect(mockedGetChapter).not.toHaveBeenCalled();
    expect(mockedGetChapterTopics).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-subject", { subject_id: "subject-2" }],
    ["cross-structure", { curriculum_structure_id: "structure-2" }],
    ["non-chapter node", { node_type_code: "TOPIC" }],
  ])("rejects a %s chapter response", async (_name, change) => {
    mockChapterContext();
    mockedGetChapter.mockResolvedValue({
      chapter: { ...chapterFixture.chapter, ...change },
    });
    renderPage();

    expect(await screen.findByText("Chapter not available")).toBeInTheDocument();
    expect(screen.queryByText("Learn about real numbers.")).not.toBeInTheDocument();
    expect(mockedGetChapterTopics).not.toHaveBeenCalled();
  });
});
