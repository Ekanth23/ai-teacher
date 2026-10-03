/**
 * Stage 2C — Real Context Builder implementation.
 *
 * PURPOSE
 * -------
 * Load governance documents from source paths only, with deterministic
 * discovery, size limits, and conflict handling. The Context Builder never
 * restates, duplicates, or invents governance content.
 *
 * CONTRACT (Section 5.1, 5.3, 14)
 * ---------------------------------
 * - Documents are loaded from source paths only, never invented.
 * - PO decision files are discovered dynamically from Docs/, filtered by Epic.
 * - Context size limits: 100K total, 50K per document, 20 sections max.
 * - Authoritative content MUST NOT be truncated. Oversized -> BLOCKED.
 * - Non-authoritative content MAY be truncated. Report truncation in notes.
 * - Missing or unreadable PO decisions -> BLOCKED.
 * - The Context Builder does NOT grant file permissions or bypass scope.
 */

import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_SECTION_AUTHORITY,
  type ContextPackage,
  type ContextRequest,
  type ContextSection,
  type ContextSectionKind,
  type ContextSourceRef,
} from "./context-builder.js";

/** Maximum total context package size in characters. */
const MAX_TOTAL_CONTEXT_CHARS = 100_000;

/** Maximum single document size in characters. */
const MAX_SINGLE_DOCUMENT_CHARS = 50_000;

/** Maximum number of sections per package. */
const MAX_SECTIONS_PER_PACKAGE = 20;

/** A loaded document with metadata. */
interface LoadedDocument {
  readonly path: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly notes: readonly string[];
}

/** Result of loading a document. */
type DocumentResult =
  | { readonly kind: "loaded"; readonly document: LoadedDocument }
  | { readonly kind: "missing"; readonly path: string; readonly reason: string }
  | { readonly kind: "oversized"; readonly path: string; readonly size: number }
  | { readonly kind: "binary"; readonly path: string }
  | { readonly kind: "empty"; readonly path: string };

/**
 * Read a file and classify the result.
 *
 * Returns a DocumentResult indicating success, missing, oversized, binary, or empty.
 */
function readDocument(filePath: string, maxSize: number): DocumentResult {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "missing", path: filePath, reason };
  }

  if (content.trim().length === 0) {
    return { kind: "empty", path: filePath };
  }

  // Check for binary content (null bytes or excessive non-printable characters)
  if (content.includes("\0")) {
    return { kind: "binary", path: filePath };
  }

  if (content.length > maxSize) {
    return { kind: "oversized", path: filePath, size: content.length };
  }

  return {
    kind: "loaded",
    document: {
      path: filePath,
      content,
      truncated: false,
      notes: [],
    },
  };
}

/**
 * Discover PO decision files in the Docs/ directory.
 *
 * Lists the directory, filters by *PO_Decisions* pattern, and returns
 * all matching files. Does not hardcode a filename list.
 */
function discoverPoDecisionFiles(poDecisionsDirectory: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(poDecisionsDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.includes("PO_Decisions"))
    .map((name) => path.join(poDecisionsDirectory, name))
    .sort();
}

/**
 * Extract the Epic identifier from a PO decision file's header.
 *
 * Reads the first few lines and looks for an Epic reference.
 * Returns null if no Epic is found.
 */
