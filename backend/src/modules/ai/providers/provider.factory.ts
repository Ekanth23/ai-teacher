import type { LlmProvider } from "./llm.provider.js";
import { DeepSeekProvider } from "./deepseek.provider.js";
import { MockLlmProvider } from "./mock.provider.js";
import { OllamaProvider } from "./ollama.provider.js";

export type AiProviderName = "ollama" | "deepseek" | "mock";

/**
 * Default provider used when AI_PROVIDER is not set.
 *
 * `mock` is the safe default: it requires no external service, no API key,
 * and no local Ollama server. It returns a deterministic response.
 */
export const DEFAULT_AI_PROVIDER: AiProviderName = "mock";

const SUPPORTED_PROVIDERS: readonly AiProviderName[] = ["ollama", "deepseek", "mock"];

function normalizeProviderName(value: string | undefined): AiProviderName {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "") {
    return DEFAULT_AI_PROVIDER;
  }

  if (!SUPPORTED_PROVIDERS.includes(normalized as AiProviderName)) {
    const supported = SUPPORTED_PROVIDERS.join(", ");
    throw new Error(
      `Unsupported AI_PROVIDER "${value}". Supported values: ${supported}.`
    );
  }

  return normalized as AiProviderName;
}

/**
 * Resolves the configured provider name without constructing an instance.
 *
 * Part of the single central provider-selection mechanism: used by the AI
 * service to label failure usage events when a provider cannot supply
 * metadata itself.
 */
export function resolveAiProviderName(providerName?: string): AiProviderName {
  return normalizeProviderName(providerName ?? process.env.AI_PROVIDER);
}

export function createLlmProvider(providerName?: string): LlmProvider {
  const provider = resolveAiProviderName(providerName);

  switch (provider) {
    case "ollama":
      return new OllamaProvider();
    case "deepseek":
      return new DeepSeekProvider();
    case "mock":
      return new MockLlmProvider();
  }
}