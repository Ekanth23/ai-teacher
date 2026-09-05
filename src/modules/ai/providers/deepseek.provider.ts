import type { LlmProvider, LlmProviderWithMetadata } from "./llm.provider.js";
import type { LlmGenerationMetadata, LlmGenerationResult, LlmRequestContext, LlmTokenUsage } from "./llm.types.js";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractAssistantText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) return null;
  const message = firstChoice.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  if (typeof content !== "string" || content.trim().length === 0) return null;
  return content;
}

function extractUsage(payload: unknown): LlmTokenUsage | undefined {
  if (!isRecord(payload)) return undefined;
  const usage = payload.usage;
  if (!isRecord(usage)) return undefined;
  const result: LlmTokenUsage = {};
  if (typeof usage.prompt_tokens === "number") result.inputTokens = usage.prompt_tokens;
  if (typeof usage.completion_tokens === "number") result.outputTokens = usage.completion_tokens;
  if (typeof usage.total_tokens === "number") result.totalTokens = usage.total_tokens;
  return Object.keys(result).length > 0 ? result : undefined;
}

function extractRequestId(payload: unknown): string | undefined {
  if (!isRecord(payload) || typeof payload.id !== "string") return undefined;
  return payload.id.trim().length > 0 ? payload.id : undefined;
}

type CompleteResult = {
  text: string;
  usage: LlmTokenUsage | undefined;
  requestId: string | undefined;
  model: string;
  latencyMs: number;
};

export class DeepSeekProvider implements LlmProvider, LlmProviderWithMetadata {
  constructor(
    private readonly options: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      timeoutMs?: number;
    } = {}
  ) {}

  async generate(prompt: string): Promise<string> {
    const result = await this.complete(prompt);
    return result.text;
  }

  async generateWithMetadata(prompt: string, _context?: LlmRequestContext): Promise<LlmGenerationResult> {
    const result = await this.complete(prompt);
    const metadata: LlmGenerationMetadata = {
      provider: "deepseek",
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
      requestId: result.requestId,
      status: "SUCCESS",
      finishedReason: "stop",
    };
    return { text: result.text, metadata };
  }

  private async complete(prompt: string): Promise<CompleteResult> {
    const apiKey = this.options.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured.");

    const baseUrl = (this.options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, "");
    const model = this.options.model ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = performance.now();

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`DeepSeek request failed: ${message}`);
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      const detail = responseBody ? `: ${responseBody.slice(0, 500)}` : "";
      throw new Error(`DeepSeek request failed with status ${response.status} ${response.statusText}${detail}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("DeepSeek request failed: response body is not valid JSON.");
    }

    const assistantText = extractAssistantText(payload);
    if (assistantText === null) {
      throw new Error("DeepSeek request failed: response did not contain an assistant message.");
    }

    return {
      text: assistantText,
      usage: extractUsage(payload),
      requestId: extractRequestId(payload),
      model,
      latencyMs: performance.now() - startedAt,
    };
  }
}