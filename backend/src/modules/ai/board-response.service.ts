import {
  findExactActiveBoard,
  normalizeBoardRequestText,
  parseBoardRequest,
} from "./board-request-parser.js";
import {
  BoardEvidenceRepository,
  type AuthoritativeBoardContextRow,
} from "./board-evidence.repository.js";
import { LearningContextService } from "./learning-context.service.js";
import type { StudentLearningContext } from "./learning-context.types.js";
import type {
  ContextEntity,
  LearningHierarchyResolution,
} from "./learning-context.types.js";
import {
  findExactLanguage,
  parseLanguageRequest,
  type LanguageIdentity,
} from "./language-request-parser.js";
import { SubjectTopicResolutionService } from "./subject-topic-resolution.service.js";
import type {
  ActiveBoardIdentity,
  BoardComparisonProjection,
  BoardEvidenceProjection,
  BoardEvidenceStatus,
  BoardRequestParseResult,
  BoardResolutionReason,
  BoardResponseContext,
  BoardResponseMode,
  BoardResponseResolution,
  BoardScopeDuration,
  BoardScopeMutation,
  ResponseLanguageAvailability,
  ResponseLanguageSource,
  SubjectTopicRequestOutcome,
} from "./board-response.types.js";

/**
 * Internal-only companion to a resolved board context. Authoritative language
 * identities (name + code) are needed for Decision #119 applicability but must
 * never reach the provider-safe context.
 */
interface InternalBoardResolution extends BoardResponseResolution {
  authoritativeLanguages: LanguageIdentity[];
}

type ResponseLanguageResolution = Pick<
  BoardResponseContext,
  "responseLanguage" | "responseLanguageSource" | "responseLanguageAvailability"
>;

const UNRESOLVED_LANGUAGE: ResponseLanguageResolution = {
  responseLanguage: null,
  responseLanguageSource: null,
  responseLanguageAvailability: "UNRESOLVED",
};

interface ResolvedEntity {
  id: string;
  name: string;
  code: string | null;
}

interface ResolvedBoardContext {
  board: ActiveBoardIdentity;
  class: ResolvedEntity;
  syllabusId: string;
  medium: ResolvedEntity | null;
  languages: ResolvedEntity[];
  hierarchy: LearningHierarchyResolution;
  /**
   * US-122 explicit subject/chapter/topic request outcome for the current
   * response only. Absent when the question contained no explicit request, so
   * every pre-US-122 resolution path is unchanged.
   */
  subjectTopicRequestOutcome?: Exclude<SubjectTopicRequestOutcome, "NONE">;
}

interface EvidenceSelection {
  status: BoardEvidenceStatus;
  evidence: BoardEvidenceProjection[];
  sourceLabels: string[];
}

export interface BoardConversationScope {
  board: string | null;
  class: string | null;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  language: string | null;
  medium: string | null;
}

export interface BoardResponseInput {
  organizationId: string;
  studentId: string;
  question: string;
  conversationScope: BoardConversationScope;
  learningContext: StudentLearningContext;
  /** Only ORIGINAL attempts may repeat or apply a durable scope mutation. */
  allowScopeMutation: boolean;
}

export interface BoardResponseDependencies {
  repository: Pick<
    BoardEvidenceRepository,
    | "listActiveBoards"
    | "getAuthoritativeBoardContexts"
    | "getSyllabusLanguages"
    | "getEvidence"
  >;
  learningContext: Pick<LearningContextService, "resolveCurriculumScope">;
}

export class BoardResponseResolutionError extends Error {
  readonly code = "AI_BOARD_RESPONSE_ASSEMBLY_FAILED" as const;
  readonly category = "context_assembly" as const;

  constructor(public readonly originalError: unknown) {
    super("AI board response context could not be assembled.");
    this.name = "BoardResponseResolutionError";
  }
}

function entityValue(entity: ContextEntity | undefined): ResolvedEntity | null {
  if (!entity || entity.status !== "resolved" || !entity.id || !entity.name) return null;
  return { id: entity.id, name: entity.name, code: entity.code ?? null };
}

