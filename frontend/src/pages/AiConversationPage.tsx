import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
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
  getConversationMessages,
  sendReply,
} from "../services/api/ai";
import { SUGGESTED_PROMPTS } from "./AiTeacherPage";
import type { AiMessage } from "../types/ai";

type ThreadState =
  | { status: "loading" }
  | { status: "success"; messages: AiMessage[] }
  | { status: "unavailable"; title: string; description: string }
  | { status: "error"; message: string };

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "error"; message: string };

export default function AiConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const location = useLocation();
  const initialQuestion =
    typeof (location.state as { initialQuestion?: unknown } | null)
      ?.initialQuestion === "string"
      ? ((location.state as { initialQuestion: string }).initialQuestion)
      : "";
  const initialSentRef = useRef(false);

  const [thread, setThread] = useState<ThreadState>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [send, setSend] = useState<SendState>({ status: "idle" });
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    if (!conversationId) {
      setThread({
        status: "unavailable",
        title: "Conversation unavailable",
        description:
          "This conversation link is incomplete. Start a new conversation from AI Teacher.",
      });
      return;
    }
    setThread({ status: "loading" });
    try {
      const data = await getConversationMessages(conversationId);
      setThread({ status: "success", messages: data.messages });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setThread({
          status: "unavailable",
          title: "Conversation unavailable",
          description:
            "This conversation doesn't exist or isn't available to your account.",
        });
        return;
      }
      setThread({
        status: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "We couldn't load this conversation. Please try again.",
      });
    }
  }, [conversationId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const refreshMessages = useCallback(async () => {
    if (!conversationId) return null;
    try {
      const data = await getConversationMessages(conversationId);
      setThread({ status: "success", messages: data.messages });
      return data.messages;
    } catch {
      return null;
    }
  }, [conversationId]);

  const handleSend = useCallback(
    async (rawQuestion: string) => {
      if (send.status === "sending") return;
      const question = rawQuestion.trim();
      if (!question || !conversationId) return;
      setSend({ status: "sending" });
      try {
        await sendReply(conversationId, question);
        setDraft("");
        setSend({ status: "idle" });
        await refreshMessages();
      } catch (error) {
        setSend({
          status: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "We couldn't send your message. Please try again.",
        });
      }
    },
    [send.status, conversationId, refreshMessages],
  );

  // Send the landing page's first question exactly once.
  useEffect(() => {
    if (initialSentRef.current || !initialQuestion.trim() || !conversationId)
      return;
    initialSentRef.current = true;
    void handleSend(initialQuestion);
  }, [initialQuestion, conversationId, handleSend]);

  const messages = thread.status === "success" ? thread.messages : [];
  const sending = send.status === "sending";

  useEffect(() => {
    const anchor = bottomRef.current;
    if (anchor && typeof anchor.scrollIntoView === "function") {
      anchor.scrollIntoView({ block: "end" });
    }
  }, [messages.length, sending]);

  if (thread.status === "loading") {
    return (
      <Container className="py-8">
        <ThreadSkeleton />
      </Container>
    );
  }

  if (thread.status === "error") {
    return (
      <Container className="py-8">
        <ErrorState
          title="We couldn't load this conversation"
          description={thread.message}
          onRetry={() => void loadMessages()}
        />
      </Container>
    );
  }

  if (thread.status === "unavailable") {
    return (
      <Container className="py-8">
        <EmptyState
          title={thread.title}
          description={thread.description}
          action={
            <Link
              to="/ai-teacher"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              Back to AI Teacher
            </Link>
          }
        />
      </Container>
    );
  }

  return (
    <Container className="py-8">
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: "AI Teacher", href: "/ai-teacher" },
            { label: "Conversation" },
          ]}
        />
        <PageHeader title="Conversation" />

        {messages.length === 0 && !sending ? (
          <Card>
            <CardContent className="space-y-3">
              <h2 className="card-title">Start the conversation</h2>
              <p className="secondary">
                Ask your first question below, or pick a starter.
              </p>
              <ul className="flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <li key={prompt}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDraft(prompt);
                        document.getElementById("ai-composer")?.focus();
                      }}
                    >
                      {prompt}
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : (
          <ul aria-label="Conversation messages" className="space-y-4">
            {messages.map((message) =>
              message.role === "user" ? (
                <li key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary-600 px-4 py-3 text-white sm:max-w-[70%]">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary-100">
                      You
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap">
                      {message.content}
                    </p>
                  </div>
                </li>
              ) : (
                <li key={message.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-neutral-200 bg-white px-4 py-3 sm:max-w-[70%]">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      AI Teacher
                    </p>
                    <p className="mt-1 text-sm text-neutral-900 whitespace-pre-wrap">
                      {message.content}
                    </p>
                  </div>
                </li>
              ),
            )}
            {sending ? (
              <li className="flex justify-start">
                <p
                  role="status"
                  className="rounded-xl rounded-bl-sm border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600"
                >
                  <span aria-hidden="true" className="mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-neutral-400" />
                  AI Teacher is thinking…
                </p>
              </li>
            ) : null}
          </ul>
        )}
        <div ref={bottomRef} />

        <Card>
          <CardContent className="space-y-3">
            <label
              htmlFor="ai-composer"
              className="text-sm font-medium text-neutral-900"
            >
              Message AI Teacher
            </label>
            <textarea
              id="ai-composer"
              rows={3}
              value={draft}
              disabled={sending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend(draft);
                }
              }}
              placeholder="Type your question here… (Enter to send, Shift+Enter for a new line)"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
            />
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <Button
                variant="primary"
                loading={sending}
                disabled={draft.trim() === "" || sending}
                onClick={() => void handleSend(draft)}
              >
                Send
              </Button>
              {send.status === "error" ? (
                <div role="alert" className="space-y-1">
                  <p className="text-sm font-medium text-error">
                    {send.message}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleSend(draft)}
                  >
                    Retry send
                  </Button>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}

function ThreadSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading this conversation…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-40 max-w-full" />
      </div>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
