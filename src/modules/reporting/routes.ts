import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../auth/middleware.js";
import { AuthorizationError, type AuthenticatedRequest } from "../../auth/organization.js";
import * as reportingService from "./service.js";

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
    if (code === "23505") return { status: 409, payload: { error: { code: "DUPLICATE_RESOURCE", message: "A report with the same name already exists in this organization." } } };
  }

  console.error("Reporting API error:", error);
  return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "Failed to process reporting request." } } };
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

const orgId = (req: Request) => param(req.params.organizationId);

// Default institutional dashboard (real, available data only).
router.get("/api/organizations/:organizationId/reporting/dashboard", requireAuth, handler((req) => reportingService.getDashboard(req, userFor(req), orgId(req))));

// Drill-down aggregations.
router.get("/api/organizations/:organizationId/reporting/grades", requireAuth, handler((req) => reportingService.getGrades(req, userFor(req), orgId(req))));
router.get("/api/organizations/:organizationId/reporting/classes", requireAuth, handler((req) => reportingService.getClasses(req, userFor(req), orgId(req))));
router.get("/api/organizations/:organizationId/reporting/subjects", requireAuth, handler((req) => reportingService.getSubjects(req, userFor(req), orgId(req))));
router.get("/api/organizations/:organizationId/reporting/upcoming", requireAuth, handler((req) => reportingService.getUpcoming(req, userFor(req), orgId(req), 20)));

// Performance analytics (honestly flagged as unavailable until a data source exists).
router.get("/api/organizations/:organizationId/reporting/top-students", requireAuth, handler((req) => reportingService.getTopStudents(req, userFor(req), orgId(req))));
router.get("/api/organizations/:organizationId/reporting/students-needing-support", requireAuth, handler((req) => reportingService.getNeedsSupport(req, userFor(req), orgId(req))));

// Custom report definitions (organization-scoped).
router.post("/api/organizations/:organizationId/reporting/reports", requireAuth, handler((req) => reportingService.createDefinition(req, userFor(req), orgId(req), req.body ?? {}), 201));
router.get("/api/organizations/:organizationId/reporting/reports", requireAuth, handler((req) => reportingService.listDefinitions(req, userFor(req), orgId(req))));
router.get("/api/organizations/:organizationId/reporting/reports/:reportId", requireAuth, handler((req) => reportingService.getDefinition(req, userFor(req), orgId(req), param(req.params.reportId))));
router.patch("/api/organizations/:organizationId/reporting/reports/:reportId", requireAuth, handler((req) => reportingService.updateDefinition(req, userFor(req), orgId(req), param(req.params.reportId), req.body ?? {})));

// Generate a custom report: from a saved definition, or ad-hoc from an inline config.
router.post("/api/organizations/:organizationId/reporting/reports/:reportId/run", requireAuth, handler((req) => reportingService.runSavedReport(req, userFor(req), orgId(req), param(req.params.reportId))));
router.post("/api/organizations/:organizationId/reporting/reports/run", requireAuth, handler((req) => reportingService.runReport(req, userFor(req), orgId(req), req.body ?? {})));

export default router;

