import { describe, expect, it, vi } from "vitest";
import { resolveClassAwareness } from "../../src/modules/ai/class-awareness.js";
import {
  BoardResponseService,
  type BoardResponseInput,
} from "../../src/modules/ai/board-response.service.js";
import type { ActiveBoardIdentity } from "../../src/modules/ai/board-response.types.js";
import {
  resolvedEntity,
  unresolvedEntity,
  type ContextEntity,
  type LearningHierarchyResolution,
  type StudentLearningContext,
} from "../../src/modules/ai/learning-context.types.js";

const ids = {
  organization: "00000000-0000-4000-8000-000000000401",
  student: "00000000-0000-4000-8000-000000000402",
  class: "00000000-0000-4000-8000-000000000403",
  syllabus: "00000000-0000-4000-8000-000000000404",
  tnBoard: "00000000-0000-4000-8000-000000000405",
  medium: "00000000-0000-4000-8000-000000000408",
  subject: "00000000-0000-4000-8000-000000000409",
  chapter: "00000000-0000-4000-8000-00000000040a",
  topic: "00000000-0000-4000-8000-00000000040b",
  enrollment: "00000000-0000-4000-8000-00000000040c",
};

const boards: ActiveBoardIdentity[] = [
  { id: ids.tnBoard, name: "Tamil Nadu State Board", code: "TNSTATE" },
];

function entity(id: string, name: string): ContextEntity {
  return resolvedEntity({ id, name, code: null, source: "authoritative_syllabus" });
}

function hierarchy(): LearningHierarchyResolution {
  return {
    subject: entity(ids.subject, "Mathematics"),
    chapter: entity(ids.chapter, "Fractions"),
    topic: entity(ids.topic, "Equivalent Fractions"),
    reports: {
      subject: { status: "resolved" },
      chapter: { status: "resolved" },
      topic: { status: "resolved" },
    },
  };
}

function learningContext(
  options: { className?: string | null; gradeLevel?: string | null; syllabus?: boolean } = {}
): StudentLearningContext {
  const className = options.className === undefined ? "Class 8" : options.className;
  const withSyllabus = options.syllabus !== false;
  const resolved = hierarchy();
  const component = { status: "resolved" as const };
  return {
    contractVersion: "1",
    student: { id: ids.student, gradeLevel: options.gradeLevel ?? "8" },
    currentEnrollment: {
      id: ids.enrollment,
      classId: className ? ids.class : null,
      academicYear: "2026-27",
      status: className ? "resolved" : "unresolved",
      enrollmentStatus: className ? "ACTIVE" : null,
      source: className ? "explicit_enrollment" : "unresolved",
    },
    currentClass: className
      ? resolvedEntity({
          id: ids.class,
          name: className,
          source: "explicit_enrollment",
          academicYear: "2026-27",
        })
      : unresolvedEntity("NO_CURRENT_SELECTION"),
    authoritativeSyllabus: withSyllabus
      ? {
          ...resolvedEntity({
            id: ids.syllabus,
            name: "Class 8 Mathematics",
            source: "authoritative_syllabus",
          }),
          classId: ids.class,
        }
      : { ...unresolvedEntity("NO_AUTHORITATIVE_SYLLABUS"), classId: className ? ids.class : null },
    // The board carries its authoritative code so the existing US-119 normal
    // path resolves a board, class, and medium from the learning context.
    board: { ...entity(ids.tnBoard, "Tamil Nadu State Board"), code: "TNSTATE" },
    medium: entity(ids.medium, "English"),
    languages: [entity(ids.medium, "English")],
    subject: resolved.subject,
    chapter: resolved.chapter,
    topic: resolved.topic,
    learningProfile: null,
    conversation: {
      conversationId: "00000000-0000-4000-8000-00000000040d",
      branchId: "00000000-0000-4000-8000-00000000040e",
      branchName: null,
      isActiveBranch: true,
      subjectLabel: "Mathematics",
      chapterLabel: "Fractions",
      topicLabel: "Equivalent Fractions",
      boardLabel: null,
      classLabel: null,
      languageLabel: null,
      mediumLabel: "English",
      history: [],
      historyTruncated: false,
    },
    assembly: {
      assemblyId: "assembly-us121-resolution",
      assembledAt: "2026-01-01T00:00:00.000Z",
      durationMs: 1,
      freshness: "request_time",
    },
    components: {
      enrollment: component,
      currentClass: component,
      syllabus: withSyllabus ? component : { status: "unresolved" },
      subject: component,
      chapter: component,
      topic: component,
      learningProfile: { status: "empty" },
      history: { status: "empty" },
    },
  };
}

