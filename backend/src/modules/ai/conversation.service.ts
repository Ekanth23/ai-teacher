import { createHash } from "node:crypto";
import { createLlmProvider, resolveAiProviderNameOrUnknown } from "./providers/provider.factory.js";
import type { LlmProvider } from "./providers/llm.provider.js";
import { PostgresUsageTracker } from "./usage/postgres.usage.tracker.js";
import type { UsageTracker } from "./usage/usage.tracker.js";
import { ConversationRepository } from "./conversation.repository.js";
import type { ConversationQueryable } from "./conversation.repository.js";
import { GenerationFailedError, GenerationService } from "./generation.service.js";
import type {
  BranchRecord,
  ConversationHistoryResult,
  ConversationRecord,
  CreateConversationInput,
  EditMessageInput,
  FeedbackInput,
  FeedbackRecord,
  GenerationAttemptRecord,
  GenerationResult,
  IdempotencyOperation,
  IdempotencyRecord,
  MessageRecord,
  RegenerateInput,
  RetryInput,
  SendMessageInput,
} from "./conversation.types.js";
import type { ConversationScope } from "./conversation.types.js";
import { LearningContextAssemblyError, LearningContextService } from "./learning-context.service.js";
import {
  BoardResponseResolutionError,
  BoardResponseService,
} from "./board-response.service.js";
import type { BoardScopeMutation } from "./board-response.types.js";

const DEFAULT_TITLE = "New Conversation";
const HISTORY_LIMIT = 20;

export interface ConversationOwner {
  organizationId: string;
  studentId: string;
  userId: string;
  studentGrade?: string | null;
}

export interface ConversationOperationResult extends GenerationResult {
  failed: boolean;
}

export interface EmptyConversationResult {
  conversation: ConversationRecord;
  requestMessage: null;
  responseMessage: null;
  attempt: null;
  failed: false;
}

export type CreateConversationResult = EmptyConversationResult | ConversationOperationResult;

interface PreparedGeneration {
  conversation: ConversationRecord;
  request: MessageRecord | null;
  attempt: GenerationAttemptRecord | null;
  existing: boolean;
}

export class ConversationNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;

  constructor(message = "Conversation not found") {
    super(message);
    this.name = "ConversationNotFoundError";
  }
}

export class MessageNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;

  constructor(message = "Message not found") {
    super(message);
    this.name = "MessageNotFoundError";
  }
}

export class ResponseNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;

  constructor(message = "Response not found") {
    super(message);
    this.name = "ResponseNotFoundError";
  }
}

export class ConversationConflictError extends Error {
  readonly code = "CONFLICT" as const;
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ConversationConflictError";
  }
}

export class DuplicateFeedbackError extends Error {
  readonly code = "DUPLICATE_FEEDBACK" as const;
  readonly status = 409;

