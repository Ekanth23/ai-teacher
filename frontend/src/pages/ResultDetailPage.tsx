import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Breadcrumb } from "../components/Breadcrumb";
import { Container } from "../components/Container";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Badge, type BadgeVariant } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Skeleton, SkeletonCard } from "../components/ui/Skeleton";
import { ApiError } from "../services/api/errors";
import {
  getAttemptResult,
  startPracticeAttempt,
} from "../services/api/practice";
import type {
  AttemptResultDetail,
  PracticeType,
  ResultQuestionReview,
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

/** Storage key for the newest started attempt, handed to the practice player. */
const ACTIVE_ATTEMPT_KEY = "ai-teacher:activeAttempt";

type ResultDetailState =
  | { status: "loading" }
  | { status: "success"; result: AttemptResultDetail }
  | { status: "unavailable"; title: string; description: string }
  | { status: "error"; message: string };

type TryAgainState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "error"; message: string };

function formatSubmittedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function correctnessLabel(review: ResultQuestionReview): string {
  if (review.selected_option === null) return "Unanswered";
  return review.is_correct ? "Correct" : "Incorrect";
}

export default function ResultDetailPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<ResultDetailState>({ status: "loading" });
  const [retry, setRetry] = useState<TryAgainState>({ status: "idle" });

  const load = useCallback(async () => {
    if (!attemptId) {
      setState({
        status: "unavailable",
        title: "Result unavailable",
        description:
          "This result link is incomplete. Open a result from the Results page.",
      });
      return;
    }
    setState({ status: "loading" });
    try {
      const result = await getAttemptResult(attemptId);
      setState({ status: "success", result });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({
          status: "unavailable",
          title: "Result unavailable",
          description:
            "This result isn't available. Only submitted attempts can be reviewed.",
        });
        return;
      }
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load this result. Please try again.",
      });
    }
  }, [attemptId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleTryAgain = useCallback(async () => {
    if (state.status !== "success") return;
    if (retry.status === "starting") return;
    const practiceId = state.result.practice.id;
    setRetry({ status: "starting" });
    try {
      const data = await startPracticeAttempt(practiceId);
      sessionStorage.setItem(
        ACTIVE_ATTEMPT_KEY,
        JSON.stringify({ attemptId: data.attempt.id, practiceId }),
      );
      navigate(`/practice/${practiceId}/attempt/${data.attempt.id}`);
    } catch (error) {
      setRetry({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't start a new attempt. Please try again.",
      });
    }
  }, [state, retry.status, navigate]);

  if (state.status === "loading") {
    return (
      <Container className="py-8">
        <ResultDetailSkeleton />
      </Container>
    );
  }

  if (state.status === "error") {
    return (
      <Container className="py-8">
        <ErrorState
          title="We couldn't load this result"
          description={state.message}
          onRetry={() => void load()}
        />
      </Container>
    );
  }

  if (state.status === "unavailable") {
    return (
      <Container className="py-8">
        <EmptyState
          title={state.title}
          description={state.description}
          action={
            <Link
              to="/results"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              Back to Results
            </Link>
          }
        />
      </Container>
    );
  }

  const { result } = state;

  return (
    <Container className="py-8">
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: "Results", href: "/results" },
            { label: result.practice.title },
          ]}
        />
        <PageHeader title={result.practice.title} />

        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={PRACTICE_TYPE_BADGE[result.practice.practice_type]}
              >
                {PRACTICE_TYPE_LABELS[result.practice.practice_type]}
              </Badge>
              {result.practice.topic ? (
                <span className="caption">{result.practice.topic}</span>
              ) : null}
            </div>
            <p className="text-2xl font-bold text-neutral-900">
              {result.score} of {result.max_score} · {result.percentage}%
            </p>
            <p className="secondary">
              {result.correct_count} correct · {result.incorrect_count}{" "}
              incorrect · {result.unanswered_count} unanswered
            </p>
            <p className="caption">
              Submitted {formatSubmittedAt(result.submitted_at)}
            </p>
          </CardContent>
        </Card>

        <section aria-labelledby="review-heading">
          <h2 id="review-heading" className="section-title">
            Question review
          </h2>
          <ul className="mt-3 space-y-4">
            {result.questions.map((review, position) => (
              <li key={review.question_id}>
                <Card className="h-full">
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-base font-semibold text-neutral-900">
                        <span className="mr-1">{position + 1}.</span>
                        <span>{review.question_text}</span>
                      </h3>
                      <Badge
                        variant={
                          review.selected_option === null
                            ? "primary"
                            : review.is_correct
                              ? "success"
                              : "info"
                        }
                      >
                        {correctnessLabel(review)}
                      </Badge>
                    </div>
                    <ul className="space-y-2">
                      {review.options.map((option) => {
                        const isSelected =
                          review.selected_option === option.key;
                        const isCorrect = review.correct_option === option.key;
                        return (
                          <li
                            key={option.key}
                            className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800"
                          >
                            <span className="font-medium text-neutral-500">
                              {option.key}.
                            </span>
                            <span className="ml-1">{option.text}</span>
                            {isSelected ? (
                              <span className="caption ml-2">
                                · Your answer
                              </span>
                            ) : null}
                            {isCorrect ? (
                              <span className="caption ml-2">
                                · Correct answer
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    {review.selected_option === null ? (
                      <p className="caption">You did not answer this question.</p>
                    ) : null}
                    <p className="caption">
                      {review.awarded_marks} of {review.marks}{" "}
                      {review.marks === 1 ? "mark" : "marks"}
                    </p>
                    {review.explanation ? (
                      <p className="secondary text-sm">
                        <span className="font-medium text-neutral-900">
                          Explanation:{" "}
                        </span>
                        {review.explanation}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <Card>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                to="/results"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                Back to Results
              </Link>
              <Link
                to="/practice"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                Back to Practice
              </Link>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <Button
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
                loading={retry.status === "starting"}
                onClick={() => void handleTryAgain()}
              >
                Try Again
              </Button>
              {retry.status === "error" ? (
                <p role="alert" className="text-sm font-medium text-error">
                  {retry.message}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}

function ResultDetailSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading this result…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-40 max-w-full" />
      </div>
      <SkeletonCard />
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
