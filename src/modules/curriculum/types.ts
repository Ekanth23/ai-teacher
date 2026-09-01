export type BoardRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type MediumRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type SyllabusRow = {
  id: string;
  class_id: string;
  board_id: string;
  medium_id: string;
  name: string;
  code: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type SyllabusVersionRow = {
  id: string;
  syllabus_id: string;
  version: string;
  effective_from: string | null;
  effective_to: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};
