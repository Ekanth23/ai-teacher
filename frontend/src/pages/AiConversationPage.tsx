import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Breadcrumb } from "../components/Breadcrumb";
import { Container } from "../components/Container";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Skeleton, SkeletonCard } from "../components/ui/Skeleton";
import { ApiError } from "../services/api/errors";
import {
  activateConversationBranch,
  deleteConversation,
  editMessage,
  getConversationMessages,
  regenerateResponse,
  renameConversation,
  retryGeneration,
  sendMessage,
  submitConversationFeedback,
} from "../services/api/ai";
import {
  AI_FEEDBACK_REASONS,
  type AiBranch,
  type AiConversation,
  type AiFeedback,
  type AiGenerationAttempt,
  type AiMessage,
  type AiMessageStatus,
} from "../types/ai";
import { SUGGESTED_PROMPTS } from "./AiTeacherPage";

type ThreadSnapshot = {
  messages: AiMessage[];
  conversation?: AiConversation;
  branches: AiBranch[];
  attempts: AiGenerationAttempt[];
  activeAttempt: AiGenerationAttempt | null;
  processingAttempt: AiGenerationAttempt | null;
  feedback: AiFeedback[];
};

type ThreadState =
  | { status: "loading" }
  | { status: "success"; snapshot: ThreadSnapshot }
  | { status: "unavailable"; title: string; description: string }
  | { status: "error"; message: string };

type OperationKind =
  | "send"
  | "edit"
  | "regenerate"
  | "retry"
  | "branch"
  | "rename"
  | "delete"
  | "feedback";

type FailedOperation = {
  kind: OperationKind;
  message: string;
  question?: string;
  attemptId?: string;
  messageId?: string;
  responseId?: string;
  idempotencyKey?: string;
  unknownOutcome: boolean;
};

type OperationState =
  | { status: "idle" }
  | { status: "pending"; kind: OperationKind }
  | { status: "error"; operation: FailedOperation };

type RefreshResult = {
  applied: boolean;
  aborted: boolean;
  data?: ThreadSnapshot;
  error?: unknown;
};

type InFlightRefresh = {
  id: string;
  controller: AbortController;
  promise: Promise<RefreshResult>;
};

type MessageGroup = {
  key: string;
  request: AiMessage | null;
  variants: AiMessage[];
  order: number;
};

type LifecycleDetails = {
  conversationId?: string;
  messageId?: string;
  responseId?: string;
  attemptId?: string;
  attemptStatus?: AiMessageStatus;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name?: unknown }).name === "AbortError" ||
      (error as { message?: unknown }).message === "AbortError")
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function lifecycleDetails(error: unknown): LifecycleDetails {
  if (!(error instanceof ApiError) || !isRecord(error.details)) return {};
  const outer = error.details;
  const nestedError = isRecord(outer.error) ? outer.error : {};
  const details = { ...outer, ...nestedError };
  const attempt = isRecord(details.attempt) ? details.attempt : undefined;
  const studentMessage = isRecord(details.student_message)
    ? details.student_message
    : isRecord(details.studentMessage)
      ? details.studentMessage
      : undefined;
  const responseMessage = isRecord(details.response_message)
    ? details.response_message
    : isRecord(details.responseMessage)
      ? details.responseMessage
      : undefined;
  const attemptStatus =
    typeof details.generation_status === "string"
      ? details.generation_status
      : typeof details.attempt_status === "string"
        ? details.attempt_status
        : undefined;

  return {
    conversationId:
      typeof details.conversation_id === "string"
        ? details.conversation_id
        : isRecord(details.conversation) && typeof details.conversation.id === "string"
          ? details.conversation.id
          : undefined,
    messageId:
      typeof studentMessage?.id === "string"
        ? studentMessage.id
        : typeof details.message_id === "string"
          ? details.message_id
          : typeof details.student_message_id === "string"
            ? details.student_message_id
            : typeof attempt?.request_message_id === "string"
              ? attempt.request_message_id
              : undefined,
    responseId:
      typeof responseMessage?.id === "string"
        ? responseMessage.id
        : typeof details.response_message_id === "string"
          ? details.response_message_id
          : typeof attempt?.response_message_id === "string"
            ? attempt.response_message_id
            : undefined,
    attemptId:
      typeof attempt?.id === "string"
        ? attempt.id
        : typeof details.attempt_id === "string"
          ? details.attempt_id
          : undefined,
    attemptStatus: attemptStatus as AiMessageStatus | undefined,
  };
}

function normalizedQuestion(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isUnknownOutcome(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.code === "NETWORK_ERROR"
  );
}

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeSnapshot(data: {
  messages?: AiMessage[];
  conversation?: AiConversation;
  branches?: AiBranch[];
  attempts?: AiGenerationAttempt[];
  active_attempt?: AiGenerationAttempt | null;
  processing_attempt?: AiGenerationAttempt | null;
  feedback?: AiFeedback[];
}): ThreadSnapshot {
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const attempts = Array.isArray(data.attempts) ? data.attempts : [];
  const latestByRequest = new Map<string, AiGenerationAttempt>();
  for (const attempt of [...attempts].sort(attemptSort)) {
    latestByRequest.set(attempt.request_message_id, attempt);
  }
  const processingFromAttempts =
    data.active_attempt === null && data.processing_attempt === null
      ? null
      : [...latestByRequest.values()]
          .filter((attempt) => attempt.status === "PROCESSING")
          .sort(attemptSort)
          .at(-1) ?? null;
  const fieldIsProcessing = (value: AiGenerationAttempt | null | undefined): value is AiGenerationAttempt => {
    if (!value) return false;
    if (value.status !== undefined && value.status !== "PROCESSING") return false;
    const latest = latestByRequest.get(value.request_message_id);
    return !latest || latest.id === value.id;
  };
  const activeCandidate = fieldIsProcessing(data.active_attempt)
    ? data.active_attempt
    : fieldIsProcessing(data.processing_attempt)
      ? data.processing_attempt
      : processingFromAttempts;
  const processingCandidate = fieldIsProcessing(data.processing_attempt)
    ? data.processing_attempt
    : fieldIsProcessing(data.active_attempt)
      ? data.active_attempt
      : processingFromAttempts;
  const activeAttempt = activeCandidate ?? null;
  const processingAttempt = processingCandidate ?? null;

  return {
    messages,
    conversation: data.conversation,
    branches: Array.isArray(data.branches) ? data.branches : [],
    attempts,
    activeAttempt,
    processingAttempt,
    feedback: Array.isArray(data.feedback) ? data.feedback : [],
  };
}