function dependencies() {
  return {
    repository: {
      listActiveBoards: vi.fn(async () => boards),
      getAuthoritativeBoardContexts: vi.fn(async () => ({ rows: [] })),
      getSyllabusLanguages: vi.fn(async () => ({
        rows: [{ id: ids.medium, name: "English", code: "EN" }],
      })),
      getEvidence: vi.fn(async () => ({
        primarySourceCount: 1,
        sources: [
          {
            authority: "AUTHORITATIVE_CURRICULUM" as const,
            sourceKind: "CURRICULUM_NODE" as const,
            sourceLabel: "Fractions",
            content: "Equivalent fractions represent the same quantity.",
          },
        ],
      })),
    },
    learningContext: {
      resolveCurriculumScope: vi.fn(async () => hierarchy()),
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
      language: null,
      medium: "English",
    },
    learningContext: learningContext(),
    allowScopeMutation: true,
    ...overrides,
  };
}

/**
 * Mirrors the class input precedence the prompt layer uses, so this suite can
 * assert which resolved value class awareness would consume.
 */
function classPolicyFor(
  effectiveClass: string | null,
  gradeLevel: string | null,
  curriculumAvailable: boolean
) {
  return resolveClassAwareness({
    effectiveClass,
    gradeLevel,
    curriculumAvailable,
    modelLearningProfile: undefined,
  });
}

