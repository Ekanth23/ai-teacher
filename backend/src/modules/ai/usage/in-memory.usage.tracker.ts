import type { LlmUsageEvent } from "./usage.types.js";
import type { UsageTracker } from "./usage.tracker.js";

/**
 * Minimal in-memory UsageTracker.
 *
 * Stores events in memory for the integration test. No persistence.
 * A future production implementation will persist to a usage store.
 */
export class InMemoryUsageTracker implements UsageTracker {
  private readonly events: LlmUsageEvent[] = [];

  async recordUsage(event: LlmUsageEvent): Promise<void> {
    this.events.push(event);
  }

  getEvents(): readonly LlmUsageEvent[] {
    return this.events;
  }

  clear(): void {
    this.events.length = 0;
  }
}