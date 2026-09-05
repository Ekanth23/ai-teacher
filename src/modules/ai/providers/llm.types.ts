export type LlmProviderName = "ollama" | "deepseek" | "mock";

export interface LlmModelIdentity {
  provider: LlmProviderName;
  model: string;
}

export interface LlmTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type LlmGenerationStatus = "SUCCESS" | "FAILURE";

export interface LlmGenerationMetadata extends LlmModelIdentity {
  usage?: LlmTokenUsage;
  latencyMs?: number;
  requestId?: string;
  estimatedCost?: number;
  finishedReason?: string;
  status: LlmGenerationStatus;
  errorCategory?: string;
}

export interface LlmGenerationResult {
  text: string;
  metadata: LlmGenerationMetadata;
}

/** WHO made the future AI request — supplied by the AI service layer. */
export interface LlmRequestContext {
  organizationId?: string;
  studentId?: string;
  userId?: string;
  feature?: string;
  conversationId?: string;
  requestId?: string;
}