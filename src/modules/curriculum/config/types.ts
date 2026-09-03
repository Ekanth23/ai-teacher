export type CurriculumNodeConfig = { key: string; type: string; title: string; parentKey?: string; sequence?: number; description?: string; knowledgeCodes?: string[]; elements?: { key: string; type: string; title: string }[] };
export type StructureConfig = { key: string; kind: "SYLLABUS"|"TEXTBOOK"; name: string; nodes: CurriculumNodeConfig[] };
export type CurriculumConfiguration = {
  boardCode: string; boardName: string; version: string; datasetCode: string; datasetVersion: string;
  academicYear: { code: string; name: string; startDate: string; endDate: string };
  examinationYear: { code: string; name: string; yearValue: number };
  languages: string[]; mediumCodes: string[]; source: { name: string; uri?: string; citation?: Record<string, unknown> };
  structures: StructureConfig[];
};
