/**
 * Stage 2C — Real Story Resolver implementation.
 *
 * PURPOSE
 * -------
 * Resolve story IDs against the frozen Master Backlog. Section B is the only
 * authoritative story table. Section F is cross-checked for Draft 1.0 / Draft 2.0
 * ID collisions. Collisions are reported, never resolved.
 *
 * CONTRACT (Section 4.2, 5.1, 5.3)
 * ---------------------------------
 * - Story ID validated against `US-\d+`.
 * - Story text, title, status, notes from Master Backlog Section B.
 * - Section F cross-check for collision detection.
 * - Retired IDs are permanent and never reused.
 * - A story absent from Section B is never invented.
 *
 * STORY RESOLUTION PROCEDURE (from `.opencode/ai-workflow-rules.md` Section 3)
 * -----------------------------------------------------------------------------
 * 1. Resolve against Section B only.
 * 2. Check whether the same US-### also appears in Section F.
 * 3. If it does, state the collision explicitly and state which table the
 *    resolution came from.
 * 4. Never merge, reconcile, or resolve the collision yourself.
 */

import fs from "node:fs";
import path from "node:path";

import {
  AUTHORITATIVE_STORY_TABLE,
  COLLISION_TRACEABILITY_TABLE,
  type DraftIdCollision,
  type ResolvedStory,
  type StoryResolution,
  type StoryResolutionRequest,
  type StoryResolver,
} from "./story-resolver.js";

/** A parsed row from Section B (authoritative story table). */
interface SectionBRow {
  readonly epic: string;
  readonly usId: string;
  readonly title: string;
  readonly status: string;
  readonly notes: string;
}

/** A parsed row from Section F (collision traceability table). */
interface SectionFRow {
  readonly draft1Id: string;
  readonly draft1Story: string;
  readonly draft2Id: string;
  readonly draft2Epic: string;
  readonly disposition: string;
}

/** Retired story IDs that are permanent and never reused. */
const RETIRED_STORY_IDS = new Set([
  "US-037", "US-038", "US-039", "US-040", "US-041",
  "US-042", "US-043", "US-044", "US-045", "US-046",
  "US-084",
]);

/** Validate that a story ID matches the required format. */
function isValidStoryId(storyId: string): boolean {
  return /^US-\d+$/.test(storyId);
}

/** Normalize a story ID to uppercase for comparison. */
function normalizeStoryId(storyId: string): string {
  return storyId.trim().toUpperCase();
}

/** Check if a status indicates a retired/voided story. */
function isRetiredStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return normalized.includes("RETIRED") || normalized.includes("VOIDED");
}

/** Parse a markdown table row into cells. */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  const cells = trimmed
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  return cells;
}

/** Check if a line is a table separator row (e.g., |---|---|). */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const cells = trimmed.split("|").slice(1, -1);
  return cells.every((cell) => /^[-:]+$/.test(cell.trim()));
}

/** Check if a line is a table header row. */
function isTableHeader(line: string, headers: readonly string[]): boolean {
  const cells = parseTableRow(line);
  if (cells.length < headers.length) return false;
  return headers.every((header, index) => cells[index]?.toUpperCase().includes(header.toUpperCase()) ?? false);
}

/** Extract the section content between two section headers. */
function extractSection(content: string, sectionHeader: string, nextSectionHeader: string | null): string {
  const lines = content.split("\n");
  const sectionLines: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ") && trimmed.toUpperCase().includes(sectionHeader.toUpperCase())) {
      inSection = true;
      continue;
    }

    if (inSection && nextSectionHeader !== null && trimmed.startsWith("## ") && trimmed.toUpperCase().includes(nextSectionHeader.toUpperCase())) {
      break;
    }

    if (inSection && trimmed.startsWith("## ") && !trimmed.toUpperCase().includes(sectionHeader.toUpperCase())) {
      break;
    }

    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join("\n");
}

