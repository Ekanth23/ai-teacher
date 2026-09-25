import { describe, expect, it, vi } from "vitest";
import {
  BoardResponseService,
  type BoardResponseInput,
} from "../../src/modules/ai/board-response.service.js";
import type {
  ActiveBoardIdentity,
  BoardEvidenceProjection,
} from "../../src/modules/ai/board-response.types.js";
import {
  resolvedEntity,
  unresolvedEntity,
  type ContextEntity,
  type LearningHierarchyResolution,
  type StudentLearningContext,
} from "../../src/modules/ai/learning-context.types.js";

const ids = {
  organization: "00000000-0000-4000-8000-000000000001",
  student: "00000000-0000-4000-8000-000000000002",
  class: "00000000-0000-4000-8000-000000000003",
  syllabus: "00000000-0000-4000-8000-000000000004",
  tnBoard: "00000000-0000-4000-8000-000000000005",
  cbseBoard: "00000000-0000-4000-8000-000000000006",
  icseBoard: "00000000-0000-4000-8000-000000000007",
  medium: "00000000-0000-4000-8000-000000000008",
  subject: "00000000-0000-4000-8000-000000000009",
  chapter: "00000000-0000-4000-8000-00000000000a",
  topic: "00000000-0000-4000-8000-00000000000b",
};

const boards: ActiveBoardIdentity[] = [
  { id: ids.tnBoard, name: "Tamil Nadu State Board", code: "TNSTATE" },
  { id: ids.cbseBoard, name: "CBSE", code: "CBSE" },
  { id: ids.icseBoard, name: "ICSE", code: "ICSE" },
];

function entity(id: string, name: string, source: ContextEntity["source"]): ContextEntity {
  return resolvedEntity({ id, name, code: null, source });
}

function hierarchy(
  subjectStatus: ContextEntity["status"] = "resolved",
  chapterStatus: ContextEntity["status"] = "resolved",
  topicStatus: ContextEntity["status"] = "resolved"
): LearningHierarchyResolution {
  return {
    subject:
      subjectStatus === "resolved"
        ? entity(ids.subject, "Mathematics", "class_subject_relationship")
        : unresolvedEntity("NO_SUBJECT"),
    chapter:
      chapterStatus === "resolved"
        ? entity(ids.chapter, "Fractions", "authoritative_curriculum_hierarchy")
        : unresolvedEntity("NO_CHAPTER"),
    topic:
      topicStatus === "resolved"
        ? entity(ids.topic, "Equivalent Fractions", "authoritative_curriculum_hierarchy")
        : unresolvedEntity("NO_TOPIC"),
    reports: {
      subject: { status: subjectStatus },
      chapter: { status: chapterStatus },
      topic: { status: topicStatus },
    },
  };
}

function learningContext(
  board: ContextEntity = entity(ids.tnBoard, "Tamil Nadu State Board", "authoritative_syllabus")
): StudentLearningContext {
  const currentClass = entity(ids.class, "Class 8", "explicit_enrollment");
  const syllabus = entity(ids.syllabus, "Class 8 Mathematics", "authoritative_syllabus");
  const medium = entity(ids.medium, "English", "authoritative_syllabus");
  const resolvedHierarchy = hierarchy();
  const boardWithCode =
    board.status === "resolved" && board.id === ids.tnBoard ? { ...board, code: "TNSTATE" } : board;
  return {
    contractVersion: "1",
    student: { id: ids.student, gradeLevel: "8" },
    currentEnrollment: {
      id: "00000000-0000-4000-8000-00000000000c",
      classId: ids.class,
      academicYear: "2026-27",
      status: "resolved",
      enrollmentStatus: "ACTIVE",
      source: "explicit_enrollment",
    },
    currentClass,
    authoritativeSyllabus: { ...syllabus, classId: ids.class },
    board: boardWithCode,
    medium,
    languages: [entity("00000000-0000-4000-8000-00000000000d", "English", "authoritative_syllabus")],
    subject: resolvedHierarchy.subject,
    chapter: resolvedHierarchy.chapter,
    topic: resolvedHierarchy.topic,
    learningProfile: null,
    conversation: {
      conversationId: "00000000-0000-4000-8000-00000000000e",
      branchId: "00000000-0000-4000-8000-00000000000f",
      branchName: null,
      isActiveBranch: true,
      subjectLabel: "Mathematics",
      chapterLabel: "Fractions",
      topicLabel: "Equivalent Fractions",
      boardLabel: null,
      classLabel: "Class 8",
      languageLabel: "English",
      mediumLabel: "English",
      history: [],
      historyTruncated: false,
    },
    assembly: {
      assemblyId: "assembly-test",
      assembledAt: "2026-01-01T00:00:00.000Z",
      durationMs: 1,
      freshness: "request_time",
    },
    components: {
      enrollment: { status: "resolved" },
      currentClass: { status: "resolved" },
      syllabus: { status: "resolved" },
      subject: resolvedHierarchy.reports.subject,
      chapter: resolvedHierarchy.reports.chapter,
      topic: resolvedHierarchy.reports.topic,
      learningProfile: { status: "empty" },
      history: { status: "empty" },
    },
  };
}

