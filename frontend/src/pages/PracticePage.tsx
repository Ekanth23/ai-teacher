import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Container } from "../components/Container";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Badge, type BadgeVariant } from "../components/ui/Badge";
import { Card, CardContent } from "../components/ui/Card";
import { Skeleton, SkeletonCard } from "../components/ui/Skeleton";
import { ApiError } from "../services/api/errors";
import { getPractices } from "../services/api/practice";
import type { PracticeSummary, PracticeType } from "../types/practice";

const PRACTICE_TYPE_BADGE: Record<PracticeType, BadgeVariant> = {
  PRACTICE: "primary",
  QUIZ: "info",
  SELF_ASSESSMENT: "success",
};

const PRACTICE_TYPE_LABELS: Record<PracticeType, string> = {
  PRACTICE: "Practice",
  QUIZ: "Quiz",
  SELF_ASSESSMENT: "Self-assessment",
};

type PracticeState =
  | { status: "loading" }
  | { status: "success"; practices: PracticeSummary[] }
  | { status: "error"; message: string };

export default function PracticePage() {
  const [state, setState] = useState<PracticeState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getPractices();
      setState({ status: "success", practices: data.practices });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load your practices. Please try again.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Container className="py-8">
      {state.status === "loading" ? (
        <PracticeSkeleton />
      ) : state.status === "error" ? (
        <ErrorState
          title="We couldn't load your practices"
          description={state.message}
          onRetry={() => void load()}
        />
      ) : (
        <div className="space-y-6">
          <PageHeader
            title="Practice"
            description="Question sets available to your class."
          />
          {state.practices.length === 0 ? (
            <EmptyState
              title="No practices yet"
              description="Practices you can attempt will show up here."
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.practices.map((practice) => (
                <li key={practice.id}>
                  <Link
                    to={`/practice/${practice.id}`}
                    className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <Card className="flex h-full flex-col transition-colors hover:border-primary-300">
                      <CardContent className="flex h-full flex-col gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={PRACTICE_TYPE_BADGE[practice.practice_type]}>
                              {PRACTICE_TYPE_LABELS[practice.practice_type]}
                            </Badge>
                            <span className="caption">{practice.topic.name}</span>
                          </div>
                          <h3 className="card-title">{practice.title}</h3>
                          {practice.description ? (
                            <p className="secondary mt-1">{practice.description}</p>
                          ) : null}
                        </div>
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

function PracticeSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading your practices…</span>
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