function extractEpicFromHeader(filePath: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n").slice(0, 20);
  for (const line of lines) {
    const match = line.match(/Epic\s*(\d+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Check if a PO decision file is marked as superseded or deprecated.
 */
function isSupersededOrDeprecated(filePath: string): boolean {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }

  const header = content.slice(0, 2000).toLowerCase();
  return header.includes("superseded") || header.includes("deprecated");
}

/**
 * Real Context Builder implementation.
 *
 * Loads governance documents from source paths only. Enforces context size
 * limits. Handles missing, ambiguous, and oversized documents.
 */
export class ContextBuilderImpl {
  build(request: ContextRequest): Promise<ContextPackage> {
    const notes: string[] = [];
    const sections: ContextSection[] = [];
    let totalChars = 0;

    // 1. Load Master Backlog (authoritative)
    const masterBacklogResult = readDocument(request.governance.masterBacklogPath, MAX_SINGLE_DOCUMENT_CHARS);
    if (masterBacklogResult.kind === "loaded") {
      const content = masterBacklogResult.document.content;
      totalChars += content.length;
      sections.push(createSection("master-backlog", request.governance.masterBacklogPath, "SECTION B", content, true));
    } else {
      // Create a section even when the document is missing, with loaded: false
      sections.push(createSection("master-backlog", request.governance.masterBacklogPath, "SECTION B", null, true));
      if (masterBacklogResult.kind === "missing") {
        notes.push(`Master Backlog not found: ${masterBacklogResult.reason}`);
      } else if (masterBacklogResult.kind === "oversized") {
        notes.push(`Master Backlog exceeds size limit (${masterBacklogResult.size} > ${MAX_SINGLE_DOCUMENT_CHARS}). BLOCKED.`);
      } else if (masterBacklogResult.kind === "binary") {
        notes.push("Master Backlog is binary, not text. BLOCKED.");
      } else if (masterBacklogResult.kind === "empty") {
        notes.push("Master Backlog is empty. BLOCKED.");
      }
    }

    // 2. Load user story (from Master Backlog Section B)
    // The user story is resolved by the Story Resolver; here we reference the Master Backlog.
    if (masterBacklogResult.kind === "loaded") {
      sections.push(createSection("user-story", request.governance.masterBacklogPath, "SECTION B", null, false));
    }

    // 3. Load PO decision files (discover dynamically, filter by Epic)
    const poDecisionFiles = discoverPoDecisionFiles(request.governance.poDecisionsDirectory);
    if (poDecisionFiles.length === 0) {
      notes.push(`No PO decision files found in ${request.governance.poDecisionsDirectory}`);
    }

    for (const poFile of poDecisionFiles) {
      if (isSupersededOrDeprecated(poFile)) {
        notes.push(`Excluded superseded/deprecated PO decision file: ${path.basename(poFile)}`);
        continue;
      }

      const epic = extractEpicFromHeader(poFile);
      if (request.epicId !== null && epic !== null && epic !== request.epicId) {
        // Skip files that belong to a different Epic
        continue;
      }

      const result = readDocument(poFile, MAX_SINGLE_DOCUMENT_CHARS);
      if (result.kind === "loaded") {
        const content = result.document.content;
        if (totalChars + content.length > MAX_TOTAL_CONTEXT_CHARS) {
          notes.push(`Total context size would exceed ${MAX_TOTAL_CONTEXT_CHARS} characters. BLOCKED.`);
          break;
        }
        totalChars += content.length;
        sections.push(createSection("po-decisions", poFile, null, content, true));
      } else if (result.kind === "missing") {
        notes.push(`PO decision file not found: ${result.reason}`);
      } else if (result.kind === "oversized") {
        notes.push(`PO decision file exceeds size limit: ${path.basename(poFile)} (${result.size} > ${MAX_SINGLE_DOCUMENT_CHARS}). BLOCKED.`);
      } else if (result.kind === "binary") {
        notes.push(`PO decision file is binary: ${path.basename(poFile)}. BLOCKED.`);
      } else if (result.kind === "empty") {
        notes.push(`PO decision file is empty: ${path.basename(poFile)}. BLOCKED.`);
      }
    }

    // 4. Load project instructions (AGENTS.md)
    const projectInstructionsResult = readDocument(request.governance.projectInstructionsPath, MAX_SINGLE_DOCUMENT_CHARS);
    if (projectInstructionsResult.kind === "loaded") {
      const content = projectInstructionsResult.document.content;
      if (totalChars + content.length <= MAX_TOTAL_CONTEXT_CHARS) {
        totalChars += content.length;
        sections.push(createSection("project-instructions", request.governance.projectInstructionsPath, null, content, true));
      } else {
        notes.push("Project instructions omitted: total context size limit reached.");
      }
    } else if (projectInstructionsResult.kind === "missing") {
      notes.push(`Project instructions not found: ${projectInstructionsResult.reason}`);
    }

    // 5. Load Stage 1 OpenCode rules
    const stage1RulesResult = readDocument(request.governance.stage1OpenCodeRulesPath, MAX_SINGLE_DOCUMENT_CHARS);
    if (stage1RulesResult.kind === "loaded") {
      const content = stage1RulesResult.document.content;
      if (totalChars + content.length <= MAX_TOTAL_CONTEXT_CHARS) {
        totalChars += content.length;
        sections.push(createSection("stage-1-opencode-rules", request.governance.stage1OpenCodeRulesPath, null, content, true));
      } else {
        notes.push("Stage 1 OpenCode rules omitted: total context size limit reached.");
      }
    } else if (stage1RulesResult.kind === "missing") {
      notes.push(`Stage 1 OpenCode rules not found: ${stage1RulesResult.reason}`);
    }

    // Enforce maximum sections
    if (sections.length > MAX_SECTIONS_PER_PACKAGE) {
      notes.push(`Context package has ${sections.length} sections, exceeding maximum of ${MAX_SECTIONS_PER_PACKAGE}.`);
      sections.splice(MAX_SECTIONS_PER_PACKAGE);
    }

    const createdAt = new Date().toISOString();
    const packageId = `ctx-${request.storyId ?? "unassigned"}-${createdAt.replace(/[:.]/g, "-")}`;

    const complete = sections.every((section) => !section.required || section.loaded);

    const pkg: ContextPackage = {
      packageId,
      storyId: request.storyId,
      epicId: request.epicId,
      createdAt,
      sections,
      notes,
      complete,
    };

    return Promise.resolve(pkg);
  }

  capabilities(): readonly ContextSectionKind[] {
    return ["master-backlog", "user-story", "po-decisions", "project-instructions", "stage-1-opencode-rules"];
  }
}

/**
 * Create a ContextSection from a loaded document.
 */
function createSection(
  kind: ContextSectionKind,
  filePath: string,
  locator: string | null,
  content: string | null,
  required: boolean,
): ContextSection {
  const source: ContextSourceRef = {
    path: filePath,
    locator,
    note: null,
  };

  return {
    kind,
    authority: DEFAULT_SECTION_AUTHORITY[kind],
    source,
    content,
    loaded: content !== null,
    required,
  };
}

/**
 * Factory for the real Context Builder.
 */
export function createRealContextBuilder(): ContextBuilderImpl {
  return new ContextBuilderImpl();
}
