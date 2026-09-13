import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../auth/middleware.js";
import { AuthorizationError, type AuthenticatedRequest } from "../../auth/organization.js";
import * as attemptService from "./attempt.service.js";

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

  console.error("Student practice API error:", error);
  return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "Failed to process practice attempt request." } } };
}

function handler(action: (req: Request) => Promise<unknown>, status = 200) {
  return async (req: Request, res: Response) => {
    try {
      const result = await action(req);
      return res.status(status).json(result);
    } catch (error) {
      const response = errorResponse(error);
      return res.status(response.status).json(response.payload);
    }
  };
}

// Start an attempt for a published practice.
router.post("/api/student/practices/:practiceId/attempts", requireAuth, handler(async (req) => {
  const { attempt, questions } = await attemptService.startAttempt(req, userFor(req), param(req.params.practiceId));
  return { attempt, questions };
}, 201));

// Save/update answers while IN_PROGRESS.
router.put("/api/student/attempts/:attemptId/answers", requireAuth, handler(async (req) => {
  const answers = await attemptService.saveAnswers(req, userFor(req), param(req.params.attemptId), req.body ?? {});
  return { answers };
}));

// Submit and deterministically evaluate the attempt.
router.post("/api/student/attempts/:attemptId/submit", requireAuth, handler((req) =>
  attemptService.submitAttempt(req, userFor(req), param(req.params.attemptId))
));

// US-085: view a single submitted result (with per-question review).
router.get("/api/student/attempts/:attemptId/result", requireAuth, handler((req) =>
  attemptService.getResult(req, userFor(req), param(req.params.attemptId))
));

// US-085: view the student's submitted result history (newest-first).
router.get("/api/student/results", requireAuth, handler(async (req) => {
  const results = await attemptService.listResults(req, userFor(req));
  return { results, total: results.length };
}));

// Student practice discovery: list published, enrolled-accessible practices.
router.get("/api/student/practices", requireAuth, handler(async (req) => {
  const practices = await attemptService.listStudentPractices(req, userFor(req));
  return { practices, total: practices.length };
}));

// Student practice detail: open a published practice before starting an attempt.
router.get("/api/student/practices/:practiceId", requireAuth, handler(async (req) => {
  const practice = await attemptService.getStudentPractice(req, userFor(req), param(req.params.practiceId));
  return { practice };
}));

export default router;