function baseInput(overrides: Partial<BoardResponseInput> = {}): BoardResponseInput {
  return {
    organizationId: ids.organization,
    studentId: ids.student,
    question: "Explain equivalent fractions.",
    conversationScope: {
      board: null,
      class: "Class 8",
      subject: "Mathematics",
      chapter: "Fractions",
      topic: "Equivalent Fractions",
      language: "English",
      medium: "English",
    },
    learningContext: learningContext(),
    allowScopeMutation: true,
    ...overrides,
  };
}

function authoritativeRow(boardId = ids.cbseBoard, boardName = "CBSE") {
  return {
    board_id: boardId,
    board_name: boardName,
    board_code: boardName === "ICSE" ? "ICSE" : "CBSE",
    class_id: ids.class,
    class_name: "Class 8",
    syllabus_id: "00000000-0000-4000-8000-000000000010",
    syllabus_name: "Class 8 Mathematics",
    syllabus_code: "MATH-8",
    medium_id: ids.medium,
    medium_name: "English",
    medium_code: "EN",
  };
}

function evidence(overrides: {
  primarySourceCount?: number;
  sources?: Array<{
    authority: BoardEvidenceProjection["authority"];
    sourceKind: BoardEvidenceProjection["sourceKind"];
    sourceLabel: string;
    content: string;
  }>;
} = {}) {
  return {
    primarySourceCount: overrides.primarySourceCount ?? 1,
    sources: overrides.sources ?? [
      {
        authority: "AUTHORITATIVE_CURRICULUM" as const,
        sourceKind: "CURRICULUM_NODE" as const,
        sourceLabel: "Fractions",
        content: "Equivalent fractions represent the same quantity.",
      },
    ],
  };
}

function dependencies(options: {
  contexts?: ReturnType<typeof authoritativeRow>[];
  evidence?: ReturnType<typeof evidence>;
  hierarchy?: LearningHierarchyResolution;
} = {}) {
  return {
    repository: {
      listActiveBoards: vi.fn(async () => boards),
      getAuthoritativeBoardContexts: vi.fn(async () => ({
        rows: options.contexts ?? [authoritativeRow()],
      })),
      getSyllabusLanguages: vi.fn(async () => ({
        rows: [{ id: ids.medium, name: "English", code: "EN" }],
      })),
      getEvidence: vi.fn(async () => options.evidence ?? evidence()),
    },
    learningContext: {
      resolveCurriculumScope: vi.fn(async () => options.hierarchy ?? hierarchy()),
    },
  };
}

