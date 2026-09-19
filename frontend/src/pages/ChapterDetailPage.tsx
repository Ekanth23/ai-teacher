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
import type {
  Chapter,
  StudentClassSummary,
  SubjectSummary,
  Topic,
} from "../types/learning";

type ChapterDetailState =
  | { status: "loading" }
  | {
      status: "success";
      classContext: StudentClassSummary;
      subject: SubjectSummary;
      chapter: Chapter;
      topics: Topic[];
    }
  | { status: "unavailable"; title: string; description: string }
  | { status: "error"; message: string };

export default function ChapterDetailPage() {
  const { classId, subjectId, chapterId } = useParams<{
    classId: string;
    subjectId: string;
    chapterId: string;
  }>();
  const [state, setState] = useState<ChapterDetailState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!classId || !subjectId || !chapterId) {
      setState({
        status: "unavailable",
        title: "Chapter not found",
        description: "This chapter isn't available in this subject.",
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
          title: "Chapter not available",
          description: "There isn't a chapter structure available for this subject.",
        });
        return;
      }
      if (structures.length > 1) {
        setState({
          status: "unavailable",
          title: "Chapter unavailable",
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

      setState({
        status: "success",
        classContext,
        subject,
        chapter,
        topics: topicData.topics,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({
          status: "unavailable",
          title: "Chapter not found",
          description: "This chapter isn't available in this subject.",
        });
        return;
      }
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load this chapter. Please try again.",
      });
    }
  }, [chapterId, classId, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <Container className="py-8">
        <ChapterDetailSkeleton />
      </Container>
    );
  }

  if (state.status === "error") {
    return (
      <Container className="py-8">
        <ErrorState
          title="We couldn't load this chapter"
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

  const { classContext, subject, chapter, topics } = state;

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
            { label: chapter.title },
          ]}
        />
        <PageHeader title={chapter.title} />
        <Card>
          <CardContent className="space-y-3">
            {chapter.code ? <Badge variant="primary">{chapter.code}</Badge> : null}
            {chapter.description ? (
              <p className="secondary">{chapter.description}</p>
            ) : null}
          </CardContent>
        </Card>
        <section aria-labelledby="topics-heading">
          <h2 id="topics-heading" className="section-title">
            Topics
          </h2>
          <div className="mt-3">
            {topics.length === 0 ? (
              <EmptyState
                title="No topics yet"
                description="Topics for this chapter will appear here once they're available."
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {topics.map((topic) => (
                  <li key={topic.id}>
                    <Link
                      to={`/learning/${classContext.id}/subjects/${subject.id}/chapters/${chapter.id}/topics/${topic.id}`}
                      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <Card className="h-full transition-colors hover:border-primary-300">
                        <CardContent>
                          <h3 className="card-title">{topic.title}</h3>
                          {topic.code ? (
                            <p className="caption mt-1">{topic.code}</p>
                          ) : null}
                          {topic.description ? (
                            <p className="secondary mt-2">{topic.description}</p>
                          ) : null}
                        </CardContent>
                      </Card>
                    </Link>
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

function ChapterDetailSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading chapter…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-40 max-w-full" />
      </div>
      <SkeletonCard />
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
