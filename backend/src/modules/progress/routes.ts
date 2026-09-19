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

  console.error("Progress API error:", error);
  return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "Failed to load progress." } } };
}

function handler(action: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      return res.status(200).json(await action(req));
    } catch (error) {
      const response = errorResponse(error);
      return res.status(response.status).json(response.payload);
    }
  };
}

// Student: own derived progress (US-097/US-098/US-099).
router.get("/api/student/progress", requireAuth, handler(async (req) => {
  return service.getOwnProgress(req, userFor(req));
}));

// Staff: one student's derived progress within the organization.
router.get("/api/organizations/:organizationId/students/:studentId/progress", requireAuth, handler(async (req) => {
  return service.getStudentProgress(req, userFor(req), param(req.params.organizationId), param(req.params.studentId));
}));

// Student: own homework performance (US-100: completion + timeliness states).
router.get("/api/student/homework-performance", requireAuth, handler(async (req) => {
  return service.getOwnHomework(req, userFor(req));
}));

// Staff: one student's homework performance within the organization.
router.get("/api/organizations/:organizationId/students/:studentId/homework-performance", requireAuth, handler(async (req) => {
  return service.getStudentHomework(req, userFor(req), param(req.params.organizationId), param(req.params.studentId));
}));

// Student: own assessment performance (US-101: separate individual results).
router.get("/api/student/assessment-performance", requireAuth, handler(async (req) => {
  return service.getOwnAssessmentPerformance(req, userFor(req));
}));

// Staff: one student's assessment performance within the organization.
router.get("/api/organizations/:organizationId/students/:studentId/assessment-performance", requireAuth, handler(async (req) => {
  return service.getStudentAssessmentPerformance(req, userFor(req), param(req.params.organizationId), param(req.params.studentId));
}));

// Student: own weak topics (US-102: performance < 60% with >= 10 answered responses).
router.get("/api/student/weak-topics", requireAuth, handler(async (req) => {
  return service.getOwnWeakTopics(req, userFor(req));
}));

// Staff: one student's weak topics within the organization.
router.get("/api/organizations/:organizationId/students/:studentId/weak-topics", requireAuth, handler(async (req) => {
  return service.getStudentWeakTopics(req, userFor(req), param(req.params.organizationId), param(req.params.studentId));
}));

// Student: own strong topics (US-103: performance >= 90% with >= 10 answered responses).
router.get("/api/student/strong-topics", requireAuth, handler(async (req) => {
  return service.getOwnStrongTopics(req, userFor(req));
}));

// Staff: one student's strong topics within the organization.
router.get("/api/organizations/:organizationId/students/:studentId/strong-topics", requireAuth, handler(async (req) => {
  return service.getStudentStrongTopics(req, userFor(req), param(req.params.organizationId), param(req.params.studentId));
}));

// Student: own unfinished learning (US-104: topic coverage COMPLETED/UNFINISHED).
router.get("/api/student/unfinished-learning", requireAuth, handler(async (req) => {
  return service.getOwnUnfinishedLearning(req, userFor(req));
}));

// Staff: one student's unfinished learning within the organization.
router.get("/api/organizations/:organizationId/students/:studentId/unfinished-learning", requireAuth, handler(async (req) => {
  return service.getStudentUnfinishedLearning(req, userFor(req), param(req.params.organizationId), param(req.params.studentId));
}));

// Student: own repeated mistakes (US-105: same primary concept across questions/attempts).
router.get("/api/student/repeated-mistakes", requireAuth, handler(async (req) => {
  return service.getOwnRepeatedMistakes(req, userFor(req));
}));

// Staff: one student's repeated mistakes within the organization.
router.get("/api/organizations/:organizationId/students/:studentId/repeated-mistakes", requireAuth, handler(async (req) => {
  return service.getStudentRepeatedMistakes(req, userFor(req), param(req.params.organizationId), param(req.params.studentId));
}));

// Student: own learning profile (US-106: composition of US-097-105 outputs).
router.get("/api/student/learning-profile", requireAuth, handler(async (req) => {
  return service.getOwnLearningProfile(req, userFor(req));
}));

// Staff: one student's learning profile within the organization.
router.get("/api/organizations/:organizationId/students/:studentId/learning-profile", requireAuth, handler(async (req) => {
  return service.getStudentLearningProfile(req, userFor(req), param(req.params.organizationId), param(req.params.studentId));
}));

export default router;