describe("US-121 class-aware resolution over the US-119/US-120 context", () => {
  it("derives the educational level from the authoritative resolved class", async () => {
    const service = new BoardResponseService(dependencies());
    const result = await service.resolve(baseInput());

    // The authoritative class is resolved by the existing US-119 board context.
    expect(result.context.effectiveClass).toBe("Class 8");
    expect(result.context.responseMode).toBe("CURRICULUM_GROUNDED");
    expect(result.context.evidenceStatus).toBe("AVAILABLE");

    const policy = classPolicyFor(
      result.context.effectiveClass,
      "8",
      result.context.responseMode === "CURRICULUM_GROUNDED"
    );
    expect(policy.status).toBe("RESOLVED");
    expect(policy.educationalLevelAvailable).toBe(true);
    expect(policy.authoritativeCurriculum).toBe("AVAILABLE");
  });

  it("keeps the level unresolved when the authoritative board context has no class", async () => {
    // No authoritative syllabus means no board context, so the existing chain
    // yields no class. Class awareness must not invent one.
    const service = new BoardResponseService(dependencies());
    const result = await service.resolve(
      baseInput({ learningContext: learningContext({ syllabus: false }) })
    );

    expect(result.context.effectiveClass).toBeNull();
    expect(result.context.responseMode).toBe("GENERAL_EDUCATIONAL");
    expect(result.context.evidenceStatus).toBe("NONE");

    const policy = classPolicyFor(
      result.context.effectiveClass,
      "8",
      result.context.responseMode === "CURRICULUM_GROUNDED"
    );
    // The grade label alone still resolves an educational level, and the
    // missing curriculum is reported as unavailable.
    expect(policy.status).toBe("RESOLVED");
    expect(policy.authoritativeCurriculum).toBe("UNAVAILABLE");
  });

  it("stays fully unresolved when neither class nor grade is available", async () => {
    const service = new BoardResponseService(dependencies());
    const result = await service.resolve(
      baseInput({
        learningContext: learningContext({ className: null, gradeLevel: null, syllabus: false }),
      })
    );

    expect(result.context.effectiveClass).toBeNull();
    const policy = classPolicyFor(result.context.effectiveClass, null, false);
    expect(policy.status).toBe("UNRESOLVED");
    expect(policy.educationalLevelAvailable).toBe(false);
  });

  it("adds no class-awareness field to the board response context", async () => {
    const service = new BoardResponseService(dependencies());
    const result = await service.resolve(baseInput());

    // US-121 must not extend the US-119/US-120 provider-safe contract: the
    // resolved context is exactly the pre-existing shape.
    expect(Object.keys(result.context).sort()).toEqual([
      "chapter",
      "comparisonBoards",
      "duration",
      "effectiveBoard",
      "effectiveClass",
      "evidence",
      "evidenceStatus",
      "generalKnowledgePolicy",
      "intent",
      "languages",
      "medium",
      "requestedBoard",
      "resolutionReason",
      "responseLanguage",
      "responseLanguageAvailability",
      "responseLanguageSource",
      "responseMode",
      "sourceLabels",
      "subject",
      "topic",
    ]);
    // And the class is not persisted anywhere in the resolution output.
    expect(JSON.stringify(result.context)).not.toContain("classAwareness");
    expect(JSON.stringify(result.context)).not.toContain("educationalLevelAvailable");
  });

  it("leaves the board, mode, evidence, and language resolution unchanged", async () => {
    const service = new BoardResponseService(dependencies());
    const result = await service.resolve(
      baseInput({ question: "Explain this in French. Explain equivalent fractions." })
    );

    expect(result.context.effectiveBoard).toBe("Tamil Nadu State Board");
    expect(result.context.effectiveClass).toBe("Class 8");
    expect(result.context.responseMode).toBe("CURRICULUM_GROUNDED");
    expect(result.context.evidenceStatus).toBe("AVAILABLE");
    expect(result.context.subject).toBe("Mathematics");
    expect(result.context.chapter).toBe("Fractions");
    expect(result.context.topic).toBe("Equivalent Fractions");
    // US-120 precedence is untouched by class awareness.
    expect(result.context.responseLanguage).toBe("French");
    expect(result.context.responseLanguageSource).toBe("EXPLICIT_REQUEST");
    expect(result.context.responseLanguageAvailability).toBe("UNAVAILABLE");
  });

  it("never mutates conversation scope for a class-aware response", async () => {
    const service = new BoardResponseService(dependencies());
    const result = await service.resolve(baseInput());
    // The inherited path produces no scope mutation, so a request-scoped
    // presentation level can never be written back.
    expect(result.scopeMutation).toBeNull();
  });

  it("reaches no write path and re-resolves no curriculum", async () => {
    const deps = dependencies();
    const service = new BoardResponseService(deps);
    await service.resolve(baseInput());

    // No persistence method is reachable from the resolution path.
    expect(
      (service as unknown as { repository: Record<string, unknown> }).repository
    ).not.toHaveProperty("updateConversationScope");
    expect(
      (service as unknown as { repository: Record<string, unknown> }).repository
    ).not.toHaveProperty("saveClassAwareness");

    // US-121 adds no data access: the read pattern stays exactly what US-119 and
    // US-120 need on the inherited path, and curriculum is not re-resolved.
    expect(deps.repository.listActiveBoards).toHaveBeenCalledTimes(1);
    expect(deps.repository.getEvidence).toHaveBeenCalledTimes(1);
    expect(deps.repository.getSyllabusLanguages).not.toHaveBeenCalled();
    expect(deps.repository.getAuthoritativeBoardContexts).not.toHaveBeenCalled();
  });
});