function messageSort(left: AiMessage, right: AiMessage): number {
  const leftSequence =
    left.sequence_number === null || left.sequence_number === undefined
      ? Number.MAX_SAFE_INTEGER
      : left.sequence_number;
  const rightSequence =
    right.sequence_number === null || right.sequence_number === undefined
      ? Number.MAX_SAFE_INTEGER
      : right.sequence_number;
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  const created = String(left.created_at).localeCompare(String(right.created_at));
  if (created !== 0) return created;
  if (left.role !== right.role) return left.role === "user" ? -1 : 1;
  return left.id.localeCompare(right.id);
}

function attemptSort(left: AiGenerationAttempt, right: AiGenerationAttempt): number {
  const number = Number(left.attempt_number ?? 0) - Number(right.attempt_number ?? 0);
  if (number !== 0) return number;
  const started = String(left.started_at ?? "").localeCompare(String(right.started_at ?? ""));
  if (started !== 0) return started;
  return left.id.localeCompare(right.id);
}

function latestAttempt(
  attempts: AiGenerationAttempt[],
  requestMessageId: string,
  failedOnly = false,
): AiGenerationAttempt | undefined {
  return attempts
    .filter(
      (attempt) =>
        attempt.request_message_id === requestMessageId &&
        (!failedOnly || attempt.status === "FAILED"),
    )
    .sort(attemptSort)
    .at(-1);
}

function groupMessages(messages: AiMessage[]): MessageGroup[] {
  const ordered = [...messages].sort(messageSort);
  const groups: MessageGroup[] = [];
  const byRequest = new Map<string, MessageGroup>();

  ordered.forEach((message, order) => {
    if (message.role === "assistant" && message.request_message_id) {
      const key = `request:${message.request_message_id}`;
      let group = byRequest.get(key);
      if (!group) {
        group = { key, request: null, variants: [], order };
        byRequest.set(key, group);
        groups.push(group);
      }
      group.variants.push(message);
      return;
    }

    if (message.role === "user") {
      const key = `request:${message.id}`;
      let group = byRequest.get(key);
      if (!group) {
        group = { key, request: message, variants: [], order };
        byRequest.set(key, group);
        groups.push(group);
      } else if (!group.request) {
        group.request = message;
        group.order = Math.min(group.order, order);
      }
      return;
    }

    groups.push({
      key: `legacy:${message.id}`,
      request: null,
      variants: [message],
      order,
    });
  });

  for (const group of groups) {
    group.variants.sort((left, right) => {
      const variant = Number(left.variant_number ?? 0) - Number(right.variant_number ?? 0);
      return variant !== 0 ? variant : messageSort(left, right);
    });
  }

  return groups.sort((left, right) => left.order - right.order);
}

function feedbackMap(
  snapshot: ThreadSnapshot,
  overrides: Record<string, AiFeedback>,
): Map<string, AiFeedback> {
  const result = new Map<string, AiFeedback>();
  for (const feedback of snapshot.feedback) {
    if (feedback.response_message_id) result.set(feedback.response_message_id, feedback);
  }
  for (const message of snapshot.messages) {
    if (message.role === "assistant" && message.feedback) {
      result.set(message.id, message.feedback);
    }
  }
  for (const [id, feedback] of Object.entries(overrides)) result.set(id, feedback);
  return result;
}

function requestIsProcessing(
  snapshot: ThreadSnapshot | null,
  requestMessageId: string,
  messageStatus?: AiMessageStatus,
): boolean {
  if (!snapshot) return false;
  if (snapshot.processingAttempt?.request_message_id === requestMessageId) return true;
  const latest = latestAttempt(snapshot.attempts, requestMessageId);
  if (latest) return latest.status === "PROCESSING";
  return messageStatus === "PROCESSING";
}

function isProcessingSnapshot(snapshot: ThreadSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.processingAttempt || snapshot.activeAttempt) return true;
  if (
    snapshot.attempts.some(
      (attempt) =>
        attempt.status === "PROCESSING" &&
        latestAttempt(snapshot.attempts, attempt.request_message_id)?.id === attempt.id,
    )
  )
    return true;
  return snapshot.messages.some(
    (message) => message.role === "user" && requestIsProcessing(snapshot, message.id, message.status),
  );
}

function hasUnresolvedFailedRequest(snapshot: ThreadSnapshot | null): boolean {
  if (!snapshot) return false;
  const responsesByRequest = new Set(
    snapshot.messages
      .filter((message) => message.role === "assistant" && message.request_message_id)
      .map((message) => message.request_message_id),
  );
  return snapshot.messages.some((message) => {
    if (message.role !== "user" || responsesByRequest.has(message.id)) return false;
    const latest = latestAttempt(snapshot.attempts, message.id);
    return message.status === "FAILED" || latest?.status === "FAILED";
  });
}

function activeBranchLabel(branches: AiBranch[], conversation?: AiConversation): string {
  const activeId = conversation?.active_branch_id ?? conversation?.selected_branch_id;
  const active = branches.find((branch) => branch.id === activeId) ??
    branches.find((branch) => branch.is_active);
  if (!active) return "Primary branch";
  return active.name?.trim() || (active.is_primary ? "Primary branch" : "Edited branch");
}

