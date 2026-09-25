import { describe, expect, it } from "vitest";
import {
  LearningContextService,
  type LearningContextBuilderDependencies,
} from "../../src/modules/ai/learning-context.service.js";
import {
  selectRelevantLearningProfile,
  toModelLearningContext,
} from "../../src/modules/ai/context-resolution.js";
import { generateTutorReply } from "../../src/modules/ai/ai.service.js";
import type { LearningProfile } from "../../src/modules/progress/types.js";
import type { ContextEntity } from "../../src/modules/ai/learning-context.types.js";

const ids = {
  organization: "00000000-0000-4000-8000-000000000001",
  student: "00000000-0000-4000-8000-000000000002",
  enrollment: "00000000-0000-4000-8000-000000000003",
  klass: "00000000-0000-4000-8000-000000000004",
  syllabus: "00000000-0000-4000-8000-000000000005",
  board: "00000000-0000-4000-8000-000000000006",
  medium: "00000000-0000-4000-8000-000000000007",
  subject: "00000000-0000-4000-8000-000000000008",
  topic: "00000000-0000-4000-8000-000000000009",
};

function profile(): LearningProfile {
  return {
    subject_progress: {
      subjects: [
        { id: "math-subject", name: "Mathematics", code: "MATH", completed: 2, available: 4, percentage: 50 },
        { id: "science-subject", name: "Science", code: "SCI", completed: 1, available: 1, percentage: 100 },
      ],
    },
    chapter_progress: {
      chapters: [
        { id: "fraction-chapter", title: "Fractions", subject_id: "math-subject", completed: 2, available: 4, percentage: 50 },
        { id: "physics-chapter", title: "Motion", subject_id: "science-subject", completed: 1, available: 1, percentage: 100 },
      ],
    },
    topic_progress: {
      topics: [
        { id: "fractions-topic", title: "Equivalent Fractions", chapter_id: "fraction-chapter", completed: 1, available: 2, percentage: 50 },
        { id: "motion-topic", title: "Speed", chapter_id: "physics-chapter", completed: 1, available: 1, percentage: 100 },
      ],
    },
    homework_performance: { on_time: 1, late: 0, pending: 0, overdue: 0, total: 1 },
    practice_performance: {
      practice_results: [
        {
          attempt_id: "attempt-1",
          practice_id: "practice-1",
          practice_title: "Fraction practice",
          practice_type: "MULTIPLE_CHOICE",
          topic: "Equivalent Fractions",
          score: 1,
          max_score: 2,
          percentage: 50,
          correct_count: 1,
          incorrect_count: 1,
          unanswered_count: 0,
          submitted_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    formal_assessment_performance: { formal_assessment_results: [] },
    strong_topics: { strong_topics: [{ id: "motion-topic", title: "Speed", chapter_id: "physics-chapter", performance: 100, answered_responses: 10 }] },
    weak_topics: { weak_topics: [{ id: "fractions-topic", title: "Equivalent Fractions", chapter_id: "fraction-chapter", performance: 50, answered_responses: 10 }] },
    unfinished_learning: { topics: [{ id: "fractions-topic", title: "Equivalent Fractions", chapter_id: "fraction-chapter", completed: 1, available: 2, status: "UNFINISHED" }] },
    repeated_mistakes: { repeated_mistakes: [] },
  };
}

function entity(id: string, name: string): ContextEntity {
  return { id, name, code: null, status: "resolved", source: "authoritative_curriculum_hierarchy" };
}

function currentRow(overrides: Record<string, unknown> = {}) {
  return {
    current_enrollment_id: ids.enrollment,
    enrollment_id: ids.enrollment,
    enrollment_status: "ACTIVE",
    academic_year: "2026-27",
    class_id: ids.klass,
    class_name: "Class 8",
    class_section: "A",
    class_status: "ACTIVE",
    class_organization_id: ids.organization,
    student_organization_id: ids.organization,
    student_grade_level: "8",
    ...overrides,
  };
}

function syllabusRow(overrides: Record<string, unknown> = {}) {
  return {
    syllabus_id: ids.syllabus,
    class_id: ids.klass,
    board_id: ids.board,
    board_name: "CBSE",
    board_code: "CBSE",
    medium_id: ids.medium,
    medium_name: "English",
    medium_code: "EN",
    syllabus_name: "Class 8 Mathematics",
    syllabus_code: "MATH-8",
    syllabus_status: "ACTIVE",
    class_organization_id: ids.organization,
    class_status: "ACTIVE",
    ...overrides,
  };
}

function dependencies(overrides: Partial<LearningContextBuilderDependencies> = {}): LearningContextBuilderDependencies {
  const baseRepository = {
    getCurrentEnrollment: async () => ({ rows: [currentRow()] } as never),
    getAuthoritativeSyllabi: async () => ({ rows: [syllabusRow()] } as never),
    getSyllabusLanguages: async () => ({ rows: [] } as never),
    findSubjects: async () => ({ rows: [{ id: "math-subject", name: "Mathematics", code: "MATH" }] } as never),
    findCurriculumNodes: async (_organizationId: string, _classId: string, _syllabusId: string, _subjectId: string, nodeType: "CHAPTER" | "TOPIC") => ({
      rows: nodeType === "CHAPTER"
        ? [{ id: "fraction-chapter", title: "Fractions", code: null, subject_id: "math-subject", parent_id: null, parent_title: null, parent_type: null }]
        : [{ id: "fractions-topic", title: "Equivalent Fractions", code: null, subject_id: "math-subject", parent_id: "fraction-chapter", parent_title: "Fractions", parent_type: "CHAPTER" }],
    } as never),
  };
  return {
    ...overrides,
    repository: {
      ...baseRepository,
      ...(overrides.repository ?? {}),
    },
    loadLearningProfile: overrides.loadLearningProfile ?? (async () => profile()),
    now: overrides.now ?? (() => new Date("2026-01-01T00:00:00.000Z")),
    createAssemblyId: overrides.createAssemblyId ?? (() => "assembly-test"),
  };
}

const baseInput = {
  organizationId: ids.organization,
  studentId: ids.student,
  conversationId: "00000000-0000-4000-8000-00000000000a",
  branchId: "00000000-0000-4000-8000-00000000000b",
  history: [
    { role: "user" as const, content: "Earlier question" },
    { role: "assistant" as const, content: "Earlier answer" },
  ],
};

describe("US-118 student learning context", () => {
  it("does not infer a current class when no enrollment was explicitly selected", async () => {
    let syllabusCalls = 0;
    const service = new LearningContextService(
      dependencies({
        repository: {
          getCurrentEnrollment: async () => ({ rows: [currentRow({ current_enrollment_id: null })] } as never),
          getAuthoritativeSyllabi: async () => {
            syllabusCalls += 1;
            return { rows: [syllabusRow()] } as never;
          },
        },
      })
    );

    const context = await service.assemble(baseInput);
    expect(context.currentEnrollment.status).toBe("unresolved");
    expect(context.currentClass.status).toBe("unresolved");
    expect(context.currentClass.name).toBeNull();
    expect(syllabusCalls).toBe(0);
  });

  it("resolves class, board, and medium only through the selected chain", async () => {
    const service = new LearningContextService(dependencies());
    const context = await service.assemble(baseInput);

    expect(context.currentEnrollment.id).toBe(ids.enrollment);
    expect(context.currentClass.name).toBe("Class 8");
    expect(context.authoritativeSyllabus.id).toBe(ids.syllabus);
    expect(context.board.name).toBe("CBSE");
    expect(context.medium.name).toBe("English");
    expect(context.assembly.freshness).toBe("request_time");
  });

  it("marks zero and multiple authoritative syllabus candidates unresolved", async () => {
    const none = new LearningContextService(
      dependencies({ repository: { getAuthoritativeSyllabi: async () => ({ rows: [] } as never) } })
    );
    const noneContext = await none.assemble(baseInput);
    expect(noneContext.authoritativeSyllabus.status).toBe("unresolved");
    expect(noneContext.board.status).toBe("unresolved");
    expect(noneContext.medium.status).toBe("unresolved");

    const multiple = new LearningContextService(
      dependencies({
        repository: {
          getAuthoritativeSyllabi: async () => ({ rows: [syllabusRow(), syllabusRow({ syllabus_id: "second" })] } as never),
        },
      })
    );
    const multipleContext = await multiple.assemble(baseInput);
    expect(multipleContext.authoritativeSyllabus.status).toBe("unresolved");
    expect(multipleContext.authoritativeSyllabus.multipleCount).toBe(2);
    expect(multipleContext.board.status).toBe("unresolved");
  });

  it("keeps a complete Epic 10 profile internally while projecting only relevant fields", async () => {
    const complete = profile();
    const selected = selectRelevantLearningProfile(complete, {
      subject: entity("math-subject", "Mathematics"),
      chapter: entity("fraction-chapter", "Fractions"),
      topic: entity("fractions-topic", "Equivalent Fractions"),
    });
    expect(selected?.topic_progress?.map((item) => item.title)).toEqual(["Equivalent Fractions"]);
    expect(selected?.weak_topics?.map((item) => item.title)).toEqual(["Equivalent Fractions"]);
    expect(JSON.stringify(selected)).not.toContain("Speed");
    expect(JSON.stringify(selected)).not.toContain("physics-chapter");
    expect(complete.topic_progress.topics).toHaveLength(2);
  });

  it("does not persist or expose internal IDs in the model projection", async () => {
    const service = new LearningContextService(dependencies());
    const context = await service.assemble({
      ...baseInput,
      scope: { subject: "Mathematics", topic: "Equivalent Fractions" },
    });
    const projection = toModelLearningContext(context).context;
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(ids.student);
    expect(serialized).not.toContain(ids.enrollment);
    expect(serialized).not.toContain(ids.syllabus);
    expect(serialized).not.toContain("assembly-test");
  });

  it("preserves the supplied active-branch history and never adds sibling history", async () => {
    const service = new LearningContextService(dependencies());
    const context = await service.assemble({
      ...baseInput,
      history: [{ role: "user", content: "active branch only" }],
    });
    expect(context.conversation.history).toEqual([{ role: "user", content: "active branch only" }]);
    expect(context.conversation.isActiveBranch).toBe(true);
    expect(context.conversation.branchId).toBe(baseInput.branchId);

    const historicalAttempt = await service.assemble({
      ...baseInput,
      isActiveBranch: false,
      history: [{ role: "user", content: "historical branch only" }],
    });
    expect(historicalAttempt.conversation.isActiveBranch).toBe(false);
    expect(historicalAttempt.conversation.history[0].content).toBe("historical branch only");
  });

  it("reads authoritative state afresh for each assembly", async () => {
    let reads = 0;
    const service = new LearningContextService(
      dependencies({
        createAssemblyId: () => `assembly-${reads + 1}`,
        repository: {
          getCurrentEnrollment: async () => {
            reads += 1;
            return { rows: [currentRow()] } as never;
          },
          getAuthoritativeSyllabi: async () => ({
            rows: [syllabusRow({ board_name: reads === 1 ? "CBSE" : "ICSE", board_code: reads === 1 ? "CBSE" : "ICSE" })],
          } as never),
        },
      })
    );
    const first = await service.assemble(baseInput);
    const second = await service.assemble(baseInput);
    expect(reads).toBe(2);
    expect(first.board.name).toBe("CBSE");
    expect(second.board.name).toBe("ICSE");
    expect(first.assembly.assemblyId).not.toBe(second.assembly.assemblyId);
  });

  it("applies the configured token budget before the prompt layer reuses the projection", async () => {
    const service = new LearningContextService(dependencies({ maxModelContextTokens: 300 }));
    const context = await service.assemble({
      ...baseInput,
      history: [{ role: "user", content: "x".repeat(4000) }],
    });
    expect(context.modelContext).toBeDefined();
    expect(JSON.stringify(context.modelContext).length).toBeLessThan(4000);
    expect(context.conversation.historyTruncated).toBe(true);
  });

  it("degrades a missing profile without fabricating profile data", async () => {
    const service = new LearningContextService(
      dependencies({ loadLearningProfile: async () => { throw new Error("profile unavailable"); } })
    );
    const context = await service.assemble(baseInput);
    expect(context.learningProfile).toBeNull();
    expect(context.components.learningProfile.status).toBe("failed");
    expect(context.currentClass.status).toBe("resolved");
  });

  it("renders a privacy-safe structured context for a plain provider", async () => {
    let prompt = "";
    const service = new LearningContextService(dependencies());
    const context = await service.assemble({
      ...baseInput,
      scope: { subject: "Mathematics", topic: "Equivalent Fractions" },
    });
    const reply = await generateTutorReply(
      { question: "Explain equivalent fractions", studentLearningContext: context },
      {
        provider: {
          generate: async (value) => {
            prompt = value;
            return "safe reply";
          },
        },
      }
    );
    expect(reply).toBe("safe reply");
    expect(prompt).toContain("Equivalent Fractions");
    expect(prompt).toContain("CBSE");
    expect(prompt).not.toContain(ids.student);
    expect(prompt).not.toContain("Speed");
  });
});
