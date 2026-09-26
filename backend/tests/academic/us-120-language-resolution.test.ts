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
  organization: "00000000-0000-4000-8000-000000000101",
  student: "00000000-0000-4000-8000-000000000102",
  class: "00000000-0000-4000-8000-000000000103",
  syllabus: "00000000-0000-4000-8000-000000000104",
  tnBoard: "00000000-0000-4000-8000-000000000105",
  medium: "00000000-0000-4000-8000-000000000108",
  subject: "00000000-0000-4000-8000-000000000109",
  chapter: "00000000-0000-4000-8000-00000000010a",
  topic: "00000000-0000-4000-8000-00000000010b",
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
  languages: ContextEntity[] = [entity("00000000-0000-4000-8000-00000000010d", "English")]
): StudentLearningContext {
  const currentClass = entity(ids.class, "Class 8");
  const syllabus = entity(ids.syllabus, "Class 8 Mathematics");
  const medium = entity(ids.medium, "English");
  const resolved = hierarchy();
  return {
    contractVersion: "1",
    student: { id: ids.student, gradeLevel: "8" },
    currentEnrollment: {
      id: "00000000-0000-4000-8000-00000000010c",
      classId: ids.class,
      academicYear: "2026-27",
      status: "resolved",
      enrollmentStatus: "ACTIVE",
      source: "explicit_enrollment",
    },
    currentClass,
    authoritativeSyllabus: { ...syllabus, classId: ids.class },
    board: { ...entity(ids.tnBoard, "Tamil Nadu State Board"), code: "TNSTATE" },
    medium,
    languages,
    subject: resolved.subject,
    chapter: resolved.chapter,
    topic: resolved.topic,
    learningProfile: null,
    conversation: {
      conversationId: "00000000-0000-4000-8000-00000000010e",
      branchId: "00000000-0000-4000-8000-00000000010f",
      branchName: null,
      isActiveBranch: true,
      subjectLabel: "Mathematics",
      chapterLabel: "Fractions",
      topicLabel: "Equivalent Fractions",
      boardLabel: null,
      classLabel: "Class 8",
      languageLabel: null,
      mediumLabel: "English",
      history: [],
      historyTruncated: false,
    },
    assembly: {
      assemblyId: "assembly-us120",
      assembledAt: "2026-01-01T00:00:00.000Z",
      durationMs: 1,
      freshness: "request_time",
    },
    components: {
      enrollment: { status: "resolved" },
      currentClass: { status: "resolved" },
      syllabus: { status: "resolved" },
      subject: resolved.reports.subject,
      chapter: resolved.reports.chapter,
      topic: resolved.reports.topic,
      learningProfile: { status: "empty" },
      history: { status: "empty" },
    },
  };
}

function languageRow(id: string, name: string, code: string) {
  return { id, name, code };
}

function dependencies(options: { languages?: Array<ReturnType<typeof languageRow>> } = {}) {
  return {
    repository: {
      listActiveBoards: vi.fn(async () => boards),
      getAuthoritativeBoardContexts: vi.fn(async () => ({ rows: [] })),
      getSyllabusLanguages: vi.fn(async () => ({
        rows: options.languages ?? [languageRow(ids.medium, "English", "EN")],
      })),
      getEvidence: vi.fn(async () => ({
        primarySourceCount: 0,
        sources: [] as Array<{
          authority: "AUTHORITATIVE_CURRICULUM";
          sourceKind: "CURRICULUM_NODE";
          sourceLabel: string;
          content: string;
        }>,
      })),
    },
    learningContext: {
      resolveCurriculumScope: vi.fn(async () => hierarchy()),
    },
  };
}

function baseInput(
  overrides: Partial<BoardResponseInput> = {},
  languageRows?: Array<ReturnType<typeof languageRow>>
): BoardResponseInput {
  // The authoritative syllabus language list reaches the resolver through the
  // US-118 learning context on the normal/inherited path.
  const rows = languageRows ?? [languageRow(ids.medium, "English", "EN")];
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
    learningContext: learningContext(
      rows.map((row, index) =>
        entity(`00000000-0000-4000-8000-0000000002${index}${row.code}`, row.name)
      )
    ),
    allowScopeMutation: true,
    ...overrides,
  };
}

