import { describe, expect, it, vi } from "vitest";
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
  organization: "00000000-0000-4000-8000-000000000501",
  student: "00000000-0000-4000-8000-000000000502",
  class: "00000000-0000-4000-8000-000000000503",
  syllabus: "00000000-0000-4000-8000-000000000504",
  tnBoard: "00000000-0000-4000-8000-000000000505",
  medium: "00000000-0000-4000-8000-000000000508",
  subject: "00000000-0000-4000-8000-000000000509",
  chapter: "00000000-0000-4000-8000-00000000050a",
  topic: "00000000-0000-4000-8000-00000000050b",
  science: "00000000-0000-4000-8000-00000000050c",
  photosynthesis: "00000000-0000-4000-8000-00000000050d",
  enrollment: "00000000-0000-4000-8000-00000000050e",
  conversation: "00000000-0000-4000-8000-00000000050f",
  branch: "00000000-0000-4000-8000-000000000510",
};

const boards: ActiveBoardIdentity[] = [
  { id: ids.tnBoard, name: "Tamil Nadu State Board", code: "TNSTATE" },
];

function entity(id: string, name: string, source: ContextEntity["source"] = "authoritative_syllabus") {
  return resolvedEntity({ id, name, code: null, source });
}

function hierarchy(overrides: Partial<LearningHierarchyResolution> = {}): LearningHierarchyResolution {
  return {
    subject: entity(ids.subject, "Mathematics", "class_subject_relationship"),
    chapter: entity(ids.chapter, "Fractions", "authoritative_curriculum_hierarchy"),
    topic: entity(ids.topic, "Equivalent Fractions", "authoritative_curriculum_hierarchy"),
    reports: {
      subject: { status: "resolved" },
      chapter: { status: "resolved" },
      topic: { status: "resolved" },
    },
    ...overrides,
  };
}

function learningContext(): StudentLearningContext {
  const component = { status: "resolved" as const };
  return {
    contractVersion: "1",
    student: { id: ids.student, gradeLevel: "8" },
    currentEnrollment: {
      id: ids.enrollment,
      classId: ids.class,
      academicYear: "2026-27",
      status: "resolved",
      enrollmentStatus: "ACTIVE",
      source: "explicit_enrollment",
    },
    currentClass: resolvedEntity({
      id: ids.class,
      name: "Class 8",
      source: "explicit_enrollment",
      academicYear: "2026-27",
    }),
    authoritativeSyllabus: {
      ...entity(ids.syllabus, "Class 8 Mathematics"),
      classId: ids.class,
    },
    board: { ...entity(ids.tnBoard, "Tamil Nadu State Board"), code: "TNSTATE" },
    medium: entity(ids.medium, "English"),
    languages: [entity(ids.medium, "English")],
    subject: entity(ids.subject, "Mathematics", "class_subject_relationship"),
    chapter: entity(ids.chapter, "Fractions", "authoritative_curriculum_hierarchy"),
    topic: entity(ids.topic, "Equivalent Fractions", "authoritative_curriculum_hierarchy"),
    learningProfile: null,
    conversation: {
      conversationId: ids.conversation,
      branchId: ids.branch,
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
      assemblyId: "assembly-us122",
      assembledAt: "2026-01-01T00:00:00.000Z",
      durationMs: 1,
      freshness: "request_time",
    },
    components: {
      enrollment: component,
      currentClass: component,
      syllabus: component,
      subject: component,
      chapter: component,
      topic: component,
      learningProfile: { status: "empty" },
      history: { status: "empty" },
    },
  };
}

/**
 * The authoritative resolver stand-in. It records every lookup it receives so the
 * suite can prove the seam reuses the existing resolution with the existing
 * tenant, class, and syllabus predicates, and returns exactly the hierarchy the
 * requested label authoritatively maps to.
 */
