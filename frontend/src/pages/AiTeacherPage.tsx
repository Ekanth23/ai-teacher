import { useCallback, useEffect, useState } from "react";
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
  const parts = [conversation.subject, conversation.topic].filter(
    (part): part is string => part !== null && part !== "",
  );
  return parts.length > 0 ? parts.join(" · ") : "General conversation";
}

function formatUpdatedAt(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
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

  const loadHistory = useCallback(async () => {
    setHistory({ status: "loading" });
    try {
      const data = await getConversations();
      setHistory({ status: "success", conversations: data.conversations });
    } catch (error) {
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
    void loadHistory();
  }, [loadHistory]);

  const handleStart = useCallback(
    async (firstQuestion: string) => {
      if (start.status === "starting") return;
      const trimmed = firstQuestion.trim();
      if (!trimmed) return;
      setStart({ status: "starting" });
      try {
        const data = await createConversation(
          hasContext
            ? {
                ...(contextSubject ? { subject: contextSubject } : {}),
                ...(contextTopic ? { topic: contextTopic } : {}),
              }
            : {},
        );
        navigate(`/ai-teacher/${data.conversation.id}`, {
          state: { initialQuestion: trimmed },
        });
      } catch (error) {
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
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Type your question here…"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <Button
                variant="primary"
                loading={start.status === "starting"}
                disabled={question.trim() === ""}
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
