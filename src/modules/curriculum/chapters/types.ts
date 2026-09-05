export type JsonObject = Record<string, unknown>;
export type CurriculumNodeStatus = "ACTIVE" | "INACTIVE";

export type ChapterOrTopicNode = {
  id: string;
  curriculum_structure_id: string;
  parent_node_id: string | null;
  node_type_id: string;
  node_type_code: string;
  node_type_name: string;
  subject_id: string | null;
  title: string;
  code: string | null;
  sequence_number: number | null;
  description: string | null;
  metadata: JsonObject;
  status: CurriculumNodeStatus;
  created_at: string;
  updated_at: string;
};

export type CreateChapterOrTopicInput = {
  title: string;
  code?: string | null;
  sequenceNumber?: number | null;
  description?: string | null;
  metadata?: JsonObject;
};

export type UpdateChapterOrTopicInput = Partial<CreateChapterOrTopicInput> & {
  status?: CurriculumNodeStatus;
};

export type CreateNodeInput = {
  curriculumStructureId: string;
  parentNodeId: string | null;
  nodeTypeId: string;
  title: string;
  code?: string | null;
  sequenceNumber?: number | null;
  description?: string | null;
  metadata?: JsonObject;
};
