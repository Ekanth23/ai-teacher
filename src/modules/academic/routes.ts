import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../auth/middleware.js";
import { AuthorizationError, type AuthenticatedRequest } from "../../auth/organization.js";
import * as assessmentService from "./assessment/service.js";
import * as calendarService from "./calendar/service.js";

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

  console.error("Academic API error:", error);
  return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "Failed to process academic request." } } };
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

router.get("/api/academic-calendars", requireAuth, handler(async (req) => {
  const calendars = await calendarService.list(req, userFor(req));
  return { calendars, total: calendars.length };
}));

router.post("/api/academic-calendars", requireAuth, handler(
  (req) => calendarService.create(req, userFor(req), req.body ?? {}),
  "calendar",
  201
));
router.get("/api/academic-calendars/:calendarId", requireAuth, handler(
  (req) => calendarService.get(req, userFor(req), param(req.params.calendarId)),
  "calendar"
));
router.patch("/api/academic-calendars/:calendarId", requireAuth, handler(
  (req) => calendarService.update(req, userFor(req), param(req.params.calendarId), req.body ?? {}),
  "calendar"
));
router.post("/api/academic-calendars/:calendarId/publish", requireAuth, handler(
  (req) => calendarService.publish(req, userFor(req), param(req.params.calendarId)),
  "calendar"
));
router.post("/api/academic-calendars/:calendarId/retire", requireAuth, handler(
  (req) => calendarService.retire(req, userFor(req), param(req.params.calendarId)),
  "calendar"
));

router.get("/api/academic-calendars/:calendarId/periods", requireAuth, handler(async (req) => {
  const periods = await calendarService.listPeriods(req, userFor(req), param(req.params.calendarId));
  return { periods, total: periods.length };
}));
router.post("/api/academic-calendars/:calendarId/periods", requireAuth, handler(
  (req) => calendarService.createPeriod(req, userFor(req), { ...(req.body ?? {}), calendarId: param(req.params.calendarId) }),
  "period",
  201
));
router.patch("/api/academic-calendar-periods/:periodId", requireAuth, handler(
  (req) => calendarService.updatePeriod(req, userFor(req), param(req.params.periodId), req.body ?? {}),
  "period"
));
router.delete("/api/academic-calendar-periods/:periodId", requireAuth, handler(
  (req) => calendarService.deletePeriod(req, userFor(req), param(req.params.periodId)),
  "period"
));

router.get("/api/assessment-types", requireAuth, handler(async () => {
  const assessmentTypes = await assessmentService.listAssessmentTypes();
  return { assessmentTypes, total: assessmentTypes.length };
}));
router.get("/api/assessment-schemes", requireAuth, handler(async (req) => {
  const schemes = await assessmentService.listSchemes(typeof req.query.board_id === "string" ? req.query.board_id : undefined);
  return { schemes, total: schemes.length };
}));
router.get("/api/assessment-schemes/:schemeId", requireAuth, handler(
  (req) => assessmentService.getSchemeDetail(param(req.params.schemeId)),
  "scheme"
));

router.get("/api/assessment-events", requireAuth, handler(async (req) => {
  const events = await assessmentService.listEvents(req, userFor(req), typeof req.query.academic_year_id === "string" ? req.query.academic_year_id : undefined);
  return { events, total: events.length };
}));
router.post("/api/assessment-events", requireAuth, handler(
  (req) => {
    const { organizationId: _organizationId, ...input } = req.body ?? {};
    return assessmentService.createEvent(req, userFor(req), input);
  },
  "assessmentEvent",
  201
));
router.post("/api/classes/:classId/assessment-events", requireAuth, handler(
  (req) => assessmentService.createEventForClass(req, userFor(req), param(req.params.classId), req.body ?? {}),
  "assessmentEvent",
  201
));
router.get("/api/assessment-events/:eventId", requireAuth, handler(
  (req) => assessmentService.getEvent(req, userFor(req), param(req.params.eventId)),
  "assessmentEvent"
));
router.patch("/api/assessment-events/:eventId", requireAuth, handler(
  (req) => assessmentService.updateEvent(req, userFor(req), param(req.params.eventId), req.body ?? {}),
  "assessmentEvent"
));
router.post("/api/assessment-events/:eventId/status", requireAuth, handler(
  (req) => assessmentService.changeEventStatus(req, userFor(req), param(req.params.eventId), req.body?.status),
  "assessmentEvent"
));

router.get("/api/assessment-events/:eventId/curriculum-portions", requireAuth, handler(async (req) => {
  const curriculumPortions = await assessmentService.listPortions(req, userFor(req), param(req.params.eventId));
  return { curriculumPortions, total: curriculumPortions.length };
}));
router.post("/api/assessment-events/:eventId/curriculum-portions", requireAuth, handler(
  (req) => assessmentService.addPortion(req, userFor(req), { ...(req.body ?? {}), assessmentEventId: param(req.params.eventId) }),
  "curriculumPortion",
  201
));
router.delete("/api/assessment-events/:eventId/curriculum-portions/:portionId", requireAuth, handler(
  (req) => assessmentService.deletePortion(req, userFor(req), param(req.params.eventId), param(req.params.portionId)),
  "curriculumPortion"
));

export default router;
