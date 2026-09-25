import { resolveAiProviderNameOrUnknown, createLlmProvider } from "./providers/provider.factory.js";
import type { LlmProvider } from "./providers/llm.provider.js";
import type { LlmUsageEvent } from "./usage/usage.types.js";
import { generateTutorReplyWithMetadata, TutorGenerationError, categorizeProviderError } from "./ai.service.js";
import type { UsageTracker } from "./usage/usage.tracker.js";
import type {
  ConversationRecord,
  GenerationAttemptRecord,
  GenerationResult,
  MessageRecord,
} from "./conversation.types.js";
import { ConversationRepository } from "./conversation.repository.js";
import type { StudentLearningContext } from "./learning-context.types.js";
import type { BoardResponseContext } from "./board-response.types.js";

export interface GenerationOwner {
  organizationId: string;
  studentId: string;
  userId: string;
}

export interface GenerateAttemptInput extends GenerationOwner {
  conversation: ConversationRecord;
  requestMessage: MessageRecord;
  attempt: GenerationAttemptRecord;
  studentGrade?: string | null;
  history: Array<{ role: string; content: string }>;
  studentLearningContext?: StudentLearningContext;
  boardResponseContext?: BoardResponseContext;
}

export class GenerationFailedError extends Error {
  readonly code = "AI_GENERATION_FAILED" as const;

  constructor(
    public readonly attempt: GenerationAttemptRecord,
    public readonly usageEvent?: LlmUsageEvent
  ) {
    super("We couldn't generate an AI Teacher response. Please try again.");
    this.name = "GenerationFailedError";
  }
}

