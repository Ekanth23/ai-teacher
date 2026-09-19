import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AiConversationPage from "../pages/AiConversationPage";
import {
  getConversationMessages,
  sendReply,
} from "../services/api/ai";
import { ApiError } from "../services/api/errors";
import type {
  AiMessage,
  ConversationMessagesResponse,
} from "../types/ai";

vi.mock("../services/api/ai", () => ({
  createConversation: vi.fn(),
  getConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  sendReply: vi.fn(),
}));

const mockedGetMessages = vi.mocked(getConversationMessages);
const mockedSendReply = vi.mocked(sendReply);

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

describe("AI conversation thread (AiConversationPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetMessages.mockResolvedValue(threadResponse);
    mockedSendReply.mockResolvedValue({
      status: "success",
      message: "AI reply created successfully",
      data: {
        id: "msg-4",
        role: "assistant",
        content: "New answer.",
        created_at: "2026-09-17T00:01:00.000Z",
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

    expect(mockedGetMessages).toHaveBeenCalledWith("conv-1");
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
      expect(mockedSendReply).toHaveBeenCalledWith("conv-1", "Explain fractions"),
    );
    // Exactly once despite re-renders from the send/refresh cycle.
    await waitFor(() => expect(mockedGetMessages).toHaveBeenCalled());
    expect(mockedSendReply).toHaveBeenCalledTimes(1);
  });

  it("sends a message, shows thinking state, and refreshes the thread", async () => {
    const user = userEvent.setup();
    let resolveReply: (value: {
      status: string;
      message: string;
      data: AiMessage;
    }) => void = () => {};
    mockedSendReply.mockReturnValue(
      new Promise((resolve) => {
        resolveReply = resolve;
      }),
    );
    renderPage();
    await screen.findByText("What is 2 + 2?");

    await user.type(screen.getByLabelText(/Message AI Teacher/), "And 3 + 3?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(mockedSendReply).toHaveBeenCalledTimes(1);
    expect(mockedSendReply).toHaveBeenCalledWith("conv-1", "And 3 + 3?");
    expect(await screen.findByText("AI Teacher is thinking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    resolveReply({
      status: "success",
      message: "AI reply created successfully",
      data: {
        id: "msg-4",
        role: "assistant",
        content: "New answer.",
        created_at: "2026-09-17T00:01:00.000Z",
      },
    });

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
    expect(mockedSendReply).not.toHaveBeenCalled();
  });

  it("preserves the draft and offers retry when sending fails", async () => {
    const user = userEvent.setup();
    mockedSendReply.mockRejectedValueOnce(
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

    mockedSendReply.mockResolvedValue({
      status: "success",
      message: "AI reply created successfully",
      data: {
        id: "msg-4",
        role: "assistant",
        content: "New answer.",
        created_at: "2026-09-17T00:01:00.000Z",
      },
    });
    await user.click(screen.getByRole("button", { name: "Retry send" }));
    expect(mockedSendReply).toHaveBeenCalledTimes(2);
  });
});
