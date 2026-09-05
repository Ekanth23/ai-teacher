import { createLlmProvider, resolveAiProviderName } from "./providers/provider.factory.js";
import { isLlmProviderWithMetadata, type LlmProvider } from "./providers/llm.provider.js";
import type { LlmRequestContext } from "./providers/llm.types.js";
import { createUsageEvent } from "./usage/usage.types.js";
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
  conversationHistory?: ConversationHistoryMessage[];
}

export interface GenerateTutorReplyOptions {
  context?: LlmRequestContext;
  provider?: LlmProvider;
  usageTracker?: UsageTracker;
}

const FEATURE_TUTOR_REPLY = "tutor-reply";

function categorizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/not configured|configuration/i.test(message)) return "configuration";
  if (/unauthorized|401|api key|authentication/i.test(message)) return "authentication";
  if (/rate.?limit|429/i.test(message)) return "rate_limit";
  if (/timeout|abort/i.test(message)) return "timeout";
  if (/network|fetch|ECONNREFUSED|ENOTFOUND/i.test(message)) return "network";
  if (/invalid|malformed|did not contain/i.test(message)) return "invalid_response";
  return "provider_error";
}

export async function generateTutorReply(
  input: GenerateTutorReplyInput,
  options: GenerateTutorReplyOptions = {}
): Promise<string> {
  const {
    question,
    subject,
    topic,
    studentGrade,
    conversationHistory = [],
  } = input;

  const {
    context: rawContext,
    provider: injectedProvider,
    usageTracker = new InMemoryUsageTracker(),
  } = options;

  const context = {
    ...rawContext,
    feature: rawContext?.feature ?? FEATURE_TUTOR_REPLY,
  };

  const historyText = conversationHistory
    .map((message) => {
      const speaker =
        message.role === "assistant" ? "ASSISTANT" : "STUDENT";
      return `${speaker}: ${message.content}`;
    })
    .join("\n");

  const prompt = `
You are an AI Teacher helping a school student.

Teaching rules:
- Explain concepts clearly and simply.
- Use examples appropriate for the student's age.
- Do not unnecessarily use difficult terminology.
- Encourage understanding rather than memorization.
- If the question is unclear, ask a short clarification question.
- Give accurate educational answers.
- Do not pretend to know information that is uncertain.

Student information:
Grade: ${studentGrade ?? "not provided"}
Subject: ${subject ?? "not provided"}
Topic: ${topic ?? "not provided"}

This is the student's actual context. Answer according to the student's grade, subject and topic.

${
  historyText
    ? `Previous conversation (for context only, continue naturally, do not repeat it back to the student):\n${historyText}\n`
    : ""
}
STUDENT: ${question}

Give the best educational answer for the student, continuing the conversation naturally based on the context above.
`.trim();

  const provider = injectedProvider ?? createLlmProvider();

  if (!isLlmProviderWithMetadata(provider)) {
    return (await provider.generate(prompt)).trim();
  }

  const startedAt = performance.now();

  try {
    const result = await provider.generateWithMetadata(prompt, context);

    const event = createUsageEvent({
      context,
      provider: result.metadata.provider,
      model: result.metadata.model,
      usage: result.metadata.usage,
      latencyMs: result.metadata.latencyMs ?? performance.now() - startedAt,
      status: "SUCCESS",
    });

    await usageTracker.recordUsage(event);

    return result.text.trim();
  } catch (error) {
    const errorCategory = categorizeError(error);

    const event = createUsageEvent({
      context,
      provider: resolveAiProviderName(),
      model: "unknown",
      status: "FAILURE",
      errorCategory,
    });

    await usageTracker.recordUsage(event);

    throw error;
  }
}