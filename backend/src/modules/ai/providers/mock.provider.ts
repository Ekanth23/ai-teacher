import type { LlmProvider, LlmProviderWithMetadata } from "./llm.provider.js";
import type { LlmGenerationResult, LlmRequestContext, LlmTokenUsage } from "./llm.types.js";

const MOCK_MODEL = "mock-model";
const MOCK_USAGE: Required<LlmTokenUsage> = {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
};

export class MockLlmProvider implements LlmProvider, LlmProviderWithMetadata {
  async generate(_prompt: string): Promise<string> {
    return "MOCK_LLM_RESPONSE";
  }

  async generateWithMetadata(_prompt: string, _context?: LlmRequestContext): Promise<LlmGenerationResult> {
    return {
      text: "MOCK_LLM_RESPONSE",
      metadata: {
        provider: "mock",
        model: MOCK_MODEL,
        usage: MOCK_USAGE,
        latencyMs: 0,
        requestId: "mock-request-id",
        status: "SUCCESS",
        finishedReason: "stop",
      },
    };
  }
}
