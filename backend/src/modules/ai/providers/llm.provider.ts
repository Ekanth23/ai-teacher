import type { LlmGenerationMetadata, LlmGenerationResult, LlmRequestContext } from "./llm.types.js";

export interface LlmProvider {
  generate(prompt: string): Promise<string>;
}

/**
 * Optional capability: generating with usage/observability metadata.
 *
 * Providers may implement this without breaking the existing `generate`
 * contract. Callers should use `isLlmProviderWithMetadata` to detect support.
 */
export interface LlmProviderWithMetadata extends LlmProvider {
  generateWithMetadata(prompt: string, context?: LlmRequestContext): Promise<LlmGenerationResult>;
}

export function isLlmProviderWithMetadata(provider: LlmProvider): provider is LlmProviderWithMetadata {
  return typeof (provider as Partial<LlmProviderWithMetadata>).generateWithMetadata === "function";
}
