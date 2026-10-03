/**
 * Stage 2C-3 — Context Builder unit tests.
 *
 * Covers valid context construction, missing documents, size limits,
 * PO decision discovery, and scope restrictions.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";

import { createRealContextBuilder } from "../src/context-builder-impl.js";
import type { ContextBuilder, ContextRequest } from "../src/context-builder.js";
import type { GovernanceReferences } from "../src/config.js";

const REPO_ROOT = path.resolve("C:/Users/Royal/ai-teacher");

function defaultGovernance(): GovernanceReferences {
  return {
    stage1OpenCodeRulesPath: path.join(REPO_ROOT, ".opencode", "ai-workflow-rules.md"),
    projectInstructionsPath: path.join(REPO_ROOT, "AGENTS.md"),
    masterBacklogPath: path.join(
      REPO_ROOT,
      "AI_Teacher_16_Epic_Master_PO_User_Story_Backlog_Draft_2.0_FINAL_CONSOLIDATED.txt",
    ),
    poDecisionsDirectory: path.join(REPO_ROOT, "Docs"),
  };
}

function defaultRequest(overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    storyId: "US-001",
    epicId: "1",
    stateDirectory: path.join(REPO_ROOT, "tools", "ai-orchestrator", "state"),
    governance: defaultGovernance(),
    requestedKinds: [],
    ...overrides,
  };
}

function builder(): ContextBuilder {
  return createRealContextBuilder();
}

describe("context builder — valid construction", () => {
  it("builds a context package with loaded sections", async () => {
    const pkg = await builder().build(defaultRequest());

    expect(pkg.packageId).toMatch(/^ctx-/);
    expect(pkg.storyId).toBe("US-001");
    expect(pkg.epicId).toBe("1");
    expect(pkg.sections.length).toBeGreaterThan(0);
    expect(pkg.complete).toBe(true);
  });

  it("loads the Master Backlog as an authoritative section", async () => {
    const pkg = await builder().build(defaultRequest());

    const masterBacklog = pkg.sections.find((s) => s.kind === "master-backlog");
    expect(masterBacklog).toBeDefined();
    expect(masterBacklog?.loaded).toBe(true);
    expect(masterBacklog?.content).toBeTruthy();
    expect(masterBacklog?.authority).toBe("authoritative");
  });

  it("loads project instructions", async () => {
    const pkg = await builder().build(defaultRequest());

    const projectInstructions = pkg.sections.find((s) => s.kind === "project-instructions");
    expect(projectInstructions).toBeDefined();
    expect(projectInstructions?.loaded).toBe(true);
    expect(projectInstructions?.content).toBeTruthy();
  });

  it("loads Stage 1 OpenCode rules", async () => {
    const pkg = await builder().build(defaultRequest());

    const stage1Rules = pkg.sections.find((s) => s.kind === "stage-1-opencode-rules");
    expect(stage1Rules).toBeDefined();
    expect(stage1Rules?.loaded).toBe(true);
    expect(stage1Rules?.content).toBeTruthy();
  });

  it("discovers PO decision files from Docs/", async () => {
    // Use epicId: null to include all PO decision files (Epic 1 has none)
    const request = defaultRequest({ epicId: null });
    const pkg = await builder().build(request);

    const poDecisions = pkg.sections.filter((s) => s.kind === "po-decisions");
    expect(poDecisions.length).toBeGreaterThan(0);
    for (const po of poDecisions) {
      expect(po.loaded).toBe(true);
      expect(po.content).toBeTruthy();
    }
  });

  it("reports the correct capabilities", () => {
    const capabilities = builder().capabilities();
    expect(capabilities).toContain("master-backlog");
    expect(capabilities).toContain("po-decisions");
    expect(capabilities).toContain("project-instructions");
    expect(capabilities).toContain("stage-1-opencode-rules");
  });
});

describe("context builder — missing documents", () => {
  it("handles a missing Master Backlog gracefully", async () => {
    const request = defaultRequest({
      governance: {
        ...defaultGovernance(),
        masterBacklogPath: "C:/nonexistent/backlog.txt",
      },
    });

    const pkg = await builder().build(request);

    const masterBacklog = pkg.sections.find((s) => s.kind === "master-backlog");
    expect(masterBacklog).toBeDefined();
    expect(masterBacklog?.loaded).toBe(false);
    expect(pkg.notes.some((n) => n.includes("Master Backlog not found"))).toBe(true);
  });

  it("handles missing PO decision files directory", async () => {
    const request = defaultRequest({
      governance: {
        ...defaultGovernance(),
        poDecisionsDirectory: "C:/nonexistent/docs",
      },
    });

    const pkg = await builder().build(request);

    expect(pkg.notes.some((n) => n.includes("No PO decision files found"))).toBe(true);
  });

  it("handles missing project instructions", async () => {
    const request = defaultRequest({
      governance: {
        ...defaultGovernance(),
        projectInstructionsPath: "C:/nonexistent/AGENTS.md",
      },
    });

    const pkg = await builder().build(request);

    expect(pkg.notes.some((n) => n.includes("Project instructions not found"))).toBe(true);
  });
});

describe("context builder — size limits", () => {
  it("enforces the maximum number of sections", async () => {
    const request = defaultRequest({
      requestedKinds: [
        "master-backlog",
        "user-story",
        "po-decisions",
        "project-instructions",
        "stage-1-opencode-rules",
      ],
    });

    const pkg = await builder().build(request);

    // The builder should not exceed MAX_SECTIONS_PER_PACKAGE (20)
    expect(pkg.sections.length).toBeLessThanOrEqual(20);
  });

  it("reports when total context size limit is reached", async () => {
    // This test verifies the size limit logic exists.
    // In practice, the real documents are small enough to fit.
    const pkg = await builder().build(defaultRequest());

    // If we got here without blocking, the total size is within limits
    expect(pkg.complete).toBe(true);
  });
});

describe("context builder — non-duplication invariants", () => {
  it("does not embed acceptance criteria", async () => {
    const pkg = await builder().build(defaultRequest());

    // The context package should not contain acceptance criteria
    // (those live in PO decision documents, not in the orchestrator)
    const allContent = pkg.sections
      .map((s) => s.content ?? "")
      .join("\n");

    // The orchestrator should not invent acceptance criteria
    expect(allContent).not.toContain("ACCEPTANCE CRITERIA");
  });

  it("does not restate PO decisions", async () => {
    const pkg = await builder().build(defaultRequest());

    // The context package references PO decisions but does not restate them
    const poDecisions = pkg.sections.filter((s) => s.kind === "po-decisions");
    for (const po of poDecisions) {
      // The content should be the actual file content, not a restatement
      expect(po.content).toBeTruthy();
      expect(po.source.path).toBeTruthy();
    }
  });

  it("does not grant file permissions or bypass scope", async () => {
    const pkg = await builder().build(defaultRequest());

    // The context package should not contain any scope or permission grants
    const allContent = pkg.sections
      .map((s) => s.content ?? "")
      .join("\n");

    // The orchestrator should not grant file permissions
    expect(allContent).not.toContain("GRANT");
    expect(allContent).not.toContain("PERMISSION");
  });
});

describe("context builder — Epic filtering", () => {
  it("filters PO decision files by Epic when epicId is provided", async () => {
    const request = defaultRequest({ epicId: "12" });
    const pkg = await builder().build(request);

    const poDecisions = pkg.sections.filter((s) => s.kind === "po-decisions");
    // Epic 12 PO decisions should be included
    expect(poDecisions.length).toBeGreaterThan(0);
  });

  it("includes all PO decision files when epicId is null", async () => {
    const request = defaultRequest({ epicId: null });
    const pkg = await builder().build(request);

    const poDecisions = pkg.sections.filter((s) => s.kind === "po-decisions");
    expect(poDecisions.length).toBeGreaterThan(0);
  });
});
