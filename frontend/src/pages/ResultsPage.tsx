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
import { getResults } from "../services/api/practice";
import type {
  AttemptResultSummary,
  PracticeType,
} from "../types/practice";

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

type ResultsState =
  | { status: "loading" }
  | { status: "success"; results: AttemptResultSummary[] }
  | { status: "error"; message: string };

function formatSubmittedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ResultsPage() {
  const [state, setState] = useState<ResultsState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getResults();
      setState({ status: "success", results: data.results });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load your results. Please try again.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Container className="py-8">
      {state.status === "loading" ? (
        <ResultsSkeleton />
      ) : state.status === "error" ? (
        <ErrorState
          title="We couldn't load your results"
          description={state.message}
          onRetry={() => void load()}
        />
      ) : (
        <div className="space-y-6">
          <PageHeader
            title="Results"
            description="Your submitted practice results, newest first."
          />
          {state.results.length === 0 ? (
            <EmptyState
              title="No results yet"
              description="Results appear here after you submit a practice. Start a practice to see how you did."
              action={
                <Link
                  to="/practice"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  Browse Practice
                </Link>
              }
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.results.map((result) => (
                <li key={result.id}>
                  <Link
                    to={`/results/${result.id}`}
                    aria-label={`${result.practice.title}: ${result.score} of ${result.max_score}, ${result.percentage} percent`}
                    className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <Card className="flex h-full flex-col transition-colors hover:border-primary-300">
                      <CardContent className="flex h-full flex-col gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                PRACTICE_TYPE_BADGE[result.practice.practice_type]
                              }
                            >
                              {
                                PRACTICE_TYPE_LABELS[
                                  result.practice.practice_type
                                ]
                              }
                            </Badge>
                            {result.practice.topic ? (
                              <span className="caption">
                                {result.practice.topic}
                              </span>
                            ) : null}
                          </div>
                          <h3 className="card-title">
                            {result.practice.title}
                          </h3>
                        </div>
                        <p className="text-base font-semibold text-neutral-900">
                          {result.score} of {result.max_score} ·{" "}
                          {result.percentage}%
                        </p>
                        <p className="caption">
                          {result.correct_count} correct ·{" "}
                          {result.incorrect_count} incorrect ·{" "}
                          {result.unanswered_count} unanswered
                        </p>
                        <p className="caption mt-auto">
                          Submitted {formatSubmittedAt(result.submitted_at)}
                        </p>
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

function ResultsSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading your results…</span>
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
