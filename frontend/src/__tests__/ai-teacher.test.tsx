import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AiTeacherPage from "../pages/AiTeacherPage";
import {
  createConversation,
  getConversations,
} from "../services/api/ai";
import { ApiError } from "../services/api/errors";
import type { ConversationsResponse } from "../types/ai";

vi.mock("../services/api/ai", () => ({
  createConversation: vi.fn(),
  getConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  sendReply: vi.fn(),
}));

const mockedNavigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockedNavigate };
});

const mockedGetConversations = vi.mocked(getConversations);
const mockedCreateConversation = vi.mocked(createConversation);

const historyFixture: ConversationsResponse = {
  status: "success",
  conversations: [
    {
      id: "conv-1",
      subject: "Maths",
      topic: "Fractions",
      updated_at: "2026-09-17T00:05:00.000Z",
    },
    { id: "conv-2", subject: null, topic: null },
  ],
  total: 2,
};

function renderPage(route = "/ai-teacher") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/ai-teacher" element={<AiTeacherPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AI Teacher landing (AiTeacherPage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConversations.mockResolvedValue({
      status: "success",
      conversations: [],
      total: 0,
    });
    mockedCreateConversation.mockResolvedValue({
      status: "success",
      message: "Conversation created successfully",
      conversation: {
        id: "conv-9",
        subject: null,
        topic: null,
        created_at: "2026-09-18T00:00:00.000Z",
      },
    });
  });

  it("renders the landing with composer, prompts, and history", async () => {
    mockedGetConversations.mockResolvedValue(historyFixture);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "AI Teacher" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/What would you like help with/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Explain this topic in simple terms" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Recent conversations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Maths · Fractions")).toBeInTheDocument();
    expect(screen.getByText("General conversation")).toBeInTheDocument();
  });

  it("shows a loading state while fetching history", () => {
    mockedGetConversations.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading conversations…")).toBeInTheDocument();
  });

  it("shows an empty history state", async () => {
    renderPage();
    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
  });

  it("shows an error state with retry when history fails", async () => {
    const user = userEvent.setup();
    mockedGetConversations
      .mockRejectedValueOnce(
        new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
      )
      .mockResolvedValueOnce({ status: "success", conversations: [], total: 0 });
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
  });

  it("selecting a prompt fills the composer without calling the API", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Recent conversations" });

    await user.click(
      screen.getByRole("button", { name: "Give me a practice question" }),
    );
    expect(
      screen.getByLabelText(/What would you like help with/),
    ).toHaveValue("Give me a practice question");
    expect(mockedCreateConversation).not.toHaveBeenCalled();
  });

  it("starts a conversation and navigates to the thread with the question", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Recent conversations" });

    await user.type(
      screen.getByLabelText(/What would you like help with/),
      "What is 2 + 2?",
    );
    await user.click(screen.getByRole("button", { name: "Ask AI Teacher" }));

    expect(mockedCreateConversation).toHaveBeenCalledTimes(1);
    expect(mockedCreateConversation).toHaveBeenCalledWith({});
    expect(mockedNavigate).toHaveBeenCalledWith("/ai-teacher/conv-9", {
      state: { initialQuestion: "What is 2 + 2?" },
    });
  });

  it("blocks empty questions and duplicate starts", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Recent conversations" });

    expect(screen.getByRole("button", { name: "Ask AI Teacher" })).toBeDisabled();
    await user.type(screen.getByLabelText(/What would you like help with/), "   ");
    expect(screen.getByRole("button", { name: "Ask AI Teacher" })).toBeDisabled();
    expect(mockedCreateConversation).not.toHaveBeenCalled();
  });

  it("passes subject/topic context when entering from a topic link", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/ai-teacher?subject=Maths&topic=Fractions"]}>
        <Routes>
          <Route path="/ai-teacher" element={<AiTeacherPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Recent conversations" });
    expect(screen.getByText("Context: Maths · Fractions")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/What would you like help with/),
      "Help?",
    );
    await user.click(screen.getByRole("button", { name: "Ask AI Teacher" }));

    expect(mockedCreateConversation).toHaveBeenCalledWith({
      subject: "Maths",
      topic: "Fractions",
    });
  });

  it("shows an inline error when starting fails", async () => {
    const user = userEvent.setup();
    mockedCreateConversation.mockRejectedValue(
      new ApiError("NETWORK_ERROR", "Unable to reach the server.", 0),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Recent conversations" });

    await user.type(screen.getByLabelText(/What would you like help with/), "Hi");
    await user.click(screen.getByRole("button", { name: "Ask AI Teacher" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the server.",
    );
    expect(mockedNavigate).not.toHaveBeenCalled();
  });

  it("links history entries to their conversation threads", async () => {
    mockedGetConversations.mockResolvedValue(historyFixture);
    renderPage();

    const link = await screen.findByRole("link", { name: /Maths · Fractions/ });
    expect(link).toHaveAttribute("href", "/ai-teacher/conv-1");
  });
});
