export type JsonObject = Record<string, unknown>;

export type NodeInput = {
  curriculumStructureId: string;
  parentNodeId?: string | null;
  nodeTypeId: string;
  title: string;
  code?: string | null;
  sequenceNumber?: number | null;
  description?: string | null;
  metadata?: JsonObject;
};

export type StructureInput = {
  syllabusVersionId?: string | null;
  structureKind: "SYLLABUS" | "TEXTBOOK";
  name: string;
  referenceMetadata?: JsonObject;
};

export type LearningElementInput = {
  curriculumNodeId: string;
  elementTypeId: string;
  title: string;
  description?: string | null;
  metadata?: JsonObject;
};

export type KnowledgeItemInput = {
  kind: "CONCEPT" | "SKILL" | "COMPETENCY" | "LEARNING_OUTCOME";
  code?: string | null;
  name: string;
  description?: string | null;
  expectedMastery?: number | null;
  depth?: number | null;
  complexity?: number | null;
  difficulty?: number | null;
  applicationLevel?: number | null;
  metadata?: JsonObject;
  problemTypes?: string[];
};

export type MappingProfileInput = {
  sourceSyllabusVersionId: string;
  targetSyllabusVersionId?: string | null;
  targetPathwayVersionId?: string | null;
  targetType: "CURRICULUM" | "PATHWAY";
  rules?: JsonObject;
};

export type PathwayRequirementInput = {
  targetPathwayVersionId: string;
  targetPathwayStageId?: string | null;
  knowledgeItemId: string;
  requiredMastery?: number | null;
  depth?: number | null;
  complexity?: number | null;
  difficulty?: number | null;
  applicationLevel?: number | null;
  problemType?: string | null;
};
