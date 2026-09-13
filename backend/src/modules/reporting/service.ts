import type { Request } from "express";
import type { AuthenticatedUser } from "../../auth/tokens.js";
import { AuthorizationError, resolveOrganizationContext } from "../../auth/organization.js";
import * as repository from "./repository.js";
import type {
  CreateReportDefinitionInput,
  DataAvailability,
  GradeSummary,
  ReportConfiguration,
  UpdateReportDefinitionInput,
} from "./types.js";

// Analytics whose required data source does not yet exist in the domain model.
// These are reported as "unavailable" instead of fabricating values.
const UNAVAILABLE_METRICS: Record<string, string> = {
  task_completion_rate: "No assignment/task submission data source exists yet.",
  assessment_score: "No student assessment result/score data source exists yet.",
  curriculum_coverage: "No curriculum progress/coverage tracking data source exists yet.",
  learning_progress: "No per-student learning progress data source exists yet.",
  engagement: "No engagement/activity data source exists yet.",
  pending_work: "No assignment/task pending-work data source exists yet.",
};

const notFound = (name: string) => {
  const error = new Error(`${name} was not found.`);
  (error as Error & { code?: string }).code = "NOT_FOUND";
  return error;
};

async function requireAdminContext(req: Request, user: AuthenticatedUser, organizationId?: string) {
  const context = await resolveOrganizationContext(req, user, organizationId);
  if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(context.role.name)) {
    throw new AuthorizationError("ROLE_REQUIRED", "You do not have permission to access institutional reporting.");
  }
  return context;
}

function buildAvailability(): DataAvailability[] {
  return Object.entries(UNAVAILABLE_METRICS).map(([key, reason]) => ({ key, available: false, reason }));
}

function gradeSummaries(grades: { grade: string; students: number }[], enrollments: { grade: string; enrollments: number }[]): GradeSummary[] {
  const byGrade = new Map<string, GradeSummary>();
  for (const g of grades) byGrade.set(g.grade, { grade: g.grade, students: g.students, enrollments: 0 });
  for (const e of enrollments) {
    const existing = byGrade.get(e.grade);
    if (existing) existing.enrollments = e.enrollments;
  }
  return [...byGrade.values()];
}

export async function getDashboard(req: Request, user: AuthenticatedUser, organizationId?: string) {
  const context = await requireAdminContext(req, user, organizationId);
  const orgId = context.organization.id;

  const [counts, grades, enrollments, classes, subjects, upcoming, noTeacher, noSubjects, unenrolled] = await Promise.all([
    repository.institutionCounts(orgId),
    repository.studentsByGrade(orgId),
    repository.enrollmentsByGrade(orgId),
    repository.classSummaries(orgId),
    repository.subjectSummaries(orgId),
    repository.upcomingAssessments(orgId),
    repository.classesWithoutTeacher(orgId),
    repository.classesWithoutSubjects(orgId),
    repository.unenrolledStudents(orgId),
  ]);

  const c = counts.rows[0] as Record<string, number>;

  const insights: string[] = [];
  const gradeList = gradeSummaries(grades.rows, enrollments.rows);
  if (c.students > 0) insights.push(`${c.students} active students are enrolled across ${c.classes} active classes.`);
  if (gradeList.length > 0) {
    const largest = gradeList.reduce((a, b) => (b.students > a.students ? b : a), gradeList[0]);
    insights.push(`Grade "${largest.grade}" has the largest cohort with ${largest.students} active students.`);
  }
  if (noTeacher.rows.length > 0) insights.push(`${noTeacher.rows.length} active classes have no assigned teacher.`);
  if (noSubjects.rows.length > 0) insights.push(`${noSubjects.rows.length} active classes have no mapped subjects.`);
  if (unenrolled.rows.length > 0) insights.push(`${unenrolled.rows.length} active students are not enrolled in any class.`);
  if (c.upcoming_assessments > 0) insights.push(`${c.upcoming_assessments} assessments are scheduled in the future.`);

  return {
    organization: { id: context.organization.id, name: context.organization.name, type: context.organization.type },
    metrics: {
      students: { value: c.students ?? 0, available: true },
      classes: { value: c.classes ?? 0, available: true },
      teachers: { value: c.teachers ?? 0, available: true },
      subjects: { value: c.subjects ?? 0, available: true },
      enrollments: { value: c.enrollments ?? 0, available: true },
      upcoming_assessments: { value: c.upcoming_assessments ?? 0, available: true },
      published_resources: { value: c.published_resources ?? 0, available: true },
    },
    grades: gradeList,
    classes: classes.rows,
    subjects: subjects.rows,
    upcoming: upcoming.rows,
    attention: {
      classesWithoutTeacher: noTeacher.rows,
      classesWithoutSubjects: noSubjects.rows,
      unenrolledStudents: unenrolled.rows,
    },
    insights,
    dataAvailability: buildAvailability(),
  };
}

