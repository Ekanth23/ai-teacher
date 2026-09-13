import pool from "../../../db.js";
import type { LlmUsageEvent } from "./usage.types.js";
import type { UsageTracker } from "./usage.tracker.js";

export interface UsageQueryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Persists AI usage events to the `ai_usage_events` table.
 *
 * Best-effort by design: usage tracking must never fail the primary AI
 * reply flow, so persistence errors are logged and swallowed.
 */
export class PostgresUsageTracker implements UsageTracker {
  constructor(private readonly db: UsageQueryable = pool as unknown as UsageQueryable) {}

  async recordUsage(event: LlmUsageEvent): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO ai_usage_events
           (organization_id, student_id, user_id, conversation_id,
            feature, provider, model, request_id,
            input_tokens, output_tokens, total_tokens,
            latency_ms, estimated_cost, status, error_category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          event.organizationId ?? null,
          event.studentId ?? null,
          event.userId ?? null,
          event.conversationId ?? null,
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
    } catch (error) {
      console.error("Failed to persist AI usage event:", error);
    }
  }
}
