import { randomUUID } from "node:crypto";
import { learningProfileForStudent } from "../progress/service.js";
import {
  learningContextRepository,
  type LearningContextRepository,
} from "./learning-context.repository.js";
import {
  normalizeContextLabel,
  toModelLearningContext,
} from "./context-resolution.js";
import {
  LEARNING_CONTEXT_CONTRACT_VERSION,
  resolvedEntity,
  unresolvedEntity,
  type ContextAssemblyComponent,
  type ContextEntity,
  type ContextMessage,
  type EnrollmentContext,
  type LearningContextBuildInput,
  type StudentLearningContext,
} from "./learning-context.types.js";

const MAX_CONTEXT_HISTORY_MESSAGES = 20;
const DEFAULT_MAX_MODEL_CONTEXT_TOKENS = 6000;

export class LearningContextAssemblyError extends Error {
  readonly code = "AI_CONTEXT_ASSEMBLY_FAILED" as const;
  readonly category = "context_assembly" as const;

  constructor(
    public readonly component: string,
    public readonly originalError: unknown
  ) {
    super("AI learning context could not be assembled.");
    this.name = "LearningContextAssemblyError";
  }
}

export interface LearningContextBuilderDependencies {
  repository?: Partial<LearningContextRepository>;
  loadLearningProfile?: (organizationId: string, studentId: string) => Promise<import("../progress/types.js").LearningProfile>;
  now?: () => Date;
  createAssemblyId?: () => string;
  maxModelContextTokens?: number;
}

function unresolved<T extends ContextEntity>(reason: Parameters<typeof unresolvedEntity>[0]): T {
  return unresolvedEntity(reason) as T;
}

function component(
  status: ContextAssemblyComponent["status"],
  values: Omit<ContextAssemblyComponent, "status"> = {}
): ContextAssemblyComponent {
  return { status, ...values };
}

function rowIsCurrentAndActive(row: {
  current_enrollment_id: string | null;
  enrollment_id: string | null;
  enrollment_status: string | null;
  class_id: string | null;
  class_name: string | null;
  class_status: string | null;
  class_organization_id: string | null;
  student_organization_id: string | null;
} | undefined, organizationId: string): boolean {
  return Boolean(
    row &&
      row.current_enrollment_id &&
      row.enrollment_id === row.current_enrollment_id &&
      row.enrollment_status === "ACTIVE" &&
      row.class_id &&
      row.class_name &&
      row.class_status === "ACTIVE" &&
      row.class_organization_id === organizationId &&
      row.student_organization_id === organizationId
  );
}

function unresolvedEnrollment(reason: EnrollmentContext["resolutionError"]): EnrollmentContext {
  return {
    id: null,
    classId: null,
    academicYear: null,
    status: "unresolved",
    enrollmentStatus: null,
    source: "unresolved",
    resolutionError: reason,
  };
}

/**
 * Request-time US-118 assembler.  It reads only authoritative data, reuses
 * Epic 10's complete profile output, and consumes the already branch-filtered
 * history supplied by US-117.  No context snapshot is written.
 */
export class LearningContextService {
  private readonly repository: LearningContextRepository;
  private readonly loadLearningProfile: NonNullable<LearningContextBuilderDependencies["loadLearningProfile"]>;
  private readonly now: () => Date;
  private readonly createAssemblyId: () => string;
  private readonly maxModelContextTokens: number;

  constructor(dependencies: LearningContextBuilderDependencies = {}) {
    this.repository = {
      ...learningContextRepository,
      ...(dependencies.repository ?? {}),
    };
    this.loadLearningProfile = dependencies.loadLearningProfile ?? learningProfileForStudent;
    this.now = dependencies.now ?? (() => new Date());
    this.createAssemblyId = dependencies.createAssemblyId ?? (() => randomUUID());
    this.maxModelContextTokens = dependencies.maxModelContextTokens ?? DEFAULT_MAX_MODEL_CONTEXT_TOKENS;
  }