export async function getGrades(req: Request, user: AuthenticatedUser, organizationId?: string) {
  const context = await requireAdminContext(req, user, organizationId);
  const [grades, enrollments] = await Promise.all([
    repository.studentsByGrade(context.organization.id),
    repository.enrollmentsByGrade(context.organization.id),
  ]);
  return { grades: gradeSummaries(grades.rows, enrollments.rows) };
}

export async function getClasses(req: Request, user: AuthenticatedUser, organizationId?: string) {
  const context = await requireAdminContext(req, user, organizationId);
  const result = await repository.classSummaries(context.organization.id);
  return { classes: result.rows };
}

export async function getSubjects(req: Request, user: AuthenticatedUser, organizationId?: string) {
  const context = await requireAdminContext(req, user, organizationId);
  const result = await repository.subjectSummaries(context.organization.id);
  return { subjects: result.rows };
}

export async function getUpcoming(req: Request, user: AuthenticatedUser, organizationId: string | undefined, limit: number) {
  const context = await requireAdminContext(req, user, organizationId);
  const result = await repository.upcomingAssessments(context.organization.id, limit);
  return { upcoming: result.rows, dataAvailability: buildAvailability() };
}

// Performance-based ranking cannot be produced without assessment-result data.
// The endpoint shape is stable so a future data source can populate it.
export async function getTopStudents(req: Request, user: AuthenticatedUser, organizationId?: string) {
  await requireAdminContext(req, user, organizationId);
  return {
    students: [],
    available: false,
    reason: "Insufficient assessment data is available to reliably rank students.",
    evidence: [] as unknown[],
  };
}

export async function getNeedsSupport(req: Request, user: AuthenticatedUser, organizationId?: string) {
  const context = await requireAdminContext(req, user, organizationId);
  const unenrolled = await repository.unenrolledStudents(context.organization.id);
  return {
    performanceBased: {
      students: [],
      available: false,
      reason: "Insufficient assessment data is available to reliably identify students below the expected level.",
    },
    unenrolledStudents: unenrolled.rows,
  };
}

export async function createDefinition(req: Request, user: AuthenticatedUser, organizationId: string | undefined, input: CreateReportDefinitionInput) {
  const context = await requireAdminContext(req, user, organizationId);
  if (!input.name || !input.name.trim()) {
    const error = new Error("Report name is required.");
    (error as Error & { code?: string }).code = "VALIDATION_ERROR";
    throw error;
  }
  return (await repository.createDefinition(context.organization.id, user.id, input)).rows[0];
}

export async function listDefinitions(req: Request, user: AuthenticatedUser, organizationId?: string) {
  const context = await requireAdminContext(req, user, organizationId);
  return (await repository.listDefinitions(context.organization.id)).rows;
}

export async function getDefinition(req: Request, user: AuthenticatedUser, organizationId: string | undefined, id: string) {
  const context = await requireAdminContext(req, user, organizationId);
  const row = (await repository.getDefinition(id, context.organization.id)).rows[0];
  if (!row) throw notFound("Report definition");
  return row;
}

