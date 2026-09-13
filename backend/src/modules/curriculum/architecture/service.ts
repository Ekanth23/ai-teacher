import { AuthorizationError, isValidUuid, resolveOrganizationContext } from "../../../auth/organization.js";
import type { Request } from "express";
import type { AuthenticatedUser } from "../../../auth/tokens.js";
import { getClassForUser } from "../service.js";
import * as repository from "./repository.js";
import type { LearningElementInput, MappingProfileInput, NodeInput, StructureInput, KnowledgeItemInput, PathwayRequirementInput } from "./types.js";

export class ArchitectureValidationError extends Error {
  code = "VALIDATION_ERROR";
}
type AccessMode = "read" | "manage";
async function ensureVersionAccess(req: Request, user: AuthenticatedUser, versionId: string, mode: AccessMode) {
  const result = await repository.getSyllabusVersionClassId(requiredUuid(versionId, "Syllabus version id"));
  if (result.rows.length === 0) throw new ArchitectureValidationError("Syllabus version was not found.");
  return getClassForUser(req, user, result.rows[0].class_id, mode);
}
async function ensureStructureAccess(req: Request, user: AuthenticatedUser, structureId: string, mode: AccessMode) {
  const result = await repository.getStructureClassId(requiredUuid(structureId, "Curriculum structure id"));
  if (result.rows.length === 0) throw new ArchitectureValidationError("Curriculum structure was not found.");
  return getClassForUser(req, user, result.rows[0].class_id, mode);
}
async function ensureNodeAccess(req: Request, user: AuthenticatedUser, nodeId: string, mode: AccessMode) {
  const result = await repository.getNodeClassId(requiredUuid(nodeId, "Node id"));
  if (result.rows.length === 0) throw new ArchitectureValidationError("Curriculum node was not found.");
  return getClassForUser(req, user, result.rows[0].class_id, mode);
}
function requireManagementRole(roleName: string) {
  if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(roleName)) {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to manage reference data.");
  }
}

function requiredUuid(value: string | null | undefined, field: string) {
  if (!value || !isValidUuid(value)) throw new ArchitectureValidationError(`${field} is invalid.`);
  return value.trim().toLowerCase();
}
function requiredText(value: string | null | undefined, field: string) {
  const normalized = value?.trim();
  if (!normalized) throw new ArchitectureValidationError(`${field} is required.`);
  return normalized;
}
export const listNodeTypes = async () => (await repository.listNodeTypes()).rows;
export const listElementTypes = async () => (await repository.listElementTypes()).rows;
async function ensureSubjectAssignedToClass(organizationId: string, classId: string, subjectId: string) {
  const normalizedSubjectId = requiredUuid(subjectId, "Subject id");
  const assignment = await repository.classHasSubject(organizationId, classId, normalizedSubjectId);
  if (assignment.rows.length === 0) {
    throw new ArchitectureValidationError("Subject is not assigned to this class.");
  }
  return normalizedSubjectId;
}

export async function createStructure(req: Request, user: AuthenticatedUser, input: StructureInput) {
  const name = requiredText(input.name, "Structure name");
  if (!["SYLLABUS", "TEXTBOOK"].includes(input.structureKind)) throw new ArchitectureValidationError("structureKind is invalid.");
  const syllabusVersionId = requiredUuid(input.syllabusVersionId, "Syllabus version id");
  const access = await ensureVersionAccess(req, user, syllabusVersionId, "manage");
  let subjectId: string | null = null;
  if (input.subjectId) {
    subjectId = await ensureSubjectAssignedToClass(access.organizationContext.organization.id, access.classRecord.id, input.subjectId);
  }
  return (await repository.createStructure({ ...input, syllabusVersionId, name, subjectId })).rows[0];
}