/** Parse Section B rows from the Master Backlog content. */
function parseSectionB(content: string): SectionBRow[] {
  const sectionContent = extractSection(content, "SECTION B", "SECTION C");
  const rows: SectionBRow[] = [];
  let inTable = false;

  for (const line of sectionContent.split("\n")) {
    const trimmed = line.trim();

    if (isTableHeader(trimmed, ["Epic", "US ID", "Story Title", "Status", "Notes"])) {
      inTable = true;
      continue;
    }

    if (inTable && isTableSeparator(trimmed)) {
      continue;
    }

    if (inTable && trimmed.startsWith("|")) {
      const cells = parseTableRow(trimmed);
      if (cells.length >= 5) {
        rows.push({
          epic: cells[0] ?? "",
          usId: normalizeStoryId(cells[1] ?? ""),
          title: cells[2] ?? "",
          status: cells[3] ?? "",
          notes: cells[4] ?? "",
        });
      }
    } else if (inTable && trimmed.length > 0 && !trimmed.startsWith("|")) {
      inTable = false;
    }
  }

  return rows;
}

/** Parse Section F rows from the Master Backlog content. */
function parseSectionF(content: string): SectionFRow[] {
  const sectionContent = extractSection(content, "SECTION F", "SECTION G");
  const rows: SectionFRow[] = [];
  let inTable = false;

  for (const line of sectionContent.split("\n")) {
    const trimmed = line.trim();

    if (isTableHeader(trimmed, ["Draft 1.0 ID", "Draft 1.0 Story", "Draft 2.0 ID", "Draft 2.0 Epic", "Disposition"])) {
      inTable = true;
      continue;
    }

    if (inTable && isTableSeparator(trimmed)) {
      continue;
    }

    if (inTable && trimmed.startsWith("|")) {
      const cells = parseTableRow(trimmed);
      if (cells.length >= 5) {
        rows.push({
          draft1Id: normalizeStoryId(cells[0] ?? ""),
          draft1Story: cells[1] ?? "",
          draft2Id: normalizeStoryId(cells[2] ?? ""),
          draft2Epic: cells[3] ?? "",
          disposition: cells[4] ?? "",
        });
      }
    } else if (inTable && trimmed.length > 0 && !trimmed.startsWith("|")) {
      inTable = false;
    }
  }

  return rows;
}

/** Check if a Section F row represents a collision (same ID, different story). */
function isCollisionRow(row: SectionFRow, sectionBRow: SectionBRow): boolean {
  // A collision exists when the Draft 1.0 ID matches the Section B US ID
  // but the story titles are different.
  if (row.draft1Id !== sectionBRow.usId) return false;
  // If the disposition is "PO DECISION REQUIRED", it's explicitly a collision
  if (row.disposition.toUpperCase().includes("PO DECISION REQUIRED")) return true;
  // If the Draft 1.0 story title is different from the Section B title, it's a collision
  if (row.draft1Story.trim() !== "" && row.draft1Story.trim() !== sectionBRow.title.trim()) return true;
  return false;
}

/**
 * Real Story Resolver implementation.
 *
 * Reads the Master Backlog from the configured path, resolves stories from
 * Section B, and cross-checks Section F for collisions.
 */
export class StoryResolverImpl implements StoryResolver {
  resolve(request: StoryResolutionRequest): Promise<StoryResolution> {
    const storyId = normalizeStoryId(request.storyId);

    if (!isValidStoryId(storyId)) {
      return Promise.resolve({
        kind: "not-found",
        storyId,
        message: `Invalid story ID format: "${request.storyId}". Expected format: US-###.`,
      });
    }

    let content: string;
    try {
      const resolvedPath = path.resolve(request.masterBacklogPath);
      content = fs.readFileSync(resolvedPath, "utf-8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return Promise.resolve({
        kind: "not-found",
        storyId,
        message: `Master Backlog could not be read: ${reason}`,
      });
    }

