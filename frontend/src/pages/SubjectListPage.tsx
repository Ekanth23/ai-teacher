import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumb } from "../components/Breadcrumb";
import { Container } from "../components/Container";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent } from "../components/ui/Card";
import { Skeleton, SkeletonCard } from "../components/ui/Skeleton";
import { ApiError } from "../services/api/errors";
import { getClasses, getClassSubjects } from "../services/api/learning";
import type { StudentClassSummary, SubjectSummary } from "../types/learning";

type SubjectListState =
  | { status: "loading" }
  | { status: "success"; classContext: StudentClassSummary; subjects: SubjectSummary[] }
  | { status: "notfound" }
  | { status: "error"; message: string };

const classTitle = (classContext: StudentClassSummary) => classContext.name;
const classSubtitle = (classContext: StudentClassSummary) =>
  classContext.section ? `Section ${classContext.section}` : null;

export default function SubjectListPage() {
  const { classId } = useParams<{ classId: string }>();
  const [state, setState] = useState<SubjectListState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!classId) {
      setState({ status: "notfound" });
      return;
    }
    setState({ status: "loading" });
    try {
      const classData = await getClasses();
      const classContext = classData.classes.find((c) => c.id === classId) ?? null;
      if (!classContext) {
        setState({ status: "notfound" });
        return;
      }
      const subjectData = await getClassSubjects(classId);
      setState({ status: "success", classContext, subjects: subjectData.subjects });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load this class. Please try again.",
      });
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <Container className="py-8">
        <SubjectListSkeleton />
      </Container>
    );
  }

  if (state.status === "error") {
    return (
      <Container className="py-8">
        <ErrorState
          title="We couldn't load this class"
          description={state.message}
          onRetry={() => void load()}
        />
      </Container>
    );
  }

  if (state.status === "notfound") {
    return (
      <Container className="py-8">
        <ErrorState
          title="Class not found"
          description="This class isn't available to your account."
        />
      </Container>
    );
  }

  const { classContext, subjects } = state;
  const title = classTitle(classContext);
  const subtitle = classSubtitle(classContext);

  return (
    <Container className="py-8">
      <div className="space-y-6">
        <Breadcrumb
          items={[{ label: "My Learning", href: "/learning" }, { label: title }]}
        />
        <PageHeader
          title={title}
          description={subtitle ?? "Your subjects for this class."}
        />
        {subjects.length === 0 ? (
          <EmptyState
            title="No subjects yet"
            description="Your subjects will appear here once they're available."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((subject) => (
              <li key={subject.id}>
                <Link
                  to={`/learning/${classContext.id}/subjects/${subject.id}`}
                  className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <Card className="h-full transition-colors hover:border-primary-300">
                    <CardContent>
                      <h3 className="card-title">{subject.name}</h3>
                      {subject.code ? (
                        <p className="caption mt-1">{subject.code}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Container>
  );
}

function SubjectListSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading subjects…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-40 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}