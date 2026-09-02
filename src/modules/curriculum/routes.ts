import { Router } from "express";
import { AuthorizationError, type AuthenticatedRequest } from "../../auth/organization.js";
import { requireAuth } from "../../auth/middleware.js";
import * as service from "./service.js";
import * as architectureService from "./architecture/service.js";

const router = Router();

function getParam(value: string | string[]) {
  return typeof value === "string" ? value : "";
}

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

router.get("/api/curriculum/node-types", requireAuth, async (_req, res) => {
  return res.status(200).json({ nodeTypes: await architectureService.listNodeTypes() });
});

router.get("/api/curriculum/element-types", requireAuth, async (_req, res) => {
  return res.status(200).json({ elementTypes: await architectureService.listElementTypes() });
});

router.get("/api/syllabus-versions/:versionId/structures", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    return res.status(200).json({ structures: await architectureService.listStructures(req, user, getParam(req.params.versionId)) });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.post("/api/syllabus-versions/:versionId/structures", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    const structure = await architectureService.createStructure(req, user, {
      syllabusVersionId: getParam(req.params.versionId),
      structureKind: req.body?.structure_kind,
      name: req.body?.name,
      referenceMetadata: req.body?.reference_metadata,
    });
    return res.status(201).json({ structure });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/curriculum/structures/:structureId/nodes", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    return res.status(200).json({ nodes: await architectureService.listNodes(req, user, getParam(req.params.structureId)) });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.post("/api/curriculum/structures/:structureId/nodes", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    const node = await architectureService.createNode(req, user, {
      curriculumStructureId: getParam(req.params.structureId),
      parentNodeId: req.body?.parent_node_id,
      nodeTypeId: req.body?.node_type_id,
      title: req.body?.title,
      code: req.body?.code,
      sequenceNumber: req.body?.sequence_number,
      description: req.body?.description,
      metadata: req.body?.metadata,
    });
    return res.status(201).json({ node });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/knowledge/items", requireAuth, async (_req, res) => {
  return res.status(200).json({ knowledgeItems: await architectureService.listKnowledgeItems() });
});

router.post("/api/knowledge/items", requireAuth, async (req, res) => {
  try {
    const authRequest = req as AuthenticatedRequest;
    if (!authRequest.user) return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    const item = await architectureService.createKnowledgeItem(req, authRequest.user, {
      kind: req.body?.kind,
      code: req.body?.code,
      name: req.body?.name,
      description: req.body?.description,
      expectedMastery: req.body?.expected_mastery,
      depth: req.body?.depth,
      complexity: req.body?.complexity,
      difficulty: req.body?.difficulty,
      applicationLevel: req.body?.application_level,
      metadata: req.body?.metadata,
      problemTypes: req.body?.problem_types,
    });
    return res.status(201).json({ knowledgeItem: item });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.post("/api/curriculum/nodes/:nodeId/knowledge-items/:knowledgeItemId", requireAuth, async (req, res) => {
  try {
    const authRequest = req as AuthenticatedRequest;
    if (!authRequest.user) return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    const mapping = await architectureService.mapNodeKnowledge(req, authRequest.user, getParam(req.params.nodeId), getParam(req.params.knowledgeItemId), req.body?.coverage_level, req.body?.depth ?? null);
    return res.status(201).json({ mapping });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/target-pathways", requireAuth, async (_req, res) => {
  return res.status(200).json({ pathways: await architectureService.listPathways() });
});

router.get("/api/target-pathways/:pathwayId/versions", requireAuth, async (req, res) => {
  try {
    return res.status(200).json({ pathwayVersions: await architectureService.listPathwayVersions(getParam(req.params.pathwayId)) });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/target-pathway-versions/:versionId/stages", requireAuth, async (req, res) => {
  try {
    return res.status(200).json({ stages: await architectureService.listPathwayStages(getParam(req.params.versionId)) });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.post("/api/target-pathway-versions/:versionId/requirements", requireAuth, async (req, res) => {
  try {
    const authRequest = req as AuthenticatedRequest;
    if (!authRequest.user) return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    const requirement = await architectureService.createPathwayRequirement(req, authRequest.user, {
      targetPathwayVersionId: getParam(req.params.versionId),
      targetPathwayStageId: req.body?.target_pathway_stage_id,
      knowledgeItemId: req.body?.knowledge_item_id,
      requiredMastery: req.body?.required_mastery,
      depth: req.body?.depth,
      complexity: req.body?.complexity,
      difficulty: req.body?.difficulty,
      applicationLevel: req.body?.application_level,
      problemType: req.body?.problem_type,
    });
    return res.status(201).json({ requirement });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.get("/api/curriculum/mapping-profiles", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    return res.status(200).json({ mappingProfiles: await architectureService.listMappingProfiles(req, user) });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

router.post("/api/curriculum/mapping-profiles", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
    const profile = await architectureService.createMappingProfile(req, user, {
      sourceSyllabusVersionId: req.body?.source_syllabus_version_id,
      targetSyllabusVersionId: req.body?.target_syllabus_version_id,
      targetPathwayVersionId: req.body?.target_pathway_version_id,
      targetType: req.body?.target_type,
      rules: req.body?.rules,
    });
    return res.status(201).json({ mappingProfile: profile });
  } catch (error) {
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.payload);
  }
});

export default router;
