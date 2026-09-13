import type { LlmModelIdentity, LlmRequestContext, LlmTokenUsage } from "../providers/llm.types.js";

export type UsageEventStatus = "SUCCESS" | "FAILURE";

export interface LlmUsageEvent extends LlmModelIdentity {
  requestId?: string;
  feature?: string;
  organizationId?: string;
  studentId?: string;
  userId?: string;
  conversationId?: string;
  usage?: LlmTokenUsage;
  latencyMs?: number;
  estimatedCost?: number;
  status: UsageEventStatus;
  errorCategory?: string;
  timestamp: string;
}

export type CreateUsageEventInput = {
  context?: LlmRequestContext;
  provider: LlmModelIdentity["provider"];
  model: string;
  usage?: LlmTokenUsage;
  latencyMs?: number;
  estimatedCost?: number;
  status: UsageEventStatus;
  errorCategory?: string;
};

export function createUsageEvent(input: CreateUsageEventInput): LlmUsageEvent {
  return {
    provider: input.provider,
    model: input.model,
    requestId: input.context?.requestId,
    feature: input.context?.feature,
    organizationId: input.context?.organizationId,
    studentId: input.context?.studentId,
    userId: input.context?.userId,
    conversationId: input.context?.conversationId,
    usage: input.usage,
    latencyMs: input.latencyMs,
    estimatedCost: input.estimatedCost,
    status: input.status,
    errorCategory: input.errorCategory,
    timestamp: new Date().toISOString(),
  };
}