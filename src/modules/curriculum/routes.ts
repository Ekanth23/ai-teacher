import { Router } from "express";
import { AuthorizationError, type AuthenticatedRequest } from "../../auth/organization.js";
import { requireAuth } from "../../auth/middleware.js";
import * as service from "./service.js";

const router = Router();

function getErrorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return { status: 403, payload: { error: { code: error.code, message: error.message } } };
  }

  if (typeof error === "object" && error !== null) {
    const maybeCode = (error as { code?: string }).code;
    const maybeMessage = (error as { message?: string }).message ?? "An unexpected error occurred.";

    if (maybeCode === "VALIDATION_ERROR") {
      return { status: 400, payload: { error: { code: "VALIDATION_ERROR", message: maybeMessage } } };
    }

    if (maybeCode === "DUPLICATE_SYLLABUS") {
      return { status: 409, payload: { error: { code: "DUPLICATE_SYLLABUS", message: maybeMessage } } };
    }

    if (maybeCode === "DUPLICATE_SYLLABUS_VERSION") {
      return { status: 409, payload: { error: { code: "DUPLICATE_SYLLABUS_VERSION", message: maybeMessage } } };
    }

    if (maybeCode === "NOT_FOUND") {
      return { status: 404, payload: { error: { code: "NOT_FOUND", message: maybeMessage } } };
    }
  }

  return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "Failed to process curriculum request." } } };
}

router.get("/api/boards", async (req, res) => {
  try {
    const boards = await service.listBoards();
    return res.status(200).json({ boards, total: boards.length });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/boards/:boardId", async (req, res) => {
  try {
    const board = await service.getBoardById(req.params.boardId);
    return res.status(200).json({ board });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/mediums", async (req, res) => {
  try {
    const mediums = await service.listMediums();
    return res.status(200).json({ mediums, total: mediums.length });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/mediums/:mediumId", async (req, res) => {
  try {
    const medium = await service.getMediumById(req.params.mediumId);
    return res.status(200).json({ medium });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/classes/:classId/syllabus", requireAuth, async (req, res) => {
  try {
    const authRequest = req as AuthenticatedRequest;
    const user = authRequest.user;
    if (!user) {
      return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    }

    const classId = typeof req.params.classId === "string" ? req.params.classId : "";
    const syllabi = await service.listClassSyllabus(req, user, classId);
    return res.status(200).json({ syllabi });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.post("/api/classes/:classId/syllabus", requireAuth, async (req, res) => {
  try {
    const authRequest = req as AuthenticatedRequest;
    const user = authRequest.user;
    if (!user) {
      return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    }

    const classId = typeof req.params.classId === "string" ? req.params.classId : "";
    const syllabus = await service.createSyllabus(req, user, classId, req.body ?? {});
    return res.status(201).json({ syllabus });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/syllabus/:syllabusId", requireAuth, async (req, res) => {
  try {
    const authRequest = req as AuthenticatedRequest;
    const user = authRequest.user;
    if (!user) {
      return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    }

    const syllabusId = typeof req.params.syllabusId === "string" ? req.params.syllabusId : "";
    const syllabus = await service.getSyllabusById(req, user, syllabusId);
    return res.status(200).json({ syllabus });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.post("/api/syllabus/:syllabusId/versions", requireAuth, async (req, res) => {
  try {
    const authRequest = req as AuthenticatedRequest;
    const user = authRequest.user;
    if (!user) {
      return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    }

    const syllabusId = typeof req.params.syllabusId === "string" ? req.params.syllabusId : "";
    const syllabusVersion = await service.createSyllabusVersion(req, user, syllabusId, req.body ?? {});
    return res.status(201).json({ syllabusVersion });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

export default router;