export class GenerationService {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly providerFactory: () => LlmProvider = () => createLlmProvider(),
    private readonly usageTracker: UsageTracker
  ) {}

  async generate(input: GenerateAttemptInput): Promise<GenerationResult> {
    try {
      const provider = this.providerFactory();
      const result = await generateTutorReplyWithMetadata(
        {
          question: input.requestMessage.content,
          subject: input.conversation.subject ?? undefined,
          topic: input.conversation.topic ?? undefined,
          studentGrade: input.studentGrade ?? undefined,
          className: input.conversation.scope_class ?? undefined,
          chapter: input.conversation.scope_chapter ?? undefined,
          language: input.conversation.scope_language ?? undefined,
          medium: input.conversation.scope_medium ?? undefined,
          conversationHistory: input.history,
          studentLearningContext: input.studentLearningContext,
          boardResponseContext: input.boardResponseContext,
        },
        {
          provider,
          usageTracker: this.usageTracker,
          requireDurableUsage: true,
          context: {
            organizationId: input.organizationId,
            studentId: input.studentId,
            userId: input.userId,
            conversationId: input.conversation.id,
            feature: "tutor-reply",
            generationAttemptId: input.attempt.id,
          },
        }
      );

      const providerName = result.metadata?.provider ?? resolveAiProviderNameOrUnknown();
      const model = result.metadata?.model ?? "unknown";
      const usageEventId = result.usageEvent?.id ?? null;
      if (!usageEventId) {
        throw new Error("Generation usage linkage is not durable.");
      }

      const completed = await this.repository.transaction(async (client) => {
        const conversationLock = await client.query(
          `SELECT id, deleted_at FROM ai_conversations
            WHERE id = $1 AND organization_id = $2 AND student_id = $3
            FOR UPDATE`,
          [input.conversation.id, input.organizationId, input.studentId]
        );
        if (conversationLock.rows.length === 0) {
          throw new Error("Conversation is no longer available.");
        }
        const current = await client.query(
          `SELECT id, status, request_message_id, branch_id
             FROM ai_generation_attempts
            WHERE id = $1 AND conversation_id = $2
              AND organization_id = $3 AND student_id = $4
            FOR UPDATE`,
          [input.attempt.id, input.conversation.id, input.organizationId, input.studentId]
        );
        if (current.rows.length === 0 || current.rows[0].status !== "PROCESSING") {
          throw new Error("Generation attempt is no longer available.");
        }
        if (conversationLock.rows[0].deleted_at) {
          const failedAttempt = await this.repository.updateAttemptFailed(
            client,
            input.attempt.id,
            providerName,
            model,
            "conversation_deleted",
            usageEventId
          );
          if (!failedAttempt) throw new Error("Generation attempt could not be finalized.");
          if (input.attempt.attempt_type === "ORIGINAL") {
            await this.repository.updateMessageStatus(client, input.requestMessage.id, "FAILED");
          }
          await this.repository.updateConversationTimestamp(client, input.conversation.id);
          return { responseMessage: null, attempt: failedAttempt };
        }

        const sequence = Number(input.requestMessage.sequence_number ?? 1);
        const variant = await this.repository.getNextVariantNumber(client, input.requestMessage.id);
        const response = await this.repository.insertMessage(client, {
          conversationId: input.conversation.id,
          role: "assistant",
          content: result.text,
          status: "COMPLETED",
          branchId: input.requestMessage.branch_id ?? input.attempt.branch_id,
          sequenceNumber: sequence,
          variantNumber: variant,
          requestMessageId: input.requestMessage.id,
          generationAttemptId: input.attempt.id,
        });

        const attempt = await this.repository.updateAttemptCompleted(
          client,
          input.attempt.id,
          response.id,
          providerName,
          model,
          result.usageEvent?.requestId ?? result.metadata?.requestId ?? null,
          usageEventId
        );
        if (!attempt) throw new Error("Generation attempt could not be completed.");

        // The original request's status represents its original attempt. A
        // retry/regeneration remains traceable without rewriting that status.
        if (input.attempt.attempt_type === "ORIGINAL") {
          await this.repository.updateMessageStatus(client, input.requestMessage.id, "COMPLETED");
        }
        await this.repository.updateConversationTimestamp(client, input.conversation.id);
        return { responseMessage: response, attempt };
      });

      return {
        conversation: input.conversation,
        requestMessage: input.requestMessage,
        responseMessage: completed.responseMessage,
        attempt: completed.attempt,
      };
    } catch (error) {
      if (error instanceof GenerationFailedError) throw error;

      const usageEvent = error instanceof TutorGenerationError ? error.usageEvent : undefined;
      const isContextAssemblyFailure =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "AI_CONTEXT_ASSEMBLY_FAILED";
      const category = isContextAssemblyFailure
        ? "context_assembly"
        : usageEvent?.errorCategory ?? categorizeProviderError(error);
      const providerName = usageEvent?.provider ?? resolveAiProviderNameOrUnknown();
      const model = usageEvent?.model ?? "unknown";
      let failedAttempt: GenerationAttemptRecord | null = null;

      try {
        failedAttempt = await this.repository.transaction(async (client) => {
          const conversationLock = await client.query(
            `SELECT id, deleted_at FROM ai_conversations
              WHERE id = $1 AND organization_id = $2 AND student_id = $3
              FOR UPDATE`,
            [input.conversation.id, input.organizationId, input.studentId]
          );
          if (conversationLock.rows.length === 0) return null;
          const current = await client.query(
            `SELECT id, status, attempt_type, request_message_id
               FROM ai_generation_attempts
              WHERE id = $1 AND conversation_id = $2
                AND organization_id = $3 AND student_id = $4
              FOR UPDATE`,
            [input.attempt.id, input.conversation.id, input.organizationId, input.studentId]
          );
          if (current.rows.length === 0 || current.rows[0].status !== "PROCESSING") {
            return null;
          }
          const attempt = await this.repository.updateAttemptFailed(
            client,
            input.attempt.id,
            providerName,
            model,
            category,
            usageEvent?.id ?? null
          );
          if (attempt && input.attempt.attempt_type === "ORIGINAL") {
            await this.repository.updateMessageStatus(client, input.requestMessage.id, "FAILED");
          }
          await this.repository.updateConversationTimestamp(client, input.conversation.id);
          return attempt;
        });
      } catch (persistError) {
        // Do not expose persistence/provider internals to the caller. The
        // original request remains recorded even if finalization itself fails.
        console.error("AI generation attempt finalization failed.");
      }

      throw new GenerationFailedError(
        failedAttempt ?? { ...input.attempt, status: "FAILED" },
        usageEvent
      );
    }
  }
}
