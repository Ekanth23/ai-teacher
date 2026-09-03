import { describe, expect, it } from "vitest";
import { validatePeriodInput } from "../../src/modules/academic/calendar/validation.js";
import { AssessmentValidationError, validateComponent, validateEvent, validatePortion } from "../../src/modules/academic/assessment/validation.js";
import { isValidEventTransition } from "../../src/modules/academic/assessment/service.js";

const id = "11111111-1111-4111-8111-111111111111";

describe("Phase 020-B domain validation", () => {
  it("rejects reversed calendar period dates", () => {
    expect(() => validatePeriodInput({
      calendarId: id,
      periodType: "CUSTOM",
      name: "Invalid",
      startsOn: "2026-06-01",
      endsOn: "2026-05-01",
    })).toThrow("Period dates are invalid.");
  });

  it("rejects invalid assessment event schedules", () => {
    expect(() => validateEvent({
      organizationId: id,
      academicYearId: id,
      classId: id,
      title: "Exam",
      scheduledStart: "not-a-date",
      scheduledEnd: "2026-06-01T10:00:00Z",
    })).toThrow("Assessment schedule is invalid.");
  });

  it("rejects negative assessment component values", () => {
    expect(() => validateComponent({
      schemeId: id,
      assessmentTypeId: id,
      code: "WRITTEN",
      name: "Written",
      maximumMarks: -1,
    })).toThrow("Maximum marks cannot be negative.");
  });

  it("requires structural curriculum portion references", () => {
    expect(() => validatePortion({
      assessmentEventId: id,
      curriculumStructureId: "invalid",
    })).toThrow(AssessmentValidationError);
  });

  it("enforces the assessment event lifecycle", () => {
    expect(isValidEventTransition("DRAFT", "SCHEDULED")).toBe(true);
    expect(isValidEventTransition("SCHEDULED", "COMPLETED")).toBe(true);
    expect(isValidEventTransition("COMPLETED", "DRAFT")).toBe(false);
    expect(isValidEventTransition("CANCELLED", "DRAFT")).toBe(false);
  });
});
