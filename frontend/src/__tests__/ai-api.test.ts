import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../services/api/client";
import {
  createConversation,
  editMessage,
  getConversationMessages,
  getConversations,
  regenerateResponse,
  retryGeneration,
  sendMessage,
  sendReply,
  submitConversationFeedback,
} from "../services/api/ai";

vi.mock("../services/api/client", () => ({
  request: vi.fn(),
}));

const mockedRequest = vi.mocked(request);

describe("AI Teacher API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a conversation via POST with optional context only", async () => {
    mockedRequest.mockResolvedValue({
      status: "success",
      conversation: { id: "conv-1", subject: "Maths", topic: null },
    });

    await createConversation({ subject: "Maths" });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("/api/ai/conversations", {
      method: "POST",
      body: { subject: "Maths" },
    });
  });

  it("requests the student's conversation history", async () => {
    mockedRequest.mockResolvedValue({ conversations: [], total: 0 });

    await getConversations();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("/api/ai/conversations");
  });

  it("requests a conversation's messages in chronological order", async () => {
    mockedRequest.mockResolvedValue({ messages: [], total: 0 });

    await getConversationMessages("conv-1");

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/ai/conversations/conv-1/messages",
    );
  });

  it("exposes the additive lifecycle endpoints without changing the legacy reply path", async () => {
    mockedRequest.mockResolvedValue({});

    await sendMessage("conv-1", { question: "Next question" });
    await retryGeneration("conv-1", "attempt-1");
    await regenerateResponse("conv-1", "response-1");
    await submitConversationFeedback("conv-1", "response-1", {
      sentiment: "not helpful",
      reason: "not clear",
    });

    expect(mockedRequest).toHaveBeenNthCalledWith(
      1,
      "/api/ai/conversations/conv-1/messages",
      { method: "POST", body: { question: "Next question" } },
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(
      2,
      "/api/ai/conversations/conv-1/retry",
      { method: "POST", body: { attempt_id: "attempt-1", message_id: undefined } },
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(
      3,
      "/api/ai/conversations/conv-1/regenerate",
      { method: "POST", body: { response_message_id: "response-1" } },
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(
      4,
      "/api/ai/conversations/conv-1/messages/response-1/feedback",
      { method: "POST", body: { sentiment: "not helpful", reason: "not clear" } },
    );
  });

  it("forwards cancellation signals and idempotency headers on lifecycle writes", async () => {
    const controller = new AbortController();
    mockedRequest.mockResolvedValue({});

    await createConversation(
      { question: "Start once" },
      { idempotencyKey: "create-key" },
    );
    await sendMessage(
      "conv-1",
      { question: "Next question" },
      { idempotencyKey: "send-key" },
    );
    await editMessage("conv-1", "message-1", "Edited", {
      idempotencyKey: "edit-key",
      signal: controller.signal,
    });

    expect(mockedRequest).toHaveBeenNthCalledWith(
      1,
      "/api/ai/conversations",
      {
        method: "POST",
        body: { question: "Start once" },
        headers: { "Idempotency-Key": "create-key" },
      },
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(
      2,
      "/api/ai/conversations/conv-1/messages",
      {
        method: "POST",
        body: { question: "Next question" },
        headers: { "Idempotency-Key": "send-key" },
      },
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(
      3,
      "/api/ai/conversations/conv-1/messages/message-1",
      {
        method: "PATCH",
        body: { content: "Edited" },
        signal: controller.signal,
        headers: { "Idempotency-Key": "edit-key" },
      },
    );
  });

  it("passes an AbortSignal to an owner-authorized history request", async () => {
    const controller = new AbortController();
    mockedRequest.mockResolvedValue({ messages: [], total: 0 });

    await getConversationMessages("conv-1", { signal: controller.signal });

    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/ai/conversations/conv-1/messages",
      { signal: controller.signal },
    );
  });

  it("sends a reply with only the conversation id and question", async () => {
    mockedRequest.mockResolvedValue({
      status: "success",
      data: { id: "msg-2", role: "assistant", content: "Hi" },
    });

    await sendReply("conv-1", "What is 2 + 2?");

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("/api/ai/reply", {
      method: "POST",
      body: { conversation_id: "conv-1", question: "What is 2 + 2?" },
    });
  });
});
