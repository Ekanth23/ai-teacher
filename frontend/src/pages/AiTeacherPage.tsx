import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Container } from "../components/Container";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Skeleton, SkeletonCard } from "../components/ui/Skeleton";
import { ApiError } from "../services/api/errors";
import { createConversation, getConversations } from "../services/api/ai";
import type { AiConversation } from "../types/ai";

/** Static, deterministic starter prompts (UI copy only — no backend source). */
export const SUGGESTED_PROMPTS = [
  "Explain this topic in simple terms",
  "Give me a practice question",
  "Help me understand this chapter",
  "Explain this step by step",
];

function conversationTitle(conversation: AiConversation): string {
  if (conversation.title?.trim()) return conversation.title;
  const parts = [conversation.subject, conversation.topic].filter(
    (part): part is string => part !== null && part !== "",
  );
  return parts.length > 0 ? parts.join(" · ") : "New Conversation";
}

function formatUpdatedAt(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function conversationScopeLabel(conversation: AiConversation): string | null {
  const scope = conversation.scope;
  const parts = scope
    ? [scope.board, scope.class, scope.subject, scope.chapter, scope.topic]
    : [conversation.subject, conversation.topic];
  const label = parts
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" · ");
  return label || null;
}

type HistoryState =
  | { status: "loading" }
  | { status: "success"; conversations: AiConversation[] }
  | { status: "error"; message: string };

type StartState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "error"; message: string };

