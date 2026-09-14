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
import { getClasses, getClassSubjects, getStructureChapters } from "../services/api/learning";
import type { Chapter, StudentClassSummary, SubjectSummary } from "../types/learning";

type SubjectContextState =
  | { status: "loading" }
  | {
      status: "success";
      classContext: StudentClassSummary;
      subject: SubjectSummary;
      chapters: Chapter[];
    }
  | { status: "no-structure"; classContext: StudentClassSummary; subject: SubjectSummary }
  | { status: "ambiguous-structure"; classContext: StudentClassSummary; subject: SubjectSummary }
  | { status: "notfound"; title: string; description: string }
  | { status: "error"; message: string };

export default function SubjectContextPage() {
  const { classId, subjectId } = useParams<{ classId: string; subjectId: string }>();
  const [state, setState] = useState<SubjectContextState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!classId || !subjectId) {
      setState({
        status: "notfound",
        title: "Subject not found",
        description: "This subject isn't available in your class.",
      });
      return;
    }
    setState({ status: "loading" });
    try {
      const classData = await getClasses();
      const classContext = classData.classes.find((c) => c.id === classId) ?? null;
      if (!classContext) {
        setState({
          status: "notfound",
          title: "Class not found",
          description: "This class isn't available to your account.",
        });
        return;
      }
      const subjectData = await getClassSubjects(classId);
      const subject = subjectData.subjects.find((s) => s.id === subjectId) ?? null;
      if (!subject) {
        setState({
          status: "notfound",
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
        setState({ status: "no-structure", classContext, subject });
        return;
      }
      if (structures.length > 1) {
        setState({ status: "ambiguous-structure", classContext, subject });
        return;
      }
      const chapterData = await getStructureChapters(structures[0].id);
      setState({
        status: "success",
        classContext,
        subject,
        chapters: chapterData.chapters,
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load this subject. Please try again.",
      });
    }
  }, [classId, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <Container className="py-8">
        <SubjectContextSkeleton />
      </Container>
    );
  }

  if (state.status === "error") {
    return (
      <Container className="py-8">
        <ErrorState
          title="We couldn't load this subject"
          description={state.message}
          onRetry={() => void load()}
        />
      </Container>
    );
  }

  if (state.status === "notfound") {
    return (
      <Container className="py-8">
        <ErrorState title={state.title} description={state.description} />
      </Container>
    );
  }

  const { classContext, subject } = state;
  const title = classContext.name;
  const subtitle = classContext.section ? `Section ${classContext.section}` : null;

  return (
    <Container className="py-8">
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: "My Learning", href: "/learning" },
            { label: title, href: `/learning/${classContext.id}` },
            { label: subject.name },
          ]}
        />
        <PageHeader title={subject.name} description={`${title}${subtitle ? ` · ${subtitle}` : ""}`} />
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="secondary">Class</p>
              <p className="text-base font-semibold text-neutral-900">{title}</p>
              {subtitle ? <p className="caption">{subtitle}</p> : null}
            </div>
            {subject.code ? <Badge variant="primary">{subject.code}</Badge> : null}
          </CardContent>
        </Card>
        <section aria-labelledby="curriculum-heading">
          <h2 id="curriculum-heading" className="section-title">
            Chapters
          </h2>
          <div className="mt-3">
            {state.status === "no-structure" ? (
              <EmptyState
                title="No chapters available"
                description="There isn't a chapter structure available for this subject."
              />
            ) : state.status === "ambiguous-structure" ? (
              <ErrorState
                title="Chapters unavailable"
                description="More than one chapter structure is available for this subject."
              />
            ) : state.chapters.length === 0 ? (
              <EmptyState
                title="No chapters yet"
                description="Chapters for this subject will appear here once they're available."
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.chapters.map((chapter) => (
                  <li key={chapter.id}>
                    <Link
                      to={`/learning/${classContext.id}/subjects/${subject.id}/chapters/${chapter.id}`}
                      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <Card className="h-full transition-colors hover:border-primary-300">
                        <CardContent>
                          <h3 className="card-title">{chapter.title}</h3>
                          {chapter.code ? (
                            <p className="caption mt-1">{chapter.code}</p>
                          ) : null}
                          {chapter.description ? (
                            <p className="secondary mt-2">{chapter.description}</p>
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

function SubjectContextSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading subject…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-40 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}