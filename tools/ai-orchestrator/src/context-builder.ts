/**
 * Stage 2A — Context Package model.
 *
 * PURPOSE
 * -------
 * Define the shape of the prepared context that a future stage hands to OpenCode,
 * so the orchestrator can prove, on paper, that it *references* existing
 * governance rather than duplicating it.
 *
 * STAGE 2A HARD RULE
 * ------------------
 * This module does NOT read the Master Backlog, PO decision files, AGENTS.md,
 * DESIGN.md, or `.opencode/ai-workflow-rules.md`. `buildContextPackage()` returns
 * an empty, unloaded skeleton. Document loading is Stage 2B work.
 *
 * NON-DUPLICATION INVARIANTS
 * --------------------------
 * The orchestrator must never become a second source of product truth:
 *   - no acceptance criteria are stored here;
 *   - no PO decision is restated here;
 *   - no Epic formula (e.g. any topic-performance formula) is copied here;
 *   - no user story text is cached here as authority.
 * The Context Package carries *references* and a builder, never content.
 */

import type { GovernanceReferences } from "./config.js";
import { NotImplementedInStageError } from "./errors.js";
import { ContextBuilderImpl } from "./context-builder-impl.js";

/** Categories of context a future build step may need. */
export const CONTEXT_SECTION_KINDS = [
  "master-backlog",
  "user-story",
  "po-decisions",
  "architecture",
  "project-instructions",
  "stage-1-opencode-rules",
  "implementation-context",
  "test-requirements",
] as const;

export type ContextSectionKind = (typeof CONTEXT_SECTION_KINDS)[number];

/**
 * How authoritative a section is.
 *
 * - `authoritative` — the canonical document. Read, never restated.
 * - `derived`      — produced by a future builder from an authoritative document.
 * - `reference`    — background material for the agent.
 */
export type ContextAuthority = "authoritative" | "derived" | "reference";

export interface ContextSourceRef {
  /** Repository-relative path, when the section comes from a file. */
  readonly path: string | null;
  /** Section/heading within that file, when relevant (e.g. a backlog section). */
  readonly locator: string | null;
  readonly note: string | null;
}

export interface ContextSection {
  readonly kind: ContextSectionKind;
  readonly authority: ContextAuthority;
  readonly source: ContextSourceRef;
  /**
   * Loaded content. `null` in Stage 2A, always. A future stage may populate it
   * ONLY with text that was read from `source`, and never with invented content.
   */
  readonly content: string | null;
  /** Whether a future stage actually read this section. */
  readonly loaded: boolean;
  /** True when the section must exist for the story to proceed. */
  readonly required: boolean;
}

export interface ContextPackage {
  readonly packageId: string;
  readonly storyId: string | null;
  readonly epicId: string | null;
  readonly createdAt: string;
  readonly sections: readonly ContextSection[];
  /** Non-blocking observations a future builder wants a human to see. */
  readonly notes: readonly string[];
  /** True once a future stage has populated `content` for the required sections. */
  readonly complete: boolean;
}

export interface ContextRequest {
  readonly storyId: string | null;
  readonly epicId: string | null;
  /** Absolute path of the state directory; the package will be written there. */
  readonly stateDirectory: string;
  readonly governance: GovernanceReferences;
  /** Section kinds a caller needs. Empty means "the default set". */
  readonly requestedKinds: readonly ContextSectionKind[];
}

/**
 * Section kind -> default authority. Documents that are canonical stay
 * `authoritative` so a future implementation cannot silently downgrade them.
 */
export const DEFAULT_SECTION_AUTHORITY: Readonly<Record<ContextSectionKind, ContextAuthority>> = {
  "master-backlog": "authoritative",
  "user-story": "authoritative",
  "po-decisions": "authoritative",
  "stage-1-opencode-rules": "authoritative",
  "project-instructions": "authoritative",
  architecture: "reference",
  "implementation-context": "derived",
  "test-requirements": "derived",
};

export const CONTEXT_INVARIANTS: readonly string[] = Object.freeze([
  "The Context Package references governance documents; it never restates them.",
  "No acceptance criteria are embedded in the orchestrator.",
  "No PO decision is duplicated or paraphrased in the orchestrator.",
  "No Epic formula is copied into the orchestrator.",
  "Stage 2A loads no repository document content.",
  "The frozen Master Backlog is read-only and is never written by the orchestrator.",
]);

export interface ContextBuilder {
  /** Prepare the context package for one story. */
  build(request: ContextRequest): Promise<ContextPackage>;
  /** Names of section kinds this builder can produce. */
  capabilities(): readonly ContextSectionKind[];
}

/**
 * Stage 2A builder.
 *
 * Produces a structurally complete but entirely unloaded package. It is a real
 * implementation of the *shape*, not of document loading.
 */
export class Stage2AContextBuilder implements ContextBuilder {
  build(request: ContextRequest): Promise<ContextPackage> {
    const kinds =
      request.requestedKinds.length > 0
        ? [...new Set(request.requestedKinds)]
        : ([...CONTEXT_SECTION_KINDS] as ContextSectionKind[]);

    const sections: ContextSection[] = kinds.map((kind) => ({
      kind,
      authority: DEFAULT_SECTION_AUTHORITY[kind],
      source: {
        path: referencePathFor(kind, request.governance),
        locator: null,
        note: "Reference only. Stage 2A does not read this document.",
      },
      content: null,
      loaded: false,
      required: kind === "master-backlog" || kind === "user-story" || kind === "stage-1-opencode-rules",
    }));

    const createdAt = new Date().toISOString();
    const packageId = `ctx-${request.storyId ?? "unassigned"}-${createdAt.replace(/[:.]/g, "-")}`;

    const pkg: ContextPackage = {
      packageId,
      storyId: request.storyId,
      epicId: request.epicId,
      createdAt,
      sections,
      notes: [
        "Stage 2A skeleton: no repository document was read.",
        "A later stage must load content from source paths only, never invent it.",
      ],
      complete: false,
    };

    return Promise.resolve(pkg);
  }

  capabilities(): readonly ContextSectionKind[] {
    return CONTEXT_SECTION_KINDS;
  }
}

/** Stage 2C: real document loader. */
export function createContextBuilder(): ContextBuilder {
  return new ContextBuilderImpl();
}

/** Throwing placeholder for any attempt to read content in Stage 2A. */
export function loadSectionContent(): never {
  throw new NotImplementedInStageError("ContextBuilder.loadSectionContent", "Stage 2A", "Stage 2B");
}

function referencePathFor(kind: ContextSectionKind, governance: GovernanceReferences): string | null {
  switch (kind) {
    case "master-backlog":
      return governance.masterBacklogPath;
    case "po-decisions":
      return governance.poDecisionsDirectory;
    case "project-instructions":
      return governance.projectInstructionsPath;
    case "stage-1-opencode-rules":
      return governance.stage1OpenCodeRulesPath;
    case "user-story":
      // The user story lives inside the Master Backlog; resolved by story-resolver.ts.
      return governance.masterBacklogPath;
    case "architecture":
    case "implementation-context":
    case "test-requirements":
      return null;
    default:
      return null;
  }
}
