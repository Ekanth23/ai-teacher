import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../services/api/client";
import { getClasses, getClassSubjects, getStructureChapters } from "../services/api/learning";

vi.mock("../services/api/client", () => ({
  request: vi.fn(),
}));

const mockedRequest = vi.mocked(request);

describe("learning API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests the canonical classes endpoint", async () => {
    mockedRequest.mockResolvedValue({ classes: [], total: 0 });

    await getClasses();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("/api/student/classes");
  });

  it("requests the canonical class-subjects endpoint", async () => {
    mockedRequest.mockResolvedValue({ subjects: [], total: 0 });

    await getClassSubjects("class-123");

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("/api/student/classes/class-123/subjects");
  });

  it("requests chapters for a curriculum structure", async () => {
    mockedRequest.mockResolvedValue({ chapters: [], total: 0 });

    await getStructureChapters("structure-123");

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/curriculum/structures/structure-123/chapters",
    );
  });
});
