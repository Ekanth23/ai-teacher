import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTutorReply } from "../../src/modules/ai/ai.service.js";
import { DeepSeekProvider } from "../../src/modules/ai/providers/deepseek.provider.js";
import { isLlmProviderWithMetadata, type LlmProvider, type LlmProviderWithMetadata } from "../../src/modules/ai/providers/llm.provider.js";
import { MockLlmProvider } from "../../src/modules/ai/providers/mock.provider.js";
import { OllamaProvider } from "../../src/modules/ai/providers/ollama.provider.js";
import { createLlmProvider } from "../../src/modules/ai/providers/provider.factory.js";
import { InMemoryUsageTracker } from "../../src/modules/ai/usage/in-memory.usage.tracker.js";

/**
 * Test 7 — First real AI Teacher LLM integration.
 *
 * Contract under test:
 *   ai.service -> LlmProvider (abstraction) -> provider factory -> provider
 *   metadata   -> createUsageEvent() -> UsageTracker (in-memory seam)
 *
 * Constraints honored here:
 * - No DeepSeek API, no API key, no running Ollama, no database, no network.
 * - The service's public behaviour (string reply) remains unchanged.
 */

const originalFetch = globalThis.fetch;
const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER;
const ORIGINAL_DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

beforeEach(() => {
  // Test isolation: never inherit a real developer key or provider choice.
  delete process.env.DEEPSEEK_API_KEY;
  process.env.AI_PROVIDER = "mock";

  // Fail the test (rather than hang or hit a real endpoint) if any code
  // attempts a network call during this integration test.
  globalThis.fetch = vi.fn().mockRejectedValue(
    new Error("Network access is not allowed in this test")
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();

  if (ORIGINAL_AI_PROVIDER === undefined) {
    delete process.env.AI_PROVIDER;
  } else {
    process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
  }

  if (ORIGINAL_DEEPSEEK_API_KEY === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
  } else {
    process.env.DEEPSEEK_API_KEY = ORIGINAL_DEEPSEEK_API_KEY;
  }
});

const BASE_INPUT = {
  question: "What is photosynthesis?",
  subject: "Biology",
  topic: "Plants",
  studentGrade: "6",
};

/** Metadata-capable provider whose generation always fails (no network involved). */
function createFailingMetadataProvider(error: Error): LlmProviderWithMetadata {
  return {
    generate: async () => {
      throw error;
    },
    generateWithMetadata: async () => {
      throw error;
    },
  };
}

describe("ai.service provider abstraction integration", () => {
  it("depends on the LlmProvider abstraction: an injected plain provider is used instead of ollama.client", async () => {
    const injected: LlmProvider = {
      generate: async () => "PLAIN_PROVIDER_REPLY",
    };

    const reply = await generateTutorReply(BASE_INPUT, {
      provider: injected,
      usageTracker: new InMemoryUsageTracker(),
    });

    expect(reply).toBe("PLAIN_PROVIDER_REPLY");
  });

  it("does not import ollama.client directly (source-level architecture check)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../src/modules/ai/ai.service.ts", import.meta.url),
      "utf-8"
    );

    expect(source).not.toContain("ollama.client");
    expect(source).toContain("createLlmProvider");
    expect(source).toContain("isLlmProviderWithMetadata");
  });

  it("AI_PROVIDER=mock produces the existing deterministic AI service response", async () => {
    process.env.AI_PROVIDER = "mock";

    const reply = await generateTutorReply(BASE_INPUT);

    // Existing contract: trimmed provider text.
    expect(reply).toBe("MOCK_LLM_RESPONSE");
  });

  it("preserves the existing response shape: a plain trimmed string", async () => {
    const tracker = new InMemoryUsageTracker();

    const reply = await generateTutorReply(BASE_INPUT, {
      provider: new MockLlmProvider(),
      usageTracker: tracker,
    });

    expect(typeof reply).toBe("string");
    expect(reply).toBe("MOCK_LLM_RESPONSE");
    expect(reply).toBe(reply.trim());
  });

  it("provider selection still works through the single central factory", () => {
    expect(createLlmProvider("mock")).toBeInstanceOf(MockLlmProvider);
    expect(createLlmProvider("deepseek")).toBeInstanceOf(DeepSeekProvider);
    expect(createLlmProvider("ollama")).toBeInstanceOf(OllamaProvider);
    expect(() => createLlmProvider("definitely-invalid")).toThrow(
      /Unsupported AI_PROVIDER/
    );
  });

  it("metadata-capable provider generates exactly one SUCCESS usage event", async () => {
    const tracker = new InMemoryUsageTracker();

    await generateTutorReply(BASE_INPUT, {
      provider: new MockLlmProvider(),
      usageTracker: tracker,
    });

    expect(tracker.getEvents()).toHaveLength(1);
    const event = tracker.getEvents()[0];
    expect(event?.status).toBe("SUCCESS");
  });

  it("usage event contains provider/model/token metadata when available", async () => {
    const tracker = new InMemoryUsageTracker();

    await generateTutorReply(BASE_INPUT, {
      provider: new MockLlmProvider(),
      usageTracker: tracker,
    });

    const event = tracker.getEvents()[0];
    expect(event?.provider).toBe("mock");
    expect(event?.model).toBe("mock-model");
    expect(event?.usage?.inputTokens).toBe(10);
    expect(event?.usage?.outputTokens).toBe(20);
    expect(event?.usage?.totalTokens).toBe(30);
    expect(typeof event?.timestamp).toBe("string");
  });

  it("tenant/student/user/feature/conversation context is passed when available", async () => {
    const tracker = new InMemoryUsageTracker();

    await generateTutorReply(BASE_INPUT, {
      provider: new MockLlmProvider(),
      usageTracker: tracker,
      context: {
        organizationId: "org-123",
        studentId: "student-456",
        userId: "user-789",
        conversationId: "conv-001",
        feature: "tutor-reply",
        requestId: "req-42",
      },
    });

    const event = tracker.getEvents()[0];
    expect(event?.organizationId).toBe("org-123");
    expect(event?.studentId).toBe("student-456");
    expect(event?.userId).toBe("user-789");
    expect(event?.conversationId).toBe("conv-001");
    expect(event?.feature).toBe("tutor-reply");
    expect(event?.requestId).toBe("req-42");
  });

  it("defaults the feature to the tutor-reply feature identifier when context omits it", async () => {
    const tracker = new InMemoryUsageTracker();

    await generateTutorReply(BASE_INPUT, {
      provider: new MockLlmProvider(),
      usageTracker: tracker,
      context: { studentId: "student-456" },
    });

    const event = tracker.getEvents()[0];
    expect(event?.feature).toBe("tutor-reply");
    expect(event?.studentId).toBe("student-456");
  });

  it("estimatedCost stays undefined — no invented pricing", async () => {
    const tracker = new InMemoryUsageTracker();

    await generateTutorReply(BASE_INPUT, {
      provider: new MockLlmProvider(),
      usageTracker: tracker,
    });

    const event = tracker.getEvents()[0];
    expect(event?.estimatedCost).toBeUndefined();
  });

  it("propagates provider failure without swallowing it", async () => {
    const tracker = new InMemoryUsageTracker();
    const failing: LlmProvider = {
      generate: async () => {
        throw new Error("DeepSeek request failed with status 429 Too Many Requests");
      },
    };

    await expect(
      generateTutorReply(BASE_INPUT, { provider: failing, usageTracker: tracker })
    ).rejects.toThrow("429 Too Many Requests");
  });

  it("creates a FAILURE usage event with a categorized error when possible", async () => {
    const tracker = new InMemoryUsageTracker();
    const failing = createFailingMetadataProvider(
      new Error("DeepSeek request failed with status 429 Too Many Requests")
    );

    await expect(
      generateTutorReply(BASE_INPUT, { provider: failing, usageTracker: tracker })
    ).rejects.toThrow();

    expect(tracker.getEvents()).toHaveLength(1);
    const event = tracker.getEvents()[0];
    expect(event?.status).toBe("FAILURE");
    expect(event?.errorCategory).toBe("rate_limit");
    expect(event?.provider).toBe("mock"); // from resolved AI_PROVIDER, not invented
  });

  it("categorizes configuration errors distinctly", async () => {
    const tracker = new InMemoryUsageTracker();
    const failing = createFailingMetadataProvider(
      new Error("DEEPSEEK_API_KEY is not configured.")
    );

    await expect(
      generateTutorReply(BASE_INPUT, { provider: failing, usageTracker: tracker })
    ).rejects.toThrow();

    const event = tracker.getEvents()[0];
    expect(event?.errorCategory).toBe("configuration");
  });

  it("never includes secrets in usage events or propagated errors", async () => {
    const tracker = new InMemoryUsageTracker();
    const secret = "super-secret-api-key-do-not-leak";
    const failing = createFailingMetadataProvider(
      new Error(`DeepSeek request failed: Authorization failed for key ${secret}`)
    );

    await expect(
      generateTutorReply(BASE_INPUT, { provider: failing, usageTracker: tracker })
    ).rejects.toThrow();

    const serialized = JSON.stringify(tracker.getEvents());
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("apiKey");
    // The service must not fabricate usage event fields beyond the contract.
    const event = tracker.getEvents()[0] as unknown as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(
      [
        "conversationId",
        "errorCategory",
        "estimatedCost",
        "feature",
        "latencyMs",
        "model",
        "organizationId",
        "provider",
        "requestId",
        "status",
        "studentId",
        "timestamp",
        "usage",
        "userId",
      ].sort()
    );
  });

  it("makes no external network request (no DeepSeek, no Ollama)", async () => {
    const tracker = new InMemoryUsageTracker();

    const reply = await generateTutorReply(BASE_INPUT, {
      provider: new MockLlmProvider(),
      usageTracker: tracker,
    });

    expect(reply).toBe("MOCK_LLM_RESPONSE");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("metadata capability detection remains a clean abstraction-level check", () => {
    expect(isLlmProviderWithMetadata(new MockLlmProvider())).toBe(true);
    expect(isLlmProviderWithMetadata(new OllamaProvider())).toBe(true);
    expect(isLlmProviderWithMetadata(new DeepSeekProvider({ apiKey: "unused" }))).toBe(true);
    const plain: LlmProvider = { generate: async () => "plain" };
    expect(isLlmProviderWithMetadata(plain)).toBe(false);
  });

  it("plain (non-metadata) providers keep working through the generate() compatibility path", async () => {
    const tracker = new InMemoryUsageTracker();
    const plain: LlmProvider = { generate: async () => "  legacy-provider  " };

    const reply = await generateTutorReply(BASE_INPUT, {
      provider: plain,
      usageTracker: tracker,
    });

    expect(reply).toBe("legacy-provider");
    expect(tracker.getEvents()).toHaveLength(0);
  });

  it("preserves the existing prompt construction and business logic", async () => {
    let capturedPrompt = "";
    const capture: LlmProvider = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return "ok";
      },
    };

    await generateTutorReply(
      {
        question: "Why is the sky blue?",
        subject: "Physics",
        topic: "Light",
        studentGrade: "8",
        conversationHistory: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      },
      { provider: capture, usageTracker: new InMemoryUsageTracker() }
    );

    expect(capturedPrompt).toContain("You are an AI Teacher helping a school student.");
    expect(capturedPrompt).toContain("Grade: 8");
    expect(capturedPrompt).toContain("Subject: Physics");
    expect(capturedPrompt).toContain("Topic: Light");
    expect(capturedPrompt).toContain("STUDENT: Why is the sky blue?");
    expect(capturedPrompt).toContain("STUDENT: Hello");
    expect(capturedPrompt).toContain("ASSISTANT: Hi there!");
    expect(capturedPrompt).toContain("Previous conversation");
    expect(capturedPrompt).toBe(capturedPrompt.trim());
  });
});