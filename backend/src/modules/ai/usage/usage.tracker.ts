import type { LlmUsageEvent } from "./usage.types.js";

/**
 * Future usage-recording interface.
 *
 * Implementations will persist events to a usage store (e.g., PostgreSQL)
 * later. No persistence is performed in this test.
 */
export interface UsageTracker {
  /**
   * Records one actual provider generation. Implementations may return the
   * persisted event (including its database id); the original void contract
   * remains valid for lightweight/test trackers.
   */
  recordUsage(event: LlmUsageEvent): Promise<LlmUsageEvent | void>;
}