import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../auth/middleware.js";
import { AuthorizationError, type AuthenticatedRequest } from "../../auth/organization.js";
import * as service from "./service.js";

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
  }

  console.error("Student API error:", error);
  return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "Failed to process student request." } } };
}

function handler(action: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const result = await action(req);
      return res.status(200).json(result);
    } catch (error) {
      const response = errorResponse(error);
      return res.status(response.status).json(response.payload);
    }
  };
}

router.get("/api/student/current-enrollment", requireAuth, handler(async (req) => {
  return service.getCurrentEnrollment(req, userFor(req));
}));

router.get("/api/student/enrollments", requireAuth, handler(async (req) => {
  const enrollments = await service.listEnrollments(req, userFor(req));
  return { enrollments, total: enrollments.length };
}));

router.put("/api/student/current-enrollment", requireAuth, handler(async (req) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : {};
  const enrollmentId = typeof body.enrollment_id === "string"
    ? body.enrollment_id
    : typeof body.enrollmentId === "string"
      ? body.enrollmentId
      : typeof body.current_enrollment_id === "string"
        ? body.current_enrollment_id
        : "";
  return service.selectCurrentEnrollment(req, userFor(req), enrollmentId);
}));

router.patch("/api/student/current-enrollment", requireAuth, handler(async (req) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : {};
  const enrollmentId = typeof body.enrollment_id === "string"
    ? body.enrollment_id
    : typeof body.enrollmentId === "string"
      ? body.enrollmentId
      : typeof body.current_enrollment_id === "string"
        ? body.current_enrollment_id
        : "";
  return service.selectCurrentEnrollment(req, userFor(req), enrollmentId);
}));

router.get("/api/student/classes", requireAuth, handler(async (req) => {
  const classes = await service.listClasses(req, userFor(req));
  return { classes, total: classes.length };
}));

router.get("/api/student/classes/:classId/subjects", requireAuth, handler(async (req) => {
  const subjects = await service.listClassSubjects(req, userFor(req), param(req.params.classId));
  return { subjects, total: subjects.length };
}));

router.get("/api/student/dashboard", requireAuth, handler((req) => service.getDashboard(req, userFor(req))));

export default router;