export async function updateDefinition(req: Request, user: AuthenticatedUser, organizationId: string | undefined, id: string, input: UpdateReportDefinitionInput) {
  const context = await requireAdminContext(req, user, organizationId);
  const result = await repository.updateDefinition(id, context.organization.id, input);
  if (!result.rows[0]) throw notFound("Report definition");
  return result.rows[0];
}

async function buildGroups(orgId: string, config: ReportConfiguration) {
  const groupBy = config.groupBy ?? "class";
  const scope = config.scope ?? {};

  if (groupBy === "grade") {
    const [grades, enrollments] = await Promise.all([
      repository.studentsByGrade(orgId),
      repository.enrollmentsByGrade(orgId),
    ]);
    let rows = gradeSummaries(grades.rows, enrollments.rows).map((g) => ({
      key: g.grade,
      label: g.grade,
      metrics: { students: g.students, enrollments: g.enrollments },
    }));
    if (scope.grades && scope.grades.length > 0) rows = rows.filter((r) => scope.grades!.includes(r.key));
    return rows;
  }

  if (groupBy === "subject") {
    const result = await repository.subjectSummaries(orgId);
    let rows: { key: string; label: string; metrics: Record<string, number> }[] = result.rows.map((s: Record<string, unknown>) => ({
      key: String(s.id),
      label: String(s.name),
      metrics: { classes: Number(s.classes ?? 0), upcoming_assessments: Number(s.upcoming_assessments ?? 0) },
    }));
    if (scope.subjectIds && scope.subjectIds.length > 0) rows = rows.filter((r) => scope.subjectIds!.includes(r.key));
    return rows;
  }

  const result = await repository.classSummaries(orgId);
  let rows: { key: string; label: string; metrics: Record<string, number> }[] = result.rows.map((c: Record<string, unknown>) => ({
    key: String(c.id),
    label: String(c.name),
    metrics: {
      students: Number(c.students ?? 0),
      subjects: Number(c.subjects ?? 0),
      teachers: Number(c.teachers ?? 0),
      upcoming_assessments: Number(c.upcoming_assessments ?? 0),
    },
  }));
  if (scope.classIds && scope.classIds.length > 0) rows = rows.filter((r) => scope.classIds!.includes(r.key));
  return rows;
}

function sortGroups(rows: { key: string; label: string; metrics: Record<string, number> }[], config: ReportConfiguration) {
  const field = config.sort?.field ?? "students";
  const ascending = config.sort?.direction === "asc";
  const copy = [...rows];
  if (field === "label") {
    copy.sort((a, b) => a.label.localeCompare(b.label) * (ascending ? 1 : -1));
  } else {
    copy.sort((a, b) => ((a.metrics[field] ?? 0) - (b.metrics[field] ?? 0)) * (ascending ? 1 : -1));
  }
  return copy;
}

export async function runReport(req: Request, user: AuthenticatedUser, organizationId: string | undefined, config: ReportConfiguration) {
  const context = await requireAdminContext(req, user, organizationId);
  const groups = sortGroups(await buildGroups(context.organization.id, config), config);
  const requestedMetrics = config.metrics ?? [];
  const unavailable = Object.keys(UNAVAILABLE_METRICS).filter((m) => requestedMetrics.includes(m));

  return {
    organization_id: context.organization.id,
    generated_at: new Date().toISOString(),
    configuration: config,
    groups,
    unavailableMetrics: unavailable.map((key) => ({ key, reason: UNAVAILABLE_METRICS[key] })),
  };
}

export async function runSavedReport(req: Request, user: AuthenticatedUser, organizationId: string | undefined, id: string) {
  const definition = await getDefinition(req, user, organizationId, id);
  const config = (definition.configuration ?? {}) as ReportConfiguration;
  return { definition: { id: definition.id, name: definition.name, description: definition.description }, ...(await runReport(req, user, organizationId, config)) };
}