function authoritativeLookup() {
  const calls: Array<{
    organizationId: string;
    classId: string;
    syllabusId: string;
    scope: { subject?: string | null; chapter?: string | null; topic?: string | null };
  }> = [];
  const resolveCurriculumScope = vi.fn(
    async (input: {
      organizationId: string;
      classId: string;
      syllabusId: string;
      scope: { subject?: string | null; chapter?: string | null; topic?: string | null };
    }) => {
      calls.push(input);
      const subjectLabel = (input.scope.subject ?? "").trim().toLowerCase();
      const chapterLabel = (input.scope.chapter ?? "").trim().toLowerCase();
      const topicLabel = (input.scope.topic ?? "").trim().toLowerCase();

      if (subjectLabel && subjectLabel !== "mathematics") {
        if (subjectLabel === "science") {
          return hierarchy({
            subject: entity(ids.science, "Science", "class_subject_relationship"),
            chapter: unresolvedEntity("NO_CHAPTER"),
            topic: unresolvedEntity("NO_TOPIC"),
            reports: {
              subject: { status: "resolved" },
              chapter: { status: "unresolved" },
              topic: { status: "unresolved" },
            },
          });
        }
        if (subjectLabel === "social studies") {
          return hierarchy({
            subject: unresolvedEntity("AMBIGUOUS_SUBJECT"),
            chapter: unresolvedEntity("NO_CHAPTER"),
            topic: unresolvedEntity("NO_TOPIC"),
            reports: {
              subject: { status: "unresolved" },
              chapter: { status: "unresolved" },
              topic: { status: "unresolved" },
            },
          });
        }
        return hierarchy({
          subject: unresolvedEntity("NO_SUBJECT"),
          chapter: unresolvedEntity("NO_CHAPTER"),
          topic: unresolvedEntity("NO_TOPIC"),
          reports: {
            subject: { status: "unresolved" },
            chapter: { status: "unresolved" },
            topic: { status: "unresolved" },
          },
        });
      }
      if (topicLabel && topicLabel !== "equivalent fractions") {
        if (topicLabel === "photosynthesis") {
          return hierarchy({
            topic: entity(ids.photosynthesis, "Photosynthesis", "authoritative_curriculum_hierarchy"),
          });
        }
        return hierarchy({ topic: unresolvedEntity("NO_TOPIC") });
      }
      // The authoritative resolver matches node titles, so a chapter reference
      // that is not an authoritative title resolves as unresolved.
      if (chapterLabel && chapterLabel !== "fractions") {
        return hierarchy({ chapter: unresolvedEntity("NO_CHAPTER") });
      }
      return hierarchy();
    }
  );
  return { calls, resolveCurriculumScope };
}

function dependencies(lookup = authoritativeLookup()) {
  const getEvidence = vi.fn(async () => ({
    primarySourceCount: 1,
    sources: [
      {
        authority: "AUTHORITATIVE_CURRICULUM" as const,
        sourceKind: "CURRICULUM_NODE" as const,
        sourceLabel: "Fractions",
        content: "Equivalent fractions represent the same quantity.",
      },
    ],
  }));
  return {
    lookup,
    getEvidence,
    service: new BoardResponseService({
      repository: {
        listActiveBoards: vi.fn(async () => boards),
        getAuthoritativeBoardContexts: vi.fn(async () => ({ rows: [] })),
        getSyllabusLanguages: vi.fn(async () => ({
          rows: [{ id: ids.medium, name: "English", code: "EN" }],
        })),
        getEvidence,
      },
      learningContext: { resolveCurriculumScope: lookup.resolveCurriculumScope },
    }),
  };
}

