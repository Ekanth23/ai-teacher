import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumb } from "../components/Breadcrumb";
import { Container } from "../components/Container";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Skeleton, SkeletonCard } from "../components/ui/Skeleton";
import { ApiError } from "../services/api/errors";
import {
  getPractice,
  saveAttemptAnswers,
  submitAttempt,
} from "../services/api/practice";
import type { PracticeDetail, PracticeQuestion } from "../types/practice";

type LoadState =
  | { status: "loading" }
  | { status: "success"; practice: PracticeDetail }
  | { status: "unavailable"; title: string; description: string }
  | { status: "error"; message: string };

type QuestionSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

type SubmitState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "submitting" }
  | { status: "submitted" }
  | { status: "error"; message: string };

function unavailableAttempt(
  title: string,
  description: string,
): Extract<LoadState, { status: "unavailable" }> {
  return { status: "unavailable", title, description };
}

export default function AttemptPage() {
  const { practiceId, attemptId } = useParams<{
    practiceId: string;
    attemptId: string;
  }>();

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [index, setIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [saves, setSaves] = useState<Record<string, QuestionSaveState>>({});
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  // Tracks the option key last sent to the backend per question so a change
  // made while a save is in flight triggers exactly one follow-up save.
  const lastSentRef = useRef<Record<string, string>>({});
  const savingRef = useRef<Set<string>>(new Set());
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const fetchPractice = useCallback(async () => {
    if (!practiceId || !attemptId) {
      setLoad(
        unavailableAttempt(
          "Attempt unavailable",
          "This attempt link is incomplete. Start the practice again from its detail page.",
        ),
      );
      return;
    }
    setLoad({ status: "loading" });
    try {
      const data = await getPractice(practiceId);
      setLoad({ status: "success", practice: data.practice });
      setIndex(0);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setLoad(
          unavailableAttempt(
            "Practice unavailable",
            "This practice isn't published or isn't available to your account.",
          ),
        );
        return;
      }
      setLoad({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load this attempt. Please try again.",
      });
    }
  }, [practiceId, attemptId]);

  useEffect(() => {
    void fetchPractice();
  }, [fetchPractice]);

  const questions: PracticeQuestion[] = useMemo(() => {
    if (load.status !== "success") return [];
    return [...load.practice.questions].sort(
      (a, b) => a.sequence_number - b.sequence_number,
    );
  }, [load]);

  const answeredCount = useMemo(
    () =>
      questions.filter((question) => selections[question.id] !== undefined)
        .length,
    [questions, selections],
  );

  // Mirror of selections for use inside the async save loop.
  const selectionsRef = useRef<Record<string, string>>({});
  selectionsRef.current = selections;

  const persistAnswer = useCallback(
    async (questionId: string) => {
      if (!attemptId) return;
      if (savingRef.current.has(questionId)) return;
      savingRef.current.add(questionId);
      setSaves((prev) => ({ ...prev, [questionId]: { status: "saving" } }));
      try {
        // Keep sending the latest local selection until it matches what the
        // backend has acknowledged (covers changes made mid-save).
        while (
          lastSentRef.current[questionId] !== selectionsRef.current[questionId]
        ) {
          const latest = selectionsRef.current[questionId];
          if (latest === undefined) break;
          await saveAttemptAnswers(attemptId, {
            answers: [{ question_id: questionId, selected_option: latest }],
          });
          lastSentRef.current[questionId] = latest;
        }
        setSaves((prev) => ({ ...prev, [questionId]: { status: "saved" } }));
      } catch (error) {
        const message =
          error instanceof ApiError && error.status === 404
            ? "This attempt is no longer available. It may already be submitted."
            : error instanceof ApiError
              ? error.message
              : "We couldn't save your answer. Please try again.";
        setSaves((prev) => ({
          ...prev,
          [questionId]: { status: "error", message },
        }));
      } finally {
        savingRef.current.delete(questionId);
      }
    },
    [attemptId],
  );

  const handleSelect = useCallback(
    (questionId: string, optionKey: string) => {
      if (submit.status === "submitting" || submit.status === "submitted")
        return;
      setSelections((prev) => {
        if (prev[questionId] === optionKey) return prev;
        return { ...prev, [questionId]: optionKey };
      });
      // Defer the save so the updated selections ref is visible to it.
      queueMicrotask(() => void persistAnswer(questionId));
    },
    [persistAnswer, submit.status],
  );

  const handleRetrySave = useCallback(
    (questionId: string) => {
      const selected = selectionsRef.current[questionId];
      if (selected === undefined) return;
      void persistAnswer(questionId);
    },
    [persistAnswer],
  );

  const goTo = useCallback(
    (next: number) => {
      setIndex(Math.min(Math.max(next, 0), questions.length - 1));
    },
    [questions.length],
  );

  // Focus the confirm action when the dialog opens; return focus on close.
  useEffect(() => {
    if (submit.status === "confirming") {
      confirmButtonRef.current?.focus();
    }
  }, [submit.status]);

  const closeDialog = useCallback(() => {
    setSubmit({ status: "idle" });
    queueMicrotask(() => submitButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (submit.status !== "confirming") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDialog();
        return;
      }
      // Keep keyboard focus inside the dialog while it is open.
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submit.status, closeDialog]);

  const handleConfirmSubmit = useCallback(async () => {
    if (
      submit.status === "submitting" ||
      submit.status === "submitted" ||
      !attemptId
    )
      return;
    setSubmit({ status: "submitting" });
    try {
      await submitAttempt(attemptId);
      setSubmit({ status: "submitted" });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 404
          ? "This attempt is no longer available. It may already be submitted."
          : error instanceof ApiError
            ? error.message
            : "We couldn't submit your attempt. Please try again.";
      setSubmit({ status: "error", message });
    }
  }, [attemptId, submit.status]);

  if (load.status === "loading") {
    return (
      <Container className="py-8">
        <AttemptSkeleton />
      </Container>
    );
  }

  if (load.status === "error") {
    return (
      <Container className="py-8">
        <ErrorState
          title="We couldn't load this attempt"
          description={load.message}
          onRetry={() => void fetchPractice()}
        />
      </Container>
    );
  }

  if (load.status === "unavailable") {
    return (
      <Container className="py-8">
        <EmptyState title={load.title} description={load.description} />
      </Container>
    );
  }

  const { practice } = load;
  const submitted = submit.status === "submitted";
  const submitting = submit.status === "submitting";
  const controlsDisabled = submitting || submitted;

  if (questions.length === 0) {
    return (
      <Container className="py-8">
        <div className="space-y-6">
          <Breadcrumb
            items={[
              { label: "Practice", href: "/practice" },
              {
                label: practice.title,
                href: `/practice/${practice.id}`,
              },
              { label: "Attempt" },
            ]}
          />
          <PageHeader title={practice.title} />
          <EmptyState
            title="No questions in this practice"
            description="There are no questions to answer in this practice yet."
          />
        </div>
      </Container>
    );
  }

  const current = questions[index];
  const unansweredCount = questions.length - answeredCount;

  return (
    <Container className="py-8">
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: "Practice", href: "/practice" },
            {
              label: practice.title,
              href: `/practice/${practice.id}`,
            },
            { label: "Attempt" },
          ]}
        />
        <PageHeader title={practice.title} />

        {submitted ? (
          <Card>
            <CardContent className="space-y-3">
              <h2 className="card-title">Practice submitted</h2>
              <p role="status" className="secondary">
                Your answers have been submitted. Results will be available on
                the Results page.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  to="/practice"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  Back to Practice
                </Link>
                <Link
                  to="/results"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                >
                  View Results
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-neutral-900">
                Question {index + 1} of {questions.length}
              </p>
              <p className="caption">
                {answeredCount} of {questions.length} answered
              </p>
            </div>

            <Card key={current.id}>
              <CardContent className="space-y-4">
                <fieldset>
                  <legend className="text-base font-semibold text-neutral-900">
                    <span className="mr-1">{current.sequence_number}.</span>
                    <span>{current.question_text}</span>
                  </legend>
                  <p className="caption mt-1">
                    {current.marks} {current.marks === 1 ? "mark" : "marks"}
                  </p>
                  <div className="mt-3 space-y-2" role="radiogroup">
                    {current.options.map((option) => {
                      const checked =
                        selections[current.id] === option.key;
                      const inputId = `q-${current.id}-opt-${option.key}`;
                      return (
                        <label
                          key={option.key}
                          htmlFor={inputId}
                          className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 transition-colors hover:border-primary-300 focus-within:ring-2 focus-within:ring-primary-500"
                        >
                          <input
                            id={inputId}
                            type="radio"
                            name={`question-${current.id}`}
                            value={option.key}
                            checked={checked}
                            disabled={controlsDisabled}
                            onChange={() =>
                              handleSelect(current.id, option.key)
                            }
                            className="mt-1 h-4 w-4 accent-primary-600"
                          />
                          <span>
                            <span className="font-medium text-neutral-500">
                              {option.key}.
                            </span>{" "}
                            <span>{option.text}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <SaveStatus
                  save={saves[current.id] ?? { status: "idle" }}
                  onRetry={() => handleRetrySave(current.id)}
                />
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="secondary"
                  onClick={() => goTo(index - 1)}
                  disabled={index === 0 || controlsDisabled}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => goTo(index + 1)}
                  disabled={index === questions.length - 1 || controlsDisabled}
                >
                  Next
                </Button>
              </div>
              <Button
                ref={submitButtonRef}
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
                loading={submitting}
                disabled={controlsDisabled}
                onClick={() => setSubmit({ status: "confirming" })}
              >
                Submit Practice
              </Button>
            </div>

            {submit.status === "error" ? (
              <div role="alert" className="space-y-2">
                <p className="text-sm font-medium text-error">
                  {submit.message}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => void handleConfirmSubmit()}
                >
                  Try again
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {submit.status === "confirming" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/50 p-4"
          role="presentation"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-confirm-heading"
            className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 id="submit-confirm-heading" className="card-title">
              Submit this practice?
            </h2>
            <p className="secondary">
              Submission is final — you won&apos;t be able to change your
              answers after submitting.
            </p>
            <p className="text-sm font-medium text-neutral-900">
              {unansweredCount === 0
                ? "You have answered every question."
                : unansweredCount === 1
                  ? "You have 1 unanswered question."
                  : `You have ${unansweredCount} unanswered questions.`}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                ref={confirmButtonRef}
                variant="primary"
                onClick={() => void handleConfirmSubmit()}
              >
                Confirm Submit
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Container>
  );
}

function SaveStatus({
  save,
  onRetry,
}: {
  save: QuestionSaveState;
  onRetry: () => void;
}) {
  if (save.status === "idle") return null;
  if (save.status === "saving") {
    return (
      <p role="status" className="caption">
        Saving…
      </p>
    );
  }
  if (save.status === "saved") {
    return (
      <p role="status" className="caption">
        Answer saved
      </p>
    );
  }
  return (
    <div role="alert" className="space-y-1">
      <p className="text-sm font-medium text-error">{save.message}</p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Retry save
      </Button>
    </div>
  );
}

function AttemptSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading your attempt…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-40 max-w-full" />
      </div>
      <SkeletonCard />
      <div className="flex gap-2">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  );
}