export async function setStructureSubject(req: Request, user: AuthenticatedUser, structureId: string, subjectId: string) {
  const normalizedStructureId = requiredUuid(structureId, "Structure id");
  const access = await ensureStructureAccess(req, user, normalizedStructureId, "manage");
  const normalizedSubjectId = await ensureSubjectAssignedToClass(access.organizationContext.organization.id, access.classRecord.id, subjectId);
  return (await repository.updateStructureSubject(normalizedStructureId, normalizedSubjectId)).rows[0];
}
export async function listStructures(req: Request, user: AuthenticatedUser, versionId: string) {
  const normalizedId = requiredUuid(versionId, "Syllabus version id");
  await ensureVersionAccess(req, user, normalizedId, "read");
  return (await repository.listStructures(normalizedId)).rows.filter((row) => row.syllabus_version_id === normalizedId);
}
export async function createNode(req: Request, user: AuthenticatedUser, input: NodeInput) {
  await ensureStructureAccess(req, user, input.curriculumStructureId, "manage");
  requiredUuid(input.nodeTypeId, "Node type id");
  if (input.parentNodeId) {
    const parentId = requiredUuid(input.parentNodeId, "Parent node id");
    const parent = await repository.getParentNodeStructureId(parentId);
    if (parent.rows.length === 0) throw new ArchitectureValidationError("Parent node was not found.");
    if (parent.rows[0].curriculum_structure_id !== input.curriculumStructureId) {
      throw new ArchitectureValidationError("Parent node must belong to the same curriculum structure.");
    }
  }
  const title = requiredText(input.title, "Node title");
  return (await repository.createNode({ ...input, title })).rows[0];
}
export async function listNodes(req: Request, user: AuthenticatedUser, structureId: string) {
  const normalizedId = requiredUuid(structureId, "Structure id");
  await ensureStructureAccess(req, user, normalizedId, "read");
  return (await repository.listNodes(normalizedId)).rows;
}
export async function createLearningElement(req: Request, user: AuthenticatedUser, input: LearningElementInput) {
  await ensureNodeAccess(req, user, input.curriculumNodeId, "manage");
  requiredUuid(input.elementTypeId, "Element type id");
  return (await repository.createLearningElement({ ...input, title: requiredText(input.title, "Element title") })).rows[0];
}
export const listKnowledgeItems = async () => (await repository.listKnowledgeItems()).rows;
export async function createKnowledgeItem(req: Request, user: AuthenticatedUser, input: KnowledgeItemInput) {
  requireManagementRole((await resolveOrganizationContext(req, user)).role.name);
  if (!["CONCEPT", "SKILL", "COMPETENCY", "LEARNING_OUTCOME"].includes(input.kind)) throw new ArchitectureValidationError("Knowledge kind is invalid.");
  const item = (await repository.createKnowledgeItem({ ...input, name: requiredText(input.name, "Knowledge item name") })).rows[0];
  for (const problemType of input.problemTypes ?? []) await repository.addProblemType(item.id, requiredText(problemType, "Problem type"));
  return item;
}
export async function addPrerequisite(req: Request, user: AuthenticatedUser, itemId: string, prerequisiteId: string) {
  const context = await resolveOrganizationContext(req, user);
  requireManagementRole(context.role.name);
  return (await repository.addPrerequisite(requiredUuid(itemId, "Knowledge item id"), requiredUuid(prerequisiteId, "Prerequisite id"))).rows[0];
}
export async function addProblemType(req: Request, user: AuthenticatedUser, itemId: string, problemType: string) {
  const context = await resolveOrganizationContext(req, user);
  requireManagementRole(context.role.name);
  return (await repository.addProblemType(requiredUuid(itemId, "Knowledge item id"), requiredText(problemType, "Problem type"))).rows[0];
}
export async function mapNodeKnowledge(req: Request, user: AuthenticatedUser, nodeId: string, itemId: string, coverageLevel = "PARTIAL", depth: number | null = null) {
  await ensureNodeAccess(req, user, nodeId, "manage");
  return (await repository.mapNodeKnowledge(requiredUuid(nodeId, "Node id"), requiredUuid(itemId, "Knowledge item id"), coverageLevel, depth)).rows[0];
}
export const listPathways = async () => (await repository.listPathways()).rows;
export const listPathwayVersions = async (pathwayId: string) => (await repository.listPathwayVersions(requiredUuid(pathwayId, "Pathway id"))).rows;
export const listPathwayStages = async (versionId: string) => (await repository.listPathwayStages(requiredUuid(versionId, "Pathway version id"))).rows;
export async function createPathwayRequirement(req: Request, user: AuthenticatedUser, input: PathwayRequirementInput) {
  requireManagementRole((await resolveOrganizationContext(req, user)).role.name);
  requiredUuid(input.targetPathwayVersionId, "Pathway version id");
  requiredUuid(input.knowledgeItemId, "Knowledge item id");
  if (input.targetPathwayStageId) {
    const stageId = requiredUuid(input.targetPathwayStageId, "Pathway stage id");
    const stage = await repository.getPathwayStageVersionId(stageId);
    if (stage.rows.length === 0) throw new ArchitectureValidationError("Pathway stage was not found.");
    if (stage.rows[0].target_pathway_version_id !== input.targetPathwayVersionId) {
      throw new ArchitectureValidationError("Pathway stage must belong to the same pathway version.");
    }
  }
  return (await repository.createPathwayRequirement(input)).rows[0];
}
export async function createMappingProfile(req: Request, user: AuthenticatedUser, input: MappingProfileInput) {
  const sourceVersionId = requiredUuid(input.sourceSyllabusVersionId, "Source syllabus version id");
  await ensureVersionAccess(req, user, sourceVersionId, "manage");
  if (input.targetType === "CURRICULUM") {
    const targetVersionId = requiredUuid(input.targetSyllabusVersionId, "Target syllabus version id");
    await ensureVersionAccess(req, user, targetVersionId, "manage");
    if (input.targetPathwayVersionId) throw new ArchitectureValidationError("A curriculum mapping cannot include a pathway target.");
  } else if (input.targetType === "PATHWAY") {
    requiredUuid(input.targetPathwayVersionId, "Target pathway version id");
    if (input.targetSyllabusVersionId) throw new ArchitectureValidationError("A pathway mapping cannot include a syllabus target.");
  } else throw new ArchitectureValidationError("Target type is invalid.");
  return (await repository.createMappingProfile({ ...input, sourceSyllabusVersionId: sourceVersionId })).rows[0];
}
export async function listMappingProfiles(req: Request, user: AuthenticatedUser) {
  const context = await resolveOrganizationContext(req, user);
  return (await repository.listMappingProfiles(context.organization.id, user.id, context.role.name)).rows;
}
