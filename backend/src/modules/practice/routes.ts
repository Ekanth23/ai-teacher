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
    if (code === "DUPLICATE_PRACTICE_QUESTION") return { status: 409, payload: { error: { code, message } } };
    if (code === "23505") return { status: 409, payload: { error: { code: "DUPLICATE_RESOURCE", message: "A practice question with this sequence already exists." } } };
  }

  console.error("Practice API error:", error);
  return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "Failed to process practice request." } } };
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

// Authoring: practice listing.
router.get("/api/practices", requireAuth, handler(async (req) => {
  const practices = await service.listPractices(req, userFor(req));
  return { practices, total: practices.length };
}));

// Authoring: create practice.
router.post("/api/practices", requireAuth, handler(
  (req) => service.createPractice(req, userFor(req), {
    curriculumNodeId: req.body?.curriculum_node_id,
    title: req.body?.title,
    description: req.body?.description,
    practiceType: req.body?.practice_type,
  }),
  "practice",
  201
));

// Authoring: get a practice.
router.get("/api/practices/:practiceId", requireAuth, handler(
  (req) => service.getPractice(req, userFor(req), param(req.params.practiceId)),
  "practice"
));

// Authoring: update a draft practice.
router.patch("/api/practices/:practiceId", requireAuth, handler(
  (req) => service.updatePractice(req, userFor(req), param(req.params.practiceId), {
    title: req.body?.title,
    description: req.body?.description,
    practiceType: req.body?.practice_type,
  }),
  "practice"
));

// Authoring: publish a practice.
router.post("/api/practices/:practiceId/publish", requireAuth, handler(
  (req) => service.publishPractice(req, userFor(req), param(req.params.practiceId)),
  "practice"
));

// Authoring: archive a practice.
router.post("/api/practices/:practiceId/archive", requireAuth, handler(
  (req) => service.archivePractice(req, userFor(req), param(req.params.practiceId)),
  "practice"
));

// Authoring: list questions for a practice.
router.get("/api/practices/:practiceId/questions", requireAuth, handler(async (req) => {
  const questions = await service.listQuestions(req, userFor(req), param(req.params.practiceId));
  return { questions, total: questions.length };
}));

// Authoring: add a question (editable practice only).
router.post("/api/practices/:practiceId/questions", requireAuth, handler(
  (req) => service.addQuestion(req, userFor(req), param(req.params.practiceId), {
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

// Authoring: update a question (editable practice only).
router.patch("/api/practices/:practiceId/questions/:questionId", requireAuth, handler(
  (req) => service.updateQuestion(req, userFor(req), param(req.params.practiceId), param(req.params.questionId), {
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

// Authoring: remove a question (editable practice only).
router.delete("/api/practices/:practiceId/questions/:questionId", requireAuth, handler(
  (req) => service.deleteQuestion(req, userFor(req), param(req.params.practiceId), param(req.params.questionId)),
  "question"
));

export default router;
