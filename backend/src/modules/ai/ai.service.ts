import { randomUUID } from "node:crypto";
import { createLlmProvider, resolveAiProviderName } from "./providers/provider.factory.js";
import { isLlmProviderWithMetadata, type LlmProvider } from "./providers/llm.provider.js";
import type { LlmGenerationMetadata, LlmRequestContext } from "./providers/llm.types.js";
import { createUsageEvent, type LlmUsageEvent } from "./usage/usage.types.js";
import type { UsageTracker } from "./usage/usage.tracker.js";
import { InMemoryUsageTracker } from "./usage/in-memory.usage.tracker.js";

export interface ConversationHistoryMessage {
  role: string;
  content: string;
}

export interface GenerateTutorReplyInput {
  question: string;
  subject?: string;
  topic?: string;
  studentGrade?: string;
  board?: string;
  className?: string;
  chapter?: string;
  language?: string;
  medium?: string;
  conversationHistory?: ConversationHistoryMessage[];
}

export interface GenerateTutorReplyOptions {
  context?: LlmRequestContext;
  provider?: LlmProvider;
  usageTracker?: UsageTracker;
  /** US-117 lifecycle mode: provider success requires durable usage identity. */
  requireDurableUsage?: boolean;
}

export interface GenerateTutorReplyResult {
  text: string;
  metadata?: LlmGenerationMetadata;
  usageEvent?: LlmUsageEvent;
}

const FEATURE_TUTOR_REPLY = "tutor-reply";

/**
 * Internal generation error carrying only the already-categorized usage event
 * to the conversation orchestrator. The public string-returning API below
 * still rethrows the original provider error for backwards compatibility.
 */
export class TutorGenerationError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly usageEvent?: LlmUsageEvent
  ) {
    super("AI generation failed");
    this.name = "TutorGenerationError";
  }
}

export class UsagePersistenceError extends Error {
  readonly code = "AI_USAGE_PERSISTENCE_FAILED" as const;

  constructor(public readonly originalError: unknown) {
    super("AI usage could not be persisted.");
    this.name = "UsagePersistenceError";
  }
}

export function categorizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/not configured|configuration/i.test(message)) return "configuration";
  if (/unauthorized|401|api key|authentication/i.test(message)) return "authentication";
  if (/rate.?limit|429/i.test(message)) return "rate_limit";
  if (/timeout|abort/i.test(message)) return "timeout";
  if (/network|fetch|ECONNREFUSED|ENOTFOUND/i.test(message)) return "network";
  if (/invalid|malformed|did not contain/i.test(message)) return "invalid_response";
  return "provider_error";
}

function buildPrompt(input: GenerateTutorReplyInput): string {
  const {
    question,
    subject,
    topic,
    studentGrade,
    board,
    className,
    chapter,
    language,
    medium,
    conversationHistory = [],
  } = input;

  const historyText = conversationHistory
    .map((message) => {
      const speaker =
        message.role === "assistant" ? "ASSISTANT" : "STUDENT";
      return `${speaker}: ${message.content}`;
    })
    .join("\n");

  return `
You are an AI Teacher helping a school student.

Teaching rules:
- Explain concepts clearly and simply.
- Use examples appropriate for the student's age.
- Do not unnecessarily use difficult terminology.
- Encourage understanding rather than memorization.
- If the question is unclear, ask a short clarification question.
- If a curriculum-specific answer needs context that is not available, ask a targeted clarification question instead of inventing curriculum details.
- If a request is unrelated to learning, politely redirect the student to AI Teacher educational support.
- Give accurate educational answers.
- Do not pretend to know information that is uncertain.

Student information:
Grade: ${studentGrade ?? "not provided"}
Class/grade scope: ${className ?? "not provided"}
Board: ${board ?? "not provided"}
Medium: ${medium ?? "not provided"}
Language: ${language ?? "not provided"}
Subject: ${subject ?? "not provided"}
Chapter: ${chapter ?? "not provided"}
Topic: ${topic ?? "not provided"}

This is the student's actual context. Answer according to the available grade and scope labels; if a value is not provided, do not invent it.

${
  historyText
    ? `Previous conversation (for context only, continue naturally, do not repeat it back to the student):\n${historyText}\n`
    : ""
}
STUDENT: ${question}

Give the best educational answer for the student, continuing the conversation naturally based on the context above.
`.trim();
}

