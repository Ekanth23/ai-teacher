import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../auth/middleware.js";
import { AuthorizationError, type AuthenticatedRequest } from "../../auth/organization.js";
import * as service from "./learning-resources/service.js";

const router = Router();

function param(value: string | string[]) {
  return typeof value === "string" ? value : "";
}

function userFor(req: Request) {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    throw new AuthorizationError("INVALID_TOKEN", "Authentication required.");
  }
  return user;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return { status: error.code === "INVALID_TOKEN" ? 401 : 403, payload: { error: { code: error.code, message: error.message } } };
  }

  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? "An unexpected error occurred.";
    if (code === "VALIDATION_ERROR") return { status: 400, payload: { error: { code, message } } };
    if (code === "NOT_FOUND") return { status: 404, payload: { error: { code, message } } };
    if (code === "23505") return { status: 409, payload: { error: { code: "DUPLICATE_RESOURCE", message: "A resource with the same identity already exists." } } };
  }

  console.error("Content API error:", error);
  return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "Failed to process content request." } } };
}

function handler(action: (req: Request) => Promise<unknown>, key?: string, status = 200) {
  return async (req: Request, res: Response) => {
    try {
      const result = await action(req);
      return res.status(status).json(key ? { [key]: result } : result);
    } catch (error) {
      const response = errorResponse(error);
      return res.status(response.status).json(response.payload);
    }
  };
}

router.get("/api/organizations/:organizationId/learning-resources", requireAuth, handler(async (req) => {
  const learningResources = await service.list(req, userFor(req), param(req.params.organizationId), {
    curriculumNodeId: typeof req.query.curriculum_node_id === "string" ? req.query.curriculum_node_id : undefined,
    classId: typeof req.query.class_id === "string" ? req.query.class_id : undefined,
    resourceType: typeof req.query.resource_type === "string" ? req.query.resource_type : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
  });
  return { learningResources, total: learningResources.length };
}));

router.post("/api/organizations/:organizationId/learning-resources", requireAuth, handler(
  (req) => service.create(req, userFor(req), param(req.params.organizationId), {
    curriculumNodeId: req.body?.curriculum_node_id,
    classId: req.body?.class_id,
    resourceType: req.body?.resource_type,
    title: req.body?.title,
    description: req.body?.description,
    languageCode: req.body?.language_code,
    fileUrl: req.body?.file_url,
    fileName: req.body?.file_name,
    mimeType: req.body?.mime_type,
    fileSizeBytes: req.body?.file_size_bytes,
    visibility: req.body?.visibility,
    metadata: req.body?.metadata,
  }),
  "learningResource",
  201
));

router.get("/api/learning-resources/:resourceId", requireAuth, handler(
  (req) => service.get(req, userFor(req), param(req.params.resourceId)),
  "learningResource"
));

router.patch("/api/learning-resources/:resourceId", requireAuth, handler(
  (req) => service.update(req, userFor(req), param(req.params.resourceId), {
    curriculumNodeId: req.body?.curriculum_node_id,
    classId: req.body?.class_id,
    resourceType: req.body?.resource_type,
    title: req.body?.title,
    description: req.body?.description,
    languageCode: req.body?.language_code,
    fileUrl: req.body?.file_url,
    fileName: req.body?.file_name,
    mimeType: req.body?.mime_type,
    fileSizeBytes: req.body?.file_size_bytes,
    visibility: req.body?.visibility,
    metadata: req.body?.metadata,
  }),
  "learningResource"
));

router.post("/api/learning-resources/:resourceId/publish", requireAuth, handler(
  (req) => service.publish(req, userFor(req), param(req.params.resourceId)),
  "learningResource"
));

router.post("/api/learning-resources/:resourceId/archive", requireAuth, handler(
  (req) => service.archive(req, userFor(req), param(req.params.resourceId)),
  "learningResource"
));

export default router;
