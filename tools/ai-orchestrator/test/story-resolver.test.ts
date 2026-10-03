/**
 * Stage 2C-2 — Story Resolver unit tests.
 *
 * Covers valid resolution, missing stories, retired stories, invalid IDs,
 * collision detection, and file-not-found handling.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";

import { createRealStoryResolver } from "../src/story-resolver-impl.js";
import { AUTHORITATIVE_STORY_TABLE, COLLISION_TRACEABILITY_TABLE, type StoryResolver } from "../src/story-resolver.js";

const MASTER_BACKLOG_PATH = path.resolve(
  "C:/Users/Royal/ai-teacher/AI_Teacher_16_Epic_Master_PO_User_Story_Backlog_Draft_2.0_FINAL_CONSOLIDATED.txt",
);

function resolver(): StoryResolver {
  return createRealStoryResolver();
}

describe("story resolver — valid resolution", () => {
  it("resolves US-001 from Section B", async () => {
    const result = await resolver().resolve({
      storyId: "US-001",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.story.storyId).toBe("US-001");
    expect(result.story.title).toBe("User registration");
    expect(result.story.status).toBe("ACTIVE");
    expect(result.story.epicId).toBe("1");
    expect(result.story.resolvedFrom).toBe(AUTHORITATIVE_STORY_TABLE);
    expect(result.collision).toBeNull();
  });

  it("resolves US-101 from Section B (with collision detection)", async () => {
    const result = await resolver().resolve({
      storyId: "US-101",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    // US-101 appears in Section F as a Draft 1.0 ID with a different story,
    // so the resolver correctly reports a collision.
    expect(result.kind).toBe("collision-detected");
    if (result.kind !== "collision-detected") return;
    expect(result.collision.storyId).toBe("US-101");
    expect(result.collision.authoritativeEntry.title).toBeTruthy();
  });

  it("detects collision for US-123 (Draft 1.0: AI revision assistance)", async () => {
    const result = await resolver().resolve({
      storyId: "US-123",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    // US-123 is a known collision: Draft 1.0 is "AI revision assistance",
    // Draft 2.0 is "Explain concepts step-by-step".
    expect(result.kind).toBe("collision-detected");
    if (result.kind !== "collision-detected") return;
    expect(result.collision.storyId).toBe("US-123");
    expect(result.collision.authoritativeEntry.title).toBe("Explain concepts step-by-step");
    expect(result.collision.conflictingEntry.title).toBe("AI revision assistance");
  });

  it("is case-insensitive for story IDs", async () => {
    const result = await resolver().resolve({
      storyId: "us-001",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.story.storyId).toBe("US-001");
  });
});

describe("story resolver — missing stories", () => {
  it("returns not-found for a story not in Section B", async () => {
    const result = await resolver().resolve({
      storyId: "US-999",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    expect(result.kind).toBe("not-found");
    if (result.kind !== "not-found") return;
    expect(result.storyId).toBe("US-999");
    expect(result.message).toContain("not found");
  });

  it("returns not-found for an invalid story ID format", async () => {
    const result = await resolver().resolve({
      storyId: "ABC-123",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    expect(result.kind).toBe("not-found");
    if (result.kind !== "not-found") return;
    expect(result.message).toContain("Invalid story ID format");
  });

  it("returns not-found when the Master Backlog file does not exist", async () => {
    const result = await resolver().resolve({
      storyId: "US-001",
      masterBacklogPath: "C:/nonexistent/backlog.txt",
    });

    expect(result.kind).toBe("not-found");
    if (result.kind !== "not-found") return;
    expect(result.message).toContain("could not be read");
  });
});

describe("story resolver — retired stories", () => {
  it("returns retired-story for US-037 (permanently retired)", async () => {
    const result = await resolver().resolve({
      storyId: "US-037",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    expect(result.kind).toBe("retired-story");
    if (result.kind !== "retired-story") return;
    expect(result.storyId).toBe("US-037");
    expect(result.message).toContain("retired");
  });

  it("returns retired-story for US-084 (permanently retired)", async () => {
    const result = await resolver().resolve({
      storyId: "US-084",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    expect(result.kind).toBe("retired-story");
    if (result.kind !== "retired-story") return;
    expect(result.storyId).toBe("US-084");
  });
});

describe("story resolver — collision detection", () => {
  it("detects a collision for US-030 (Draft 1.0 vs Draft 2.0)", async () => {
    const result = await resolver().resolve({
      storyId: "US-030",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    expect(result.kind).toBe("collision-detected");
    if (result.kind !== "collision-detected") return;
    expect(result.collision.storyId).toBe("US-030");
    expect(result.collision.requiresPoDecision).toBe(true);
    expect(result.collision.impliesDifferentWork).toBe(true);
    expect(result.collision.authoritativeEntry.title).toBe("Class/teacher assignment");
    expect(result.collision.conflictingEntry.resolvedFrom).toBe(COLLISION_TRACEABILITY_TABLE);
  });

  it("detects a collision for US-034 (Draft 1.0 vs Draft 2.0)", async () => {
    const result = await resolver().resolve({
      storyId: "US-034",
      masterBacklogPath: MASTER_BACKLOG_PATH,
    });

    expect(result.kind).toBe("collision-detected");
    if (result.kind !== "collision-detected") return;
    expect(result.collision.storyId).toBe("US-034");
  });
});

describe("story resolver — authoritative sections", () => {
  it("reports the correct authoritative sections", () => {
    const sections = resolver().authoritativeSections();
    expect(sections).toContain(AUTHORITATIVE_STORY_TABLE);
    expect(sections).toContain(COLLISION_TRACEABILITY_TABLE);
  });
});
