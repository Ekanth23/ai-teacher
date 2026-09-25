import { randomUUID } from "node:crypto";
import pool from "../../../db.js";
import type { LlmUsageEvent } from "./usage.types.js";
import type { UsageTracker } from "./usage.tracker.js";

export interface UsageQueryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Persists AI usage events to the `ai_usage_events` table.
 *
 * Legacy/direct callers retain best-effort semantics: persistence errors are
 * logged and returned as undefined. The US-117 generation lifecycle treats an
 * undefined result as a failed durable-attribution attempt and performs its
 * own bounded recovery before allowing a provider result to complete.
 */
export class PostgresUsageTracker implements UsageTracker {
  constructor(private readonly db: UsageQueryable = pool as unknown as UsageQueryable) {}

  async recordUsage(event: LlmUsageEvent): Promise<LlmUsageEvent | void> {
    try {
      const eventId = event.id ?? randomUUID();
      await this.db.query(
        `INSERT INTO ai_usage_events
           (id, organization_id, student_id, user_id, conversation_id,
            generation_attempt_id, feature, provider, model, request_id,
            input_tokens, output_tokens, total_tokens,
            latency_ms, estimated_cost, status, error_category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (id) DO NOTHING`,
        [
          eventId,
          event.organizationId ?? null,
          event.studentId ?? null,
          event.userId ?? null,
          event.conversationId ?? null,
          event.generationAttemptId ?? null,
          event.feature ?? "unknown",
          event.provider,
          event.model,
          event.requestId ?? null,
          event.usage?.inputTokens ?? null,
          event.usage?.outputTokens ?? null,
          event.usage?.totalTokens ?? null,
          event.latencyMs !== undefined ? Math.round(event.latencyMs) : null,
          event.estimatedCost ?? null,
          event.status,
          event.errorCategory ?? null,
        ]
      );

      return { ...event, id: eventId };
    } catch (error) {
      console.error("Failed to persist AI usage event:", error instanceof Error ? error.message : "unknown error");
      return undefined;
    }
  }
}