const MAX_USAGE_PERSISTENCE_ATTEMPTS = 3;

async function persistUsage(
  event: LlmUsageEvent,
  usageTracker: UsageTracker,
  required: boolean
): Promise<LlmUsageEvent> {
  if (!event.id && required) {
    event.id = randomUUID();
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < (required ? MAX_USAGE_PERSISTENCE_ATTEMPTS : 1); attempt += 1) {
    try {
      const persisted = await usageTracker.recordUsage(event);
      if (!required) {
        return persisted ?? event;
      }
      if (persisted?.id) {
        return { ...event, ...persisted };
      }
      lastError = new Error("Usage tracker returned no durable usage identity.");
    } catch (error) {
      lastError = error;
    }
  }
  if (required) {
    throw new UsagePersistenceError(lastError);
  }
  return event;
}

/**
 * Generates a reply while retaining provider metadata and the usage event for
 * the durable US-117 generation-attempt record. The legacy
 * `generateTutorReply` wrapper below intentionally keeps its string return
 * shape.
 */
export async function generateTutorReplyWithMetadata(
  input: GenerateTutorReplyInput,
  options: GenerateTutorReplyOptions = {}
): Promise<GenerateTutorReplyResult> {
  const {
    context: rawContext,
    provider: injectedProvider,
    usageTracker = new InMemoryUsageTracker(),
    requireDurableUsage = false,
  } = options;

  const context = {
    ...rawContext,
    feature: rawContext?.feature ?? FEATURE_TUTOR_REPLY,
  };
  const prompt = buildPrompt(input);
  const provider = injectedProvider ?? createLlmProvider();

  if (!isLlmProviderWithMetadata(provider)) {
    const text = (await provider.generate(prompt)).trim();
    if (!text) {
      throw new Error("Provider returned an empty response.");
    }
    return { text };
  }

  const startedAt = performance.now();

  try {
    const result = await provider.generateWithMetadata(prompt, context);
    if (result.metadata.status !== "SUCCESS") {
      throw new Error("Provider returned an unsuccessful generation status.");
    }
    const text = result.text.trim();
    if (!text) {
      throw new Error("Provider returned an empty response.");
    }

    const event = createUsageEvent({
      context: { ...context, requestId: context.requestId ?? result.metadata.requestId },
      provider: result.metadata.provider,
      model: result.metadata.model,
      usage: result.metadata.usage,
      latencyMs: result.metadata.latencyMs ?? performance.now() - startedAt,
      estimatedCost: result.metadata.estimatedCost,
      status: "SUCCESS",
    });

    const usageEvent = await persistUsage(event, usageTracker, requireDurableUsage);
    return { text, metadata: result.metadata, usageEvent };
  } catch (error) {
    const errorCategory =
      error instanceof UsagePersistenceError
        ? "usage_persistence"
        : categorizeProviderError(error);
    const event = createUsageEvent({
      context,
      provider: resolveAiProviderName(),
      model: "unknown",
      latencyMs: performance.now() - startedAt,
      status: "FAILURE",
      errorCategory,
    });

    let usageEvent: LlmUsageEvent | undefined;
    try {
      usageEvent = await persistUsage(event, usageTracker, false);
    } catch {
      usageEvent = event;
    }

    throw new TutorGenerationError(error, usageEvent);
  }
}

/**
 * Existing public service contract: return only the trimmed provider reply.
 */
export async function generateTutorReply(
  input: GenerateTutorReplyInput,
  options: GenerateTutorReplyOptions = {}
): Promise<string> {
  try {
    const result = await generateTutorReplyWithMetadata(input, options);
    return result.text;
  } catch (error) {
    if (error instanceof TutorGenerationError) {
      throw error.originalError;
    }
    throw error;
  }
}
