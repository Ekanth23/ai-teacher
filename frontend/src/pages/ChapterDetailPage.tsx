import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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
import { getChapter, getClasses, getClassSubjects } from "../services/api/learning";
import type { Chapter, StudentClassSummary, SubjectSummary } from "../types/learning";

type ChapterDetailState =
  | { status: "loading" }
  | {
      status: "success";
      classContext: StudentClassSummary;
      subject: SubjectSummary;
      chapter: Chapter;
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

      setState({ status: "success", classContext, subject, chapter });
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

  const { classContext, subject, chapter } = state;

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
    </div>
  );
}