function sameBoard(left: ActiveBoardIdentity, right: ActiveBoardIdentity): boolean {
  return left.id === right.id;
}

/**
 * Internal-only projection of the authoritative syllabus language capability
 * list. Decision #119 clause 5 forbids using list ordering as a selection rule,
 * so callers must not depend on this array's order.
 */
function languageIdentitiesOf(context: ResolvedBoardContext): LanguageIdentity[] {
  return context.languages.map((language) => ({
    name: language.name,
    code: language.code,
  }));
}

function safeScalar(value: string, maxLength: number): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\b(?:https?|ftp):\/\/[^\s<>"']+/giu, "[redacted-location]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      "[redacted-id]"
    )
    .replace(
      /\b(?:org|organization|student|user|syllabus|resource|node|provider)(?:[_ -]id\b|[-_ ]?[0-9][A-Za-z0-9-]{2,})/giu,
      "[redacted-id]"
    )
    .replace(
      /\b(?:api[_ -]?key|access[_ -]?token|password|secret|organization[_ -]?id|student[_ -]?id|provider[_ -]?metadata|ownership)\b\s*[:=][^\n]*/giu,
      "[redacted-sensitive-value]"
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeModelLabel(value: string | null | undefined, maxLength = 180): string | null {
  if (!value) return null;
  return safeScalar(value, maxLength) || null;
}

function safeEvidence(
  authority: BoardEvidenceProjection["authority"],
  sourceKind: BoardEvidenceProjection["sourceKind"],
  sourceLabel: string,
  content: string
): BoardEvidenceProjection | null {
  const safeContent = safeScalar(content, 4000);
  if (!safeContent) return null;
  const fallback =
    authority === "AUTHORITATIVE_CURRICULUM"
      ? "Authoritative curriculum material"
      : "Approved learning resource";
  const safeLabel = safeScalar(sourceLabel, 180) || fallback;
  return { authority, sourceKind, sourceLabel: safeLabel, content: safeContent };
}

function responseModeForEvidence(status: BoardEvidenceStatus): BoardResponseMode {
  if (status === "CONFLICT") return "SOURCE_CONFLICT";
  if (status === "AVAILABLE") return "CURRICULUM_GROUNDED";
  return "GENERAL_EDUCATIONAL";
}

function contextValue(entity: ContextEntity | undefined): string | null {
  return entity?.status === "resolved" ? entity.name : null;
}

function durationForIntent(intent: BoardRequestParseResult["intent"]): BoardScopeDuration {
  switch (intent) {
    case "CURRENT_RESPONSE_BOARD":
      return "CURRENT_RESPONSE";
    case "CONVERSATION_BOARD_SCOPE":
      return "CONVERSATION";
    case "RESTORE_NORMAL_BOARD":
      return "NORMAL_BOARD";
    case "NO_BOARD_REQUEST":
      return "INHERITED";
    default:
      return "NONE";
  }
}

function scopeMutationFor(
  context: ResolvedBoardContext,
  scope: BoardConversationScope,
  restoreNormal: boolean
): BoardScopeMutation {
  const language = context.languages.find(
    (item) =>
      normalizeBoardRequestText(scope.language ?? "") === normalizeBoardRequestText(item.name) ||
      normalizeBoardRequestText(scope.language ?? "") === normalizeBoardRequestText(item.code ?? "")
  );

  return {
    board: restoreNormal ? null : context.board.name,
    class: context.class.name,
    subject: contextValue(context.hierarchy.subject),
    chapter: contextValue(context.hierarchy.chapter),
    topic: contextValue(context.hierarchy.topic),
    language: language?.name ?? null,
    medium: context.medium?.name ?? null,
  };
}

export class BoardResponseService {
  private readonly repository: BoardResponseDependencies["repository"];
  private readonly learningContext: BoardResponseDependencies["learningContext"];
  private readonly subjectTopics: SubjectTopicResolutionService;

  constructor(dependencies: Partial<BoardResponseDependencies> = {}) {
    this.repository = dependencies.repository ?? new BoardEvidenceRepository();
    this.learningContext = dependencies.learningContext ?? new LearningContextService();
    // US-122: the seam reuses the same authoritative resolver instance, so an
    // explicit request is resolved by exactly the same rules and predicates as
    // the conversation-scope hierarchy.
    this.subjectTopics = new SubjectTopicResolutionService(this.learningContext);
  }

  async resolve(input: BoardResponseInput): Promise<BoardResponseResolution> {
    try {
      const internal = await this.resolveInternal(input);
      // US-120: one uniform response-language resolution across every existing
      // board-response path. Read-only: never persists and never mutates scope.
      const language = this.resolveResponseLanguage(
        input,
        internal.context,
        internal.authoritativeLanguages
      );
      return {
        context: { ...internal.context, ...language },
        scopeMutation: internal.scopeMutation,
      };
    } catch (error) {
      if (error instanceof BoardResponseResolutionError) throw error;
      throw new BoardResponseResolutionError(error);
    }
  }

  /**
   * US-120 response-language resolution.
   *
   * Tier 1 (explicit request) and tier 3 (configured language) are resolved
   * server-side. Tier 2 (current-question language) is deliberately absent
   * because Decision #118 requires it to be determined inside the existing
   * AI/model pipeline; the model applies it between the two server-side tiers.
   *
   * Decision #116: strictly read-only. This method never writes conversation
   * scope, `scope_language`, or any persistent configuration.
   */
  private resolveResponseLanguage(
    input: BoardResponseInput,
    context: BoardResponseContext,
    authoritativeLanguages: LanguageIdentity[]
  ): ResponseLanguageResolution {
    const parsed = parseLanguageRequest(input.question, authoritativeLanguages);

    // Tier 1 - explicit language request.
    if (parsed.intent === "CURRENT_RESPONSE_LANGUAGE" && !parsed.ambiguous) {
      if (parsed.language) {
        return {
          responseLanguage: safeModelLabel(parsed.language.name),
          responseLanguageSource: "EXPLICIT_REQUEST",
          responseLanguageAvailability: "AVAILABLE",
        };
      }
      // Decision #117 - honored for the current response even though the
      // language is outside the authoritative syllabus capability list.
      if (parsed.requestedTarget) {
        return {
          responseLanguage: safeModelLabel(parsed.requestedTarget),
          responseLanguageSource: "EXPLICIT_REQUEST",
          responseLanguageAvailability: "UNAVAILABLE",
        };
      }
      // A real request whose target the server cannot confidently name. No
      // language is asserted; the model resolves it (Decision #118) under the
      // same Decision #117 guard.
      if (parsed.unverifiedExplicitRequest) {
        return {
          responseLanguage: null,
          responseLanguageSource: "EXPLICIT_REQUEST",
          responseLanguageAvailability: "UNAVAILABLE",
        };
      }
    }

    // Tier 3 - configured language (Decision #119). `context.languages` is
    // intentionally not used as a selection source; clause 5 forbids treating
    // syllabus_languages ordering as a product rule.
    const scopeLanguage = input.conversationScope.language;

    // Clause 1b - no authoritative syllabus resolved, so applicability cannot be
    // evaluated. Availability is reported as UNAVAILABLE so the model never
    // claims curriculum-language alignment it cannot prove.
    if (authoritativeLanguages.length === 0) {
      if (scopeLanguage && scopeLanguage.trim()) {
        return {
          responseLanguage: safeModelLabel(scopeLanguage),
          responseLanguageSource: "CONFIGURED",
          responseLanguageAvailability: "UNAVAILABLE",
        };
      }
      return UNRESOLVED_LANGUAGE;
    }

    // Clause 1 + 1a - exact normalized name/code match, never fuzzy.
    const applicable = findExactLanguage(scopeLanguage, authoritativeLanguages);
    if (applicable) {
      return {
        responseLanguage: safeModelLabel(applicable.name),
        responseLanguageSource: "CONFIGURED",
        responseLanguageAvailability: "AVAILABLE",
      };
    }

    // Clause 2 - exactly one authoritative syllabus language.
    if (authoritativeLanguages.length === 1) {
      return {
        responseLanguage: safeModelLabel(authoritativeLanguages[0].name),
        responseLanguageSource: "CONFIGURED",
        responseLanguageAvailability: "AVAILABLE",
      };
    }

    // Clause 3 + 4 - multiple authoritative languages and no applicable
    // scope_language. Never arbitrarily select one. Whether clarification is
    // actually required depends on the model-side tier 2, so this stays
    // UNRESOLVED and the prompt rule is conditional.
    return UNRESOLVED_LANGUAGE;
  }

  private async resolveInternal(input: BoardResponseInput): Promise<InternalBoardResolution> {
    const activeBoards = await this.repository.listActiveBoards();
    const parsed = parseBoardRequest(input.question, activeBoards);
    const normal = this.normalContext(input.learningContext);

    if (parsed.intent === "CLARIFY_BOARD") {
      return {
        context: this.clarificationContext(parsed),
        scopeMutation: null,
        authoritativeLanguages: [],
      };
    }

    if (parsed.intent === "CROSS_BOARD_COMPARISON") {
      return this.crossBoardContext(input, parsed, activeBoards, normal);
    }

    if (parsed.intent === "RESTORE_NORMAL_BOARD") {
      if (!normal) {
        return {
          context: this.emptyContext(
            { ...parsed, board: null, comparisonBoards: [], unresolvedTarget: null, reason: null },
            "NO_EFFECTIVE_BOARD",
            "TARGETED_CLARIFICATION"
          ),
          scopeMutation: null,
          authoritativeLanguages: [],
        };
      }
      const scoped = await this.applyExplicitSubjectTopic(input, normal);
      const evidence = await this.loadEvidence(input, scoped);
      const context = this.singleBoardContext({
        parsed,
        resolved: scoped,
        evidence,
        resolutionReason: evidence.status === "CONFLICT" ? "AUTHORITATIVE_SOURCE_CONFLICT" : null,
      });
      return {
        context,
        scopeMutation: input.allowScopeMutation
          ? scopeMutationFor(normal, input.conversationScope, true)
          : null,
        authoritativeLanguages: languageIdentitiesOf(normal),
      };
    }

    if (
      parsed.intent === "CURRENT_RESPONSE_BOARD" ||
      parsed.intent === "CONVERSATION_BOARD_SCOPE"
    ) {
      if (!parsed.board) {
        return {
          context: this.clarificationContext({
            ...parsed,
            reason: "MISSING_BOARD_TARGET",
          }),
          scopeMutation: null,
          authoritativeLanguages: [],
        };
      }
      const resolved = await this.resolveExactBoard(
        input,
        parsed.board,
        activeBoards,
        normal
      );
      if (!resolved.context) {
        return {
          context: this.emptyContext(parsed, resolved.reason, "TARGETED_CLARIFICATION"),
          scopeMutation: null,
          authoritativeLanguages: [],
        };
      }
      const scoped = await this.applyExplicitSubjectTopic(input, resolved.context);
      const evidence = await this.loadEvidence(input, scoped);
      return {
        context: this.singleBoardContext({
          parsed,
          resolved: scoped,
          evidence,
          resolutionReason: evidence.status === "CONFLICT" ? "AUTHORITATIVE_SOURCE_CONFLICT" : null,
        }),
        scopeMutation:
          input.allowScopeMutation && parsed.intent === "CONVERSATION_BOARD_SCOPE"
            ? scopeMutationFor(resolved.context, input.conversationScope, false)
            : null,
        authoritativeLanguages: languageIdentitiesOf(resolved.context),
      };
    }

    // No explicit request: an existing conversation override is usable only
    // after exact authoritative re-resolution. Invalid legacy labels fall back
    // to the US-118 normal context and are never promoted to authority.
    const inherited = await this.inheritedContext(
      input,
      activeBoards,
      normal
    );
    if (!inherited) {
      return {
        context: this.emptyContext(parsed, "NO_EFFECTIVE_BOARD", "GENERAL_EDUCATIONAL"),
        scopeMutation: null,
        authoritativeLanguages: [],
      };
    }
    const scoped = await this.applyExplicitSubjectTopic(input, inherited);
    const evidence = await this.loadEvidence(input, scoped);
    return {
      context: this.singleBoardContext({
        parsed,
        resolved: scoped,
        evidence,
        resolutionReason: evidence.status === "CONFLICT" ? "AUTHORITATIVE_SOURCE_CONFLICT" : null,
      }),
      scopeMutation: null,
      authoritativeLanguages: languageIdentitiesOf(inherited),
    };
  }

  private normalContext(
    learningContext: StudentLearningContext
  ): ResolvedBoardContext | null {
    const board = entityValue(learningContext.board);
    const currentClass = entityValue(learningContext.currentClass);
    const syllabusId = learningContext.authoritativeSyllabus;
    if (
      !board ||
      !currentClass ||
      syllabusId.status !== "resolved" ||
      !syllabusId.id ||
      !learningContext.board.code
    ) {
      return null;
    }
    return {
      board: {
        id: board.id,
        name: board.name,
        code: learningContext.board.code ?? board.name,
      },
      class: currentClass,
      syllabusId: syllabusId.id,
      medium: entityValue(learningContext.medium),
      languages: learningContext.languages
        .map(entityValue)
        .filter((item): item is ResolvedEntity => item !== null),
      hierarchy: {
        subject: learningContext.subject,
        chapter: learningContext.chapter,
        topic: learningContext.topic,
        reports: {
          subject: learningContext.components.subject,
          chapter: learningContext.components.chapter,
          topic: learningContext.components.topic,
        },
      },
    };
  }

  private async resolveExactBoard(
    input: BoardResponseInput,
    board: ActiveBoardIdentity,
    activeBoards: ActiveBoardIdentity[],
    normal: ResolvedBoardContext | null
  ): Promise<{ context: ResolvedBoardContext | null; reason: BoardResolutionReason }> {
    if (normal && sameBoard(normal.board, board)) {
      return { context: normal, reason: null };
    }
    const alternate = await this.alternateContext(input, board, activeBoards);
    return {
      context: alternate.context,
      reason: alternate.reason,
    };
  }

  private async alternateContext(
    input: BoardResponseInput,
    board: ActiveBoardIdentity,
    activeBoards: ActiveBoardIdentity[]
  ): Promise<{ context: ResolvedBoardContext | null; reason: BoardResolutionReason }> {
    const exact = findExactActiveBoard(board.name, activeBoards);
    if (!exact || !sameBoard(exact, board)) {
      return { context: null, reason: "BOARD_NOT_FOUND" };
    }
    const rows = (
      await this.repository.getAuthoritativeBoardContexts(
        input.organizationId,
        input.studentId,
        board.id
      )
    ).rows;
    if (rows.length === 0) {
      return { context: null, reason: "NO_AUTHORITATIVE_BOARD_CONTEXT" };
    }
    if (rows.length > 1) {
      return { context: null, reason: "MULTIPLE_AUTHORITATIVE_BOARD_CONTEXTS" };
    }
    return {
      context: await this.contextFromAuthoritativeRow(input, rows[0]),
      reason: null,
    };
  }

  private async contextFromAuthoritativeRow(
    input: BoardResponseInput,
    row: AuthoritativeBoardContextRow
  ): Promise<ResolvedBoardContext> {
    let languageRows: Array<{ id: string; name: string; code: string }> = [];
    try {
      languageRows = (await this.repository.getSyllabusLanguages(row.syllabus_id)).rows;
    } catch {
      // Language is supplementary. Its absence cannot promote or replace the
      // already authoritative board/syllabus context.
      languageRows = [];
    }
    const hierarchy = await this.learningContext.resolveCurriculumScope({
      organizationId: input.organizationId,
      classId: row.class_id,
      syllabusId: row.syllabus_id,
      scope: {
        subject: input.conversationScope.subject,
        chapter: input.conversationScope.chapter,
        topic: input.conversationScope.topic,
      },
    });
    return {
      board: {
        id: row.board_id,
        name: row.board_name,
        code: row.board_code,
      },
      class: { id: row.class_id, name: row.class_name, code: null },
      syllabusId: row.syllabus_id,
      medium: {
        id: row.medium_id,
        name: row.medium_name,
        code: row.medium_code,
      },
      languages: languageRows.map((language) => ({
        id: String(language.id),
        name: String(language.name),
        code: String(language.code),
      })),
      hierarchy,
    };
  }

  /**
   * US-122: attempt authoritative resolution for an explicit subject/chapter/topic
   * request in the current question, before curriculum evidence is selected, so
   * the evidence and the rendered scope both follow the resolved hierarchy.
   *
   * Strictly additive and request-scoped: when the question contains no explicit
   * request the context is returned unchanged, and this never contributes to a
   * conversation scope mutation.
   */
  private async applyExplicitSubjectTopic(
    input: BoardResponseInput,
    context: ResolvedBoardContext
  ): Promise<ResolvedBoardContext> {
    let resolution: Awaited<ReturnType<SubjectTopicResolutionService["resolve"]>>;
    try {
      resolution = await this.subjectTopics.resolve({
        organizationId: input.organizationId,
        question: input.question,
        classId: context.class.id,
        syllabusId: context.syllabusId,
        scope: {
          subject: input.conversationScope.subject,
          chapter: input.conversationScope.chapter,
          topic: input.conversationScope.topic,
        },
        currentHierarchy: context.hierarchy,
      });
    } catch {
      // A seam failure must never break an otherwise valid response.
      return context;
    }
    if (resolution.outcome === "NONE") return context;
    return {
      ...context,
      hierarchy: resolution.hierarchy,
      subjectTopicRequestOutcome: resolution.outcome,
    };
  }

  private async inheritedContext(
    input: BoardResponseInput,
    activeBoards: ActiveBoardIdentity[],
    normal: ResolvedBoardContext | null
  ): Promise<ResolvedBoardContext | null> {
    if (!input.conversationScope.board) return normal;
    const board = findExactActiveBoard(input.conversationScope.board, activeBoards);
    if (!board) return normal;
    if (normal && sameBoard(normal.board, board)) return normal;
    const alternate = await this.alternateContext(input, board, activeBoards);
    return alternate.context ?? normal;
  }

  private async loadEvidence(
    input: BoardResponseInput,
    context: ResolvedBoardContext
  ): Promise<EvidenceSelection> {
    let bundle: Awaited<ReturnType<BoardResponseDependencies["repository"]["getEvidence"]>>;
    try {
      bundle = await this.repository.getEvidence({
        organizationId: input.organizationId,
        studentId: input.studentId,
        classId: context.class.id,
        syllabusId: context.syllabusId,
        subjectId: context.hierarchy.subject.status === "resolved" ? context.hierarchy.subject.id : null,
        chapterId: context.hierarchy.chapter.status === "resolved" ? context.hierarchy.chapter.id : null,
        topicId: context.hierarchy.topic.status === "resolved" ? context.hierarchy.topic.id : null,
      });
    } catch {
      // Evidence is an optional grounding source. A read failure degrades to a
      // clearly general response and can never authorize a curriculum claim.
      return { status: "NONE", evidence: [], sourceLabels: [] };
    }

    if (bundle.primarySourceCount > 1) {
      return { status: "CONFLICT", evidence: [], sourceLabels: [] };
    }

    const evidence = bundle.sources
      .map((source) =>
        safeEvidence(source.authority, source.sourceKind, source.sourceLabel, source.content)
      )
      .filter((source): source is BoardEvidenceProjection => source !== null)
      .sort((left, right) => {
        if (left.authority === right.authority) return 0;
        return left.authority === "AUTHORITATIVE_CURRICULUM" ? -1 : 1;
      });
    const sourceContents = new Map<string, Set<string>>();
    for (const source of evidence) {
      const key = `${source.authority}|${normalizeBoardRequestText(source.sourceLabel)}`;
      const contents = sourceContents.get(key) ?? new Set<string>();
      contents.add(normalizeBoardRequestText(source.content));
      sourceContents.set(key, contents);
    }
    if ([...sourceContents.values()].some((contents) => contents.size > 1)) {
      return { status: "CONFLICT", evidence: [], sourceLabels: [] };
    }
    const sourceLabels = [...new Set(evidence.map((source) => source.sourceLabel))];
    return {
      status: evidence.length > 0 ? "AVAILABLE" : "NONE",
      evidence,
      sourceLabels,
    };
  }

  private singleBoardContext(values: {
    parsed: BoardRequestParseResult;
    resolved: ResolvedBoardContext;
    evidence: EvidenceSelection;
    resolutionReason: BoardResolutionReason;
  }): BoardResponseContext {
    const { parsed, resolved, evidence } = values;
    const responseMode = responseModeForEvidence(evidence.status);
    return {
      intent: parsed.intent,
      duration: durationForIntent(parsed.intent),
      responseMode,
      resolutionReason: values.resolutionReason,
      effectiveBoard: safeModelLabel(resolved.board.name),
      effectiveClass: safeModelLabel(resolved.class.name),
      medium: safeModelLabel(resolved.medium?.name),
      languages: resolved.languages
        .map((language) => safeModelLabel(language.name))
        .filter((language): language is string => language !== null),
      subject: safeModelLabel(contextValue(resolved.hierarchy.subject)),
      chapter: safeModelLabel(contextValue(resolved.hierarchy.chapter)),
      topic: safeModelLabel(contextValue(resolved.hierarchy.topic)),
      requestedBoard: safeModelLabel(parsed.board?.name),
      evidenceStatus: evidence.status,
      evidence: evidence.evidence,
      sourceLabels: evidence.sourceLabels,
      comparisonBoards: [],
      generalKnowledgePolicy: responseMode === "CURRICULUM_GROUNDED" ? "ENRICHMENT_ONLY" : "GENERAL_ONLY",
      // Provisional; resolve() replaces these with the US-120 resolution.
      responseLanguage: null,
      responseLanguageSource: null,
      responseLanguageAvailability: "UNRESOLVED",
      // US-122: present only when the question contained an explicit
      // subject/chapter/topic request.
      ...(resolved.subjectTopicRequestOutcome
        ? { subjectTopicRequestOutcome: resolved.subjectTopicRequestOutcome }
        : {}),
    };
  }

  private async crossBoardContext(
    input: BoardResponseInput,
    parsed: BoardRequestParseResult,
    activeBoards: ActiveBoardIdentity[],
    normal: ResolvedBoardContext | null
  ): Promise<InternalBoardResolution> {
    const comparisonBoards: BoardComparisonProjection[] = [];
    for (const board of parsed.comparisonBoards) {
      const resolved = await this.resolveExactBoard(input, board, activeBoards, normal);
      if (!resolved.context) {
        comparisonBoards.push({
          board: safeModelLabel(board.name) ?? "Unresolved board",
          status: "UNRESOLVED",
          evidenceStatus: "NONE",
          evidence: [],
        });
        continue;
      }
      const evidence = await this.loadEvidence(input, resolved.context);
      comparisonBoards.push({
        board: safeModelLabel(resolved.context.board.name) ?? "Resolved board",
        status: "RESOLVED",
        class: safeModelLabel(resolved.context.class.name) ?? undefined,
        subject: safeModelLabel(contextValue(resolved.context.hierarchy.subject)) ?? undefined,
        chapter: safeModelLabel(contextValue(resolved.context.hierarchy.chapter)) ?? undefined,
        topic: safeModelLabel(contextValue(resolved.context.hierarchy.topic)) ?? undefined,
        evidenceStatus: evidence.status,
        evidence: evidence.evidence,
      });
    }

    const evidenceStatus: BoardEvidenceStatus = comparisonBoards.some(
      (item) => item.evidenceStatus === "CONFLICT"
    )
      ? "CONFLICT"
      : comparisonBoards.some((item) => item.evidenceStatus === "AVAILABLE")
        ? "AVAILABLE"
        : "NONE";
    const sourceLabels = [
      ...new Set(comparisonBoards.flatMap((item) => item.evidence.map((source) => source.sourceLabel))),
    ];
    return {
      context: {
        intent: parsed.intent,
        duration: "CURRENT_RESPONSE",
        responseMode: evidenceStatus === "CONFLICT" ? "SOURCE_CONFLICT" : "CROSS_BOARD_COMPARISON",
        resolutionReason: evidenceStatus === "CONFLICT" ? "AUTHORITATIVE_SOURCE_CONFLICT" : null,
        effectiveBoard: null,
        effectiveClass: null,
        medium: null,
        languages: [],
        subject: null,
        chapter: null,
        topic: null,
        requestedBoard: comparisonBoards.map((item) => item.board).join(" and ") || null,
        evidenceStatus,
        evidence: [],
        sourceLabels,
        comparisonBoards,
        generalKnowledgePolicy:
          evidenceStatus === "AVAILABLE" ? "ENRICHMENT_ONLY" : "GENERAL_ONLY",
        // Provisional; resolve() replaces these with the US-120 resolution.
        responseLanguage: null,
        responseLanguageSource: null,
        responseLanguageAvailability: "UNRESOLVED",
      },
      scopeMutation: null,
      authoritativeLanguages: [],
    };
  }

  private clarificationContext(parsed: BoardRequestParseResult): BoardResponseContext {
    const reasonByCode: Record<string, BoardResolutionReason> = {
      MISSING_BOARD_TARGET: "MISSING_BOARD_TARGET",
      UNRESOLVED_BOARD_TARGET: "BOARD_NOT_FOUND",
      MULTIPLE_BOARD_TARGETS: "MULTIPLE_BOARD_TARGETS",
      NO_EFFECTIVE_BOARD: "NO_EFFECTIVE_BOARD",
      NO_AUTHORITATIVE_BOARD_CONTEXT: "NO_AUTHORITATIVE_BOARD_CONTEXT",
      MULTIPLE_AUTHORITATIVE_BOARD_CONTEXTS: "MULTIPLE_AUTHORITATIVE_BOARD_CONTEXTS",
    };
    return {
      ...this.emptyContext(
        parsed,
        reasonByCode[parsed.reason ?? ""] ?? "NO_EFFECTIVE_BOARD",
        "TARGETED_CLARIFICATION"
      ),
      requestedBoard: parsed.unresolvedTarget ? safeScalar(parsed.unresolvedTarget, 120) : null,
    };
  }

  private emptyContext(
    parsed: BoardRequestParseResult,
    resolutionReason: BoardResolutionReason,
    responseMode: BoardResponseMode
  ): BoardResponseContext {
    return {
      intent: parsed.intent,
      duration: durationForIntent(parsed.intent),
      responseMode,
      resolutionReason,
      effectiveBoard: null,
      effectiveClass: null,
      medium: null,
      languages: [],
      subject: null,
      chapter: null,
      topic: null,
      requestedBoard: safeModelLabel(parsed.board?.name),
      evidenceStatus: "NONE",
      evidence: [],
      sourceLabels: [],
      comparisonBoards: [],
      generalKnowledgePolicy: "GENERAL_ONLY",
      // Provisional; resolve() replaces these with the US-120 resolution.
      responseLanguage: null,
      responseLanguageSource: null,
      responseLanguageAvailability: "UNRESOLVED",
    };
  }
}
