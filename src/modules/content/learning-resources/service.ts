import type { Request } from "express";
import type { AuthenticatedUser } from "../../../auth/tokens.js";
import { AuthorizationError, resolveOrganizationContext } from "../../../auth/organization.js";
import * as repository from "./repository.js";
import { LearningResourceValidationError, requiredUuid, validateCreateInput, validateUpdateInput } from "./validation.js";
import type { CreateLearningResourceInput, ListLearningResourceFilters, UpdateLearningResourceInput } from "./types.js";

const CONTRIBUTOR_ROLES = new Set(["SCHOOL_ADMIN", "COACHING_ADMIN", "TEACHER"]);
const APPROVER_ROLES = new Set(["SCHOOL_ADMIN", "COACHING_ADMIN"]);

const notFound = (name: string) => {
  const error = new LearningResourceValidationError(`${name} was not found.`);
  error.code = "NOT_FOUND";
  return error;
};

function requireContributor(role: string) {
  if (!CONTRIBUTOR_ROLES.has(role)) {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to manage learning resources.");
  }
}

function requireApprover(role: string) {
  if (!APPROVER_ROLES.has(role)) {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to publish or archive learning resources.");
  }
}

async function ensureNodeInOrganization(nodeId: string, organizationId: string) {
  const result = await repository.nodeOrganization(nodeId);
  if (result.rows.length === 0 || result.rows[0].organization_id !== organizationId) {
    throw new LearningResourceValidationError("Curriculum node does not belong to this organization.");
  }
}

async function ensureClassInOrganization(classId: string, organizationId: string) {
  const result = await repository.classInOrganization(classId, organizationId);
  if (result.rows.length === 0) {
    throw new LearningResourceValidationError("Class does not belong to this organization.");
  }
}

async function ensureTeacherClassAccess(classId: string, organizationId: string, user: AuthenticatedUser) {
  const result = await repository.teacherAssignedToClass(classId, organizationId, user.id);
  if (result.rows.length === 0) {
    throw new AuthorizationError("ROLE_REQUIRED", "You are not authorized to manage resources for this class.");
  }
}

async function ensureTeacherResourceAccess(
  resource: { created_by_user_id: string; class_id: string | null },
  organizationId: string,
  user: AuthenticatedUser
) {
  if (resource.created_by_user_id === user.id) return;
  if (!resource.class_id) {
    throw new AuthorizationError("ROLE_REQUIRED", "You are not authorized to manage this learning resource.");
  }
  await ensureTeacherClassAccess(resource.class_id, organizationId, user);
}

export async function list(req: Request, user: AuthenticatedUser, organizationId: string, filters: ListLearningResourceFilters) {
  const context = await resolveOrganizationContext(req, user, organizationId);
  if (filters.curriculumNodeId) requiredUuid(filters.curriculumNodeId, "Curriculum node id");
  if (filters.classId) requiredUuid(filters.classId, "Class id");
  const isContributor = CONTRIBUTOR_ROLES.has(context.role.name);
  return (
    await repository.listResources({
      organizationId: context.organization.id,
      userId: user.id,
      isContributor,
      isTeacher: context.role.name === "TEACHER",
      curriculumNodeId: filters.curriculumNodeId,
      classId: filters.classId,
      resourceType: filters.resourceType,
      status: filters.status,
    })
  ).rows;
}