  constructor() {
    super("Feedback has already been submitted for this response.");
    this.name = "DuplicateFeedbackError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
  readonly status = 409;

  constructor() {
    super("The idempotency key was already used for a different request.");
    this.name = "IdempotencyConflictError";
  }
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function idempotencyOperationForCreate(): IdempotencyOperation {
  return "CREATE_CONVERSATION";
}

function idempotencyOperationForMessage(): IdempotencyOperation {
  return "SEND_MESSAGE";
}

function titleFromQuestion(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (!normalized) return DEFAULT_TITLE;
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77).trimEnd()}...`;
}

function scopeFromConversation(conversation: ConversationRecord): ConversationScope {
  return {
    board: conversation.scope_board,
    class: conversation.scope_class,
    subject: conversation.subject,
    chapter: conversation.scope_chapter,
    topic: conversation.topic,
    language: conversation.scope_language,
    medium: conversation.scope_medium,
  };
}

function numericSequence(message: MessageRecord): number {
  const value = message.sequence_number;
  return value === null || value === undefined ? Number.MAX_SAFE_INTEGER : Number(value);
}

function sortMessages(messages: MessageRecord[]): MessageRecord[] {
  return [...messages].sort((left, right) => {
    const sequence = numericSequence(left) - numericSequence(right);
    if (sequence !== 0) return sequence;
    const role = (left.role === "user" ? 0 : 1) - (right.role === "user" ? 0 : 1);
    if (role !== 0) return role;
    const variant = left.variant_number - right.variant_number;
    if (variant !== 0) return variant;
    const created = String(left.created_at).localeCompare(String(right.created_at));
    return created !== 0 ? created : left.id.localeCompare(right.id);
  });
}

function isOwnedGenerationError(error: unknown): error is GenerationFailedError {
  return error instanceof GenerationFailedError;
}

export class ConversationService {
  private readonly generation: GenerationService;

  constructor(
    private readonly repository: ConversationRepository = new ConversationRepository(),
    providerFactory: () => LlmProvider = () => createLlmProvider(),
    usageTracker: UsageTracker = new PostgresUsageTracker(),
    private readonly learningContext: Pick<LearningContextService, "assemble"> = new LearningContextService(),
    private readonly boardResponses: Pick<BoardResponseService, "resolve"> = new BoardResponseService()
  ) {
    this.generation = new GenerationService(repository, providerFactory, usageTracker);
  }

  async createConversation(
    owner: ConversationOwner,
    input: CreateConversationInput,
    idempotencyKey?: string
  ): Promise<CreateConversationResult> {
    const question = input.question?.trim() ?? "";
    const title = question ? titleFromQuestion(question) : DEFAULT_TITLE;
    const scope = input.scope ?? {};
    const hash = requestHash({
      operation: idempotencyOperationForCreate(),
      question,
      title,
      subject: input.subject ?? scope.subject ?? null,
      topic: input.topic ?? scope.topic ?? null,
      scope: {
        board: scope.board ?? null,
        class: scope.class ?? null,
        subject: input.subject ?? scope.subject ?? null,
        chapter: scope.chapter ?? null,
        topic: input.topic ?? scope.topic ?? null,
        language: scope.language ?? null,
        medium: scope.medium ?? null,
      },
    });

    const prepared = await this.repository.transaction(async (client) => {
      let idempotency: IdempotencyRecord | null = null;
      if (idempotencyKey) {
        idempotency = await this.repository.getIdempotencyRecord(
          client,
          owner.organizationId,
          owner.studentId,
          owner.userId,
          idempotencyOperationForCreate(),
          idempotencyKey,
          true
        );
        if (idempotency) {
          return this.recoverPreparedInTransaction(client, owner, idempotency, hash);
        }
        idempotency = await this.repository.insertIdempotencyRecord(client, {
          organizationId: owner.organizationId,
          studentId: owner.studentId,
          userId: owner.userId,
          operation: idempotencyOperationForCreate(),
          idempotencyKey,
          requestHash: hash,
        });
        if (!idempotency) {
          idempotency = await this.repository.getIdempotencyRecord(
            client,
            owner.organizationId,
            owner.studentId,
            owner.userId,
            idempotencyOperationForCreate(),
            idempotencyKey,
            true
          );
          if (idempotency) {
            return this.recoverPreparedInTransaction(client, owner, idempotency, hash);
          }
          throw new IdempotencyConflictError();
        }
      }

      const conversation = await this.repository.insertConversation(client, {
        organizationId: owner.organizationId,
        studentId: owner.studentId,
        title,
        titleSource: question ? "GENERATED" : "DEFAULT",
        subject: input.subject ?? scope.subject ?? null,
        topic: input.topic ?? scope.topic ?? null,
        scopeBoard: scope.board ?? null,
        scopeClass: scope.class ?? null,
        scopeChapter: scope.chapter ?? null,
        scopeLanguage: scope.language ?? null,
        scopeMedium: scope.medium ?? null,
      });
      const branch = await this.repository.insertPrimaryBranch(client, conversation.id);
      await this.repository.setActiveBranch(
        client,
        owner.organizationId,
        owner.studentId,
        conversation.id,
        branch.id
      );
      const conversationWithBranch = { ...conversation, active_branch_id: branch.id };

      if (!question) {
        if (idempotency) {
          await this.repository.linkIdempotencyRecord(client, idempotency.id, conversation.id, null, null);
        }
        return {
          conversation: conversationWithBranch,
          request: null,
          attempt: null,
          existing: false,
        } satisfies PreparedGeneration;
      }

      const requestMessage = await this.repository.insertMessage(client, {
        conversationId: conversation.id,
        role: "user",
        content: question,
        status: "PROCESSING",
        branchId: branch.id,
        sequenceNumber: 1,
      });
      const attempt = await this.repository.insertAttempt(client, {
        conversationId: conversation.id,
        organizationId: owner.organizationId,
        studentId: owner.studentId,
        userId: owner.userId,
        branchId: branch.id,
        requestMessageId: requestMessage.id,
        attemptType: "ORIGINAL",
        attemptNumber: 1,
        provider: resolveAiProviderNameOrUnknown(),
        model: "unknown",
      });
      if (idempotency) {
        await this.repository.linkIdempotencyRecord(
          client,
          idempotency.id,
          conversation.id,
          requestMessage.id,
          attempt.id
        );
      }
      await this.repository.updateConversationTimestamp(client, conversation.id);
      return {
        conversation: conversationWithBranch,
        request: requestMessage,
        attempt,
        existing: false,
      } satisfies PreparedGeneration;
    });

    if (prepared.existing) {
      return this.recoverPreparedResult(owner, prepared);
    }
    if (!prepared.request || !prepared.attempt) {
      return {
        conversation: prepared.conversation,
        requestMessage: null,
        responseMessage: null,
        attempt: null,
        failed: false,
      };
    }

    return this.runGeneration(
      owner,
      prepared.conversation,
      prepared.request,
      prepared.attempt,
      prepared.attempt.branch_id
    );
  }

  async listConversations(owner: ConversationOwner, limit = 20): Promise<Array<ConversationRecord & { latest_message_preview: string | null }>> {
    return this.repository.listConversations(this.repository.db, owner.organizationId, owner.studentId, limit);
  }

  async getConversation(
    owner: ConversationOwner,
    conversationId: string,
    branchId?: string
  ): Promise<ConversationHistoryResult> {
    let conversation = await this.requireConversation(owner, conversationId);
    const persistedActiveBranchId = conversation.active_branch_id;
    const activeBranchId = branchId ?? persistedActiveBranchId ?? (await this.ensurePrimaryBranch(conversation));
    if (!branchId && !persistedActiveBranchId) {
      conversation = { ...conversation, active_branch_id: activeBranchId };
    }
    const branch = await this.requireBranch(conversation, activeBranchId);
    // A branch query is a read-only preview. Only the explicit activation
    // operation changes the authoritative active_branch_id; callers writing
    // after a preview must send selected_branch_id explicitly.
    conversation = { ...conversation, selected_branch_id: branch.id };
    const chain = await this.repository.getActiveBranchChain(
      this.repository.db,
      conversation.id,
      branch.id
    );
    const allBranchIds = chain.map((item) => item.id);
    const allMessages = await this.repository.getMessages(
      this.repository.db,
      conversation.id,
      allBranchIds.length > 0 ? allBranchIds : undefined
    );

    const branchCutoffs = new Map<string, number>();
    for (let index = 1; index < chain.length; index += 1) {
      const child = chain[index];
      const point = child.branch_point_message_id
        ? allMessages.find((message) => message.id === child.branch_point_message_id)
        : undefined;
      if (point) {
        const parent = chain[index - 1];
        branchCutoffs.set(parent.id, numericSequence(point));
      }
    }

    const messages = sortMessages(
      allMessages.filter((message) => {
        if (message.branch_id === branch.id || !message.branch_id) return true;
        const cutoff = branchCutoffs.get(message.branch_id);
        return cutoff !== undefined && numericSequence(message) < cutoff;
      })
    );
    const branches = await this.repository.getBranches(
      this.repository.db,
      conversation.id,
      conversation.active_branch_id ?? branch.id
    );
    const attempts = await this.repository.getAttemptsForConversation(
      this.repository.db,
      conversation.id
    );
    const feedback = await this.repository.listFeedbackForConversation(
      this.repository.db,
      conversation.id
    );
    const feedbackByResponse = new Map(feedback.map((item) => [item.response_message_id, item]));
    const hydratedMessages = messages.map((message) => ({
      ...message,
      feedback: message.role === "assistant" ? feedbackByResponse.get(message.id) ?? null : null,
      regeneration_available:
        message.role === "assistant" &&
        message.request_message_id !== null,
    }));
    const visibleBranchIds = new Set(chain.map((item) => item.id));
    const activeAttempt =
      attempts
        .filter(
          (attempt) =>
            attempt.status === "PROCESSING" && visibleBranchIds.has(attempt.branch_id)
        )
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0] ?? null;
    return {
      conversation,
      messages: hydratedMessages,
      branches,
      attempts,
      active_attempt: activeAttempt,
      processing_attempt: activeAttempt,
      feedback,
    };
  }

  async updateConversationScope(
    owner: ConversationOwner,
    conversationId: string,
    scope: Partial<ConversationScope>
  ): Promise<ConversationRecord> {
    const result = await this.repository.transaction(async (client) => {
      const conversation = await this.repository.lockConversation(
        client,
        owner.organizationId,
        owner.studentId,
        conversationId
      );
      if (!conversation) throw new ConversationNotFoundError();
      return this.repository.updateConversationScope(
        client,
        owner.organizationId,
        owner.studentId,
        conversationId,
        scope
      );
    });
    if (!result) throw new ConversationNotFoundError();
    return result;
  }

  async renameConversation(owner: ConversationOwner, conversationId: string, title: string): Promise<ConversationRecord> {
    const result = await this.repository.renameConversation(
      this.repository.db,
      owner.organizationId,
      owner.studentId,
      conversationId,
      title
    );
    if (!result) throw new ConversationNotFoundError();
    return result;
  }

  async deleteConversation(owner: ConversationOwner, conversationId: string): Promise<void> {
    const result = await this.repository.softDeleteConversation(
      this.repository.db,
      owner.organizationId,
      owner.studentId,
      conversationId
    );
    if (!result) throw new ConversationNotFoundError();
  }

  async activateBranch(owner: ConversationOwner, conversationId: string, branchId: string): Promise<ConversationHistoryResult> {
    const conversation = await this.requireConversation(owner, conversationId);
    await this.requireBranch(conversation, branchId);
    const changed = await this.repository.setActiveBranch(
      this.repository.db,
      owner.organizationId,
      owner.studentId,
      conversationId,
      branchId
    );
    if (!changed) throw new ConversationNotFoundError();
    return this.getConversation(owner, conversationId, branchId);
  }

  async sendMessage(
    owner: ConversationOwner,
    conversationId: string,
    input: SendMessageInput,
    editMessageId?: string,
    idempotencyKey?: string
  ): Promise<ConversationOperationResult> {
    const hash = requestHash({
      operation: idempotencyOperationForMessage(),
      conversationId,
      question: input.question,
      branchId: input.branchId ?? null,
      editMessageId: editMessageId ?? null,
    });
    const prepared = await this.repository.transaction(async (client) => {
      let idempotency: IdempotencyRecord | null = null;
      if (idempotencyKey) {
        idempotency = await this.repository.getIdempotencyRecord(
          client,
          owner.organizationId,
          owner.studentId,
          owner.userId,
          idempotencyOperationForMessage(),
          idempotencyKey,
          true
        );
        if (idempotency) {
          return this.recoverPreparedInTransaction(client, owner, idempotency, hash);
        }
        idempotency = await this.repository.insertIdempotencyRecord(client, {
          organizationId: owner.organizationId,
          studentId: owner.studentId,
          userId: owner.userId,
          operation: idempotencyOperationForMessage(),
          idempotencyKey,
          requestHash: hash,
        });
        if (!idempotency) {
          idempotency = await this.repository.getIdempotencyRecord(
            client,
            owner.organizationId,
            owner.studentId,
            owner.userId,
            idempotencyOperationForMessage(),
            idempotencyKey,
            true
          );
          if (idempotency) {
            return this.recoverPreparedInTransaction(client, owner, idempotency, hash);
          }
          throw new IdempotencyConflictError();
        }
      }

      let conversation = await this.repository.lockConversation(
        client,
        owner.organizationId,
        owner.studentId,
        conversationId
      );
      if (!conversation) throw new ConversationNotFoundError();
      const processingAttempt = await client.query(
        `SELECT id FROM ai_generation_attempts
          WHERE conversation_id = $1 AND status = 'PROCESSING'
          LIMIT 1`,
        [conversationId]
      );
      if (processingAttempt.rows.length > 0) {
        throw new ConversationConflictError("A generation attempt is already in progress.");
      }

      let branch: BranchRecord;
      let sequenceNumber: number;
      let parentMessageId: string | null = null;
      let originalMessageId: string | null = null;

      if (editMessageId) {
        const original = await this.repository.getMessage(
          client,
          owner.organizationId,
          owner.studentId,
          editMessageId,
          "user"
        );
        if (!original || original.conversation_id !== conversationId) {
          throw new MessageNotFoundError();
        }
        branch = await this.repository.insertBranch(client, {
          conversationId,
          parentBranchId: original.branch_id ?? conversation.active_branch_id ?? (await this.repository.insertPrimaryBranch(client, conversationId)).id,
          branchPointMessageId: original.id,
        });
        await this.repository.setActiveBranch(client, owner.organizationId, owner.studentId, conversationId, branch.id);
        sequenceNumber = Number(original.sequence_number ?? 1);
        parentMessageId = original.id;
        originalMessageId = original.original_message_id ?? original.id;
      } else {
        const requestedBranchId = input.branchId ?? conversation.active_branch_id;
        branch = requestedBranchId
          ? await this.requireBranch(conversation, requestedBranchId, client)
          : await this.repository.insertPrimaryBranch(client, conversation.id);
        if (!branch.conversation_id) throw new ConversationNotFoundError();
        if (input.branchId && input.branchId !== conversation.active_branch_id) {
          await this.repository.setActiveBranch(client, owner.organizationId, owner.studentId, conversationId, branch.id);
        }
        sequenceNumber = await this.repository.getNextSequence(client, conversationId, [branch.id]);
      }
      conversation = { ...conversation, active_branch_id: branch.id };

      const isFirstStudentMessage = !(await this.repository.hasStudentMessages(client, conversationId));
      const requestMessage = await this.repository.insertMessage(client, {
        conversationId,
        role: "user",
        content: input.question,
        status: "PROCESSING",
        branchId: branch.id,
        sequenceNumber,
        parentMessageId,
        originalMessageId,
      });
      if (isFirstStudentMessage && conversation.title_source === "DEFAULT") {
        const generatedTitle = titleFromQuestion(input.question);
        await this.repository.updateGeneratedTitle(client, conversationId, generatedTitle);
        conversation = { ...conversation, title: generatedTitle, title_source: "GENERATED" };
      }
      const attempt = await this.repository.insertAttempt(client, {
        conversationId,
        organizationId: owner.organizationId,
        studentId: owner.studentId,
        userId: owner.userId,
        branchId: branch.id,
        requestMessageId: requestMessage.id,
        attemptType: "ORIGINAL",
        attemptNumber: await this.repository.getNextAttemptNumber(client, requestMessage.id),
        provider: resolveAiProviderNameOrUnknown(),
        model: "unknown",
      });
      if (idempotency) {
        await this.repository.linkIdempotencyRecord(
          client,
          idempotency.id,
          conversationId,
          requestMessage.id,
          attempt.id
        );
      }
      await this.repository.updateConversationTimestamp(client, conversationId);
      return { conversation, request: requestMessage, attempt, existing: false } satisfies PreparedGeneration;
    });

    if (prepared.existing) {
      return this.recoverMessageResult(owner, prepared);
    }
    if (!prepared.request || !prepared.attempt) {
      throw new ConversationNotFoundError();
    }
    return this.runGeneration(
      owner,
      prepared.conversation,
      prepared.request,
      prepared.attempt,
      prepared.attempt.branch_id
    );
  }

  async retry(
    owner: ConversationOwner,
    conversationId: string,
    input: RetryInput
  ): Promise<ConversationOperationResult> {
    const prepared = await this.repository.transaction(async (client) => {
      const conversation = await this.repository.lockConversation(
        client,
        owner.organizationId,
        owner.studentId,
        conversationId
      );
      if (!conversation) throw new ConversationNotFoundError();

      let attempt = input.attemptId
        ? await this.repository.getAttempt(client, owner.organizationId, owner.studentId, input.attemptId)
        : null;
      if (input.attemptId && !attempt) {
        throw new ConversationNotFoundError();
      }
      if (!attempt && input.messageId) {
        const message = await this.repository.getMessage(client, owner.organizationId, owner.studentId, input.messageId, "user");
        if (!message) throw new MessageNotFoundError();
        attempt = await this.repository.getLatestAttemptForMessage(client, message.id);
      }
      if (!attempt || attempt.conversation_id !== conversation.id) throw new ConversationNotFoundError();

      const locked = await client.query(
        `SELECT id, status FROM ai_generation_attempts
          WHERE id = $1 AND conversation_id = $2
          FOR UPDATE`,
        [attempt.id, conversationId]
      );
      if (locked.rows.length === 0 || locked.rows[0].status !== "FAILED") {
        throw new ConversationConflictError("Only a failed generation attempt can be retried.");
      }
      const inFlight = await client.query(
        `SELECT id FROM ai_generation_attempts
          WHERE request_message_id = $1 AND status = 'PROCESSING'
          LIMIT 1`,
        [attempt.request_message_id]
      );
      if (inFlight.rows.length > 0) {
        throw new ConversationConflictError("A generation attempt is already in progress.");
      }
      const requestMessage = await this.repository.getMessageForConversation(client, conversationId, attempt.request_message_id);
      if (!requestMessage) throw new MessageNotFoundError();
      const next = await this.repository.insertAttempt(client, {
        conversationId,
        organizationId: owner.organizationId,
        studentId: owner.studentId,
        userId: owner.userId,
        branchId: attempt.branch_id,
        requestMessageId: attempt.request_message_id,
        attemptType: "RETRY",
        attemptNumber: await this.repository.getNextAttemptNumber(client, attempt.request_message_id),
        retryOfAttemptId: attempt.id,
        provider: resolveAiProviderNameOrUnknown(),
        model: "unknown",
      });
      await this.repository.updateConversationTimestamp(client, conversationId);
      return { conversation, requestMessage, attempt: next };
    });

    return this.runGeneration(
      owner,
      prepared.conversation,
      prepared.requestMessage,
      prepared.attempt,
      prepared.attempt.branch_id
    );
  }

  async regenerate(
    owner: ConversationOwner,
    conversationId: string,
    input: RegenerateInput
  ): Promise<ConversationOperationResult> {
    const prepared = await this.repository.transaction(async (client) => {
      const conversation = await this.repository.lockConversation(
        client,
        owner.organizationId,
        owner.studentId,
        conversationId
      );
      if (!conversation) throw new ConversationNotFoundError();

      let targetAttempt: GenerationAttemptRecord | null = null;
      let requestMessage: MessageRecord | null = null;
      if (input.attemptId) {
        targetAttempt = await this.repository.getAttempt(
          client,
          owner.organizationId,
          owner.studentId,
          input.attemptId
        );
        if (!targetAttempt || targetAttempt.conversation_id !== conversation.id) {
          throw new ResponseNotFoundError();
        }
        requestMessage = await this.repository.getMessageForConversation(
          client,
          conversationId,
          targetAttempt.request_message_id
        );
      }
      if (!targetAttempt && input.responseMessageId) {
        const response = await this.repository.getMessage(
          client,
          owner.organizationId,
          owner.studentId,
          input.responseMessageId,
          "assistant"
        );
        if (!response || response.conversation_id !== conversationId) {
          throw new ResponseNotFoundError();
        }
        // Decision #109: a persisted request relationship is the only legacy
        // eligibility signal. No timestamp/adjacency/text heuristic is used.
        if (!response.request_message_id) {
          throw new ConversationConflictError("This legacy response cannot be regenerated.");
        }
        requestMessage = await this.repository.getMessageForConversation(
          client,
          conversationId,
          response.request_message_id
        );
        if (!requestMessage || requestMessage.role !== "user") {
          throw new ResponseNotFoundError();
        }
        targetAttempt = response.generation_attempt_id
          ? await this.repository.getAttempt(
              client,
              owner.organizationId,
              owner.studentId,
              response.generation_attempt_id
            )
          : await this.repository.getLatestAttemptForRequest(client, requestMessage.id);
      }
      if (targetAttempt && requestMessage && targetAttempt.request_message_id !== requestMessage.id) {
        throw new ResponseNotFoundError();
      }
      if (!targetAttempt && input.messageId) {
        requestMessage = await this.repository.getMessage(
          client,
          owner.organizationId,
          owner.studentId,
          input.messageId,
          "user"
        );
        if (!requestMessage || requestMessage.conversation_id !== conversationId) {
          throw new MessageNotFoundError();
        }
        targetAttempt = await this.repository.getLatestAttemptForRequest(client, requestMessage.id);
      }
      if (!requestMessage && targetAttempt) {
        requestMessage = await this.repository.getMessageForConversation(
          client,
          conversationId,
          targetAttempt.request_message_id
        );
      }
      if (!requestMessage) throw new ResponseNotFoundError();
      if (targetAttempt && targetAttempt.request_message_id !== requestMessage.id) {
        throw new ResponseNotFoundError();
      }
      if (targetAttempt && targetAttempt.status === "PROCESSING") {
        throw new ConversationConflictError("This response is still being generated.");
      }
      const inFlight = await client.query(
        `SELECT id FROM ai_generation_attempts
          WHERE request_message_id = $1 AND status = 'PROCESSING'
          LIMIT 1`,
        [requestMessage.id]
      );
      if (inFlight.rows.length > 0) {
        throw new ConversationConflictError("A generation attempt is already in progress.");
      }
      const branchId =
        targetAttempt?.branch_id ??
        requestMessage.branch_id ??
        conversation.active_branch_id ??
        (await this.repository.insertPrimaryBranch(client, conversation.id)).id;
      const next = await this.repository.insertAttempt(client, {
        conversationId,
        organizationId: owner.organizationId,
        studentId: owner.studentId,
        userId: owner.userId,
        branchId,
        requestMessageId: requestMessage.id,
        attemptType: "REGENERATION",
        attemptNumber: await this.repository.getNextAttemptNumber(client, requestMessage.id),
        parentAttemptId: targetAttempt?.id ?? null,
        provider: resolveAiProviderNameOrUnknown(),
        model: "unknown",
      });
      await this.repository.updateConversationTimestamp(client, conversationId);
      return {
        conversation,
        requestMessage,
        attempt: next,
        historyResponseMessageId:
          input.responseMessageId ?? targetAttempt?.response_message_id ?? undefined,
      };
    });

    return this.runGeneration(
      owner,
      prepared.conversation,
      prepared.requestMessage,
      prepared.attempt,
      prepared.attempt.branch_id,
      prepared.historyResponseMessageId
    );
  }

  async editMessage(
    owner: ConversationOwner,
    conversationId: string,
    input: EditMessageInput,
    idempotencyKey?: string
  ): Promise<ConversationOperationResult> {
    const original = await this.repository.getMessage(
      this.repository.db,
      owner.organizationId,
      owner.studentId,
      input.messageId
    );
    if (!original) throw new MessageNotFoundError();
    if (original.conversation_id !== conversationId) throw new MessageNotFoundError();
    if (original.role !== "user") {
      throw new ConversationConflictError("AI messages cannot be edited.");
    }
    if (original.status === "PROCESSING") {
      throw new ConversationConflictError("A message cannot be edited while it is being generated.");
    }
    return this.sendMessage(owner, conversationId, { question: input.content }, input.messageId, idempotencyKey);
  }

  async submitFeedback(
    owner: ConversationOwner,
    conversationId: string,
    input: FeedbackInput
  ): Promise<FeedbackRecord> {
    const message = await this.repository.getMessage(
      this.repository.db,
      owner.organizationId,
      owner.studentId,
      input.responseMessageId,
      "assistant"
    );
    if (!message || message.conversation_id !== conversationId) throw new ResponseNotFoundError();
    try {
      return await this.repository.insertFeedback(this.repository.db, {
        conversationId,
        responseMessageId: input.responseMessageId,
        organizationId: owner.organizationId,
        studentId: owner.studentId,
        sentiment: input.sentiment,
        reason: input.reason ?? null,
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new DuplicateFeedbackError();
      }
      if (error instanceof Error && error.message === "Response not found") {
        throw new ResponseNotFoundError();
      }
      throw error;
    }
  }

  private async recoverPreparedInTransaction(
    client: ConversationQueryable,
    owner: ConversationOwner,
    record: IdempotencyRecord,
    hash: string
  ): Promise<PreparedGeneration> {
    if (record.request_hash !== hash) {
      throw new IdempotencyConflictError();
    }
    if (!record.conversation_id) {
      throw new IdempotencyConflictError();
    }
    const conversation = await this.repository.getConversation(
      client,
      owner.organizationId,
      owner.studentId,
      record.conversation_id
    );
    if (!conversation) {
      throw new ConversationNotFoundError();
    }
    const request = record.request_message_id
      ? await this.repository.getMessageForConversation(client, conversation.id, record.request_message_id)
      : null;
    const attempt = record.attempt_id
      ? await this.repository.getAttempt(client, owner.organizationId, owner.studentId, record.attempt_id)
      : null;
    if (record.request_message_id && !request) {
      throw new MessageNotFoundError();
    }
    if (record.attempt_id && !attempt) {
      throw new ConversationNotFoundError();
    }
    return { conversation, request, attempt, existing: true };
  }

  private async recoverPreparedResult(
    owner: ConversationOwner,
    prepared: PreparedGeneration
  ): Promise<CreateConversationResult> {
    if (!prepared.request || !prepared.attempt) {
      return {
        conversation: prepared.conversation,
        requestMessage: null,
        responseMessage: null,
        attempt: null,
        failed: false,
      };
    }
    const responseMessage = prepared.attempt.response_message_id
      ? await this.repository.getMessageForConversation(
          this.repository.db,
          prepared.conversation.id,
          prepared.attempt.response_message_id
        )
      : null;
    const attempt =
      (await this.repository.getAttempt(
        this.repository.db,
        owner.organizationId,
        owner.studentId,
        prepared.attempt.id
      )) ?? prepared.attempt;
    return {
      conversation: prepared.conversation,
      requestMessage: prepared.request,
      responseMessage,
      attempt,
      failed: attempt.status === "FAILED",
    };
  }

  private async recoverMessageResult(
    owner: ConversationOwner,
    prepared: PreparedGeneration
  ): Promise<ConversationOperationResult> {
    if (!prepared.request || !prepared.attempt) {
      throw new ConversationNotFoundError();
    }
    const responseMessage = prepared.attempt.response_message_id
      ? await this.repository.getMessageForConversation(
          this.repository.db,
          prepared.conversation.id,
          prepared.attempt.response_message_id
        )
      : null;
    const attempt =
      (await this.repository.getAttempt(
        this.repository.db,
        owner.organizationId,
        owner.studentId,
        prepared.attempt.id
      )) ?? prepared.attempt;
    return {
      conversation: prepared.conversation,
      requestMessage: prepared.request,
      responseMessage,
      attempt,
      failed: attempt.status === "FAILED",
    };
  }

  private async runGeneration(
    owner: ConversationOwner,
    conversation: ConversationRecord,
    requestMessage: MessageRecord,
    attempt: GenerationAttemptRecord,
    branchId?: string,
    historyResponseMessageId?: string
  ): Promise<ConversationOperationResult> {
    let effectiveConversation = conversation;
    try {
      const history = await this.generationHistory(
        owner,
        conversation.id,
        requestMessage,
        branchId,
        historyResponseMessageId
      );
      const branchHistory = history
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        }));
      const conversationScope = {
        subject: conversation.subject,
        chapter: conversation.scope_chapter,
        topic: conversation.topic,
        board: conversation.scope_board,
        class: conversation.scope_class,
        language: conversation.scope_language,
        medium: conversation.scope_medium,
      };
      const studentLearningContext = await this.learningContext.assemble({
        organizationId: owner.organizationId,
        studentId: owner.studentId,
        studentGrade: owner.studentGrade,
        conversationId: conversation.id,
        branchId: attempt.branch_id,
        isActiveBranch: conversation.active_branch_id === attempt.branch_id,
        history: branchHistory,
        scope: conversationScope,
      });
      const boardResolution = await this.boardResponses.resolve({
        organizationId: owner.organizationId,
        studentId: owner.studentId,
        question: requestMessage.content,
        conversationScope,
        learningContext: studentLearningContext,
        allowScopeMutation: attempt.attempt_type === "ORIGINAL",
      });
      if (boardResolution.scopeMutation) {
        effectiveConversation = await this.applyBoardScopeMutation(
          owner,
          conversation.id,
          boardResolution.scopeMutation
        );
      }
      const result = await this.generation.generate({
        ...owner,
        conversation: effectiveConversation,
        requestMessage,
        attempt,
        studentGrade: owner.studentGrade,
        history,
        studentLearningContext,
        boardResponseContext: boardResolution.context,
      });

      // The provider result and attempt are already committed at this point.
      // A deleted conversation is finalized as FAILED without a response.
      if (!result.responseMessage) {
        return {
          ...result,
          requestMessage:
            result.attempt.status === "FAILED"
              ? { ...result.requestMessage, status: "FAILED" }
              : result.requestMessage,
          failed: true,
        };
      }
      // A read used only to enrich the response must not turn that committed
      // success into a reported failure.
      let refreshedRequest: MessageRecord | null = null;
      try {
        refreshedRequest = await this.repository.getMessage(
          this.repository.db,
          owner.organizationId,
          owner.studentId,
          requestMessage.id,
          "user"
        );
      } catch {
        refreshedRequest = null;
      }
      return {
        ...result,
        requestMessage: refreshedRequest ?? result.requestMessage,
        failed: false,
      };
    } catch (error) {
      if (!isOwnedGenerationError(error)) {
        await this.finalizeUnexpectedFailure(
          owner,
          conversation.id,
          requestMessage,
          attempt,
          error instanceof LearningContextAssemblyError || error instanceof BoardResponseResolutionError
            ? "context_assembly"
            : "orchestration_error"
        );
      }
      const failedAttemptId = isOwnedGenerationError(error) ? error.attempt.id : attempt.id;
      let refreshedAttempt: GenerationAttemptRecord | null = null;
      try {
        refreshedAttempt = await this.repository.getAttempt(
          this.repository.db,
          owner.organizationId,
          owner.studentId,
          failedAttemptId
        );
      } catch {
        refreshedAttempt = null;
      }
      let refreshedRequest: MessageRecord | null = null;
      try {
        refreshedRequest = await this.repository.getMessage(
          this.repository.db,
          owner.organizationId,
          owner.studentId,
          requestMessage.id,
          "user"
        );
      } catch {
        refreshedRequest = null;
      }
      return {
        conversation: effectiveConversation,
        requestMessage: refreshedRequest ?? { ...requestMessage, status: "FAILED" },
        responseMessage: null,
        attempt: refreshedAttempt ?? (isOwnedGenerationError(error) ? error.attempt : { ...attempt, status: "FAILED" }),
        failed: true,
      };
    }
  }

  private async applyBoardScopeMutation(
    owner: ConversationOwner,
    conversationId: string,
    mutation: BoardScopeMutation
  ): Promise<ConversationRecord> {
    const updated = await this.repository.transaction(async (client) => {
      const locked = await this.repository.lockConversation(
        client,
        owner.organizationId,
        owner.studentId,
        conversationId
      );
      if (!locked) throw new ConversationNotFoundError();
      return this.repository.updateConversationScope(
        client,
        owner.organizationId,
        owner.studentId,
        conversationId,
        mutation
      );
    });
    if (!updated) throw new ConversationNotFoundError();
    return updated;
  }

  private async finalizeUnexpectedFailure(
    owner: ConversationOwner,
    conversationId: string,
    requestMessage: MessageRecord,
    attempt: GenerationAttemptRecord,
    errorCategory = "orchestration_error"
  ): Promise<void> {
    for (let recoveryAttempt = 0; recoveryAttempt < 3; recoveryAttempt += 1) {
      try {
        await this.repository.transaction(async (client) => {
          const conversationLock = await client.query(
            `SELECT id, deleted_at FROM ai_conversations
              WHERE id = $1 AND organization_id = $2 AND student_id = $3
              FOR UPDATE`,
            [conversationId, owner.organizationId, owner.studentId]
          );
          if (conversationLock.rows.length === 0) return;
          const current = await client.query(
            `SELECT id, status FROM ai_generation_attempts
              WHERE id = $1 AND conversation_id = $2
                AND organization_id = $3 AND student_id = $4
              FOR UPDATE`,
            [attempt.id, conversationId, owner.organizationId, owner.studentId]
          );
          if (current.rows.length === 0 || current.rows[0].status !== "PROCESSING") return;
          await this.repository.updateAttemptFailed(
            client,
            attempt.id,
            resolveAiProviderNameOrUnknown(),
            "unknown",
            errorCategory,
            null
          );
          if (attempt.attempt_type === "ORIGINAL") {
            await this.repository.updateMessageStatus(client, requestMessage.id, "FAILED");
          }
          await this.repository.updateConversationTimestamp(client, conversationId);
        });
        return;
      } catch {
        // Retry the same bounded finalization; never expose persistence errors.
      }
    }
    console.error("AI generation failure finalization failed.");
  }

  private async generationHistory(
    owner: ConversationOwner,
    conversationId: string,
    requestMessage: MessageRecord,
    branchId?: string,
    selectedResponseMessageId?: string
  ): Promise<Array<{ role: string; content: string }>> {
    const result = await this.getConversation(owner, conversationId, branchId);
    const requestSequence = numericSequence(requestMessage);
    const completedRequestIds = await this.repository.getCompletedRequestMessageIds(
      this.repository.db,
      conversationId
    );
    const latestByRequest = new Map<string, MessageRecord>();
    const selectedResponse = selectedResponseMessageId
      ? result.messages.find(
          (message) =>
            message.id === selectedResponseMessageId &&
            message.role === "assistant" &&
            message.request_message_id !== null
        )
      : undefined;
    if (selectedResponse?.request_message_id) {
      latestByRequest.set(selectedResponse.request_message_id, selectedResponse);
    }
    for (const message of result.messages) {
      if (message.role !== "assistant" || !message.request_message_id) continue;
      if (latestByRequest.has(message.request_message_id)) continue;
      const previous = latestByRequest.get(message.request_message_id);
      if (!previous || message.variant_number > previous.variant_number) {
        latestByRequest.set(message.request_message_id, message);
      }
    }
    const selected: MessageRecord[] = [];
    for (const message of result.messages) {
      if (
        message.id === requestMessage.id ||
        (numericSequence(message) >= requestSequence && message.id !== selectedResponseMessageId)
      ) {
        continue;
      }
      if (message.status === "PROCESSING") continue;
      if (
        message.status === "FAILED" &&
        (message.role !== "user" || !completedRequestIds.has(message.id))
      ) {
        continue;
      }
      if (message.role === "assistant") {
        if (message.request_message_id && latestByRequest.get(message.request_message_id)?.id !== message.id) continue;
      } else if (message.role !== "user") {
        continue;
      }
      selected.push(message);
    }
    return selected.slice(-HISTORY_LIMIT).map((message) => ({ role: message.role, content: message.content }));
  }

  private async requireConversation(owner: ConversationOwner, conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.repository.getConversation(
      this.repository.db,
      owner.organizationId,
      owner.studentId,
      conversationId
    );
    if (!conversation) throw new ConversationNotFoundError();
    return conversation;
  }

  private async ensurePrimaryBranch(conversation: ConversationRecord): Promise<string> {
    if (conversation.active_branch_id) return conversation.active_branch_id;
    const branch = await this.repository.transaction(async (client) => {
      const created = await this.repository.insertPrimaryBranch(client, conversation.id);
      await this.repository.setActiveBranch(
        client,
        conversation.organization_id,
        conversation.student_id,
        conversation.id,
        created.id
      );
      return created;
    });
    return branch.id;
  }

  private async requireBranch(
    conversation: ConversationRecord,
    branchId: string,
    client?: ConversationQueryable
  ): Promise<BranchRecord> {
    const branch = await this.repository.getBranch(
      client ?? this.repository.db,
      conversation.id,
      branchId
    );
    if (!branch) throw new ConversationNotFoundError("Branch not found");
    return branch;
  }

}

export function mapConversationScope(conversation: ConversationRecord): ConversationScope {
  return scopeFromConversation(conversation);
}
