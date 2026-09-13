import type { LlmProvider, LlmProviderWithMetadata } from "./llm.provider.js";
import { generateWithOllama } from "../ollama.client.js";
import type { LlmGenerationMetadata, LlmGenerationResult, LlmRequestContext } from "./llm.types.js";

export class OllamaProvider implements LlmProvider, LlmProviderWithMetadata {
  async generate(prompt: string): Promise<string> {
    const response = await generateWithOllama(prompt);
    return response.response.trim();
  }

  async generateWithMetadata(_prompt: string, _context?: LlmRequestContext): Promise<LlmGenerationResult> {
    const response = await generateWithOllama(_prompt);
    const metadata: LlmGenerationMetadata = {
      provider: "ollama",
      model: response.model ?? "ollama-local",
      usage: {
        inputTokens: response.prompt_eval_count ?? undefined,
        outputTokens: response.eval_count ?? undefined,
        totalTokens:
          typeof response.prompt_eval_count === "number" && typeof response.eval_count === "number"
            ? response.prompt_eval_count + response.eval_count
            : undefined,
      },
      latencyMs: (typeof response.total_duration === "number"
        ? Math.round(response.total_duration / 1_000_000)
        : undefined),
      status: "SUCCESS",
      finishedReason: response.done ? "stop" : undefined,
    };
    return { text: response.response.trim(), metadata };
  }
}
