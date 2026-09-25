import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import AiConversationPage from "../pages/AiConversationPage";
import {
  editMessage,
  getConversationMessages,
  regenerateResponse,
  retryGeneration,
  sendMessage,
  submitConversationFeedback,
} from "../services/api/ai";
import { ApiError } from "../services/api/errors";
import type {
  AiMessage,
  ConversationMessagesResponse,
  GenerationResponse,
} from "../types/ai";

vi.mock("../services/api/ai", () => ({
  activateConversationBranch: vi.fn(),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  editMessage: vi.fn(),
  getConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  regenerateResponse: vi.fn(),
  renameConversation: vi.fn(),
  retryGeneration: vi.fn(),
  sendMessage: vi.fn(),
  submitConversationFeedback: vi.fn(),
}));

const mockedGetMessages = vi.mocked(getConversationMessages);
const mockedSendMessage = vi.mocked(sendMessage);
const mockedEditMessage = vi.mocked(editMessage);
const mockedRegenerateResponse = vi.mocked(regenerateResponse);
const mockedRetryGeneration = vi.mocked(retryGeneration);
const mockedSubmitFeedback = vi.mocked(submitConversationFeedback);

const threadFixture: AiMessage[] = [
  {
    id: "msg-1",
    role: "user",
    content: "What is 2 + 2?",
    created_at: "2026-09-17T00:00:00.000Z",
  },
  {
    id: "msg-2",
    role: "assistant",
    content: "2 + 2 equals 4.",
    created_at: "2026-09-17T00:00:05.000Z",
  },
];

const threadResponse: ConversationMessagesResponse = {
  status: "success",
  messages: threadFixture,
  total: 2,
};

