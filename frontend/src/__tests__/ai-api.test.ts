import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../services/api/client";
import {
  createConversation,
  getConversationMessages,
  getConversations,
  sendReply,
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