export default function AiConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const initialQuestion =
    typeof (location.state as { initialQuestion?: unknown } | null)
      ?.initialQuestion === "string"
      ? (location.state as { initialQuestion: string }).initialQuestion
      : "";
  const initialSentRef = useRef<string | null>(null);
  const currentConversationRef = useRef(conversationId);
  currentConversationRef.current = conversationId;
  const mountedRef = useRef(true);
  const refreshSequenceRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const refreshInFlightRef = useRef<InFlightRefresh | null>(null);
  const snapshotRef = useRef<ThreadSnapshot | null>(null);
  const operationRef = useRef<OperationState>({ status: "idle" });
  const feedbackPendingRef = useRef<string | null>(null);
  const editSaveRef = useRef<((messageId: string) => Promise<void>) | null>(null);
  const regenerateRef = useRef<((responseMessageId: string) => Promise<void>) | null>(null);
  const idempotencyKeysRef = useRef(new Map<string, string>());

  const [thread, setThread] = useState<ThreadState>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [operation, setOperation] = useState<OperationState>({ status: "idle" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [feedbackPendingId, setFeedbackPendingId] = useState<string | null>(null);
  const [feedbackOverrides, setFeedbackOverrides] = useState<Record<string, AiFeedback>>({});
  const [feedbackReasons, setFeedbackReasons] = useState<Record<string, string>>({});
  const [titleDraft, setTitleDraft] = useState("New Conversation");
  const [titleDirty, setTitleDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const settingsPendingRef = useRef(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const updateOperation = useCallback((next: OperationState) => {
    operationRef.current = next;
    setOperation(next);
  }, []);

  const applySnapshot = useCallback((id: string, snapshot: ThreadSnapshot) => {
    if (!mountedRef.current || currentConversationRef.current !== id) return false;
    snapshotRef.current = snapshot;
    setThread({ status: "success", snapshot });
    return true;
  }, []);

  const refreshSnapshot = useCallback(
    (
      id: string,
      options: { force?: boolean; showLoading?: boolean } = {},
    ): Promise<RefreshResult> => {
      const current = refreshInFlightRef.current;
      if (current?.id === id && !options.force) return current.promise;
      current?.controller.abort();

      const sequence = ++refreshSequenceRef.current;
      const controller = new AbortController();
      refreshAbortRef.current = controller;
      const promise = (async (): Promise<RefreshResult> => {
        if (options.showLoading && mountedRef.current && currentConversationRef.current === id) {
          setThread({ status: "loading" });
        }
        try {
          const data = await getConversationMessages(id, undefined, {
            signal: controller.signal,
          });
          if (
            !mountedRef.current ||
            currentConversationRef.current !== id ||
            sequence !== refreshSequenceRef.current
          ) {
            return { applied: false, aborted: true };
          }
          const snapshot = normalizeSnapshot(data);
          applySnapshot(id, snapshot);
          if (currentConversationRef.current === id) setRefreshError(null);
          return { applied: true, aborted: false, data: snapshot };
        } catch (error) {
          if (
            isAbortError(error) ||
            !mountedRef.current ||
            currentConversationRef.current !== id ||
            sequence !== refreshSequenceRef.current
          ) {
            return { applied: false, aborted: true, error };
          }
          if (error instanceof ApiError && error.status === 404) {
            setThread({
              status: "unavailable",
              title: "Conversation unavailable",
              description: "This conversation doesn't exist or isn't available to your account.",
            });
          } else if (options.showLoading) {
            setThread({
              status: "error",
              message: errorMessage(error, "We couldn't load this conversation. Please try again."),
            });
          } else {
            setRefreshError(errorMessage(error, "We couldn't refresh this conversation."));
          }
          return { applied: false, aborted: false, error };
        }
      })();
      const entry: InFlightRefresh = { id, controller, promise };
      refreshInFlightRef.current = entry;
      void promise.then(
        () => {
          if (refreshInFlightRef.current === entry) refreshInFlightRef.current = null;
        },
        () => {
          if (refreshInFlightRef.current === entry) refreshInFlightRef.current = null;
        },
      );
      return promise;
    },
    [applySnapshot],
  );

  const supersedeRefreshes = useCallback(() => {
    refreshSequenceRef.current += 1;
    refreshInFlightRef.current?.controller.abort();
    refreshInFlightRef.current = null;
  }, []);

  const refreshAfterMutation = useCallback(
    async (id: string): Promise<boolean> => {
      if (!mountedRef.current || currentConversationRef.current !== id) return false;
      setRefreshPending(true);
      setRefreshError(null);
      let result = await refreshSnapshot(id, { force: true });
      if (!result.applied && result.aborted && currentConversationRef.current === id) {
        const newest = refreshInFlightRef.current;
        if (newest?.id === id) result = await newest.promise;
      }
      if (!mountedRef.current || currentConversationRef.current !== id) return false;
      setRefreshPending(false);
      if (result.applied) {
        setRefreshRequired(false);
        return true;
      }
      setRefreshRequired(true);
      setRefreshError(
        result.error
          ? errorMessage(result.error, "We couldn't refresh this conversation.")
          : "We couldn't refresh this conversation.",
      );
      return false;
    },
    [refreshSnapshot],
  );

  const getOrCreateIdempotencyKey = useCallback((key: string): string => {
    const existing = idempotencyKeysRef.current.get(key);
    if (existing) return existing;
    const next = createIdempotencyKey();
    idempotencyKeysRef.current.set(key, next);
    return next;
  }, []);

  const clearIdempotencyKey = useCallback((key: string) => {
    idempotencyKeysRef.current.delete(key);
  }, []);

  const findPersistedFailure = useCallback(
    (snapshot: ThreadSnapshot | null, details: LifecycleDetails, question?: string) => {
      const messageId = details.messageId ??
        snapshot?.messages.find(
          (message) =>
            message.role === "user" &&
            (message.status === "FAILED" ||
              latestAttempt(snapshot.attempts, message.id)?.status === "FAILED") &&
            (question
              ? normalizedQuestion(message.content) === normalizedQuestion(question)
              : true),
        )?.id;
      const attempt = latestAttempt(snapshot?.attempts ?? [], messageId ?? "", true);
      return {
        messageId,
        attemptId: details.attemptId ?? attempt?.id,
      };
    },
    [],
  );

  const handleRefresh = useCallback(async () => {
    if (!conversationId || refreshPending) return;
    await refreshAfterMutation(conversationId);
  }, [conversationId, refreshAfterMutation, refreshPending]);

  const handleSend = useCallback(
    async (rawQuestion: string) => {
      const id = currentConversationRef.current;
      const question = rawQuestion.trim();
      if (
        !id ||
        !question ||
        operationRef.current.status === "pending" ||
        isProcessingSnapshot(snapshotRef.current) ||
        hasUnresolvedFailedRequest(snapshotRef.current)
      )
        return;
      supersedeRefreshes();
      const branchKey =
        snapshotRef.current?.conversation?.selected_branch_id ??
        snapshotRef.current?.conversation?.active_branch_id ??
        "default";
      const idempotencyMapKey = `${id}:${branchKey}:send:${question}`;
      const idempotencyKey = getOrCreateIdempotencyKey(idempotencyMapKey);
      updateOperation({ status: "pending", kind: "send" });
      setActionError(null);
      setRefreshError(null);
      try {
        const branchId =
          snapshotRef.current?.conversation?.selected_branch_id ??
          snapshotRef.current?.conversation?.active_branch_id;
        await sendMessage(
          id,
          branchId ? { question, branch_id: branchId } : { question },
          { idempotencyKey },
        );
        clearIdempotencyKey(idempotencyMapKey);
        if (currentConversationRef.current === id) setDraft("");
        const refreshed = await refreshAfterMutation(id);
        if (currentConversationRef.current === id) {
          updateOperation(
            refreshed
              ? { status: "idle" }
              : {
                  status: "error",
                  operation: {
                    kind: "send",
                    message: "Your message was saved, but the conversation could not be refreshed.",
                    question,
                    idempotencyKey,
                    unknownOutcome: false,
                  },
                },
          );
        }
      } catch (error) {
        if (isAbortError(error) || currentConversationRef.current !== id) return;
        const details = lifecycleDetails(error);
        const refreshed = await refreshAfterMutation(id);
        const persisted = findPersistedFailure(snapshotRef.current, details, question);
        const knownFailure = Boolean(
          details.attemptId || details.messageId || persisted.attemptId || persisted.messageId,
        );
        if (knownFailure || !isUnknownOutcome(error)) clearIdempotencyKey(idempotencyMapKey);
        if (currentConversationRef.current !== id) return;
        if (knownFailure) setDraft("");
        updateOperation({
          status: "error",
          operation: {
            kind: "send",
            message: refreshed
              ? errorMessage(error, "We couldn't generate a response. Please try again.")
              : "We couldn't confirm the latest conversation state. Refresh before retrying.",
            question,
            attemptId: persisted.attemptId ?? details.attemptId,
            messageId: persisted.messageId ?? details.messageId,
            idempotencyKey: isUnknownOutcome(error) && !knownFailure ? idempotencyKey : undefined,
            unknownOutcome: isUnknownOutcome(error) && !knownFailure,
          },
        });
      }
    },
    [clearIdempotencyKey, findPersistedFailure, getOrCreateIdempotencyKey, refreshAfterMutation, supersedeRefreshes, updateOperation],
  );

  const retryPersistedAttempt = useCallback(
    async (messageId: string, preferredAttemptId?: string) => {
      const id = currentConversationRef.current;
      if (!id || operationRef.current.status === "pending" || isProcessingSnapshot(snapshotRef.current)) return;
      supersedeRefreshes();
      const snapshot = snapshotRef.current;
      const attemptId = preferredAttemptId ?? latestAttempt(snapshot?.attempts ?? [], messageId, true)?.id;
      updateOperation({ status: "pending", kind: "retry" });
      setActionError(null);
      setRefreshError(null);
      try {
        const result = await retryGeneration(id, attemptId, messageId);
        const refreshed = await refreshAfterMutation(id);
        if (currentConversationRef.current === id) {
          const responseId = result?.response_message?.id ?? result?.data?.id;
          if (responseId) {
            setSelectedVariants((current) => ({
              ...current,
              [`request:${messageId}`]: responseId,
            }));
          }
          updateOperation(
            refreshed
              ? { status: "idle" }
              : {
                  status: "error",
                  operation: {
                    kind: "retry",
                    message: "The retry was saved, but the conversation could not be refreshed.",
                    messageId,
                    attemptId,
                    unknownOutcome: false,
                  },
                },
          );
        }
      } catch (error) {
        if (isAbortError(error) || currentConversationRef.current !== id) return;
        const details = lifecycleDetails(error);
        const refreshed = await refreshAfterMutation(id);
        const latest = latestAttempt(snapshotRef.current?.attempts ?? [], messageId, true);
        if (currentConversationRef.current !== id) return;
        updateOperation({
          status: "error",
          operation: {
            kind: "retry",
            message: refreshed
              ? errorMessage(error, "We couldn't retry generation. Please try again.")
              : "We couldn't confirm the latest conversation state. Refresh before retrying.",
            messageId: details.messageId ?? messageId,
            attemptId: details.attemptId ?? latest?.id ?? attemptId,
            unknownOutcome: isUnknownOutcome(error),
          },
        });
      }
    },
    [refreshAfterMutation, supersedeRefreshes, updateOperation],
  );

  const handlePersistedRetry = useCallback(
    (messageId: string) => retryPersistedAttempt(messageId),
    [retryPersistedAttempt],
  );

  const handleRetry = useCallback(async () => {
    const failed = operationRef.current;
    if (failed.status !== "error") return;
    const context = failed.operation;
    if (context.kind === "send" && !context.attemptId && !context.messageId) {
      await handleSend(context.question ?? draft);
      return;
    }
    if (
      context.kind === "edit" &&
      !context.attemptId &&
      !context.messageId &&
      editingMessageId &&
      editDraft.trim()
    ) {
      await editSaveRef.current?.(editingMessageId);
      return;
    }
    if (context.kind === "regenerate" && context.unknownOutcome && context.responseId) {
      await regenerateRef.current?.(context.responseId);
      return;
    }
    const messageId =
      context.messageId ??
      (context.attemptId
        ? snapshotRef.current?.attempts.find(
            (attempt) => attempt.id === context.attemptId,
          )?.request_message_id ?? undefined
        : context.responseId
          ? snapshotRef.current?.messages.find(
              (message) => message.id === context.responseId,
            )?.request_message_id ?? undefined
          : undefined);
    if (!messageId) return;
    await retryPersistedAttempt(messageId, context.attemptId);
  }, [draft, editDraft, editingMessageId, handleSend, retryPersistedAttempt]);

  const handleEditSave = useCallback(
    async (messageId: string) => {
      const id = currentConversationRef.current;
      const content = editDraft.trim();
      if (
        !id ||
        !content ||
        operationRef.current.status === "pending" ||
        isProcessingSnapshot(snapshotRef.current)
      )
        return;
      supersedeRefreshes();
      const branchKey =
        snapshotRef.current?.conversation?.selected_branch_id ??
        snapshotRef.current?.conversation?.active_branch_id ??
        "default";
      const idempotencyMapKey = `${id}:${branchKey}:edit:${messageId}:${content}`;
      const idempotencyKey = getOrCreateIdempotencyKey(idempotencyMapKey);
      updateOperation({ status: "pending", kind: "edit" });
      setActionError(null);
      setRefreshError(null);
      try {
        await editMessage(id, messageId, content, { idempotencyKey });
        clearIdempotencyKey(idempotencyMapKey);
        if (currentConversationRef.current === id) {
          setEditingMessageId(null);
          setEditDraft("");
        }
        const refreshed = await refreshAfterMutation(id);
        if (currentConversationRef.current === id) {
          updateOperation(
            refreshed
              ? { status: "idle" }
              : {
                  status: "error",
                  operation: {
                    kind: "edit",
                    message: "The edit was saved, but the conversation could not be refreshed.",
                    messageId,
                    idempotencyKey,
                    unknownOutcome: false,
                  },
                },
          );
        }
      } catch (error) {
        if (isAbortError(error) || currentConversationRef.current !== id) return;
        const details = lifecycleDetails(error);
        const refreshed = await refreshAfterMutation(id);
        const snapshot = snapshotRef.current;
        const failedRequest = snapshot?.messages.find(
          (message) =>
            message.role === "user" &&
            (message.status === "FAILED" ||
              latestAttempt(snapshot?.attempts ?? [], message.id)?.status === "FAILED") &&
            (message.parent_message_id === messageId ||
              normalizedQuestion(message.content) === normalizedQuestion(content)),
        );
        const failedMessageId = details.messageId ?? failedRequest?.id;
        const failedAttemptId =
          details.attemptId ?? latestAttempt(snapshot?.attempts ?? [], failedMessageId ?? "", true)?.id;
        if (!isUnknownOutcome(error) || failedMessageId || failedAttemptId) {
          clearIdempotencyKey(idempotencyMapKey);
        }
        if (currentConversationRef.current !== id) return;
        if (failedMessageId) {
          setEditingMessageId(null);
          setEditDraft("");
        }
        updateOperation({
          status: "error",
          operation: {
            kind: "edit",
            message: refreshed
              ? errorMessage(error, "We couldn't edit that message. Please try again.")
              : "We couldn't confirm the latest conversation state. Refresh before retrying.",
            messageId: failedMessageId,
            attemptId: failedAttemptId,
            idempotencyKey: isUnknownOutcome(error) && !failedMessageId && !failedAttemptId ? idempotencyKey : undefined,
            unknownOutcome: isUnknownOutcome(error) && !failedMessageId && !failedAttemptId,
          },
        });
      }
    },
    [clearIdempotencyKey, editDraft, getOrCreateIdempotencyKey, refreshAfterMutation, supersedeRefreshes, updateOperation],
  );
  editSaveRef.current = handleEditSave;

  const handleRegenerate = useCallback(
    async (responseMessageId: string) => {
      const id = currentConversationRef.current;
      const selectedMessage = snapshotRef.current?.messages.find(
        (message) => message.id === responseMessageId,
      );
      const requestId = selectedMessage?.request_message_id;
      if (
        !id ||
        operationRef.current.status === "pending" ||
        isProcessingSnapshot(snapshotRef.current) ||
        (requestId && latestAttempt(snapshotRef.current?.attempts ?? [], requestId)?.status === "FAILED")
      )
        return;
      supersedeRefreshes();
      const branchKey =
        snapshotRef.current?.conversation?.selected_branch_id ??
        snapshotRef.current?.conversation?.active_branch_id ??
        "default";
      const idempotencyMapKey = `${id}:${branchKey}:regenerate:${responseMessageId}`;
      const idempotencyKey = getOrCreateIdempotencyKey(idempotencyMapKey);
      updateOperation({ status: "pending", kind: "regenerate" });
      setActionError(null);
      setRefreshError(null);
      try {
        const result = await regenerateResponse(id, responseMessageId, { idempotencyKey });
        clearIdempotencyKey(idempotencyMapKey);
        const requestId =
          result?.student_message?.id ??
          snapshotRef.current?.messages.find(
            (message) => message.id === responseMessageId,
          )?.request_message_id;
        const responseId = result?.response_message?.id ?? result?.data?.id;
        const refreshed = await refreshAfterMutation(id);
        if (currentConversationRef.current === id) {
          const selectedResponseId =
            responseId ??
            (requestId
              ? groupMessages(snapshotRef.current?.messages ?? []).find(
                  (group) => group.key === `request:${requestId}`,
                )?.variants.at(-1)?.id
              : undefined);
          if (requestId && selectedResponseId) {
            setSelectedVariants((current) => ({
              ...current,
              [`request:${requestId}`]: selectedResponseId,
            }));
          }
          updateOperation(
            refreshed
              ? { status: "idle" }
              : {
                  status: "error",
                  operation: {
                    kind: "regenerate",
                    message: "The regenerated response was saved, but the conversation could not be refreshed.",
                    responseId: responseMessageId,
                    idempotencyKey,
                    unknownOutcome: false,
                  },
                },
          );
        }
      } catch (error) {
        if (isAbortError(error) || currentConversationRef.current !== id) return;
        const details = lifecycleDetails(error);
        const refreshed = await refreshAfterMutation(id);
        const snapshot = snapshotRef.current;
        const requestId = details.messageId ??
          snapshot?.messages.find(
            (message) =>
              message.role === "assistant" &&
              message.id === responseMessageId &&
              Boolean(message.request_message_id),
          )?.request_message_id ??
          undefined;
        const failedAttemptId =
          details.attemptId ??
          (requestId ? latestAttempt(snapshot?.attempts ?? [], requestId, true)?.id : undefined);
        if (!isUnknownOutcome(error) || requestId || failedAttemptId) {
          clearIdempotencyKey(idempotencyMapKey);
        }
        if (currentConversationRef.current !== id) return;
        updateOperation({
          status: "error",
          operation: {
            kind: "regenerate",
            message: refreshed
              ? errorMessage(error, "We couldn't regenerate the response. Please try again.")
              : "We couldn't confirm the latest conversation state. Refresh before retrying.",
            responseId: responseMessageId,
            messageId: requestId,
            attemptId: failedAttemptId,
            idempotencyKey: isUnknownOutcome(error) && !requestId && !failedAttemptId ? idempotencyKey : undefined,
            unknownOutcome: isUnknownOutcome(error) && !requestId && !failedAttemptId,
          },
        });
      }
    },
    [clearIdempotencyKey, getOrCreateIdempotencyKey, refreshAfterMutation, supersedeRefreshes, updateOperation],
  );
  regenerateRef.current = handleRegenerate;

  const handleFeedback = useCallback(
    async (
      responseMessageId: string,
      sentiment: "helpful" | "not helpful",
      reason?: (typeof AI_FEEDBACK_REASONS)[number],
    ) => {
      const id = currentConversationRef.current;
      if (
        !id ||
        operationRef.current.status === "pending" ||
        isProcessingSnapshot(snapshotRef.current) ||
        feedbackPendingRef.current
      )
        return;
      supersedeRefreshes();
      feedbackPendingRef.current = responseMessageId;
      setFeedbackPendingId(responseMessageId);
      setActionError(null);
      setRefreshError(null);
      try {
        const result = await submitConversationFeedback(id, responseMessageId, {
          sentiment,
          ...(reason ? { reason } : {}),
        });
        if (result?.feedback && currentConversationRef.current === id) {
          setFeedbackOverrides((current) => ({ ...current, [responseMessageId]: result.feedback }));
        }
        await refreshAfterMutation(id);
      } catch (error) {
        if (!isAbortError(error) && currentConversationRef.current === id) {
          setActionError(errorMessage(error, "We couldn't save your feedback."));
        }
      } finally {
        if (currentConversationRef.current === id) {
          feedbackPendingRef.current = null;
          setFeedbackPendingId(null);
        }
      }
    },
    [refreshAfterMutation, supersedeRefreshes],
  );

  const handleActivateBranch = useCallback(
    async (branchId: string) => {
      const id = currentConversationRef.current;
      if (!id || operationRef.current.status === "pending" || isProcessingSnapshot(snapshotRef.current)) return;
      supersedeRefreshes();
      updateOperation({ status: "pending", kind: "branch" });
      setActionError(null);
      setRefreshError(null);
      try {
        const data = await activateConversationBranch(id, branchId);
        if (currentConversationRef.current !== id) return;
        applySnapshot(id, normalizeSnapshot(data));
        updateOperation({ status: "idle" });
      } catch (error) {
        if (currentConversationRef.current === id) {
          setActionError(errorMessage(error, "We couldn't switch conversation branches."));
          updateOperation({ status: "idle" });
        }
      }
    },
    [applySnapshot, supersedeRefreshes, updateOperation],
  );

  const handleRename = useCallback(async () => {
    const id = currentConversationRef.current;
    const title = titleDraft.trim();
    if (
      !id ||
      !title ||
      settingsBusy ||
      settingsPendingRef.current ||
      operationRef.current.status === "pending" ||
      isProcessingSnapshot(snapshotRef.current)
    )
      return;
    supersedeRefreshes();
    settingsPendingRef.current = true;
    setSettingsBusy(true);
    setActionError(null);
    setRefreshError(null);
    try {
      const data = await renameConversation(id, title);
      if (currentConversationRef.current !== id) return;
      settingsPendingRef.current = false;
      const current = snapshotRef.current;
      if (current) {
        applySnapshot(id, { ...current, conversation: data.conversation });
      }
      setTitleDirty(false);
      updateOperation({ status: "idle" });
    } catch (error) {
      settingsPendingRef.current = false;
      if (currentConversationRef.current === id) {
        setActionError(errorMessage(error, "We couldn't rename this conversation."));
      }
    } finally {
      settingsPendingRef.current = false;
      if (currentConversationRef.current === id) setSettingsBusy(false);
    }
  }, [applySnapshot, settingsBusy, supersedeRefreshes, titleDraft, updateOperation]);

  const handleDelete = useCallback(async () => {
    const id = currentConversationRef.current;
    if (
      !id ||
      settingsBusy ||
      settingsPendingRef.current ||
      operationRef.current.status === "pending" ||
      isProcessingSnapshot(snapshotRef.current)
    )
      return;
    supersedeRefreshes();
    settingsPendingRef.current = true;
    setSettingsBusy(true);
    setActionError(null);
    setRefreshError(null);
    try {
      await deleteConversation(id);
      settingsPendingRef.current = false;
      if (currentConversationRef.current === id) navigate("/ai-teacher");
    } catch (error) {
      settingsPendingRef.current = false;
      if (currentConversationRef.current === id) {
        setActionError(errorMessage(error, "We couldn't delete this conversation."));
        setSettingsBusy(false);
      }
    }
  }, [navigate, settingsBusy, supersedeRefreshes]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshAbortRef.current?.abort();
      refreshSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const id = conversationId;
    updateOperation({ status: "idle" });
    setDraft("");
    setActionError(null);
    setRefreshError(null);
    setRefreshPending(false);
    setRefreshRequired(false);
    setFeedbackPendingId(null);
    feedbackPendingRef.current = null;
    setFeedbackOverrides({});
    setFeedbackReasons({});
    setEditingMessageId(null);
    setEditDraft("");
    setSelectedVariants({});
    setTitleDirty(false);
    setSettingsBusy(false);
    settingsPendingRef.current = false;
    snapshotRef.current = null;

    if (!id) {
      setThread({
        status: "unavailable",
        title: "Conversation unavailable",
        description: "This conversation link is incomplete. Start a new conversation from AI Teacher.",
      });
      return;
    }

    setThread({ status: "loading" });
    void refreshSnapshot(id, { force: true, showLoading: true });
    return () => {
      if (refreshInFlightRef.current?.id === id) {
        refreshSequenceRef.current += 1;
        const entry = refreshInFlightRef.current;
        entry.controller.abort();
        refreshInFlightRef.current = null;
      }
    };
  }, [conversationId, refreshSnapshot, updateOperation]);

  useEffect(() => {
    const question = initialQuestion.trim();
    const initialKey = conversationId && question ? `${conversationId}:${question}` : null;
    if (!initialKey || initialSentRef.current === initialKey) return;
    initialSentRef.current = initialKey;
    void handleSend(question);
  }, [conversationId, handleSend, initialQuestion]);

  const snapshot = thread.status === "success" ? thread.snapshot : null;
  const messages = snapshot?.messages ?? [];
  const groups = useMemo(() => groupMessages(messages), [messages]);
  const feedbackByResponse = useMemo(
    () => feedbackMap(snapshot ?? { messages: [], branches: [], attempts: [], activeAttempt: null, processingAttempt: null, feedback: [] }, feedbackOverrides),
    [feedbackOverrides, snapshot],
  );
  const processing = isProcessingSnapshot(snapshot);
  const operationPending = operation.status === "pending";
  const controlsLocked =
    operationPending ||
    feedbackPendingId !== null ||
    settingsBusy ||
    refreshPending ||
    refreshRequired ||
    processing ||
    thread.status === "loading";
  const failedOperation = operation.status === "error" ? operation.operation : null;
  const sendBlockedByPersistedFailure = Boolean(
    failedOperation?.messageId ||
      failedOperation?.attemptId ||
      hasUnresolvedFailedRequest(snapshot),
  );
  const failedOperationCanRetry = Boolean(
    failedOperation &&
      (failedOperation.messageId ||
        failedOperation.attemptId ||
        ((failedOperation.kind === "send" ||
          failedOperation.kind === "edit" ||
          failedOperation.kind === "regenerate") &&
          failedOperation.unknownOutcome)),
  );

  useEffect(() => {
    if (!snapshot || refreshRequired || processing || operation.status !== "error") return;
    const context = operation.operation;
    if (context.attemptId) {
      const attempt = snapshot.attempts.find((item) => item.id === context.attemptId);
      if (attempt?.status === "COMPLETED") {
        updateOperation({ status: "idle" });
        setActionError(null);
      }
      return;
    }
    if (context.messageId) {
      const requestMessage = snapshot.messages.find(
        (message) => message.id === context.messageId && message.role === "user",
      );
      const hasResponse = snapshot.messages.some(
        (message) => message.role === "assistant" && message.request_message_id === context.messageId,
      );
      if (requestMessage?.status === "COMPLETED" && hasResponse) {
        updateOperation({ status: "idle" });
        setActionError(null);
      }
      return;
    }
    if (context.kind === "send" && context.question) {
      const requestMessage = snapshot.messages.find(
        (message) =>
          message.role === "user" &&
          normalizedQuestion(message.content) === normalizedQuestion(context.question ?? ""),
      );
      const hasResponse = requestMessage
        ? snapshot.messages.some(
            (message) => message.role === "assistant" && message.request_message_id === requestMessage.id,
          )
        : false;
      if (requestMessage?.status === "COMPLETED" || hasResponse) {
        setDraft("");
        updateOperation({ status: "idle" });
        setActionError(null);
      }
    }
  }, [operation, processing, refreshRequired, snapshot, updateOperation]);

  useEffect(() => {
    if (!processing || !conversationId) return;
    let disposed = false;
    let timer: number | undefined;

    const schedule = () => {
      if (disposed) return;
      timer = window.setTimeout(() => {
        if (disposed) return;
        const inFlight = refreshInFlightRef.current;
        if (inFlight?.id === conversationId) {
          schedule();
          return;
        }
        if (
          operationRef.current.status === "pending" ||
          feedbackPendingRef.current ||
          settingsPendingRef.current
        ) {
          schedule();
          return;
        }
        void refreshSnapshot(conversationId, { force: false }).finally(schedule);
      }, 2_000);
    };

    schedule();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [conversationId, processing, refreshSnapshot]);

  useEffect(() => {
    if (snapshot?.conversation && !titleDirty) {
      setTitleDraft(snapshot.conversation.title ?? "New Conversation");
    }
  }, [snapshot?.conversation, titleDirty]);

  useEffect(() => {
    const anchor = bottomRef.current;
    if (anchor && typeof anchor.scrollIntoView === "function") {
      anchor.scrollIntoView({ block: "end" });
    }
  }, [groups.length, controlsLocked]);

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
          onRetry={() => void handleRefresh()}
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

  const conversation = snapshot?.conversation;
  const branches = snapshot?.branches ?? [];
  const selectedResponse = (group: MessageGroup) => {
    const selectedId = selectedVariants[group.key];
    const index = selectedId
      ? group.variants.findIndex((message) => message.id === selectedId)
      : group.variants.length - 1;
    return index >= 0 ? index : Math.max(0, group.variants.length - 1);
  };

  const selectPreviousVariant = (group: MessageGroup) => {
    const index = selectedResponse(group);
    if (index <= 0) return;
    const next = group.variants[index - 1];
    setSelectedVariants((current) => ({ ...current, [group.key]: next.id }));
  };

  const selectNextVariant = (group: MessageGroup) => {
    const index = selectedResponse(group);
    if (index >= group.variants.length - 1) return;
    const next = group.variants[index + 1];
    setSelectedVariants((current) => ({ ...current, [group.key]: next.id }));
  };

  const renderUserMessage = (group: MessageGroup) => {
    const message = group.request;
    if (!message) return null;
    const hasResponse = group.variants.length > 0;
    const latestRequestAttempt = latestAttempt(snapshot?.attempts ?? [], message.id);
    const isProcessing = requestIsProcessing(snapshot, message.id, message.status);
    const isFailed =
      (message.status === "FAILED" || latestRequestAttempt?.status === "FAILED") && !hasResponse;
    const failedAttempt = isFailed && latestRequestAttempt?.status === "FAILED"
      ? latestRequestAttempt
      : undefined;
    const hasGlobalRetry =
      failedOperation?.messageId === message.id ||
      (failedOperation?.attemptId !== undefined && failedOperation.attemptId === latestRequestAttempt?.id);
    const canRetry = isFailed && !processing && !hasGlobalRetry;
    return (
      <li key={`user:${message.id}`} className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary-600 px-4 py-3 text-white sm:max-w-[70%]">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-100">You</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{message.content}</p>
          {isProcessing ? <Badge variant="info" className="mt-2">Processing</Badge> : null}
          {isFailed ? (
            <div className="mt-2 space-y-1">
              <Badge variant="error">Generation failed</Badge>
              {canRetry ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary-100 hover:bg-primary-500 hover:text-white"
                  disabled={controlsLocked}
                  onClick={() => void handlePersistedRetry(message.id)}
                >
                  Retry generation
                </Button>
              ) : null}
            </div>
          ) : null}
          {!isProcessing && !isFailed ? (
            editingMessageId === message.id ? (
              <div className="mt-2 space-y-2">
                <label htmlFor={`edit-message-${message.id}`} className="sr-only">Edit message</label>
                <textarea
                  id={`edit-message-${message.id}`}
                  value={editDraft}
                  onChange={(event) => setEditDraft(event.target.value)}
                  rows={3}
                  maxLength={20_000}
                  disabled={controlsLocked}
                  className="w-full rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  loading={operationPending && operation.kind === "edit"}
                  disabled={!editDraft.trim() || controlsLocked}
                  onClick={() => void handleEditSave(message.id)}
                >
                  Save edited message
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={controlsLocked}
                className="mt-2 text-primary-100 hover:bg-primary-500 hover:text-white"
                onClick={() => {
                  setEditingMessageId(message.id);
                  setEditDraft(message.content);
                }}
              >
                Edit message
              </Button>
            )
          ) : null}
          {failedAttempt ? <span className="sr-only">Failed attempt {failedAttempt.id}</span> : null}
        </div>
      </li>
    );
  };

  const renderAssistantGroup = (group: MessageGroup) => {
    if (group.variants.length === 0) return null;
    const index = selectedResponse(group);
    const message = group.variants[index];
    const requestId = message.request_message_id ?? null;
    const feedback = feedbackByResponse.get(message.id);
    const latestRequestAttempt = requestId
      ? latestAttempt(snapshot?.attempts ?? [], requestId)
      : undefined;
    const failedAttempt = latestRequestAttempt?.status === "FAILED"
      ? latestRequestAttempt
      : undefined;
    const requestProcessing = requestId
      ? requestIsProcessing(snapshot, requestId, message.status)
      : message.status === "PROCESSING";
    const canRegenerate = Boolean(
      requestId && message.regeneration_available !== false,
    );
    const hasGlobalRetry =
      Boolean(requestId && failedOperation?.messageId === requestId) ||
      (failedOperation?.attemptId !== undefined && failedOperation.attemptId === failedAttempt?.id);
    const responseFailed = Boolean(failedAttempt || (requestId && message.status === "FAILED"));
    const sentiment = String(feedback?.sentiment ?? "").toUpperCase() === "NOT_HELPFUL"
      ? "Not helpful"
      : "Helpful";

    return (
      <li key={`assistant:${group.key}`} className="flex justify-start">
        <div
          className="max-w-[85%] rounded-xl rounded-bl-sm border border-neutral-200 bg-white px-4 py-3 sm:max-w-[70%]"
          aria-label={`Selected response ${index + 1} of ${group.variants.length}`}
          aria-current="true"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">AI Teacher</p>
          <p className="mt-1 text-sm text-neutral-900 whitespace-pre-wrap">{message.content}</p>
          {requestProcessing ? <Badge variant="info" className="mt-2">Processing</Badge> : null}
          {responseFailed && !requestProcessing ? (
            <div className="mt-2 space-y-1">
              <Badge variant="error">Generation failed</Badge>
              {!hasGlobalRetry ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={controlsLocked}
                  onClick={() => void handlePersistedRetry(requestId ?? message.id)}
                >
                  Retry generation
                </Button>
              ) : null}
            </div>
          ) : null}
          {group.variants.length > 1 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={index === 0 || controlsLocked}
                onClick={() => selectPreviousVariant(group)}
              >
                Previous variant
              </Button>
              <span className="text-xs text-neutral-600" aria-live="polite">
                Response {index + 1} of {group.variants.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={index === group.variants.length - 1 || controlsLocked}
                onClick={() => selectNextVariant(group)}
              >
                Next variant
              </Button>
            </div>
          ) : null}
          <div className="mt-3 space-y-2 border-t border-neutral-200 pt-2">
              {canRegenerate ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={controlsLocked || Boolean(failedAttempt)}
                  onClick={() => void handleRegenerate(message.id)}
                >
                  Regenerate response
                </Button>
              ) : null}
              {feedback ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success">Feedback submitted</Badge>
                  <span className="text-xs text-neutral-600">{sentiment}</span>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={controlsLocked || feedbackPendingId === message.id}
                      onClick={() => void handleFeedback(message.id, "helpful")}
                    >
                      Helpful
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={controlsLocked || feedbackPendingId === message.id}
                      onClick={() => void handleFeedback(
                        message.id,
                        "not helpful",
                        (feedbackReasons[message.id] ?? "not clear") as (typeof AI_FEEDBACK_REASONS)[number],
                      )}
                    >
                      Not helpful
                    </Button>
                  </div>
                  <label className="sr-only" htmlFor={`feedback-reason-${message.id}`}>
                    Feedback reason for response {index + 1}
                  </label>
                  <select
                    id={`feedback-reason-${message.id}`}
                    value={feedbackReasons[message.id] ?? "not clear"}
                    onChange={(event) =>
                      setFeedbackReasons((current) => ({
                        ...current,
                        [message.id]: event.target.value,
                      }))
                    }
                    disabled={controlsLocked || feedbackPendingId === message.id}
                    className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    {AI_FEEDBACK_REASONS.map((reason) => (
                      <option key={reason} value={reason}>{reason}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
        </div>
      </li>
    );
  };

  const thinking = operationPending || processing;

  return (
    <Container className="py-8">
      <div className="space-y-6">
        <Breadcrumb items={[{ label: "AI Teacher", href: "/ai-teacher" }, { label: "Conversation" }]} />
        <PageHeader
          title={conversation?.title ?? "Conversation"}
          description={
            conversation?.scope
              ? [
                  conversation.scope.board,
                  conversation.scope.class,
                  conversation.scope.subject,
                  conversation.scope.chapter,
                  conversation.scope.topic,
                ]
                  .filter((value): value is string => Boolean(value))
                  .join(" · ") || undefined
              : undefined
          }
        />

        {branches.length > 0 ? (
          <Card>
            <CardContent className="space-y-2">
              <h2 className="card-title">Conversation branches</h2>
              <p className="caption">Active branch: {activeBranchLabel(branches, conversation)}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Conversation branches">
                {branches.map((branch) => {
                  const editedBranchNumber = branches
                    .filter((candidate) => !candidate.is_primary)
                    .findIndex((candidate) => candidate.id === branch.id) + 1;
                  const label = branch.name?.trim() || (branch.is_primary ? "Primary branch" : `Edited branch ${editedBranchNumber}`);
                  const activeBranchId =
                    conversation?.active_branch_id ?? conversation?.selected_branch_id;
                  const hasActiveBranchId = branches.some((item) => item.id === activeBranchId);
                  const isActive = hasActiveBranchId
                    ? branch.id === activeBranchId
                    : branch.is_active;
                  return (
                    <Button
                      key={branch.id}
                      variant={isActive ? "primary" : "secondary"}
                      size="sm"
                      disabled={isActive || controlsLocked}
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => void handleActivateBranch(branch.id)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="space-y-3">
            <h2 className="card-title">Conversation settings</h2>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <label htmlFor="conversation-title" className="text-sm font-medium text-neutral-900">
                  Conversation title
                </label>
                <input
                  id="conversation-title"
                  value={titleDraft}
                  onChange={(event) => {
                    setTitleDraft(event.target.value);
                    setTitleDirty(true);
                  }}
                  maxLength={255}
                  disabled={controlsLocked}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
              </div>
              <Button
                variant="secondary"
                loading={settingsBusy}
                disabled={!titleDraft.trim() || settingsBusy || controlsLocked}
                onClick={() => void handleRename()}
              >
                Save title
              </Button>
              <Button variant="ghost" disabled={settingsBusy || controlsLocked} onClick={() => void handleDelete()}>
                Delete conversation
              </Button>
            </div>
          </CardContent>
        </Card>

        {actionError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error-subtle bg-white px-4 py-3">
            <p className="text-sm font-medium text-error">{actionError}</p>
            <Button variant="ghost" size="sm" onClick={() => setActionError(null)}>Dismiss</Button>
          </div>
        ) : null}
        {refreshError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error-subtle bg-white px-4 py-3">
            <p className="text-sm font-medium text-error">{refreshError}</p>
            <Button variant="secondary" size="sm" disabled={refreshPending} onClick={() => void handleRefresh()}>
              Refresh conversation
            </Button>
          </div>
        ) : null}

        {messages.length === 0 && !thinking ? (
          <Card>
            <CardContent className="space-y-3">
              <h2 className="card-title">Start the conversation</h2>
              <p className="secondary">Ask your first question below, or pick a starter.</p>
              <ul className="flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <li key={prompt}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={controlsLocked}
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
            {groups.map((group) => (
              <Fragment key={group.key}>
                {renderUserMessage(group)}
                {renderAssistantGroup(group)}
              </Fragment>
            ))}
            {thinking ? (
              <li className="flex justify-start">
                <p role="status" className="rounded-xl rounded-bl-sm border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
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
            <label htmlFor="ai-composer" className="text-sm font-medium text-neutral-900">Message AI Teacher</label>
            <textarea
              id="ai-composer"
              rows={3}
              value={draft}
              disabled={controlsLocked || sendBlockedByPersistedFailure}
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
                loading={operationPending && operation.kind === "send"}
                disabled={draft.trim() === "" || controlsLocked || sendBlockedByPersistedFailure}
                onClick={() => void handleSend(draft)}
              >
                Send
              </Button>
              {failedOperation ? (
                <div role="alert" className="space-y-1">
                  <p className="text-sm font-medium text-error">{failedOperation.message}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={controlsLocked || !failedOperationCanRetry}
                    onClick={() => void handleRetry()}
                  >
                    {failedOperation.kind === "send" ? "Retry send" : "Retry generation"}
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