    const sectionBRows = parseSectionB(content);
    const sectionFRows = parseSectionF(content);

    // Find the story in Section B
    const matches = sectionBRows.filter((row) => row.usId === storyId);

    if (matches.length === 0) {
      // Check if it's a known retired ID
      if (RETIRED_STORY_IDS.has(storyId)) {
        return Promise.resolve({
          kind: "retired-story",
          storyId,
          message: `Story "${storyId}" is permanently retired and must never be reused.`,
        });
      }
      return Promise.resolve({
        kind: "not-found",
        storyId,
        message: `Story "${storyId}" was not found in ${AUTHORITATIVE_STORY_TABLE}. No story was invented.`,
      });
    }

    if (matches.length > 1) {
      const candidates: ResolvedStory[] = matches.map((row) => ({
        storyId: row.usId,
        epicId: row.epic,
        title: row.title,
        status: row.status,
        notes: row.notes || null,
        resolvedFrom: AUTHORITATIVE_STORY_TABLE,
      }));
      return Promise.resolve({
        kind: "ambiguous",
        storyId,
        candidates,
        message: `Story "${storyId}" has multiple entries in ${AUTHORITATIVE_STORY_TABLE}.`,
      });
    }

    const sectionBRow = matches[0];
    if (sectionBRow === undefined) {
      return Promise.resolve({
        kind: "not-found",
        storyId,
        message: `Story "${storyId}" was not found in ${AUTHORITATIVE_STORY_TABLE}.`,
      });
    }

    // Check if the story is retired
    if (isRetiredStatus(sectionBRow.status) || RETIRED_STORY_IDS.has(storyId)) {
      return Promise.resolve({
        kind: "retired-story",
        storyId,
        message: `Story "${storyId}" is permanently retired (status: ${sectionBRow.status}). Retired IDs must never be reused.`,
      });
    }

    // Check Section F for collisions
    const collisionRows = sectionFRows.filter((row) => row.draft1Id === storyId);
    const hasCollision = collisionRows.some((row) => isCollisionRow(row, sectionBRow));

    const resolvedStory: ResolvedStory = {
      storyId: sectionBRow.usId,
      epicId: sectionBRow.epic,
      title: sectionBRow.title,
      status: sectionBRow.status,
      notes: sectionBRow.notes || null,
      resolvedFrom: AUTHORITATIVE_STORY_TABLE,
    };

    if (hasCollision) {
      const collisionRow = collisionRows.find((row) => isCollisionRow(row, sectionBRow));
      const conflictingEntry: ResolvedStory = {
        storyId: collisionRow?.draft1Id ?? storyId,
        epicId: collisionRow?.draft2Epic ?? null,
        title: collisionRow?.draft1Story ?? null,
        status: collisionRow?.disposition ?? null,
        notes: null,
        resolvedFrom: COLLISION_TRACEABILITY_TABLE,
      };

      const collision: DraftIdCollision = {
        storyId,
        authoritativeEntry: resolvedStory,
        conflictingEntry,
        impliesDifferentWork: true,
        requiresPoDecision: true,
        message:
          `Draft 1.0 / Draft 2.0 ID collision detected for "${storyId}". ` +
          `Section B: "${sectionBRow.title}" (${sectionBRow.status}). ` +
          `Section F: "${collisionRow?.draft1Story ?? "unknown"}" (Draft 1.0). ` +
          `The collision implies different work. PO decision required.`,
      };

      return Promise.resolve({
        kind: "collision-detected",
        collision,
      });
    }

    return Promise.resolve({
      kind: "resolved",
      story: resolvedStory,
      collision: null,
    });
  }

  authoritativeSections(): readonly string[] {
    return [AUTHORITATIVE_STORY_TABLE, COLLISION_TRACEABILITY_TABLE, "SECTION C"];
  }
}

/**
 * Factory for the real Story Resolver.
 */
export function createRealStoryResolver(): StoryResolver {
  return new StoryResolverImpl();
}
