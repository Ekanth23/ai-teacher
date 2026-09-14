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
import { getClasses, getClassSubjects } from "../services/api/learning";
import type { StudentClassSummary, SubjectSummary } from "../types/learning";

type SubjectContextState =
  | { status: "loading" }
  | { status: "success"; classContext: StudentClassSummary; subject: SubjectSummary }
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
      setState({ status: "success", classContext, subject });
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
            Curriculum
          </h2>
          <div className="mt-3">
            <EmptyState
              title="Chapters will appear here"
              description="Curriculum content for this subject is coming in a future update."
            />
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