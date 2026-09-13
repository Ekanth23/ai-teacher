import type { LlmUsageEvent } from "./usage.types.js";

/**
 * Future usage-recording interface.
 *
 * Implementations will persist events to a usage store (e.g., PostgreSQL)
 * later. No persistence is performed in this test.
 */
export interface UsageTracker {
  recordUsage(event: LlmUsageEvent): Promise<void>;
}