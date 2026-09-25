import { describe, expect, it } from "vitest";
import { parseBoardRequest } from "../../src/modules/ai/board-request-parser.js";
import type { ActiveBoardIdentity } from "../../src/modules/ai/board-response.types.js";

const boards: ActiveBoardIdentity[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Tamil Nadu State Board",
    code: "TNSTATE",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "CBSE",
    code: "CBSE",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "ICSE",
    code: "ICSE",
  },
];

describe("US-119 deterministic board request parser", () => {
  it.each([
    "Explain this using CBSE.",
    "Explain this topic according to CBSE.",
    "Can you explain this in CBSE?",
    "  EXPLAIN   THIS\nUSING CBSE  ",
  ])("classifies a current-response board request: %s", (question) => {
    const result = parseBoardRequest(question, boards);
    expect(result.intent).toBe("CURRENT_RESPONSE_BOARD");
    expect(result.board?.code).toBe("CBSE");
  });

  it.each([
    "Now explain this topic according to CBSE.",
    "From now on, explain using CBSE.",
    "Switch this conversation to CBSE.",
    "Change this conversation's board to ICSE.",
  ])("classifies a conversation-level board request: %s", (question) => {
    const result = parseBoardRequest(question, boards);
    expect(result.intent).toBe("CONVERSATION_BOARD_SCOPE");
    expect(["CBSE", "ICSE"]).toContain(result.board?.code);
  });

  it("restores normal board without accepting a profile/history label", () => {
    const result = parseBoardRequest("Switch back to my normal board.", boards);
    expect(result.intent).toBe("RESTORE_NORMAL_BOARD");
    expect(result.board).toBeNull();
  });

  it("does not treat an informational question as a board-context request", () => {
    const result = parseBoardRequest("What is CBSE?", boards);
    expect(result.intent).toBe("NO_BOARD_REQUEST");
    expect(result.board).toBeNull();
  });

  it("requires a named board when another board is requested", () => {
    const result = parseBoardRequest("Use another board.", boards);
    expect(result.intent).toBe("CLARIFY_BOARD");
    expect(result.reason).toBe("MISSING_BOARD_TARGET");
  });

  it("marks an unknown explicit board for targeted clarification", () => {
    const result = parseBoardRequest("Explain gravity according to Future Board.", boards);
    expect(result.intent).toBe("CLARIFY_BOARD");
    expect(result.reason).toBe("UNRESOLVED_BOARD_TARGET");
    expect(result.unresolvedTarget).toBe("Future Board");
  });

  it("does not use fuzzy or substring board matching", () => {
    const result = parseBoardRequest("Explain this using CBSEish.", boards);
    expect(result.intent).toBe("NO_BOARD_REQUEST");
  });

  it("classifies multiple unrelated exact board targets as ambiguous", () => {
    const result = parseBoardRequest("Explain photosynthesis using CBSE and ICSE.", boards);
    expect(result.intent).toBe("CLARIFY_BOARD");
    expect(result.reason).toBe("MULTIPLE_BOARD_TARGETS");
  });

  it("recognizes an explicit cross-board comparison", () => {
    const result = parseBoardRequest("Compare CBSE and ICSE treatment of fractions.", boards);
    expect(result.intent).toBe("CROSS_BOARD_COMPARISON");
    expect(result.comparisonBoards.map((board) => board.code)).toEqual(["CBSE", "ICSE"]);
  });

  it("matches an exact active board code with normalized punctuation", () => {
    const result = parseBoardRequest("Teach this in TNSTATE.", boards);
    expect(result.intent).toBe("CURRENT_RESPONSE_BOARD");
    expect(result.board?.name).toBe("Tamil Nadu State Board");
  });
});
