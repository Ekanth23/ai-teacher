import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateEstimatedCost } from "../../src/modules/ai/providers/cost.calculator.js";
import { DeepSeekProvider } from "../../src/modules/ai/providers/deepseek.provider.js";
import { isLlmProviderWithMetadata, type LlmProvider } from "../../src/modules/ai/providers/llm.provider.js";
import type { LlmGenerationResult, LlmRequestContext } from "../../src/modules/ai/providers/llm.types.js";
import { MockLlmProvider } from "../../src/modules/ai/providers/mock.provider.js";
import { createUsageEvent, type LlmUsageEvent } from "../../src/modules/ai/usage/usage.types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function createUsageContext(): LlmRequestContext {
  return {
    organizationId: "org-1",
    studentId: "student-1",
    userId: "user-1",
    feature: "tutor-reply",
    conversationId: "conv-1",
    requestId: "req-1",
  };
}

describe("AI usage architecture", () => {
  it("constructs a strongly typed usage event from context", () => {
    const event: LlmUsageEvent = createUsageEvent({
      context: createUsageContext(),
      provider: "mock",
      model: "mock-model",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      latencyMs: 5,
      estimatedCost: 0,
      status: "SUCCESS",
    });
    expect(event.provider).toBe("mock");
    expect(event.organizationId).toBe("org-1");
    expect(event.studentId).toBe("student-1");
    expect(event.feature).toBe("tutor-reply");
    expect(event.conversationId).toBe("conv-1");
    expect(event.usage?.totalTokens).toBe(30);
    expect(typeof event.timestamp).toBe("string");
  });

  it("keeps the existing generate() contract intact (backward compatible)", async () => {
    const provider = new MockLlmProvider();
    expect(await provider.generate("hello")).toBe("MOCK_LLM_RESPONSE");
  });

  it("detects metadata capability via the type guard", () => {
    const plain: LlmProvider = { generate: async () => "plain" };
    expect(isLlmProviderWithMetadata(plain)).toBe(false);
    expect(isLlmProviderWithMetadata(new MockLlmProvider())).toBe(true);
  });

  it("returns deterministic mock metadata with documented test values", async () => {
    const result: LlmGenerationResult = await new MockLlmProvider().generateWithMetadata("hello");
    expect(result.text).toBe("MOCK_LLM_RESPONSE");
    expect(result.metadata.provider).toBe("mock");
    expect(result.metadata.usage?.inputTokens).toBe(10);
    expect(result.metadata.usage?.outputTokens).toBe(20);
    expect(result.metadata.usage?.totalTokens).toBe(30);
    expect(result.metadata.status).toBe("SUCCESS");
  });

  it("exposes DeepSeek usage metadata without exposing raw API responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        id: "req-abc",
        model: "deepseek-chat",
        choices: [{ message: { role: "assistant", content: "Hi" } }],
        usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new DeepSeekProvider({ apiKey: "k", baseUrl: "https://example.com" });
    const result = await provider.generateWithMetadata("hello");
    expect(result.text).toBe("Hi");
    expect(result.metadata.provider).toBe("deepseek");
    expect(result.metadata.requestId).toBe("req-abc");
    expect(result.metadata.usage?.inputTokens).toBe(12);
    expect(result.metadata.usage?.outputTokens).toBe(34);
    expect(result.metadata.usage?.totalTokens).toBe(46);
  });

  it("calculates estimated cost from pricing and token counts", () => {
    const cost = calculateEstimatedCost({
      provider: "deepseek",
      model: "deepseek-chat",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      pricing: { inputTokenPrice: 0.001, outputTokenPrice: 0.002 },
    });
    expect(cost).toBe(100 * 0.001 + 50 * 0.002);
  });

  it("returns undefined cost when pricing is unknown", () => {
    const cost = calculateEstimatedCost({
      provider: "deepseek",
      model: "deepseek-chat",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    expect(cost).toBeUndefined();
  });

  it("returns undefined cost when token counts are missing", () => {
    const cost = calculateEstimatedCost({
      provider: "mock",
      model: "mock-model",
      usage: {},
      pricing: { inputTokenPrice: 0.001, outputTokenPrice: 0.002 },
    });
    expect(cost).toBeUndefined();
  });

  it("creates failure usage events without external calls", () => {
    const event = createUsageEvent({
      provider: "deepseek",
      model: "deepseek-chat",
      status: "FAILURE",
      errorCategory: "rate_limit",
    });
    expect(event.status).toBe("FAILURE");
    expect(event.errorCategory).toBe("rate_limit");
    expect(event.usage).toBeUndefined();
  });
});