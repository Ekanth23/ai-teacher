import { isValidUuid } from "../../../auth/organization.js";
import type { Request } from "express";
import type { AuthenticatedUser } from "../../../auth/tokens.js";
import { getClassForUser } from "../service.js";
import * as repository from "./repository.js";
import type { ChapterOrTopicNode, CreateChapterOrTopicInput, UpdateChapterOrTopicInput } from "./types.js";

export class ChapterValidationError extends Error {
  code = "VALIDATION_ERROR";
}

const notFound = (name: string) => {
  const error = new ChapterValidationError(`${name} was not found.`);
  error.code = "NOT_FOUND";
  return error;
};

function requiredUuid(value: string | null | undefined, field: string) {
  if (!value || !isValidUuid(value)) throw new ChapterValidationError(`${field} is invalid.`);
  return value.trim();
}

function requiredText(value: string | null | undefined, field: string) {
  const normalized = value?.trim();
  if (!normalized) throw new ChapterValidationError(`${field} is required.`);
  return normalized;
}

function validateNodeInput(input: CreateChapterOrTopicInput | UpdateChapterOrTopicInput, options: { partial?: boolean } = {}) {
  if (!options.partial || input.title !== undefined) requiredText(input.title, "Title");
  if (input.sequenceNumber !== undefined && input.sequenceNumber !== null) {
    if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 0) {
      throw new ChapterValidationError("Sequence number is invalid.");
    }
  }
  if ("status" in input && input.status !== undefined && !["ACTIVE", "INACTIVE"].includes(input.status)) {
    throw new ChapterValidationError("Status must be ACTIVE or INACTIVE.");
  }
}

async function ensureStructureAccess(req: Request, user: AuthenticatedUser, structureId: string, mode: "read" | "manage") {
  const normalized = requiredUuid(structureId, "Structure id");
  const result = await repository.getStructureClassId(normalized);
  if (result.rows.length === 0) throw notFound("Curriculum structure");
  await getClassForUser(req, user, result.rows[0].class_id, mode);
  return { structureId: normalized, subjectId: (result.rows[0].subject_id as string | null) ?? null };
}

function requireSubjectLinked(subjectId: string | null, label: string) {
  if (!subjectId) {
    throw new ChapterValidationError(
      `Curriculum structure must be linked to a subject before ${label} can be added. Set a subject via PATCH /api/curriculum/structures/:structureId/subject.`
    );
  }
}

async function loadNodeOfType(nodeId: string, expectedTypeCode: string, label: string): Promise<ChapterOrTopicNode> {
  const normalized = requiredUuid(nodeId, `${label} id`);
  const result = await repository.getNodeDetail(normalized);
  if (result.rows.length === 0 || String(result.rows[0].node_type_code).toUpperCase() !== expectedTypeCode) {
    throw notFound(label);
  }
  return result.rows[0];
}

async function ensureNodeAccess(req: Request, user: AuthenticatedUser, node: ChapterOrTopicNode, mode: "read" | "manage") {
  const structureResult = await repository.getStructureClassId(node.curriculum_structure_id);
  if (structureResult.rows.length === 0) throw notFound("Curriculum structure");
  await getClassForUser(req, user, structureResult.rows[0].class_id, mode);
}

async function requireNodeType(code: string, label: string) {
  const result = await repository.getNodeTypeIdByCode(code);
  if (result.rows.length === 0) throw notFound(`${label} node type`);
  return result.rows[0];
}

export async function listChapters(req: Request, user: AuthenticatedUser, structureId: string) {
  const { structureId: normalized } = await ensureStructureAccess(req, user, structureId, "read");
  return (await repository.listChildNodesByType(normalized, "CHAPTER", null)).rows;
}

export async function createChapter(req: Request, user: AuthenticatedUser, structureId: string, input: CreateChapterOrTopicInput) {
  validateNodeInput(input);
  const { structureId: normalized, subjectId } = await ensureStructureAccess(req, user, structureId, "manage");
  requireSubjectLinked(subjectId, "chapters");
  const nodeType = await requireNodeType("CHAPTER", "Chapter");
  return (
    await repository.createNode({
      curriculumStructureId: normalized,
      parentNodeId: null,
      nodeTypeId: nodeType.id,
      title: requiredText(input.title, "Title"),
      code: input.code ?? null,
      sequenceNumber: input.sequenceNumber ?? null,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
    })
  ).rows[0];
}

export async function getChapter(req: Request, user: AuthenticatedUser, chapterId: string) {
  const node = await loadNodeOfType(chapterId, "CHAPTER", "Chapter");
  await ensureNodeAccess(req, user, node, "read");
  return node;
}

export async function updateChapter(req: Request, user: AuthenticatedUser, chapterId: string, input: UpdateChapterOrTopicInput) {
  validateNodeInput(input, { partial: true });
  const node = await loadNodeOfType(chapterId, "CHAPTER", "Chapter");
  await ensureNodeAccess(req, user, node, "manage");
  return (await repository.updateNode(node.id, input)).rows[0];
}

export async function listTopics(req: Request, user: AuthenticatedUser, chapterId: string) {
  const chapter = await loadNodeOfType(chapterId, "CHAPTER", "Chapter");
  await ensureNodeAccess(req, user, chapter, "read");
  return (await repository.listChildNodesByType(chapter.curriculum_structure_id, "TOPIC", chapter.id)).rows;
}

export async function createTopic(req: Request, user: AuthenticatedUser, chapterId: string, input: CreateChapterOrTopicInput) {
  validateNodeInput(input);
  const chapter = await loadNodeOfType(chapterId, "CHAPTER", "Chapter");
  await ensureNodeAccess(req, user, chapter, "manage");
  requireSubjectLinked(chapter.subject_id, "topics");
  const nodeType = await requireNodeType("TOPIC", "Topic");
  return (
    await repository.createNode({
      curriculumStructureId: chapter.curriculum_structure_id,
      parentNodeId: chapter.id,
      nodeTypeId: nodeType.id,
      title: requiredText(input.title, "Title"),
      code: input.code ?? null,
      sequenceNumber: input.sequenceNumber ?? null,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
    })
  ).rows[0];
}

export async function getTopic(req: Request, user: AuthenticatedUser, topicId: string) {
  const node = await loadNodeOfType(topicId, "TOPIC", "Topic");
  await ensureNodeAccess(req, user, node, "read");
  return node;
}

export async function updateTopic(req: Request, user: AuthenticatedUser, topicId: string, input: UpdateChapterOrTopicInput) {
  validateNodeInput(input, { partial: true });
  const node = await loadNodeOfType(topicId, "TOPIC", "Topic");
  await ensureNodeAccess(req, user, node, "manage");
  return (await repository.updateNode(node.id, input)).rows[0];
}
