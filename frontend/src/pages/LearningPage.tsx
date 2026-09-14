import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Container } from "../components/Container";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent } from "../components/ui/Card";
import { Skeleton, SkeletonCard } from "../components/ui/Skeleton";
import { ApiError } from "../services/api/errors";
import { getClasses } from "../services/api/learning";
import type { StudentClassSummary } from "../types/learning";

type LearningState =
  | { status: "loading" }
  | { status: "success"; classes: StudentClassSummary[] }
  | { status: "error"; message: string };

export default function LearningPage() {
  const [state, setState] = useState<LearningState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getClasses();
      setState({ status: "success", classes: data.classes });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load your classes. Please try again.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Container className="py-8">
      {state.status === "loading" ? (
        <LearningSkeleton />
      ) : state.status === "error" ? (
        <ErrorState
          title="We couldn't load your classes"
          description={state.message}
          onRetry={() => void load()}
        />
      ) : (
        <div className="space-y-6">
          <PageHeader
            title="My Learning"
            description="Your enrolled classes."
          />
          {state.classes.length === 0 ? (
            <EmptyState
              title="No classes yet"
              description="Your enrolled classes will appear here once they're available."
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.classes.map((classItem, index) => (
                <li key={classItem.id}>
                  <Link
                    to={`/learning/${classItem.id}`}
                    className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <Card className="h-full transition-colors hover:border-primary-300">
                      <CardContent className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-neutral-900">
                            {classItem.name}
                          </p>
                          {classItem.section ? (
                            <p className="caption">Section {classItem.section}</p>
                          ) : null}
                        </div>
                        {index === 0 ? (
                          <Badge variant="primary">Current</Badge>
                        ) : null}
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Container>
  );
}

function LearningSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading your classes…</span>
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