  async assemble(input: LearningContextBuildInput): Promise<StudentLearningContext>;
  async assemble(
    organizationId: string,
    studentId: string,
    conversationId: string,
    history?: ContextMessage[],
    scope?: LearningContextBuildInput["scope"]
  ): Promise<StudentLearningContext>;
  async assemble(
    inputOrOrganizationId: LearningContextBuildInput | string,
    positionalStudentId?: string,
    positionalConversationId?: string,
    positionalHistory: ContextMessage[] = [],
    positionalScope: LearningContextBuildInput["scope"] = {}
  ): Promise<StudentLearningContext> {
    const input: LearningContextBuildInput =
      typeof inputOrOrganizationId === "string"
        ? {
            organizationId: inputOrOrganizationId,
            studentId: positionalStudentId ?? "",
            conversationId: positionalConversationId ?? "",
            history: positionalHistory,
            scope: positionalScope,
          }
        : inputOrOrganizationId;
    const started = Date.now();
    const assemblyId = this.createAssemblyId();
    const organizationId = input.organizationId;

    let currentRow: Awaited<ReturnType<LearningContextRepository["getCurrentEnrollment"]>>["rows"][number] | undefined;
    try {
      const result = await this.repository.getCurrentEnrollment(organizationId, input.studentId);
      currentRow = result.rows[0];
    } catch (error) {
      throw new LearningContextAssemblyError("current_enrollment", error);
    }

    const currentResolved = rowIsCurrentAndActive(currentRow, organizationId);
    let currentEnrollment: EnrollmentContext;
    let currentClass: ContextEntity;
    if (!currentRow) {
      currentEnrollment = unresolvedEnrollment("SOURCE_UNAVAILABLE");
      currentClass = unresolved("SOURCE_UNAVAILABLE");
    } else if (!currentRow.current_enrollment_id) {
      currentEnrollment = unresolvedEnrollment("NO_CURRENT_SELECTION");
      currentClass = unresolved("NO_CURRENT_SELECTION");
    } else if (
      currentRow.enrollment_id !== currentRow.current_enrollment_id ||
      currentRow.enrollment_status !== "ACTIVE"
    ) {
      currentEnrollment = unresolvedEnrollment(
        currentRow.enrollment_id ? "INACTIVE_ENROLLMENT" : "INVALID_CURRENT_SELECTION"
      );
      currentClass = unresolved(currentEnrollment.resolutionError ?? "INVALID_CURRENT_SELECTION");
    } else if (
      !currentRow.class_id ||
      !currentRow.class_name ||
      currentRow.class_status !== "ACTIVE" ||
      currentRow.class_organization_id !== organizationId ||
      currentRow.student_organization_id !== organizationId
    ) {
      currentEnrollment = unresolvedEnrollment(
        currentRow.class_id ? "INACTIVE_CLASS" : "INVALID_CURRENT_SELECTION"
      );
      currentClass = unresolved(currentEnrollment.resolutionError ?? "INVALID_CURRENT_SELECTION");
    } else {
      currentEnrollment = {
        id: currentRow.enrollment_id,
        classId: currentRow.class_id,
        academicYear: currentRow.academic_year,
        status: "resolved",
        enrollmentStatus: currentRow.enrollment_status,
        source: "explicit_enrollment",
      };
      currentClass = resolvedEntity({
        id: currentRow.class_id,
        name: currentRow.class_name,
        code: null,
        source: "explicit_enrollment",
        section: currentRow.class_section,
        academicYear: currentRow.academic_year,
      });
    }

    let syllabus: ContextEntity & { classId: string | null; multipleCount?: number } = {
      ...unresolved("NO_AUTHORITATIVE_SYLLABUS"),
      classId: currentClass.id,
    };
    let board: ContextEntity = unresolved("NO_AUTHORITATIVE_SYLLABUS");
    let medium: ContextEntity = unresolved("NO_AUTHORITATIVE_SYLLABUS");
    let languages: ContextEntity[] = [];
    let syllabusReport = component("unresolved", { count: 0, reason: "NO_AUTHORITATIVE_SYLLABUS" });

    if (currentResolved && currentClass.id) {
      let rows: Awaited<ReturnType<LearningContextRepository["getAuthoritativeSyllabi"]>>["rows"] = [];
      try {
        rows = (await this.repository.getAuthoritativeSyllabi(currentClass.id, organizationId)).rows;
      } catch (error) {
        throw new LearningContextAssemblyError("authoritative_syllabus", error);
      }
      syllabusReport = component(rows.length === 1 ? "resolved" : "unresolved", {
        count: rows.length,
        ...(rows.length > 1 ? { reason: "MULTIPLE_AUTHORITATIVE_SYLLABI" as const } : {}),
        ...(rows.length === 0 ? { reason: "NO_AUTHORITATIVE_SYLLABUS" as const } : {}),
      });
      if (rows.length === 1) {
        const row = rows[0];
        if (!row.syllabus_id || !row.board_id || !row.board_name || !row.medium_id || !row.medium_name) {
          syllabus = {
            ...unresolved("SOURCE_UNAVAILABLE"),
            classId: currentClass.id,
          };
          syllabusReport = component("unresolved", {
            count: 1,
            reason: "SOURCE_UNAVAILABLE",
          });
        } else {
          syllabus = {
            ...resolvedEntity({
              id: row.syllabus_id,
              name: row.syllabus_name,
              code: row.syllabus_code,
              source: "authoritative_syllabus",
            }),
            classId: row.class_id,
          };
          board = resolvedEntity({
            id: row.board_id,
            name: row.board_name,
            code: row.board_code,
            source: "authoritative_syllabus",
          });
          medium = resolvedEntity({
            id: row.medium_id,
            name: row.medium_name,
            code: row.medium_code,
            source: "authoritative_syllabus",
          });

          // Language is supplementary authoritative syllabus data.  A missing
          // language association is omitted; it is never inferred from the
          // user's question or locale.
          try {
            languages = (await this.repository.getSyllabusLanguages(row.syllabus_id)).rows.map((language) =>
              resolvedEntity({
                id: String(language.id),
                name: String(language.name),
                code: String(language.code),
                source: "authoritative_syllabus",
              })
            );
          } catch {
            languages = [];
          }
        }
      } else if (rows.length > 1) {
        syllabus = {
          ...unresolved("MULTIPLE_AUTHORITATIVE_SYLLABI"),
          classId: currentClass.id,
          multipleCount: rows.length,
        };
      }
    }

    const scope = input.scope ?? {};
    let subject: ContextEntity = unresolved(scope.subject ? "NO_SUBJECT" : "NOT_PROVIDED");
    let chapter: ContextEntity = unresolved(scope.chapter ? "NO_CHAPTER" : "NOT_PROVIDED");
    let topic: ContextEntity = unresolved(scope.topic ? "NO_TOPIC" : "NOT_PROVIDED");
    let subjectReport = component(scope.subject ? "unresolved" : "skipped", {
      ...(scope.subject ? { reason: "NO_SUBJECT" as const } : {}),
    });
    let chapterReport = component(scope.chapter ? "unresolved" : "skipped", {
      ...(scope.chapter ? { reason: "NO_CHAPTER" as const } : {}),
    });
    let topicReport = component(scope.topic ? "unresolved" : "skipped", {
      ...(scope.topic ? { reason: "NO_TOPIC" as const } : {}),
    });

    if (currentResolved && currentClass.id && scope.subject) {
      try {
        const rows = (await this.repository.findSubjects(organizationId, currentClass.id, scope.subject)).rows;
        if (rows.length === 1) {
          subject = resolvedEntity({
            id: rows[0].id,
            name: rows[0].name,
            code: rows[0].code,
            source: "class_subject_relationship",
          });
          subjectReport = component("resolved", { count: 1 });
        } else {
          subject = unresolved(rows.length > 1 ? "AMBIGUOUS_SUBJECT" : "NO_SUBJECT");
          subjectReport = component("unresolved", {
            count: rows.length,
            reason: rows.length > 1 ? "AMBIGUOUS_SUBJECT" : "NO_SUBJECT",
          });
        }
      } catch {
        subject = unresolved("SOURCE_UNAVAILABLE");
        subjectReport = component("failed", { reason: "SOURCE_ERROR" });
      }
    }

    if (subject.status === "resolved" && syllabus.status === "resolved" && syllabus.id && scope.chapter) {
      try {
        const rows = (
          await this.repository.findCurriculumNodes(
            organizationId,
            currentClass.id as string,
            syllabus.id,
            subject.id as string,
            "CHAPTER",
            scope.chapter
          )
        ).rows;
        if (rows.length === 1) {
          chapter = resolvedEntity({
            id: rows[0].id,
            name: rows[0].title,
            code: rows[0].code,
            source: "authoritative_curriculum_hierarchy",
          });
          chapterReport = component("resolved", { count: 1 });
        } else {
          chapter = unresolved(rows.length > 1 ? "AMBIGUOUS_CHAPTER" : "NO_CHAPTER");
          chapterReport = component("unresolved", {
            count: rows.length,
            reason: rows.length > 1 ? "AMBIGUOUS_CHAPTER" : "NO_CHAPTER",
          });
        }
      } catch {
        chapter = unresolved("SOURCE_UNAVAILABLE");
        chapterReport = component("failed", { reason: "SOURCE_ERROR" });
      }
    }

    if (subject.status === "resolved" && syllabus.status === "resolved" && syllabus.id && scope.topic) {
      try {
        const rows = (
          await this.repository.findCurriculumNodes(
            organizationId,
            currentClass.id as string,
            syllabus.id,
            subject.id as string,
            "TOPIC",
            scope.topic,
            chapter.status === "resolved" ? chapter.id : null
          )
        ).rows;
        if (rows.length === 1) {
          const row = rows[0];
          topic = resolvedEntity({
            id: row.id,
            name: row.title,
            code: row.code,
            source: "authoritative_curriculum_hierarchy",
          });
          topicReport = component("resolved", { count: 1 });
          // A topic's active chapter parent is authoritative context.  Fill
          // it only when the conversation did not provide a conflicting
          // chapter label; never infer a chapter from a topic name alone.
          if (
            !scope.chapter &&
            chapter.status !== "resolved" &&
            row.parent_id &&
            normalizeContextLabel(row.parent_type) === "chapter" &&
            row.parent_title
          ) {
            chapter = resolvedEntity({
              id: row.parent_id,
              name: row.parent_title,
              source: "authoritative_curriculum_hierarchy",
            });
            chapterReport = component("resolved", { count: 1 });
          }
        } else {
          topic = unresolved(rows.length > 1 ? "AMBIGUOUS_TOPIC" : "NO_TOPIC");
          topicReport = component("unresolved", {
            count: rows.length,
            reason: rows.length > 1 ? "AMBIGUOUS_TOPIC" : "NO_TOPIC",
          });
        }
      } catch {
        topic = unresolved("SOURCE_UNAVAILABLE");
        topicReport = component("failed", { reason: "SOURCE_ERROR" });
      }
    }

    let learningProfile: import("../progress/types.js").LearningProfile | null = null;
    let profileReport: ContextAssemblyComponent = component("loaded", { count: 1 });
    try {
      learningProfile = (await this.loadLearningProfile(organizationId, input.studentId)) ?? null;
    } catch {
      learningProfile = null;
      profileReport = component("failed", { reason: "SOURCE_ERROR" });
    }

    const conversationHistory = this.normalizeHistory(input.history);
    const provisional: StudentLearningContext = {
      contractVersion: LEARNING_CONTEXT_CONTRACT_VERSION,
      student: {
        id: input.studentId,
        gradeLevel: currentRow?.student_grade_level ?? input.studentGrade ?? null,
      },
      currentEnrollment,
      currentClass,
      authoritativeSyllabus: syllabus,
      board,
      medium,
      languages,
      subject,
      chapter,
      topic,
      learningProfile,
      conversation: {
        conversationId: input.conversationId,
        branchId: input.branchId ?? null,
        branchName: input.branchName ?? null,
        isActiveBranch: input.isActiveBranch ?? true,
        subjectLabel: scope.subject ?? null,
        chapterLabel: scope.chapter ?? null,
        topicLabel: scope.topic ?? null,
        boardLabel: scope.board ?? null,
        classLabel: scope.class ?? null,
        languageLabel: scope.language ?? null,
        mediumLabel: scope.medium ?? null,
        history: conversationHistory,
        historyTruncated: conversationHistory.length < input.history.length,
      },
      assembly: {
        assemblyId,
        assembledAt: this.now().toISOString(),
        durationMs: Math.max(0, Date.now() - started),
        freshness: "request_time",
      },
      components: {
        enrollment: component(currentEnrollment.status, currentEnrollment.resolutionError ? { reason: currentEnrollment.resolutionError } : {}),
        currentClass: component(currentClass.status, currentClass.resolutionError ? { reason: currentClass.resolutionError } : {}),
        syllabus: syllabusReport,
        subject: subjectReport,
        chapter: chapterReport,
        topic: topicReport,
        learningProfile: profileReport,
        history: component(conversationHistory.length > 0 ? "loaded" : "empty", { count: conversationHistory.length }),
      },
    };

    // Apply a second, task-specific budget after source selection.  The full
    // Epic 10 profile remains on the internal object; only the model-facing
    // projection and bounded history are reduced.
    const projected = toModelLearningContext(provisional, this.maxModelContextTokens);
    provisional.conversation.history = projected.context.conversationHistory;
    provisional.conversation.historyTruncated ||= projected.truncated;
    provisional.modelContext = projected.context;
    provisional.components.history = component(
      provisional.conversation.history.length > 0 ? "loaded" : "empty",
      { count: provisional.conversation.history.length }
    );
    provisional.assembly.durationMs = Math.max(0, Date.now() - started);
    // Operational metadata only: no student identity, labels, history, or
    // profile content is written to logs.
    if (process.env.NODE_ENV === "production") {
      console.debug("AI learning context assembled", {
        assemblyId: provisional.assembly.assemblyId,
        durationMs: provisional.assembly.durationMs,
        components: Object.fromEntries(
          Object.entries(provisional.components).map(([name, value]) => [name, value.status])
        ),
      });
    }
    return provisional;
  }

  private normalizeHistory(history: ContextMessage[]): ContextMessage[] {
    const safe = (history ?? [])
      .filter((message) => message && (message.role === "user" || message.role === "assistant"))
      .map((message) => ({ role: message.role, content: String(message.content ?? "") }));
    return safe.slice(-MAX_CONTEXT_HISTORY_MESSAGES);
  }
}

/** Short alias used by callers that prefer the service-style name. */
export const StudentLearningContextService = LearningContextService;
export const buildStudentLearningContext = async (input: LearningContextBuildInput) =>
  new LearningContextService().assemble(input);
