import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../services/api/client";
import {
  getAttemptResult,
  getPractice,
  getPractices,
  getResults,
  saveAttemptAnswers,
  startPracticeAttempt,
  submitAttempt,
} from "../services/api/practice";

vi.mock("../services/api/client", () => ({
  request: vi.fn(),
}));

const mockedRequest = vi.mocked(request);

describe("practice API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests the canonical student practices endpoint", async () => {
    mockedRequest.mockResolvedValue({ practices: [], total: 0 });

    await getPractices();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("/api/student/practices");
  });

  it("requests a practice by ID from the student endpoint", async () => {
    mockedRequest.mockResolvedValue({ practice: {} });

    await getPractice("practice-123");

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/student/practices/practice-123",
    );
  });

  it("starts an attempt via POST to the student attempts endpoint", async () => {
    mockedRequest.mockResolvedValue({
      attempt: { id: "attempt-1" },
      questions: [],
    });

    await startPracticeAttempt("practice-123");

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/student/practices/practice-123/attempts",
      { method: "POST" },
    );
  });

  it("saves answers via PUT with only the selected option", async () => {
    mockedRequest.mockResolvedValue({ answers: [] });

    await saveAttemptAnswers("attempt-1", {
      answers: [{ question_id: "q-1", selected_option: "B" }],
    });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/student/attempts/attempt-1/answers",
      {
        method: "PUT",
        body: { answers: [{ question_id: "q-1", selected_option: "B" }] },
      },
    );
  });

  it("submits an attempt via POST to the submit endpoint", async () => {
    mockedRequest.mockResolvedValue({
      id: "attempt-1",
      status: "SUBMITTED",
      submitted_at: "2026-09-17T00:00:00.000Z",
    });

    await submitAttempt("attempt-1");

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/student/attempts/attempt-1/submit",
      { method: "POST" },
    );
  });

  it("requests a submitted result from the result endpoint", async () => {
    mockedRequest.mockResolvedValue({ id: "attempt-1" });

    await getAttemptResult("attempt-1");

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/student/attempts/attempt-1/result",
    );
  });

  it("requests the submitted result history endpoint", async () => {
    mockedRequest.mockResolvedValue({ results: [], total: 0 });

    await getResults();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("/api/student/results");
  });
});