import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumb } from "../components/Breadcrumb";
import { Container } from "../components/Container";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent } from "../components/ui/Card";
import { Skeleton, SkeletonCard } from "../components/ui/Skeleton";
import { ApiError } from "../services/api/errors";
import { getDashboard } from "../services/api/dashboard";
import {
  getChapter,
  getChapterTopics,
  getClasses,
  getClassSubjects,
} from "../services/api/learning";
import { getLearningResourcesByNode } from "../services/api/resources";
import type { LearningResource } from "../types/dashboard";
import type {
  Chapter,
  StudentClassSummary,
  SubjectSummary,
  Topic,
} from "../types/learning";

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  TEXTBOOK: "Textbook",
  TEACHER_NOTES: "Teacher Notes",
  WORKSHEET: "Worksheet",
  ASSIGNMENT: "Assignment",
  QUESTION_BANK: "Question Bank",
  PREVIOUS_YEAR_PAPER: "Previous Year Paper",
  MOCK_TEST: "Mock Test",
  SYLLABUS_DOCUMENT: "Syllabus Document",
  FORMULA_SHEET: "Formula Sheet",
  OTHER: "Other",
};

function resourceTypeLabel(resourceType: string) {
  return RESOURCE_TYPE_LABELS[resourceType] ?? resourceType;
}

type TopicDetailState =
  | { status: "loading" }
  | {
      status: "success";
      classContext: StudentClassSummary;
      subject: SubjectSummary;
      chapter: Chapter;
      topic: Topic;
    }
  | { status: "unavailable"; title: string; description: string }
  | { status: "error"; message: string };

type ResourcesState =
  | { status: "loading" }
  | { status: "success"; resources: LearningResource[] }
  | { status: "empty" }
  | { status: "error"; message: string };