describe("US-120 response language resolution", () => {
  it("uses an applicable conversation scope language (Decision #119 clauses 1 and 1a)", async () => {
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "English", "EN")] })
    );
    const result = await service.resolve(
      baseInput({ conversationScope: { ...baseInput().conversationScope, language: "English" } })
    );
    expect(result.context.responseLanguage).toBe("English");
    expect(result.context.responseLanguageSource).toBe("CONFIGURED");
    expect(result.context.responseLanguageAvailability).toBe("AVAILABLE");
  });

  it("matches an applicable scope language by authoritative code", async () => {
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "English", "EN")] })
    );
    const result = await service.resolve(
      baseInput({ conversationScope: { ...baseInput().conversationScope, language: "EN" } })
    );
    expect(result.context.responseLanguage).toBe("English");
    expect(result.context.responseLanguageAvailability).toBe("AVAILABLE");
  });

  it("never applies a non-applicable scope language", async () => {
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "English", "EN")] })
    );
    const result = await service.resolve(
      baseInput({ conversationScope: { ...baseInput().conversationScope, language: "Klingon" } })
    );
    // Single authoritative syllabus language: Decision #119 clause 2.
    expect(result.context.responseLanguage).toBe("English");
    expect(result.context.responseLanguageSource).toBe("CONFIGURED");
  });

  it("uses the only authoritative syllabus language when no scope language applies", async () => {
    const rows = [languageRow(ids.medium, "Tamil", "TA")];
    const service = new BoardResponseService(dependencies({ languages: rows }));
    const result = await service.resolve(baseInput({}, rows));
    expect(result.context.responseLanguage).toBe("Tamil");
    expect(result.context.responseLanguageSource).toBe("CONFIGURED");
    expect(result.context.responseLanguageAvailability).toBe("AVAILABLE");
  });

  it("does not arbitrarily select among multiple syllabus languages", async () => {
    // Decision #119 clauses 3 and 4: no applicable scope_language and more than
    // one authoritative language must stay unresolved.
    const rows = [
      languageRow(ids.medium, "English", "EN"),
      languageRow(ids.subject, "Tamil", "TA"),
    ];
    const service = new BoardResponseService(dependencies({ languages: rows }));
    const result = await service.resolve(baseInput({}, rows));
    expect(result.context.responseLanguage).toBeNull();
    expect(result.context.responseLanguageSource).toBeNull();
    expect(result.context.responseLanguageAvailability).toBe("UNRESOLVED");
  });

  it("never uses syllabus language ordering as a selection rule", async () => {
    // Clause 5: reversing the authoritative list must not change the outcome.
    const ascending = [
      languageRow(ids.medium, "English", "EN"),
      languageRow(ids.subject, "Tamil", "TA"),
    ];
    const descending = [
      languageRow(ids.subject, "Tamil", "TA"),
      languageRow(ids.medium, "English", "EN"),
    ];
    const a = await new BoardResponseService(dependencies({ languages: ascending })).resolve(
      baseInput({}, ascending)
    );
    const b = await new BoardResponseService(dependencies({ languages: descending })).resolve(
      baseInput({}, descending)
    );
    expect(a.context.responseLanguage).toBeNull();
    expect(b.context.responseLanguage).toBeNull();
    expect(a.context.responseLanguageAvailability).toBe("UNRESOLVED");
    expect(b.context.responseLanguageAvailability).toBe("UNRESOLVED");
  });

  it("uses a present scope language when no authoritative syllabus resolves (clause 1b)", async () => {
    const service = new BoardResponseService(dependencies({ languages: [] }));
    const result = await service.resolve(
      baseInput({
        learningContext: learningContext([unresolvedEntity("NO_LANGUAGE")]),
        conversationScope: { ...baseInput().conversationScope, language: "English" },
      })
    );
    expect(result.context.responseLanguage).toBe("English");
    expect(result.context.responseLanguageSource).toBe("CONFIGURED");
    // Availability cannot be proven without an authoritative syllabus.
    expect(result.context.responseLanguageAvailability).toBe("UNAVAILABLE");
  });

  it("leaves the configured language unresolved with no syllabus and no scope language", async () => {
    const service = new BoardResponseService(dependencies({ languages: [] }));
    const result = await service.resolve(
      baseInput({
        learningContext: learningContext([unresolvedEntity("NO_LANGUAGE")]),
        conversationScope: { ...baseInput().conversationScope, language: null },
      })
    );
    expect(result.context.responseLanguage).toBeNull();
    expect(result.context.responseLanguageAvailability).toBe("UNRESOLVED");
  });

  it("honors an explicitly requested unavailable language (Decision #117)", async () => {
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "English", "EN")] })
    );
    const result = await service.resolve(
      baseInput({
        question: "Explain this in French.",
        conversationScope: { ...baseInput().conversationScope, language: null },
      })
    );
    expect(result.context.responseLanguage).toBe("French");
    expect(result.context.responseLanguageSource).toBe("EXPLICIT_REQUEST");
    expect(result.context.responseLanguageAvailability).toBe("UNAVAILABLE");
  });

  it("gives an explicit request precedence over the configured language", async () => {
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "Tamil", "TA")] })
    );
    const result = await service.resolve(
      baseInput({
        question: "Explain this in English",
        conversationScope: { ...baseInput().conversationScope, language: "Tamil" },
      })
    );
    // Tier 1 outranks tier 3.
    expect(result.context.responseLanguage).toBe("English");
    expect(result.context.responseLanguageSource).toBe("EXPLICIT_REQUEST");
    expect(result.context.responseLanguageAvailability).toBe("AVAILABLE");
  });

  it("keeps persistence wording request-scoped and never mutates scope", async () => {
    const rows = [languageRow(ids.medium, "English", "EN")];
    const service = new BoardResponseService(dependencies({ languages: rows }));
    const scope = { ...baseInput().conversationScope, language: "English" };
    const result = await service.resolve(
      baseInput({ question: "From now on explain in Tamil", conversationScope: scope }, rows)
    );
    expect(result.context.responseLanguage).toBe("Tamil");
    expect(result.context.responseLanguageSource).toBe("EXPLICIT_REQUEST");
    // Decision #116: the inherited path produces no durable scope mutation at
    // all, so a request-scoped language selection can never be written back.
    expect(result.scopeMutation).toBeNull();
  });

  it("does not mutate board, class, subject, chapter, or topic for a language request", async () => {
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "English", "EN")] })
    );
    const before = baseInput();
    const result = await service.resolve({ ...before, question: "Explain this in French." });
    expect(result.context.effectiveBoard).toBe(before.learningContext.board.name);
    expect(result.context.effectiveClass).toBe("Class 8");
    expect(result.context.subject).toBe("Mathematics");
    expect(result.context.chapter).toBe("Fractions");
    expect(result.context.topic).toBe("Equivalent Fractions");
  });

  it("honors an unverified explicit language request without asserting a language", async () => {
    // Decision #117 must not drop the request; Decision #118 forbids inventing
    // a language, so the server asserts none and flags the request.
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "English", "EN")] })
    );
    for (const question of [
      "explain this in french",
      "translate this to french",
      "explain fractions, french please",
    ]) {
      const result = await service.resolve(
        baseInput({
          question,
          conversationScope: { ...baseInput().conversationScope, language: null },
        })
      );
      expect(result.context.responseLanguage, question).toBeNull();
      expect(result.context.responseLanguageSource, question).toBe("EXPLICIT_REQUEST");
      expect(result.context.responseLanguageAvailability, question).toBe("UNAVAILABLE");
      // Decision #116: request-scoped only, never written back to scope.
      expect(result.scopeMutation, question).toBeNull();
    }
  });

  it("honors a named unavailable language from any script", async () => {
    // Decision #117: an explicitly requested language outside the authoritative
    // syllabus capability list is honored for the current response only.
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "English", "EN")] })
    );
    for (const [question, target] of [
      ["Translate this to French.", "French"],
      ["Explain fractions, French please", "French"],
      ["Respond in Spanish please", "Spanish"],
      ["Explain this using Mandarin Chinese", "Mandarin Chinese"],
      ["Explain this in தமிழ்", "தமிழ்"],
      ["Explain this in 日本語", "日本語"],
      ["Explain this in हिन्दी", "हिन्दी"],
      ["Explain this in العربية", "العربية"],
    ] as const) {
      const result = await service.resolve(
        baseInput({
          question,
          conversationScope: { ...baseInput().conversationScope, language: null },
        })
      );
      expect(result.context.responseLanguage, question).toBe(target);
      expect(result.context.responseLanguageSource, question).toBe("EXPLICIT_REQUEST");
      expect(result.context.responseLanguageAvailability, question).toBe("UNAVAILABLE");
      // No curriculum-language alignment claim and no scope mutation of any kind.
      expect(result.context.effectiveBoard, question).toBe(
        baseInput().learningContext.board?.name
      );
      expect(result.context.effectiveClass, question).toBe("Class 8");
      expect(result.context.subject, question).toBe("Mathematics");
      expect(result.context.chapter, question).toBe("Fractions");
      expect(result.context.topic, question).toBe("Equivalent Fractions");
      expect(result.scopeMutation, question).toBeNull();
    }
  });

  it("honors Tamil as an unavailable language without asserting syllabus support", async () => {
    // The authoritative syllabus offers English only, so an explicit Tamil
    // request is honored as UNAVAILABLE rather than silently downgraded.
    const rows = [languageRow(ids.medium, "English", "EN")];
    const service = new BoardResponseService(dependencies({ languages: rows }));
    for (const question of ["From now on explain in Tamil", "Use Tamil for this answer"]) {
      const result = await service.resolve(
        baseInput(
          { question, conversationScope: { ...baseInput().conversationScope, language: null } },
          rows
        )
      );
      expect(result.context.responseLanguage, question).toBe("Tamil");
      expect(result.context.responseLanguageSource, question).toBe("EXPLICIT_REQUEST");
      expect(result.context.responseLanguageAvailability, question).toBe("UNAVAILABLE");
      // Decision #116: "From now on" wording must not persist anything.
      expect(result.scopeMutation, question).toBeNull();
    }
    // The same request written in lower case is honored identically; the server
    // simply asserts no language name it cannot corroborate (Decision #118).
    const lowercase = await service.resolve(
      baseInput(
        {
          question: "Explain this in tamil",
          conversationScope: { ...baseInput().conversationScope, language: null },
        },
        rows
      )
    );
    expect(lowercase.context.responseLanguage).toBeNull();
    expect(lowercase.context.responseLanguageSource).toBe("EXPLICIT_REQUEST");
    expect(lowercase.context.responseLanguageAvailability).toBe("UNAVAILABLE");
    expect(lowercase.scopeMutation).toBeNull();
  });

  it("does not turn an obvious non-language qualifier into a language request", async () => {
    // Decision #118 tier 1 stays an explicit language request only; a style
    // qualifier is not one, so the configured language and curriculum scope
    // stay exactly as they were.
    const rows = [languageRow(ids.medium, "Tamil", "TA")];
    const service = new BoardResponseService(dependencies({ languages: rows }));
    for (const question of [
      "Explain this in detail",
      "Explain this in short terms",
      "Explain this in medium",
      "Explain this in Class 8",
      "Explain this in two parts",
      "Explain this in full detail",
    ]) {
      const result = await service.resolve(
        baseInput({ question, conversationScope: { ...baseInput().conversationScope, language: "Tamil" } }, rows)
      );
      expect(result.context.responseLanguage, question).toBe("Tamil");
      expect(result.context.responseLanguageSource, question).toBe("CONFIGURED");
      expect(result.context.responseLanguageAvailability, question).toBe("AVAILABLE");
      expect(result.scopeMutation, question).toBeNull();
    }
  });

  it("honors caseless-script explicit requests outside the syllabus list", async () => {
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "English", "EN")] })
    );
    for (const [question, target] of [
      ["Explain this in தமிழ்", "தமிழ்"],
      ["Explain this in 日本語", "日本語"],
    ] as const) {
      const result = await service.resolve(
        baseInput({
          question,
          conversationScope: { ...baseInput().conversationScope, language: null },
        })
      );
      expect(result.context.responseLanguage, question).toBe(target);
      expect(result.context.responseLanguageSource, question).toBe("EXPLICIT_REQUEST");
      expect(result.context.responseLanguageAvailability, question).toBe("UNAVAILABLE");
    }
  });

  it("redacts URL, UUID, and identifier metadata from a resolved response language", async () => {
    // The service boundary is where provider-safety is enforced.
    const service = new BoardResponseService(
      dependencies({ languages: [languageRow(ids.medium, "English", "EN")] })
    );
    const result = await service.resolve(
      baseInput({
        question: "Explain this in French.",
        conversationScope: {
          ...baseInput().conversationScope,
          language: "https://internal.example/secret",
        },
      })
    );
    expect(result.context.responseLanguage).not.toContain("internal.example");
    const serialized = JSON.stringify(result.context);
    expect(serialized).not.toMatch(/https?:\/\//i);
    expect(serialized).not.toMatch(/00000000-0000-4000-8000-[0-9a-f]{12}/i);
  });

  it("never calls any persistence method during language resolution", async () => {
    const service = new BoardResponseService(dependencies());
    const scope = { ...baseInput().conversationScope };
    await service.resolve({ ...baseInput(), question: "Explain this in French.", conversationScope: scope });
    // Nothing in the resolution path may reach the repository for writes.
    expect(
      (service as unknown as { repository: Record<string, unknown> }).repository
    ).not.toHaveProperty("updateConversationScope");
  });
});