describe("US-119 board response service", () => {
  it("uses the US-118 normal board in general mode when no authoritative evidence exists", async () => {
    const deps = dependencies({ evidence: evidence({ primarySourceCount: 0, sources: [] }) });
    const service = new BoardResponseService(deps);
    const result = await service.resolve(baseInput());

    expect(result.context).toMatchObject({
      intent: "NO_BOARD_REQUEST",
      responseMode: "GENERAL_EDUCATIONAL",
      effectiveBoard: "Tamil Nadu State Board",
      evidenceStatus: "NONE",
    });
    expect(result.scopeMutation).toBeNull();
  });

  it("resolves an exact alternate board and curriculum evidence for one response without mutating scope", async () => {
    const deps = dependencies();
    const service = new BoardResponseService(deps);
    const result = await service.resolve(
      baseInput({ question: "Explain this using CBSE." })
    );

    expect(result.context).toMatchObject({
      intent: "CURRENT_RESPONSE_BOARD",
      responseMode: "CURRICULUM_GROUNDED",
      effectiveBoard: "CBSE",
      subject: "Mathematics",
      evidenceStatus: "AVAILABLE",
    });
    expect(result.context.evidence[0]?.content).toContain("Equivalent fractions");
    expect(result.scopeMutation).toBeNull();
  });

  it("persists only a validated canonical board and re-resolved downstream scope", async () => {
    const deps = dependencies({ hierarchy: hierarchy("resolved", "unresolved", "unresolved") });
    const service = new BoardResponseService(deps);
    const result = await service.resolve(
      baseInput({ question: "From now on, explain using CBSE." })
    );

    expect(result.scopeMutation).toEqual({
      board: "CBSE",
      class: "Class 8",
      subject: "Mathematics",
      chapter: null,
      topic: null,
      language: "English",
      medium: "English",
    });
  });

  it("restores the authoritative normal board and clears the durable override", async () => {
    const deps = dependencies();
    const service = new BoardResponseService(deps);
    const result = await service.resolve(
      baseInput({
        question: "Switch back to my normal board.",
        conversationScope: { ...baseInput().conversationScope, board: "CBSE" },
      })
    );

    expect(result.context.effectiveBoard).toBe("Tamil Nadu State Board");
    expect(result.scopeMutation?.board).toBeNull();
    expect(result.scopeMutation?.subject).toBe("Mathematics");
  });

  it("does not clear an override or guess when the normal board is unresolved", async () => {
    const deps = dependencies();
    const service = new BoardResponseService(deps);
    const result = await service.resolve(
      baseInput({
        question: "My normal board",
        learningContext: learningContext(unresolvedEntity("NO_AUTHORITATIVE_SYLLABUS")),
      })
    );

    expect(result.context.responseMode).toBe("TARGETED_CLARIFICATION");
    expect(result.context.effectiveBoard).toBeNull();
    expect(result.scopeMutation).toBeNull();
  });

  it("does not substitute the normal board for an unresolved explicit board", async () => {
    const deps = dependencies({ contexts: [] });
    const service = new BoardResponseService(deps);
    const result = await service.resolve(
      baseInput({ question: "Explain this using CBSE." })
    );

    expect(result.context).toMatchObject({
      responseMode: "TARGETED_CLARIFICATION",
      effectiveBoard: null,
      resolutionReason: "NO_AUTHORITATIVE_BOARD_CONTEXT",
    });
    expect(result.context.comparisonBoards).toEqual([]);
    expect(result.scopeMutation).toBeNull();
  });

  it("does not infer CBSE from a Tamil Nadu State Board normal context", async () => {
    const deps = dependencies({ contexts: [] });
    const service = new BoardResponseService(deps);
    const result = await service.resolve(
      baseInput({ question: "Switch this conversation to CBSE." })
    );

    expect(result.context.effectiveBoard).toBeNull();
    expect(result.context.responseMode).toBe("TARGETED_CLARIFICATION");
  });

  it("does not infer a board from location, class, medium, or conversation history", async () => {
    const contextual = learningContext();
    contextual.conversation.history = [
      { role: "user", content: "Earlier I mentioned CBSE." },
      { role: "assistant", content: "We were discussing ICSE." },
    ];
    const service = new BoardResponseService(dependencies());
    const inferred = await service.resolve(
      baseInput({
        question: "I live in Tamil Nadu and study Class 8 in English. Explain the local board.",
        learningContext: contextual,
      })
    );
    expect(inferred.context.effectiveBoard).toBeNull();
    expect(inferred.context.responseMode).toBe("TARGETED_CLARIFICATION");

    const ordinary = await service.resolve(
      baseInput({
        question: "Explain gravity.",
        learningContext: contextual,
      })
    );
    expect(ordinary.context.effectiveBoard).toBe("Tamil Nadu State Board");
  });

  it("keeps zero and multiple authoritative contexts unresolved", async () => {
    const zero = new BoardResponseService(dependencies({ contexts: [] }));
    const zeroResult = await zero.resolve(baseInput({ question: "Explain this in CBSE." }));
    expect(zeroResult.context.resolutionReason).toBe("NO_AUTHORITATIVE_BOARD_CONTEXT");

    const multiple = new BoardResponseService(
      dependencies({ contexts: [authoritativeRow(), authoritativeRow()] })
    );
    const multipleResult = await multiple.resolve(baseInput({ question: "Explain this in CBSE." }));
    expect(multipleResult.context.resolutionReason).toBe("MULTIPLE_AUTHORITATIVE_BOARD_CONTEXTS");
  });

  it("re-resolves a legacy scope label and ignores it when it is not authoritative", async () => {
    const valid = new BoardResponseService(dependencies());
    const validResult = await valid.resolve(
      baseInput({
        conversationScope: { ...baseInput().conversationScope, board: "CBSE" },
      })
    );
    expect(validResult.context.effectiveBoard).toBe("CBSE");

    const invalid = new BoardResponseService(dependencies({ contexts: [] }));
    const invalidResult = await invalid.resolve(
      baseInput({
        conversationScope: { ...baseInput().conversationScope, board: "CBSE" },
      })
    );
    expect(invalidResult.context.effectiveBoard).toBe("Tamil Nadu State Board");
  });

  it("marks unresolved same-authority source structures as SOURCE_CONFLICT", async () => {
    const deps = dependencies({ evidence: evidence({ primarySourceCount: 2 }) });
    const service = new BoardResponseService(deps);
    const result = await service.resolve(baseInput());

    expect(result.context.responseMode).toBe("SOURCE_CONFLICT");
    expect(result.context.evidence).toEqual([]);
    expect(result.context.sourceLabels).toEqual([]);
  });

  it("detects divergent same-authority claims with the same source identity", async () => {
    const deps = dependencies({
      evidence: evidence({
        sources: [
          {
            authority: "APPROVED_PUBLISHED_RESOURCE",
            sourceKind: "LEARNING_RESOURCE",
            sourceLabel: "Approved fractions notes",
            content: "One approved explanation.",
          },
          {
            authority: "APPROVED_PUBLISHED_RESOURCE",
            sourceKind: "LEARNING_RESOURCE",
            sourceLabel: "approved fractions notes",
            content: "A different approved explanation.",
          },
        ],
      }),
    });
    const service = new BoardResponseService(deps);
    const result = await service.resolve(baseInput());

    expect(result.context.responseMode).toBe("SOURCE_CONFLICT");
    expect(result.context.evidence).toEqual([]);
  });

  it("orders authoritative curriculum before approved supporting resources", async () => {
    const deps = dependencies({
      evidence: evidence({
        sources: [
          {
            authority: "APPROVED_PUBLISHED_RESOURCE",
            sourceKind: "LEARNING_RESOURCE",
            sourceLabel: "Approved notes",
            content: "Supporting explanation.",
          },
          {
            authority: "AUTHORITATIVE_CURRICULUM",
            sourceKind: "CURRICULUM_NODE",
            sourceLabel: "Fractions",
            content: "Primary curriculum explanation.",
          },
        ],
      }),
    });
    const service = new BoardResponseService(deps);
    const result = await service.resolve(baseInput());

    expect(result.context.evidence.map((item) => item.authority)).toEqual([
      "AUTHORITATIVE_CURRICULUM",
      "APPROVED_PUBLISHED_RESOURCE",
    ]);
  });

  it("redacts IDs, URLs, and secret-like metadata from provider-safe evidence", async () => {
    const deps = dependencies({
      evidence: evidence({
        sources: [
          {
            authority: "AUTHORITATIVE_CURRICULUM",
            sourceKind: "CURRICULUM_NODE",
            sourceLabel: `Internal ${ids.subject}`,
            content: `See https://internal.example/secret and ${ids.organization}. api_key=do-not-send`,
          },
        ],
      }),
    });
    const service = new BoardResponseService(deps);
    const result = await service.resolve(baseInput());
    const serialized = JSON.stringify(result.context);

    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("do-not-send");
    expect(serialized).not.toContain(ids.subject);
    expect(serialized).not.toContain(ids.organization);
  });

  it("resolves cross-board targets independently without changing scope", async () => {
    const deps = dependencies();
    deps.repository.getAuthoritativeBoardContexts = vi.fn(
      async (_organizationId: string, _studentId: string, boardId: string) => ({
        rows: [
          boardId === ids.cbseBoard
            ? authoritativeRow(ids.cbseBoard, "CBSE")
            : authoritativeRow(ids.icseBoard, "ICSE"),
        ],
      })
    );
    const service = new BoardResponseService(deps);
    const result = await service.resolve(
      baseInput({ question: "Compare CBSE and ICSE for equivalent fractions." })
    );

    expect(result.context.responseMode).toBe("CROSS_BOARD_COMPARISON");
    expect(result.context.comparisonBoards.map((item) => [item.board, item.status])).toEqual([
      ["CBSE", "RESOLVED"],
      ["ICSE", "RESOLVED"],
    ]);
    expect(result.scopeMutation).toBeNull();
  });

  it("does not mutate scope again for retry or regeneration", async () => {
    const service = new BoardResponseService(dependencies());
    const result = await service.resolve(
      baseInput({
        question: "From now on, explain using CBSE.",
        allowScopeMutation: false,
      })
    );

    expect(result.context.effectiveBoard).toBe("CBSE");
    expect(result.scopeMutation).toBeNull();
  });
});