export default function AiTeacherPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contextSubject = (searchParams.get("subject") ?? "").trim();
  const contextTopic = (searchParams.get("topic") ?? "").trim();
  const hasContext = contextSubject !== "" || contextTopic !== "";

  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [question, setQuestion] = useState("");
  const [start, setStart] = useState<StartState>({ status: "idle" });
  const historySequenceRef = useRef(0);
  const historyAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const startPendingRef = useRef(false);
  const startKeyRef = useRef(new Map<string, string>());

  const loadHistory = useCallback(async () => {
    const sequence = ++historySequenceRef.current;
    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;
    setHistory({ status: "loading" });
    try {
      const data = await getConversations({ signal: controller.signal });
      if (!mountedRef.current || sequence !== historySequenceRef.current) return;
      setHistory({ status: "success", conversations: data.conversations });
    } catch (error) {
      if (
        !mountedRef.current ||
        sequence !== historySequenceRef.current ||
        (typeof error === "object" &&
          error !== null &&
          "name" in error &&
          ((error as { name?: unknown }).name === "AbortError" ||
            (error as { message?: unknown }).message === "AbortError"))
      ) {
        return;
      }
      setHistory({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load your conversations. Please try again.",
      });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadHistory();
    return () => {
      mountedRef.current = false;
      historySequenceRef.current += 1;
      historyAbortRef.current?.abort();
    };
  }, [loadHistory]);

  const handleStart = useCallback(
    async (firstQuestion: string) => {
      if (start.status === "starting" || startPendingRef.current) return;
      const trimmed = firstQuestion.trim();
      if (!trimmed) return;
      const key = `start:${trimmed}:${contextSubject}:${contextTopic}`;
      const idempotencyKey = startKeyRef.current.get(key) ?? createIdempotencyKey();
      startKeyRef.current.set(key, idempotencyKey);
      startPendingRef.current = true;
      setStart({ status: "starting" });
      try {
        const data = await createConversation(
          {
            question: trimmed,
            ...(hasContext
              ? {
                  ...(contextSubject ? { subject: contextSubject } : {}),
                  ...(contextTopic ? { topic: contextTopic } : {}),
                }
              : {}),
          },
          { idempotencyKey },
        );
        if (!mountedRef.current) return;
        startPendingRef.current = false;
        startKeyRef.current.delete(key);
        navigate(`/ai-teacher/${data.conversation.id}`);
      } catch (error) {
        if (!mountedRef.current) return;
        startPendingRef.current = false;
        const details =
          error instanceof ApiError && typeof error.details === "object" && error.details !== null
            ? (error.details as {
                conversation?: { id?: string };
                error?: { conversation?: { id?: string } };
              })
            : undefined;
        const persistedConversationId =
          details?.conversation?.id ?? details?.error?.conversation?.id;
        if (persistedConversationId) {
          startKeyRef.current.delete(key);
          // A provider failure still persists the student's request. Open that
          // conversation so the durable retry action is available instead of
          // creating a second conversation on the next click.
          navigate(`/ai-teacher/${persistedConversationId}`);
          return;
        }
        const unknownOutcome =
          !(error instanceof ApiError) ||
          error.status === 0 ||
          error.code === "NETWORK_ERROR";
        if (!unknownOutcome) startKeyRef.current.delete(key);
        setStart({
          status: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "We couldn't start a conversation. Please try again.",
        });
      }
    },
    [start.status, hasContext, contextSubject, contextTopic, navigate],
  );

  return (
    <Container className="py-8">
      <div className="space-y-6">
        <PageHeader
          title="AI Teacher"
          description="Ask questions about what you're learning and get help step by step."
        />

        <Card>
          <CardContent className="space-y-3">
            <h2 className="card-title">Start a conversation</h2>
            {hasContext ? (
              <p className="caption">
                Context:{" "}
                {[contextSubject, contextTopic]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </p>
            ) : null}
            <label
              htmlFor="ai-teacher-question"
              className="text-sm font-medium text-neutral-900"
            >
              What would you like help with?
            </label>
            <textarea
              id="ai-teacher-question"
              rows={3}
              value={question}
              maxLength={20_000}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Type your question here…"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <Button
                variant="primary"
                loading={start.status === "starting"}
                disabled={question.trim() === "" || start.status === "starting"}
                onClick={() => void handleStart(question)}
              >
                Ask AI Teacher
              </Button>
              {start.status === "error" ? (
                <p role="alert" className="text-sm font-medium text-error">
                  {start.message}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <h2 className="card-title">Suggested prompts</h2>
            <p className="secondary">
              Pick a starter to fill the question box above.
            </p>
            <ul className="flex flex-wrap gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuestion(prompt);
                      document
                        .getElementById("ai-teacher-question")
                        ?.focus();
                    }}
                  >
                    {prompt}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <section aria-labelledby="ai-history-heading">
          <h2 id="ai-history-heading" className="section-title">
            Recent conversations
          </h2>
          <div className="mt-3">
            {history.status === "loading" ? (
              <div role="status" className="space-y-3">
                <span className="sr-only">Loading conversations…</span>
                <SkeletonCard />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : history.status === "error" ? (
              <ErrorState
                title="We couldn't load your conversations"
                description={history.message}
                onRetry={() => void loadHistory()}
              />
            ) : history.conversations.length === 0 ? (
              <EmptyState
                title="No conversations yet"
                description="Your AI Teacher conversations will appear here once you start one."
              />
            ) : (
              <ul className="space-y-3">
                {history.conversations.map((conversation) => {
                  const updated = formatUpdatedAt(conversation.updated_at);
                  const scope = conversationScopeLabel(conversation);
                  return (
                    <li key={conversation.id}>
                      <Link
                        to={`/ai-teacher/${conversation.id}`}
                        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        <Card className="transition-colors hover:border-primary-300">
                          <CardContent>
                            <h3 className="card-title">
                              {conversationTitle(conversation)}
                            </h3>
                            {scope ? <p className="caption mt-1">{scope}</p> : null}
                            {conversation.latest_message_preview ? (
                              <p className="secondary mt-1 line-clamp-2">
                                {conversation.latest_message_preview}
                              </p>
                            ) : null}
                            {updated ? (
                              <p className="caption mt-1">{updated}</p>
                            ) : null}
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </Container>
  );
}
