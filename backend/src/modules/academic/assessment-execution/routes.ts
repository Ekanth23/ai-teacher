import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../../auth/middleware.js";
import { AuthorizationError, type AuthenticatedRequest } from "../../../auth/organization.js";
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
    if (code === "DUPLICATE_ASSESSMENT_QUESTION") return { status: 409, payload: { error: { code, message } } };
    if (code === "INCONSISTENT_RESULT_DATA") return { status: 500, payload: { error: { code, message } } };
    if (code === "23505") return { status: 409, payload: { error: { code: "DUPLICATE_RESOURCE", message: "A resource with the same identity already exists." } } };
  }

  console.error("Assessment execution API error:", error);
  return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "Failed to process assessment request." } } };
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

// Authoring: list questions for a formal assessment.
router.get("/api/assessment-events/:assessmentId/questions", requireAuth, handler(async (req) => {
  const questions = await service.listQuestions(req, userFor(req), param(req.params.assessmentId));
  return { questions, total: questions.length };
}));

// Authoring: add a question (draft assessment only).
router.post("/api/assessment-events/:assessmentId/questions", requireAuth, handler(
  (req) => service.addQuestion(req, userFor(req), param(req.params.assessmentId), {
    questionText: req.body?.question_text,
    questionType: req.body?.question_type,
    options: req.body?.options,
    correctOptionKey: req.body?.correct_option_key,
    marks: req.body?.marks,
    explanation: req.body?.explanation,
    sequenceNumber: req.body?.sequence_number,
  }),
  "question",
  201
));

// Authoring: update a question (draft assessment only).
router.patch("/api/assessment-events/:assessmentId/questions/:questionId", requireAuth, handler(
  (req) => service.updateQuestion(req, userFor(req), param(req.params.assessmentId), param(req.params.questionId), {
    questionText: req.body?.question_text,
    questionType: req.body?.question_type,
    options: req.body?.options,
    correctOptionKey: req.body?.correct_option_key,
    marks: req.body?.marks,
    explanation: req.body?.explanation,
    sequenceNumber: req.body?.sequence_number,
  }),
  "question"
));

// Authoring: remove a question (draft assessment only).
router.delete("/api/assessment-events/:assessmentId/questions/:questionId", requireAuth, handler(
  (req) => service.deleteQuestion(req, userFor(req), param(req.params.assessmentId), param(req.params.questionId)),
  "question"
));

// Student: start (or resume) an attempt for a scheduled assessment.
router.post("/api/student/assessment-events/:assessmentId/attempts", requireAuth, async (req: Request, res: Response) => {
  try {
    const { attempt, questions, resumed } = await service.startAttempt(req, userFor(req), param(req.params.assessmentId));
    return res.status(resumed ? 200 : 201).json({ attempt, questions });
  } catch (error) {
    const response = errorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

// Student: save/update answers while IN_PROGRESS.
router.put("/api/student/assessment-attempts/:attemptId/answers", requireAuth, handler(async (req) => {
  const answers = await service.saveAnswers(req, userFor(req), param(req.params.attemptId), req.body ?? {});
  return { answers };
}));

// Student: submit an IN_PROGRESS attempt (atomic evaluate + persist).
router.post("/api/student/assessment-attempts/:attemptId/submit", requireAuth, handler(async (req) => {
  return service.submitAttempt(req, userFor(req), param(req.params.attemptId));
}));

// Review: list submitted results for a formal assessment.
router.get("/api/assessment-events/:assessmentId/results", requireAuth, handler(async (req) => {
  const results = await service.listEventResults(req, userFor(req), param(req.params.assessmentId));
  return { results, total: results.length };
}));

// Review: one submitted result bound to its assessment.
router.get("/api/assessment-events/:assessmentId/results/:attemptId", requireAuth, handler(async (req) => {
  const result = await service.getEventResult(req, userFor(req), param(req.params.assessmentId), param(req.params.attemptId));
  return { result };
}));

export default router;