const successfulGeneration: GenerationResponse = {
  status: "success",
  message: "AI reply created successfully",
  conversation: { id: "conv-1", subject: null, topic: null },
  student_message: {
    id: "msg-3",
    role: "user",
    content: "New question",
    created_at: "2026-09-17T00:00:30.000Z",
  },
  response_message: {
    id: "msg-4",
    role: "assistant",
    content: "New answer.",
    created_at: "2026-09-17T00:01:00.000Z",
  },
  data: {
    id: "msg-4",
    role: "assistant",
    content: "New answer.",
    created_at: "2026-09-17T00:01:00.000Z",
  },
  attempt: {
    id: "attempt-1",
    conversation_id: "conv-1",
    request_message_id: "msg-3",
    response_message_id: "msg-4",
    attempt_type: "ORIGINAL",
    attempt_number: 1,
    retry_of_attempt_id: null,
    parent_attempt_id: null,
    status: "COMPLETED",
    provider: "mock",
    model: "mock-model",
    request_id: null,
    error_category: null,
    usage_event_id: null,
    started_at: "2026-09-17T00:00:30.000Z",
    completed_at: "2026-09-17T00:01:00.000Z",
  },
  generation_status: "COMPLETED",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/ai-teacher/conv-1"]}>
      <Routes>
        <Route
          path="/ai-teacher/:conversationId"
          element={<AiConversationPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderPageWithInitialQuestion(initialQuestion: string) {
  return render(
    <MemoryRouter
      initialEntries={[
        { pathname: "/ai-teacher/conv-1", state: { initialQuestion } },
      ]}
    >
      <Routes>
        <Route
          path="/ai-teacher/:conversationId"
          element={<AiConversationPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function NavigationHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/ai-teacher/conv-b")}>Open B</button>
      <Routes>
        <Route path="/ai-teacher/:conversationId" element={<AiConversationPage />} />
      </Routes>
    </>
  );
}

describe("AI conversation thread (AiConversationPage)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetMessages.mockResolvedValue(threadResponse);
    mockedSendMessage.mockResolvedValue(successfulGeneration);
    mockedEditMessage.mockResolvedValue(successfulGeneration);
    mockedRegenerateResponse.mockResolvedValue(successfulGeneration);
    mockedRetryGeneration.mockResolvedValue(successfulGeneration);
    mockedSubmitFeedback.mockResolvedValue({
      status: "success",
      feedback: {
        id: "feedback-1",
        conversation_id: "conv-1",
        response_message_id: "msg-2",
        sentiment: "HELPFUL",
        reason: null,
        created_at: "2026-09-17T00:01:00.000Z",
        updated_at: "2026-09-17T00:01:00.000Z",
      },
    });
  });

  it("shows a loading skeleton while fetching", () => {
    mockedGetMessages.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading this conversation…")).toBeInTheDocument();
  });

  it("renders messages chronologically with speaker distinction", async () => {
    renderPage();

    expect(mockedGetMessages).toHaveBeenCalledWith(
      "conv-1",
      undefined,
      expect.objectContaining({ signal: expect.anything() }),
    );
    const list = await screen.findByRole("list", {
      name: "Conversation messages",
    });
    expect(list).toBeInTheDocument();
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("You");
    expect(items[0]).toHaveTextContent("What is 2 + 2?");
    expect(items[1]).toHaveTextContent("AI Teacher");
    expect(items[1]).toHaveTextContent("2 + 2 equals 4.");
  });

  it("shows an empty state with starters for a fresh conversation", async () => {
    mockedGetMessages.mockResolvedValue({ status: "success", messages: [], total: 0 });
    renderPage();

    expect(await screen.findByText("Start the conversation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Explain this topic in simple terms" }),
    ).toBeInTheDocument();
  });

  it("shows persisted failed requests with a dedicated retry action", async () => {
    const user = userEvent.setup();
    mockedGetMessages.mockResolvedValue({
      status: "success",
      messages: [
        {
          id: "failed-message",
          role: "user",
          content: "Explain this",
          status: "FAILED",
          created_at: "2026-09-17T00:00:00.000Z",
        },
      ],
      total: 1,
    });
    mockedRetryGeneration.mockResolvedValue(successfulGeneration);
    renderPage();

    expect(await screen.findByText("Generation failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry generation" }));
    expect(mockedRetryGeneration).toHaveBeenCalledWith("conv-1", undefined, "failed-message");
  });

  it("does not offer another retry after a failed request has a response", async () => {
    mockedGetMessages.mockResolvedValue({
      status: "success",
      messages: [
        {
          id: "recovered-request",
          role: "user",
          content: "Explain this",
          status: "FAILED",
          request_message_id: null,
          created_at: "2026-09-17T00:00:00.000Z",
        },
        {
          id: "recovered-response",
          role: "assistant",
          content: "Recovered answer.",
          request_message_id: "recovered-request",
          created_at: "2026-09-17T00:00:01.000Z",
        },
      ],
      total: 2,
    });
    renderPage();

    expect(await screen.findByText("Recovered answer.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry generation" })).not.toBeInTheDocument();
  });

  it("shows an unavailable state for a missing conversation", async () => {
    mockedGetMessages.mockRejectedValue(
      new ApiError("NOT_FOUND", "Conversation not found", 404),
    );
    renderPage();

    expect(
      await screen.findByText("Conversation unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to AI Teacher" }),
    ).toHaveAttribute("href", "/ai-teacher");
  });

  it("shows an error state with retry on load failure", async () => {
    const user = userEvent.setup();
    mockedGetMessages
      .mockRejectedValueOnce(
        new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
      )
      .mockResolvedValueOnce(threadResponse);
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
  });

  it("sends the landing page's initial question once through the real flow", async () => {
    renderPageWithInitialQuestion("Explain fractions");
    await screen.findByText("What is 2 + 2?");

    await waitFor(() =>
      expect(mockedSendMessage).toHaveBeenCalledWith(
        "conv-1",
        { question: "Explain fractions" },
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
    // Exactly once despite re-renders from the send/refresh cycle.
    await waitFor(() => expect(mockedGetMessages).toHaveBeenCalled());
    expect(mockedSendMessage).toHaveBeenCalledTimes(1);
  });

  it("sends a message, shows thinking state, and refreshes the thread", async () => {
    const user = userEvent.setup();
    let resolveReply: (value: GenerationResponse) => void = () => {};
    mockedSendMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveReply = resolve;
      }),
    );
    renderPage();
    await screen.findByText("What is 2 + 2?");

    await user.type(screen.getByLabelText(/Message AI Teacher/), "And 3 + 3?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(mockedSendMessage).toHaveBeenCalledTimes(1);
    expect(mockedSendMessage).toHaveBeenCalledWith(
      "conv-1",
      { question: "And 3 + 3?" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(await screen.findByText("AI Teacher is thinking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    resolveReply(successfulGeneration);

    await waitFor(() => expect(mockedGetMessages).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("AI Teacher is thinking…")).not.toBeInTheDocument();
  });

  it("blocks whitespace-only messages and prevents duplicate sends", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("What is 2 + 2?");

    const composer = screen.getByLabelText(/Message AI Teacher/);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(composer, "   ");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(mockedSendMessage).not.toHaveBeenCalled();
  });

  it("preserves the draft and offers retry when sending fails", async () => {
    const user = userEvent.setup();
    mockedSendMessage.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
    );
    renderPage();
    await screen.findByText("What is 2 + 2?");

    await user.type(screen.getByLabelText(/Message AI Teacher/), "Hello?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the server.",
    );
    expect(screen.getByLabelText(/Message AI Teacher/)).toHaveValue("Hello?");

    mockedSendMessage.mockResolvedValue(successfulGeneration);
    await user.click(screen.getByRole("button", { name: "Retry send" }));
    expect(mockedSendMessage).toHaveBeenCalledTimes(2);
    const firstKey = (mockedSendMessage.mock.calls[0]?.[2] as { idempotencyKey?: string } | undefined)?.idempotencyKey;
    const secondKey = (mockedSendMessage.mock.calls[1]?.[2] as { idempotencyKey?: string } | undefined)?.idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
    expect(secondKey).toBe(firstKey);
  });

  it("uses the persisted attempt for retry when the server returns lifecycle details", async () => {
    const user = userEvent.setup();
    mockedSendMessage.mockRejectedValueOnce(
      new ApiError("REQUEST_FAILED", "Generation failed.", 500, {
        attempt: { id: "attempt-1" },
        student_message: { id: "message-1" },
      }),
    );
    mockedRetryGeneration.mockResolvedValue({
      status: "success",
      conversation: { id: "conv-1", subject: null, topic: null },
      student_message: {
        id: "message-1",
        role: "user",
        content: "Hello?",
        created_at: "2026-09-17T00:00:00.000Z",
      },
      response_message: {
        id: "message-2",
        role: "assistant",
        content: "Recovered answer.",
        created_at: "2026-09-17T00:01:00.000Z",
      },
      data: {
        id: "message-2",
        role: "assistant",
        content: "Recovered answer.",
        created_at: "2026-09-17T00:01:00.000Z",
      },
      attempt: {
        id: "attempt-2",
        conversation_id: "conv-1",
        request_message_id: "message-1",
        response_message_id: "message-2",
        attempt_type: "RETRY",
        attempt_number: 2,
        retry_of_attempt_id: "attempt-1",
        parent_attempt_id: null,
        status: "COMPLETED",
        provider: "mock",
        model: "mock-model",
        request_id: null,
        error_category: null,
        usage_event_id: null,
        started_at: "2026-09-17T00:00:00.000Z",
        completed_at: "2026-09-17T00:01:00.000Z",
      },
      generation_status: "COMPLETED",
    });
    renderPage();
    await screen.findByText("What is 2 + 2?");

    await user.type(screen.getByLabelText(/Message AI Teacher/), "Hello?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Generation failed.");

    await user.click(screen.getByRole("button", { name: "Retry send" }));
    expect(mockedRetryGeneration).toHaveBeenCalledWith("conv-1", "attempt-1", "message-1");
    expect(mockedSendMessage).toHaveBeenCalledTimes(1);
  });

  it("refreshes a failed edit and retries its persisted attempt without another edit", async () => {
    const user = userEvent.setup();
    mockedEditMessage.mockRejectedValueOnce(
      new ApiError("REQUEST_FAILED", "Edited generation failed.", 502, {
        student_message: { id: "edited-request" },
        attempt: { id: "edited-attempt", status: "FAILED" },
      }),
    );
    mockedGetMessages.mockResolvedValueOnce(threadResponse).mockResolvedValueOnce({
      status: "success",
      total: 1,
      messages: [
        {
          id: "edited-request",
          role: "user",
          content: "Edited question",
          status: "FAILED",
          parent_message_id: "msg-1",
          created_at: "2026-09-17T00:01:00.000Z",
        },
      ],
      attempts: [
        {
          id: "edited-attempt",
          conversation_id: "conv-1",
          request_message_id: "edited-request",
          response_message_id: null,
          attempt_type: "ORIGINAL",
          attempt_number: 1,
          retry_of_attempt_id: null,
          parent_attempt_id: null,
          status: "FAILED",
          provider: "mock",
          model: "mock-model",
          request_id: null,
          error_category: "provider_error",
          usage_event_id: null,
          started_at: "2026-09-17T00:01:00.000Z",
          completed_at: "2026-09-17T00:01:01.000Z",
        },
      ],
    } satisfies ConversationMessagesResponse);
    renderPage();
    await screen.findByText("What is 2 + 2?");

    await user.click(screen.getByRole("button", { name: "Edit message" }));
    const editor = screen.getByLabelText("Edit message");
    await user.clear(editor);
    await user.type(editor, "Edited question");
    await user.click(screen.getByRole("button", { name: "Save edited message" }));

    expect(await screen.findByText("Generation failed")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Retry generation" })[0]);
    expect(mockedRetryGeneration).toHaveBeenCalledWith(
      "conv-1",
      "edited-attempt",
      "edited-request",
    );
    expect(mockedEditMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest navigation state when an older request resolves late", async () => {
    const user = userEvent.setup();
    let resolveA: (value: ConversationMessagesResponse) => void = () => {};
    let resolveB: (value: ConversationMessagesResponse) => void = () => {};
    mockedGetMessages.mockImplementation((conversationId) => {
      if (conversationId === "conv-a") {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveB = resolve;
      });
    });

    render(
      <MemoryRouter initialEntries={["/ai-teacher/conv-a"]}>
        <NavigationHarness />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockedGetMessages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Open B" }));
    await waitFor(() => expect(mockedGetMessages).toHaveBeenCalledWith(
      "conv-b",
      undefined,
      expect.objectContaining({ signal: expect.anything() }),
    ));

    await act(async () => {
      resolveB({
        status: "success",
        total: 1,
        messages: [
          {
            id: "b-user",
            role: "user",
            content: "B answer",
            status: "COMPLETED",
            created_at: "2026-09-17T00:00:00.000Z",
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("B answer")).toBeInTheDocument();

    await act(async () => {
      resolveA({
        status: "success",
        total: 1,
        messages: [
          {
            id: "a-user",
            role: "user",
            content: "A answer",
            status: "COMPLETED",
            created_at: "2026-09-17T00:00:00.000Z",
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("B answer")).toBeInTheDocument();
    expect(screen.queryByText("A answer")).not.toBeInTheDocument();
  });

  it("resumes polling from a processing attempt and disables conflicting controls", async () => {
    vi.useFakeTimers();
    const processingResponse: ConversationMessagesResponse = {
      status: "success",
      total: 1,
      messages: [
        {
          id: "processing-request",
          role: "user",
          content: "Explain this",
          status: "PROCESSING",
          created_at: "2026-09-17T00:00:00.000Z",
        },
      ],
      attempts: [
        {
          id: "processing-attempt",
          conversation_id: "conv-1",
          request_message_id: "processing-request",
          response_message_id: null,
          attempt_type: "RETRY",
          attempt_number: 2,
          retry_of_attempt_id: "failed-attempt",
          parent_attempt_id: null,
          status: "PROCESSING",
          provider: "mock",
          model: "mock-model",
          request_id: null,
          error_category: null,
          usage_event_id: null,
          started_at: "2026-09-17T00:00:00.000Z",
          completed_at: null,
        },
      ],
      active_attempt: {
        id: "processing-attempt",
        conversation_id: "conv-1",
        request_message_id: "processing-request",
        response_message_id: null,
        attempt_type: "RETRY",
        attempt_number: 2,
        retry_of_attempt_id: "failed-attempt",
        parent_attempt_id: null,
        status: "PROCESSING",
        provider: "mock",
        model: "mock-model",
        request_id: null,
        error_category: null,
        usage_event_id: null,
        started_at: "2026-09-17T00:00:00.000Z",
        completed_at: null,
      },
      processing_attempt: {
        id: "processing-attempt",
        conversation_id: "conv-1",
        request_message_id: "processing-request",
        response_message_id: null,
        attempt_type: "RETRY",
        attempt_number: 2,
        retry_of_attempt_id: "failed-attempt",
        parent_attempt_id: null,
        status: "PROCESSING",
        provider: "mock",
        model: "mock-model",
        request_id: null,
        error_category: null,
        usage_event_id: null,
        started_at: "2026-09-17T00:00:00.000Z",
        completed_at: null,
      },
    };
    mockedGetMessages.mockResolvedValueOnce(processingResponse);
    mockedGetMessages.mockResolvedValueOnce({
      status: "success",
      total: 2,
      messages: [
        { ...processingResponse.messages[0], status: "COMPLETED" },
        {
          id: "processing-response",
          role: "assistant",
          content: "Finished answer",
          request_message_id: "processing-request",
          generation_attempt_id: "processing-attempt",
          regeneration_available: true,
          status: "COMPLETED",
          created_at: "2026-09-17T00:00:01.000Z",
        },
      ],
      attempts: [
        {
          ...processingResponse.attempts![0],
          response_message_id: "processing-response",
          status: "COMPLETED",
          completed_at: "2026-09-17T00:00:01.000Z",
        },
      ],
    });

    renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByLabelText(/Message AI Teacher/)).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockedGetMessages).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Finished answer")).toBeInTheDocument();
    expect(screen.getByLabelText(/Message AI Teacher/)).toBeEnabled();
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(mockedGetMessages).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("refreshes a failed send and retries the persisted attempt instead of creating a branch", async () => {
    const user = userEvent.setup();
    const failedHistory: ConversationMessagesResponse = {
      status: "success",
      total: 1,
      messages: [
        {
          id: "persisted-request",
          role: "user",
          content: "Persisted question",
          status: "FAILED",
          created_at: "2026-09-17T00:00:00.000Z",
        },
      ],
      branches: [
        {
          id: "primary-branch",
          conversation_id: "conv-1",
          parent_branch_id: null,
          branch_point_message_id: null,
          name: null,
          is_primary: true,
          is_active: true,
          created_at: "2026-09-17T00:00:00.000Z",
          updated_at: "2026-09-17T00:00:00.000Z",
        },
      ],
      attempts: [
        {
          id: "persisted-attempt",
          conversation_id: "conv-1",
          request_message_id: "persisted-request",
          response_message_id: null,
          attempt_type: "ORIGINAL",
          attempt_number: 1,
          retry_of_attempt_id: null,
          parent_attempt_id: null,
          status: "FAILED",
          provider: "mock",
          model: "mock-model",
          request_id: null,
          error_category: "provider_error",
          usage_event_id: null,
          started_at: "2026-09-17T00:00:00.000Z",
          completed_at: "2026-09-17T00:00:01.000Z",
        },
      ],
    };
    mockedSendMessage.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "The request outcome is unknown.", 0),
    );
    mockedGetMessages
      .mockResolvedValueOnce(threadResponse)
      .mockResolvedValueOnce(failedHistory);
    mockedRetryGeneration.mockResolvedValue(successfulGeneration);
    renderPage();
    await screen.findByText("What is 2 + 2?");

    await user.type(screen.getByLabelText(/Message AI Teacher/), "Persisted question");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Persisted question")).toBeInTheDocument();
    expect(screen.getByText("Generation failed")).toBeInTheDocument();
    expect(screen.getByText("Active branch: Primary branch")).toBeInTheDocument();
    expect(screen.getByLabelText(/Message AI Teacher/)).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Retry send" }));
    expect(mockedRetryGeneration).toHaveBeenCalledWith(
      "conv-1",
      "persisted-attempt",
      "persisted-request",
    );
    expect(mockedSendMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps mutation controls disabled until the post-mutation refresh is authoritative", async () => {
    const user = userEvent.setup();
    let resolveRefresh: (value: ConversationMessagesResponse) => void = () => {};
    mockedGetMessages
      .mockResolvedValueOnce(threadResponse)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );
    mockedSendMessage.mockResolvedValue(successfulGeneration);
    renderPage();
    await screen.findByText("What is 2 + 2?");

    await user.type(screen.getByLabelText(/Message AI Teacher/), "Another question");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mockedGetMessages).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(/Message AI Teacher/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await act(async () => {
      resolveRefresh(threadResponse);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByLabelText(/Message AI Teacher/)).toBeEnabled();
  });

  it("groups response variants and targets the selected response for regeneration", async () => {
    const user = userEvent.setup();
    mockedGetMessages.mockResolvedValue({
      status: "success",
      total: 3,
      messages: [
        {
          id: "request-1",
          role: "user",
          content: "Explain fractions",
          status: "COMPLETED",
          created_at: "2026-09-17T00:00:00.000Z",
          sequence_number: 1,
        },
        {
          id: "response-1",
          role: "assistant",
          content: "First explanation",
          request_message_id: "request-1",
          generation_attempt_id: "attempt-1",
          regeneration_available: true,
          status: "COMPLETED",
          variant_number: 1,
          created_at: "2026-09-17T00:00:01.000Z",
          sequence_number: 1,
        },
        {
          id: "response-2",
          role: "assistant",
          content: "Second explanation",
          request_message_id: "request-1",
          generation_attempt_id: "attempt-2",
          regeneration_available: true,
          status: "COMPLETED",
          variant_number: 2,
          created_at: "2026-09-17T00:00:02.000Z",
          sequence_number: 1,
        },
      ],
    } satisfies ConversationMessagesResponse);

    renderPage();
    expect(await screen.findByText("Second explanation")).toBeInTheDocument();
    expect(screen.getByText("Response 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous variant" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next variant" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous variant" }));
    expect(await screen.findByText("First explanation")).toBeInTheDocument();
    expect(screen.getByText("Response 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Regenerate response" }));
    expect(mockedRegenerateResponse).toHaveBeenCalledWith(
      "conv-1",
      "response-1",
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("hydrates feedback from history and submits feedback for the selected variant", async () => {
    const user = userEvent.setup();
    mockedGetMessages.mockResolvedValue({
      status: "success",
      total: 3,
      messages: [
        {
          id: "request-2",
          role: "user",
          content: "Explain gravity",
          status: "COMPLETED",
          created_at: "2026-09-17T00:00:00.000Z",
        },
        {
          id: "response-a",
          role: "assistant",
          content: "Gravity answer A",
          request_message_id: "request-2",
          generation_attempt_id: "attempt-a",
          regeneration_available: true,
          status: "COMPLETED",
          variant_number: 1,
          created_at: "2026-09-17T00:00:01.000Z",
        },
        {
          id: "response-b",
          role: "assistant",
          content: "Gravity answer B",
          request_message_id: "request-2",
          generation_attempt_id: "attempt-b",
          regeneration_available: true,
          status: "COMPLETED",
          variant_number: 2,
          created_at: "2026-09-17T00:00:02.000Z",
        },
      ],
      feedback: [
        {
          id: "feedback-a",
          conversation_id: "conv-1",
          response_message_id: "response-a",
          sentiment: "NOT_HELPFUL",
          reason: "not clear",
          created_at: "2026-09-17T00:01:00.000Z",
          updated_at: "2026-09-17T00:01:00.000Z",
        },
      ],
    } satisfies ConversationMessagesResponse);

    renderPage();
    expect(await screen.findByText("Gravity answer B")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous variant" }));
    expect(await screen.findByText("Feedback submitted")).toBeInTheDocument();
    expect(screen.getByText("Not helpful")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next variant" }));
    await user.click(screen.getByRole("button", { name: "Helpful" }));
    expect(mockedSubmitFeedback).toHaveBeenCalledWith(
      "conv-1",
      "response-b",
      { sentiment: "helpful" },
    );
  });

  it("does not offer regeneration for a legacy response without request linkage", async () => {
    mockedGetMessages.mockResolvedValue({
      status: "success",
      total: 1,
      messages: [
        {
          id: "legacy-response",
          role: "assistant",
          content: "Legacy answer",
          generation_attempt_id: "legacy-attempt",
          status: "COMPLETED",
          created_at: "2026-09-17T00:00:00.000Z",
        },
      ],
    } satisfies ConversationMessagesResponse);

    renderPage();
    expect(await screen.findByText("Legacy answer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate response" })).not.toBeInTheDocument();
  });

  it("retries a failed regeneration attempt without starting a new branch", async () => {
    const user = userEvent.setup();
    mockedGetMessages.mockResolvedValue({
      status: "success",
      total: 2,
      messages: [
        {
          id: "request-3",
          role: "user",
          content: "Explain photosynthesis",
          status: "COMPLETED",
          created_at: "2026-09-17T00:00:00.000Z",
        },
        {
          id: "response-3",
          role: "assistant",
          content: "Saved answer",
          request_message_id: "request-3",
          generation_attempt_id: "attempt-ok",
          regeneration_available: true,
          status: "COMPLETED",
          variant_number: 1,
          created_at: "2026-09-17T00:00:01.000Z",
        },
      ],
      branches: [
        {
          id: "branch-1",
          conversation_id: "conv-1",
          parent_branch_id: null,
          branch_point_message_id: null,
          name: null,
          is_primary: true,
          is_active: true,
          created_at: "2026-09-17T00:00:00.000Z",
          updated_at: "2026-09-17T00:00:00.000Z",
        },
      ],
      attempts: [
        {
          id: "attempt-ok",
          conversation_id: "conv-1",
          request_message_id: "request-3",
          response_message_id: "response-3",
          attempt_type: "ORIGINAL",
          attempt_number: 1,
          retry_of_attempt_id: null,
          parent_attempt_id: null,
          status: "COMPLETED",
          provider: "mock",
          model: "mock-model",
          request_id: null,
          error_category: null,
          usage_event_id: null,
          started_at: "2026-09-17T00:00:00.000Z",
          completed_at: "2026-09-17T00:00:01.000Z",
        },
        {
          id: "attempt-failed",
          conversation_id: "conv-1",
          request_message_id: "request-3",
          response_message_id: null,
          attempt_type: "REGENERATION",
          attempt_number: 2,
          retry_of_attempt_id: null,
          parent_attempt_id: "attempt-ok",
          status: "FAILED",
          provider: "mock",
          model: "mock-model",
          request_id: null,
          error_category: "provider_error",
          usage_event_id: null,
          started_at: "2026-09-17T00:01:00.000Z",
          completed_at: "2026-09-17T00:01:01.000Z",
        },
      ],
    } satisfies ConversationMessagesResponse);

    renderPage();
    expect(await screen.findByText("Generation failed")).toBeInTheDocument();
    expect(screen.getByText("Active branch: Primary branch")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry generation" }));

    expect(mockedRetryGeneration).toHaveBeenCalledWith("conv-1", "attempt-failed", "request-3");
    expect(mockedRegenerateResponse).not.toHaveBeenCalled();
  });
});