function baseInput(overrides: Partial<BoardResponseInput> = {}): BoardResponseInput {
  return {
    organizationId: ids.organization,
    studentId: ids.student,
    question: "What is 2 + 2?",
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

describe("US-122 explicit subject/topic resolution seam", () => {
  it("resolves an explicit subject against the authoritative hierarchy", async () => {
    const { service, lookup } = dependencies();
    const result = await service.resolve(baseInput({ question: "Subject Science" }));

    expect(result.context.subjectTopicRequestOutcome).toBe("RESOLVED");
    expect(result.context.subject).toBe("Science");
    // Locked Decision #120 requirement 10: the existing tenant, class, and
    // designated-syllabus predicates are reused, never relaxed.
    expect(lookup.calls.at(-1)).toMatchObject({
      organizationId: ids.organization,
      classId: ids.class,
      syllabusId: ids.syllabus,
    });
    expect(lookup.calls.at(-1)?.scope.subject).toBe("Science");
  });

  it("resolves an explicit topic and keeps the levels the student did not name", async () => {
    const { service, lookup } = dependencies();
    const result = await service.resolve(
      baseInput({ question: "Explain photosynthesis" })
    );

    expect(result.context.subjectTopicRequestOutcome).toBe("RESOLVED");
    expect(result.context.topic).toBe("Photosynthesis");
    // The subject the student did not name keeps its authoritative label.
    expect(lookup.calls.at(-1)?.scope.subject).toBe("Mathematics");
    expect(lookup.calls.at(-1)?.scope.topic).toBe("photosynthesis");
    expect(result.context.subject).toBe("Mathematics");
  });

  it("selects curriculum evidence only for the resolved hierarchy", async () => {
    const { service, getEvidence } = dependencies();
    await service.resolve(baseInput({ question: "Explain photosynthesis" }));

    expect(getEvidence).toHaveBeenCalledTimes(1);
    expect(getEvidence.mock.calls[0][0]).toMatchObject({
      subjectId: ids.subject,
      chapterId: ids.chapter,
      topicId: ids.photosynthesis,
      organizationId: ids.organization,
      classId: ids.class,
      syllabusId: ids.syllabus,
    });
  });

  it("preserves an unrelated resolved hierarchy when the request is unresolved", async () => {
    const { service } = dependencies();
    const result = await service.resolve(
      baseInput({ question: "Explain the water cycle" })
    );

    expect(result.context.subjectTopicRequestOutcome).toBe("UNRESOLVED");
    // Decision #120 follow-up rules: an unresolvable request never replaces
    // unrelated existing scope.
    expect(result.context.subject).toBe("Mathematics");
    expect(result.context.chapter).toBe("Fractions");
    expect(result.context.topic).toBe("Equivalent Fractions");
  });

  it("never guesses between ambiguous authoritative candidates", async () => {
    const { service } = dependencies();
    const result = await service.resolve(
      baseInput({ question: "Subject Social Studies" })
    );

    expect(result.context.subjectTopicRequestOutcome).toBe("AMBIGUOUS");
    expect(result.context.subject).toBe("Mathematics");
    expect(result.context.chapter).toBe("Fractions");
  });

  it("keeps an ambiguous two-target question unresolved without touching scope", async () => {
    const { service, lookup } = dependencies();
    const callsBefore = lookup.calls.length;
    const result = await service.resolve(
      baseInput({ question: "Explain photosynthesis, then tell me about respiration" })
    );

    expect(result.context.subjectTopicRequestOutcome).toBe("AMBIGUOUS");
    // The system must not choose, so no authoritative attempt is made at all.
    expect(lookup.calls.length).toBe(callsBefore);
    expect(result.context.topic).toBe("Equivalent Fractions");
  });

  it("reports an unusable authoritative source without fabricating a relationship", async () => {
    const lookup = authoritativeLookup();
    lookup.resolveCurriculumScope.mockRejectedValueOnce(new Error("source unavailable"));
    const { service } = dependencies(lookup);
    const result = await service.resolve(baseInput({ question: "Explain photosynthesis" }));

    expect(result.context.subjectTopicRequestOutcome).toBe("SOURCE_UNAVAILABLE");
    expect(result.context.subject).toBe("Mathematics");
    expect(result.context.topic).toBe("Equivalent Fractions");
  });

  it("leaves a question without an explicit request byte-identical to US-121", async () => {
    const { service, lookup } = dependencies();
    const result = await service.resolve(baseInput({ question: "What is 2 + 2?" }));

    // No new field, and no additional authoritative lookup: the seam adds no
    // resolution work at all when the question names no curriculum level.
    expect(result.context.subjectTopicRequestOutcome).toBeUndefined();
    expect("subjectTopicRequestOutcome" in result.context).toBe(false);
    expect(lookup.calls).toHaveLength(0);
    expect(result.context.subject).toBe("Mathematics");
    expect(result.context.chapter).toBe("Fractions");
    expect(result.context.topic).toBe("Equivalent Fractions");
  });

  it("never turns a bare numeric chapter reference into a curriculum claim", async () => {
    const { service } = dependencies();
    const result = await service.resolve(baseInput({ question: "Chapter 5" }));

    // The explicit reference is carried and reported honestly. The resolver
    // matches authoritative titles, so nothing is guessed.
    expect(result.context.subjectTopicRequestOutcome).toBe("UNRESOLVED");
    expect(result.context.chapter).toBe("Fractions");
  });

  it("leaves board, class, language, and Epic 10 behaviour untouched", async () => {
    const { service } = dependencies();
    const result = await service.resolve(
      baseInput({ question: "Subject Science" })
    );

    expect(result.context.effectiveBoard).toBe("Tamil Nadu State Board");
    expect(result.context.effectiveClass).toBe("Class 8");
    expect(result.context.medium).toBe("English");
    expect(result.context.responseLanguage).toBe("English");
    expect(result.context.responseLanguageSource).toBe("CONFIGURED");
    expect(result.context.responseLanguageAvailability).toBe("AVAILABLE");
    expect(result.context.responseMode).toBe("CURRICULUM_GROUNDED");
  });

  it("never persists a subject/topic request as conversation scope", async () => {
    const { service } = dependencies();
    const result = await service.resolve(
      baseInput({ question: "Explain photosynthesis" })
    );

    // Request-scoped only: the inherited path produces no scope mutation, and no
    // new persistence field exists.
    expect(result.scopeMutation).toBeNull();
    expect(
      (service as unknown as { repository: Record<string, unknown> }).repository
    ).not.toHaveProperty("updateConversationScope");
    expect(JSON.stringify(result)).not.toMatch(/scope_subject|scope_topic/);
  });
});
