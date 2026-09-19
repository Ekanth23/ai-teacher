import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TopicDetailPage from "../pages/TopicDetailPage";
import { getDashboard } from "../services/api/dashboard";
import { ApiError } from "../services/api/errors";
import {
  getChapter,
  getChapterTopics,
  getClasses,
  getClassSubjects,
} from "../services/api/learning";
import { getLearningResourcesByNode } from "../services/api/resources";
import type { DashboardResponse } from "../types/dashboard";
import type {
  ChapterResponse,
  ChapterTopicsResponse,
  ClassListResponse,
  ClassSubjectsResponse,
  LearningResourcesResponse,
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

vi.mock("../services/api/resources", () => ({
  getLearningResourcesByNode: vi.fn(),
}));

const mockedGetChapter = vi.mocked(getChapter);
const mockedGetChapterTopics = vi.mocked(getChapterTopics);
const mockedGetClasses = vi.mocked(getClasses);
const mockedGetClassSubjects = vi.mocked(getClassSubjects);
const mockedGetDashboard = vi.mocked(getDashboard);
const mockedGetLearningResourcesByNode = vi.mocked(getLearningResourcesByNode);

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

const resourcesFixture: LearningResourcesResponse = {
  learningResources: [
    {
      id: "resource-1",
      resource_type: "WORKSHEET",
      title: "Integers Practice Sheet",
      description: "Practice operations on integers.",
      language_code: "en",
      file_url: "https://cdn.example.com/integers-worksheet.pdf",
      file_name: "integers-worksheet.pdf",
      mime_type: "application/pdf",
      file_size_bytes: 102400,
      curriculum_node_id: "topic-1",
      class_id: null,
    },
  ],
  total: 1,
};

function mockTopicContext() {
  mockedGetClasses.mockResolvedValue(classesFixture);
  mockedGetClassSubjects.mockResolvedValue(subjectsFixture);
  mockedGetDashboard.mockResolvedValue(dashboardFixture);
  mockedGetChapter.mockResolvedValue(chapterFixture);
  mockedGetChapterTopics.mockResolvedValue(topicsFixture);
  mockedGetLearningResourcesByNode.mockResolvedValue(resourcesFixture);
}

function renderPage(
  route = "/learning/class-1/subjects/subject-1/chapters/chapter-1/topics/topic-1",
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/learning/:classId/subjects/:subjectId/chapters/:chapterId/topics/:topicId"
          element={<TopicDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Topic Detail (TopicDetailPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the topic's canonical fields and five-level breadcrumb", async () => {
    mockTopicContext();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Integers" })).toBeInTheDocument();
    expect(screen.getByText("T-1")).toBeInTheDocument();
    expect(screen.getByText("Operations on integers.")).toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("My Learning");
    expect(breadcrumb).toHaveTextContent("Grade 8");
    expect(breadcrumb).toHaveTextContent("Mathematics");
    expect(breadcrumb).toHaveTextContent("Number Systems");
    expect(breadcrumb).toHaveTextContent("Integers");
    expect(screen.getByRole("link", { name: "Number Systems" })).toHaveAttribute(
      "href",
      "/learning/class-1/subjects/subject-1/chapters/chapter-1",
    );
    expect(screen.getByText("Integers", { selector: "[aria-current=page]" })).toBeInTheDocument();
  });

  it("renders the published learning resources linked to the topic", async () => {
    mockTopicContext();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Learning Resources" })).toBeInTheDocument();
    expect(mockedGetLearningResourcesByNode).toHaveBeenCalledWith("topic-1");
    expect(screen.getByRole("heading", { name: "Integers Practice Sheet" })).toBeInTheDocument();
    expect(screen.getByText("Worksheet")).toBeInTheDocument();
    expect(screen.getByText("Practice operations on integers.")).toBeInTheDocument();
    expect(screen.getByText("integers-worksheet.pdf")).toBeInTheDocument();

    const openLink = screen.getByRole("link", { name: "Open resource" });
    expect(openLink).toHaveAttribute(
      "href",
      "https://cdn.example.com/integers-worksheet.pdf",
    );
    expect(openLink).toHaveAttribute("target", "_blank");
    expect(openLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows an empty state when the topic has no eligible resources", async () => {
    mockTopicContext();
    mockedGetLearningResourcesByNode.mockResolvedValue({
      learningResources: [],
      total: 0,
    });
    renderPage();

    expect(await screen.findByText("No resources yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Integers Practice Sheet" }),
    ).not.toBeInTheDocument();
  });

  it("shows a resource API error and retries only the resource request", async () => {
    const user = userEvent.setup();
    mockTopicContext();
    mockedGetLearningResourcesByNode
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0))
      .mockResolvedValueOnce(resourcesFixture);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Integers" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(
      await screen.findByRole("heading", { name: "Integers Practice Sheet" }),
    ).toBeInTheDocument();
  });

  it("does not request resources when the topic context is invalid", async () => {
    mockTopicContext();
    mockedGetClasses.mockResolvedValue({ classes: [], total: 0 });
    renderPage();

    expect(await screen.findByText("Class not found")).toBeInTheDocument();
    expect(mockedGetLearningResourcesByNode).not.toHaveBeenCalled();
  });

  it("does not request resources when the chapter is not found", async () => {
    mockTopicContext();
    mockedGetChapter.mockRejectedValue(new ApiError("NOT_FOUND", "Chapter was not found.", 404));
    renderPage();

    expect(await screen.findByText("Topic not found")).toBeInTheDocument();
    expect(mockedGetLearningResourcesByNode).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-topic node", { node_type_code: "CHAPTER" }],
    ["a parent chapter mismatch", { parent_node_id: "chapter-2" }],
  ])("rejects a topic with %s", async (_name, change) => {
    mockTopicContext();
    mockedGetChapterTopics.mockResolvedValue({
      topics: [{ ...topicsFixture.topics[0], ...change }],
      total: 1,
    });
    renderPage();

    expect(await screen.findByText("Topic not available")).toBeInTheDocument();
    expect(mockedGetLearningResourcesByNode).not.toHaveBeenCalled();
  });

  it("shows a loading status while fetching", () => {
    mockedGetClasses.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading topic…");
  });

  it("links to AI Teacher with only the supported subject/topic context", async () => {
    mockTopicContext();
    renderPage();

    const link = await screen.findByRole("link", {
      name: "Ask AI Teacher about this topic",
    });
    expect(link).toHaveAttribute(
      "href",
      "/ai-teacher?subject=Mathematics&topic=Integers",
    );
    expect(link.getAttribute("href")).not.toContain("student_id");
    expect(link.getAttribute("href")).not.toContain("organization_id");
  });
});