export async function get(req: Request, user: AuthenticatedUser, resourceId: string) {
  const normalized = requiredUuid(resourceId, "Learning resource id");
  const resource = (await repository.getResource(normalized)).rows[0];
  if (!resource) throw notFound("Learning resource");

  const context = await resolveOrganizationContext(req, user, resource.organization_id);
  if (context.role.name === "SCHOOL_ADMIN" || context.role.name === "COACHING_ADMIN") return resource;
  if (context.role.name === "TEACHER") {
    await ensureTeacherResourceAccess(resource, resource.organization_id, user);
    return resource;
  }

  if (resource.status !== "PUBLISHED") {
    throw new AuthorizationError("ROLE_REQUIRED", "You are not authorized to view this learning resource.");
  }
  if (resource.visibility === "PRIVATE" && resource.created_by_user_id !== user.id) {
    throw new AuthorizationError("ROLE_REQUIRED", "You are not authorized to view this learning resource.");
  }
  if (resource.visibility === "CLASS") {
    if (!resource.class_id) throw new AuthorizationError("ROLE_REQUIRED", "You are not authorized to view this learning resource.");
    const membership = await repository.isClassMember(resource.class_id, user.id, resource.organization_id);
    if (membership.rows.length === 0) {
      throw new AuthorizationError("ROLE_REQUIRED", "You are not authorized to view this learning resource.");
    }
  }
  return resource;
}

export async function create(req: Request, user: AuthenticatedUser, organizationId: string, input: CreateLearningResourceInput) {
  validateCreateInput(input);
  const context = await resolveOrganizationContext(req, user, organizationId);
  requireContributor(context.role.name);
  if (input.curriculumNodeId) await ensureNodeInOrganization(input.curriculumNodeId, context.organization.id);
  if (input.classId) await ensureClassInOrganization(input.classId, context.organization.id);
  if (context.role.name === "TEACHER" && input.classId) {
    await ensureTeacherClassAccess(input.classId, context.organization.id, user);
  }
  return (
    await repository.createResource({
      ...input,
      organizationId: context.organization.id,
      createdByUserId: user.id,
      title: input.title.trim(),
      fileUrl: input.fileUrl.trim(),
    })
  ).rows[0];
}

export async function update(req: Request, user: AuthenticatedUser, resourceId: string, input: UpdateLearningResourceInput) {
  validateUpdateInput(input);
  const normalized = requiredUuid(resourceId, "Learning resource id");
  const resource = (await repository.getResource(normalized)).rows[0];
  if (!resource) throw notFound("Learning resource");

  const context = await resolveOrganizationContext(req, user, resource.organization_id);
  requireContributor(context.role.name);
  if (resource.status === "ARCHIVED") {
    throw new LearningResourceValidationError("Archived learning resources cannot be modified.");
  }
  if (context.role.name === "TEACHER") {
    await ensureTeacherResourceAccess(resource, resource.organization_id, user);
  }
  if (input.curriculumNodeId) await ensureNodeInOrganization(input.curriculumNodeId, context.organization.id);
  if (input.classId) await ensureClassInOrganization(input.classId, context.organization.id);
  return (await repository.updateResource(resource.id, input)).rows[0];
}

export async function publish(req: Request, user: AuthenticatedUser, resourceId: string) {
  const normalized = requiredUuid(resourceId, "Learning resource id");
  const resource = (await repository.getResource(normalized)).rows[0];
  if (!resource) throw notFound("Learning resource");

  const context = await resolveOrganizationContext(req, user, resource.organization_id);
  requireApprover(context.role.name);
  if (!["DRAFT", "PENDING_APPROVAL"].includes(resource.status)) {
    throw new LearningResourceValidationError(`Invalid learning resource lifecycle transition: ${resource.status} -> PUBLISHED`);
  }
  return (await repository.setStatus(resource.id, "PUBLISHED", user.id)).rows[0];
}

export async function archive(req: Request, user: AuthenticatedUser, resourceId: string) {
  const normalized = requiredUuid(resourceId, "Learning resource id");
  const resource = (await repository.getResource(normalized)).rows[0];
  if (!resource) throw notFound("Learning resource");

  const context = await resolveOrganizationContext(req, user, resource.organization_id);
  requireApprover(context.role.name);
  if (resource.status === "ARCHIVED") {
    throw new LearningResourceValidationError("Learning resource is already archived.");
  }
  return (await repository.setStatus(resource.id, "ARCHIVED")).rows[0];
}