export default function TopicDetailPage() {
  const { classId, subjectId, chapterId, topicId } = useParams<{
    classId: string;
    subjectId: string;
    chapterId: string;
    topicId: string;
  }>();
  const [state, setState] = useState<TopicDetailState>({ status: "loading" });
  const [resources, setResources] = useState<ResourcesState>({
    status: "loading",
  });

  const loadResources = useCallback(async () => {
    if (!topicId) return;
    setResources({ status: "loading" });
    try {
      const data = await getLearningResourcesByNode(topicId);
      setResources(
        data.learningResources.length === 0
          ? { status: "empty" }
          : { status: "success", resources: data.learningResources },
      );
    } catch (error) {
      setResources({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load the learning resources. Please try again.",
      });
    }
  }, [topicId]);

  const load = useCallback(async () => {
    if (!classId || !subjectId || !chapterId || !topicId) {
      setState({
        status: "unavailable",
        title: "Topic not found",
        description: "This topic isn't available in this chapter.",
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const classData = await getClasses();
      const classContext = classData.classes.find((item) => item.id === classId);
      if (!classContext) {
        setState({
          status: "unavailable",
          title: "Class not found",
          description: "This class isn't available to your account.",
        });
        return;
      }

      const subjectData = await getClassSubjects(classId);
      const subject = subjectData.subjects.find((item) => item.id === subjectId);
      if (!subject) {
        setState({
          status: "unavailable",
          title: "Subject not found",
          description: "This subject isn't available in your class.",
        });
        return;
      }

      const dashboard = await getDashboard();
      const structures = dashboard.curriculum_structures.filter(
        (structure) =>
          structure.class_id === classId && structure.subject_id === subjectId,
      );
      if (structures.length === 0) {
        setState({
          status: "unavailable",
          title: "Topic not available",
          description: "There isn't a chapter structure available for this subject.",
        });
        return;
      }
      if (structures.length > 1) {
        setState({
          status: "unavailable",
          title: "Topic unavailable",
          description: "More than one chapter structure is available for this subject.",
        });
        return;
      }

      const chapter = (await getChapter(chapterId)).chapter;
      if (
        chapter.curriculum_structure_id !== structures[0].id ||
        chapter.subject_id !== subjectId ||
        chapter.node_type_code !== "CHAPTER"
      ) {
        setState({
          status: "unavailable",
          title: "Chapter not available",
          description: "This chapter isn't available in this subject.",
        });
        return;
      }

      const topicData = await getChapterTopics(chapterId);
      const topic = topicData.topics.find((item) => item.id === topicId);
      if (
        !topic ||
        topic.curriculum_structure_id !== structures[0].id ||
        topic.parent_node_id !== chapterId ||
        topic.node_type_code !== "TOPIC"
      ) {
        setState({
          status: "unavailable",
          title: "Topic not available",
          description: "This topic isn't available in this chapter.",
        });
        return;
      }

      setState({
        status: "success",
        classContext,
        subject,
        chapter,
        topic,
      });
      void loadResources();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({
          status: "unavailable",
          title: "Topic not found",
          description: "This topic isn't available in this chapter.",
        });
        return;
      }
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load this topic. Please try again.",
      });
    }
  }, [chapterId, classId, loadResources, subjectId, topicId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <Container className="py-8">
        <TopicDetailSkeleton />
      </Container>
    );
  }

  if (state.status === "error") {
    return (
      <Container className="py-8">
        <ErrorState
          title="We couldn't load this topic"
          description={state.message}
          onRetry={() => void load()}
        />
      </Container>
    );
  }

  if (state.status === "unavailable") {
    return (
      <Container className="py-8">
        <EmptyState title={state.title} description={state.description} />
      </Container>
    );
  }

  const { classContext, subject, chapter, topic } = state;

  return (
    <Container className="py-8">
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: "My Learning", href: "/learning" },
            { label: classContext.name, href: `/learning/${classContext.id}` },
            {
              label: subject.name,
              href: `/learning/${classContext.id}/subjects/${subject.id}`,
            },
            {
              label: chapter.title,
              href: `/learning/${classContext.id}/subjects/${subject.id}/chapters/${chapter.id}`,
            },
            { label: topic.title },
          ]}
        />
        <PageHeader title={topic.title} />
        <Card>
          <CardContent className="space-y-3">
            {topic.code ? <Badge variant="primary">{topic.code}</Badge> : null}
            {topic.description ? (
              <p className="secondary">{topic.description}</p>
            ) : null}
            <div>
              <Link
                to={`/ai-teacher?subject=${encodeURIComponent(subject.name)}&topic=${encodeURIComponent(topic.title)}`}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                Ask AI Teacher about this topic
              </Link>
            </div>
          </CardContent>
        </Card>
        <section aria-labelledby="resources-heading">
          <h2 id="resources-heading" className="section-title">
            Learning Resources
          </h2>
          <div className="mt-3">
            {resources.status === "loading" ? (
              <ResourcesSkeleton />
            ) : resources.status === "error" ? (
              <ErrorState
                title="We couldn't load the learning resources"
                description={resources.message}
                onRetry={() => void loadResources()}
              />
            ) : resources.status === "empty" ? (
              <EmptyState
                title="No resources yet"
                description="Learning resources for this topic will appear here once they're available."
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {resources.resources.map((resource) => (
                  <li key={resource.id}>
                    <Card className="h-full">
                      <CardContent className="flex h-full flex-col gap-3">
                        <div className="space-y-1">
                          <Badge variant="primary">
                            {resourceTypeLabel(resource.resource_type)}
                          </Badge>
                          <h3 className="card-title">{resource.title}</h3>
                          {resource.description ? (
                            <p className="secondary mt-1">{resource.description}</p>
                          ) : null}
                          {resource.file_name ? (
                            <p className="caption mt-1">{resource.file_name}</p>
                          ) : null}
                        </div>
                        <a
                          href={resource.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                          Open resource
                        </a>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </Container>
  );
}

function TopicDetailSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading topic…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-40 max-w-full" />
      </div>
      <SkeletonCard />
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}

function ResourcesSkeleton() {
  return (
    <div role="status" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <span className="sr-only">Loading learning resources…</span>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}