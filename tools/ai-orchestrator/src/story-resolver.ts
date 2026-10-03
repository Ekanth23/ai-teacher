/**
 * Stage 2A — Story resolution boundary.
 *
 * PURPOSE
 * -------
 * Preserve the Stage 1 story-resolution rule in architecture, without copying the
 * Stage 1 rule set and without implementing repository scanning.
 *
 * STAGE 1 RULE BEING PRESERVED (not restated)
 * -------------------------------------------
 * The Master Backlog's authoritative story table is the single source for a story
 * ID. A separate Draft 1.0 -> Draft 2.0 traceability section reuses the same
 * numeric IDs for *different* stories, so any resolution MUST report the collision
 * rather than silently choosing. A repo-wide grep is not sufficient because it
 * cannot distinguish the two tables.
 *
 * The authoritative table name, the collision table name, and the retired-ID list
 * live in the frozen Master Backlog and in `.opencode/ai-workflow-rules.md`. This
 * file records only *that* they are authoritative and *that* collisions must be
 * surfaced. It deliberately does NOT embed the table contents or the retired IDs.
 *
 * STAGE 2A HARD RULE
 * ------------------
 * No repository scanning is implemented. `resolveStory()` always returns
 * `not-found` with a Stage 2A marker, so nothing can be mistaken for a real
 * resolution.
 */

import { NotImplementedInStageError } from "./errors.js";
import { StoryResolverImpl } from "./story-resolver-impl.js";

/** Stage that is expected to implement repository scanning. */
export const RESOLVER_PLANNED_STAGE = "Stage 2B" as const;

/**
 * Section identifiers used for provenance reporting.
 *
 * These are section *names* used to disambiguate matches, not backlog content.
 */
export const AUTHORITATIVE_STORY_TABLE = "SECTION B" as const;
export const COLLISION_TRACEABILITY_TABLE = "SECTION F" as const;
export const NUMBERING_MATRIX_TABLE = "SECTION C" as const;

export const STORY_RESOLUTION_INVARIANTS: readonly string[] = [
  "The authoritative story table is the only place a story ID may be resolved from.",
  "A Draft 1.0 / Draft 2.0 ID collision must always be reported, never merged.",
  "A collision that implies genuinely different work stops and asks the PO.",
  "A retired story ID is permanent and is never reused.",
  "A story that is absent from the authoritative table is never invented.",
  "The orchestrator never rewrites, widens, or re-statuses a user story.",
  "Section D of the Master Backlog is historical and is never used as current state.",
];

/** Where a resolved story came from. Reported, never silently chosen. */
export type StoryTableSource = typeof AUTHORITATIVE_STORY_TABLE | typeof COLLISION_TRACEABILITY_TABLE;

export interface ResolvedStory {
  readonly storyId: string;
  readonly epicId: string | null;
  readonly title: string | null;
  readonly status: string | null;
  readonly notes: string | null;
  /** The authoritative table the resolution came from. */
  readonly resolvedFrom: StoryTableSource;
}

export interface DraftIdCollision {
  readonly storyId: string;
  readonly authoritativeEntry: ResolvedStory;
  readonly conflictingEntry: ResolvedStory;
  /** True when the two entries plausibly describe different work. */
  readonly impliesDifferentWork: boolean;
  /** Always true. A collision is never auto-resolved. */
  readonly requiresPoDecision: boolean;
  readonly message: string;
}

export type StoryResolution =
  | { readonly kind: "resolved"; readonly story: ResolvedStory; readonly collision: DraftIdCollision | null }
  | { readonly kind: "collision-detected"; readonly collision: DraftIdCollision }
  | { readonly kind: "retired-story"; readonly storyId: string; readonly message: string }
  | { readonly kind: "not-found"; readonly storyId: string; readonly message: string }
  | { readonly kind: "ambiguous"; readonly storyId: string; readonly candidates: readonly ResolvedStory[]; readonly message: string };

export const STORY_RESOLUTION_KINDS = [
  "resolved",
  "collision-detected",
  "retired-story",
  "not-found",
  "ambiguous",
] as const;

export type StoryResolutionKind = (typeof STORY_RESOLUTION_KINDS)[number];

export interface StoryResolutionRequest {
  readonly storyId: string;
  /** Absolute path to the frozen Master Backlog. */
  readonly masterBacklogPath: string;
}

export interface StoryResolver {
  resolve(request: StoryResolutionRequest): Promise<StoryResolution>;
  /** Section names this resolver is permitted to read. */
  authoritativeSections(): readonly string[];
}

/**
 * Stage 2A resolver.
 *
 * Returns a `not-found` result whose message states that scanning is not
 * implemented. It never fabricates a story, and it never guesses a collision.
 */
export class Stage2AStoryResolver implements StoryResolver {
  resolve(request: StoryResolutionRequest): Promise<StoryResolution> {
    return Promise.resolve({
      kind: "not-found",
      storyId: request.storyId,
      message:
        `Stage 2A does not scan the Master Backlog. Story "${request.storyId}" was NOT resolved. ` +
        `A later stage must resolve it from ${AUTHORITATIVE_STORY_TABLE} and cross-check ` +
        `${COLLISION_TRACEABILITY_TABLE}. No story was inferred.`,
    });
  }

  authoritativeSections(): readonly string[] {
    return [AUTHORITATIVE_STORY_TABLE, COLLISION_TRACEABILITY_TABLE, NUMBERING_MATRIX_TABLE];
  }
}

export function createStoryResolver(): StoryResolver {
  return new StoryResolverImpl();
}

/** Throwing placeholder for the Stage 2B document scanner. */
export function scanBacklogSection(): never {
  throw new NotImplementedInStageError("StoryResolver.scanBacklogSection", "Stage 2A", RESOLVER_PLANNED_STAGE);
}

/**
 * Pure policy helper: what the orchestrator must do for each resolution kind.
 *
 * Stage 2B+ consults this to pick the next workflow phase without re-deriving the
 * governance rule at each call site.
 */
export const RESOLUTION_OUTCOME: Readonly<Record<StoryResolutionKind, "continue" | "ask-po">> = {
  resolved: "continue",
  "collision-detected": "ask-po",
  "retired-story": "ask-po",
  "not-found": "ask-po",
  ambiguous: "ask-po",
};
