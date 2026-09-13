import type { LlmModelIdentity, LlmTokenUsage } from "./llm.types.js";

export interface LlmPricing {
  inputTokenPrice: number;
  outputTokenPrice: number;
}

export interface CalculateCostInput extends LlmModelIdentity {
  usage: LlmTokenUsage;
  pricing?: LlmPricing;
}

export function calculateEstimatedCost(input: CalculateCostInput): number | undefined {
  const { inputTokens, outputTokens } = input.usage;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
    return undefined;
  }
  if (!input.pricing) {
    return undefined;
  }
  return inputTokens * input.pricing.inputTokenPrice + outputTokens * input.pricing.outputTokenPrice;
}