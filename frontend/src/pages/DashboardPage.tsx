import { useCallback, useEffect, useState } from "react";
import { Container } from "../components/Container";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent } from "../components/ui/Card";
import { Skeleton, SkeletonCard } from "../components/ui/Skeleton";
import { ApiError } from "../services/api/errors";
import { getDashboard } from "../services/api/dashboard";
import type { DashboardResponse } from "../types/dashboard";

type DashboardState =
  | { status: "loading" }
  | { status: "success"; data: DashboardResponse }
  | { status: "error"; message: string };

export default function DashboardPage() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getDashboard();
      setState({ status: "success", data });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load your dashboard. Please try again.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Container className="py-8">
      {state.status === "loading" ? (
        <DashboardSkeleton />
      ) : state.status === "error" ? (
        <ErrorState
          title="We couldn't load your dashboard"
          description={state.message}
          onRetry={() => void load()}
        />
      ) : (
        <DashboardContent data={state.data} />
      )}
    </Container>
  );
}

function DashboardContent({ data }: { data: DashboardResponse }) {
  const { student, current_class: currentClass, subjects } = data;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome back, ${student.full_name}`}
        description="Continue your learning journey."
      />

      <section aria-labelledby="current-class-heading">
        <h2 id="current-class-heading" className="section-title">
          Current Class
        </h2>
        <div className="mt-3">
          {currentClass ? (
            <Card>
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-neutral-900">
                    {currentClass.name}
                  </p>
                  {currentClass.section ? (
                    <p className="caption">Section {currentClass.section}</p>
                  ) : null}
                </div>
                <Badge variant="primary">Current</Badge>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              title="No current class selected"
              description="Your learning class will appear here once it's available."
            />
          )}
        </div>
      </section>

      <section aria-labelledby="subjects-heading">
        <h2 id="subjects-heading" className="section-title">
          My Subjects
        </h2>
        <div className="mt-3">
          {subjects.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((subject) => (
                <li key={subject.id}>
                  <Card className="h-full">
                    <CardContent>
                      <h3 className="card-title">{subject.name}</h3>
                      {subject.code ? (
                        <p className="caption mt-1">{subject.code}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No subjects yet"
              description="Your subjects will appear here once they're available."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" className="space-y-8">
      <span className="sr-only">Loading your dashboard…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-44 max-w-full" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <SkeletonCard />
      </div>
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
