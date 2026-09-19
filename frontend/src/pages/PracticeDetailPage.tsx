import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { getPractice, startPracticeAttempt } from "../services/api/practice";
import type { PracticeDetail, PracticeType } from "../types/practice";

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

type PracticeDetailState =
  | { status: "loading" }
  | { status: "success"; practice: PracticeDetail }
  | { status: "unavailable"; title: string; description: string }
  | { status: "error"; message: string };

type StartState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "started"; attemptId: string }
  | { status: "error"; message: string };

export default function PracticeDetailPage() {
  const { practiceId } = useParams<{ practiceId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<PracticeDetailState>({ status: "loading" });
  const [start, setStart] = useState<StartState>({ status: "idle" });

  const load = useCallback(async () => {
    if (!practiceId) {
      setState({
        status: "unavailable",
        title: "Practice unavailable",
        description: "This practice isn't available to your account.",
      });
      return;
    }
    setState({ status: "loading" });
    try {
      const data = await getPractice(practiceId);
      setState({ status: "success", practice: data.practice });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({
          status: "unavailable",
          title: "Practice unavailable",
          description:
            "This practice isn't published or isn't available to your account.",
        });
        return;
      }
      setState({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load this practice. Please try again.",
      });
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStart = useCallback(async () => {
    if (start.status === "starting" || start.status === "started") return;
    if (!practiceId) return;
    setStart({ status: "starting" });
    try {
      const data = await startPracticeAttempt(practiceId);
      sessionStorage.setItem(
        ACTIVE_ATTEMPT_KEY,
        JSON.stringify({
          attemptId: data.attempt.id,
          practiceId,
        }),
      );
      setStart({ status: "started", attemptId: data.attempt.id });
      navigate(`/practice/${practiceId}/attempt/${data.attempt.id}`);
    } catch (error) {
      setStart({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't start this practice. Please try again.",
      });
    }
  }, [practiceId, start.status, navigate]);

  if (state.status === "loading") {
    return (
      <Container className="py-8">
        <PracticeDetailSkeleton />
      </Container>
    );
  }

  if (state.status === "error") {
    return (
      <Container className="py-8">
        <ErrorState
          title="We couldn't load this practice"
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

  const { practice } = state;

  return (
    <Container className="py-8">
      <div className="space-y-6">
        <Breadcrumb
          items={[{ label: "Practice", href: "/practice" }, { label: practice.title }]}
        />
        <PageHeader title={practice.title} />
        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={PRACTICE_TYPE_BADGE[practice.practice_type]}>
                {PRACTICE_TYPE_LABELS[practice.practice_type]}
              </Badge>
              <span className="caption">
                {practice.topic.name} · {practice.question_count}{" "}
                {practice.question_count === 1 ? "question" : "questions"}
              </span>
            </div>
            {practice.description ? (
              <p className="secondary">{practice.description}</p>
            ) : null}
          </CardContent>
        </Card>
        <section aria-labelledby="questions-preview-heading">
          <h2 id="questions-preview-heading" className="section-title">
            Questions
          </h2>
          <p className="secondary mt-1">
            Preview only — answers are only revealed after you submit.
          </p>
          <ul className="mt-3 space-y-4">
            {practice.questions.map((question) => (
              <li key={question.id}>
                <Card className="h-full">
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-base font-semibold text-neutral-900">
                        <span className="mr-1">{question.sequence_number}.</span>
                        <span>{question.question_text}</span>
                      </p>
                      <span className="caption shrink-0">
                        {question.marks} {question.marks === 1 ? "mark" : "marks"}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {question.options.map((option) => (
                        <li
                          key={option.key}
                          className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800"
                        >
                          <span className="font-medium text-neutral-500">
                            {option.key}.
                          </span>
                          <span className="ml-1">{option.text}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
        <Card>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-base font-semibold text-neutral-900">Ready?</p>
              <p className="caption">
                Starting creates an attempt you can answer and submit.
              </p>
            </div>
            {start.status === "started" ? (
              <p role="status" className="text-sm font-medium text-success-content">
                Practice started — your attempt id is {start.attemptId}.
              </p>
            ) : (
              <div className="flex flex-col items-stretch gap-3 sm:items-end">
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full sm:w-auto"
                  loading={start.status === "starting"}
                  onClick={() => void handleStart()}
                >
                  Start Practice
                </Button>
                {start.status === "error" ? (
                  <p role="alert" className="text-sm font-medium text-error">
                    {start.message}
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}

function PracticeDetailSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading practice…</span>
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