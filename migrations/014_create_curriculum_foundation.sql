CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT boards_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT boards_code_not_blank CHECK (length(trim(code)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_boards_name ON boards (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS ux_boards_code ON boards (lower(code));

CREATE TABLE IF NOT EXISTS mediums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mediums_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT mediums_code_not_blank CHECK (length(trim(code)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mediums_name ON mediums (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS ux_mediums_code ON mediums (lower(code));

CREATE TABLE IF NOT EXISTS syllabi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL,
  board_id UUID NOT NULL,
  medium_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT syllabi_class_fk FOREIGN KEY (class_id)
    REFERENCES classes (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT syllabi_board_fk FOREIGN KEY (board_id)
    REFERENCES boards (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT syllabi_medium_fk FOREIGN KEY (medium_id)
    REFERENCES mediums (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT syllabi_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT syllabi_code_not_blank CHECK (length(trim(code)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_syllabi_class_id ON syllabi (class_id);
CREATE INDEX IF NOT EXISTS idx_syllabi_board_id ON syllabi (board_id);
CREATE INDEX IF NOT EXISTS idx_syllabi_medium_id ON syllabi (medium_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_syllabi_class_board_medium_code ON syllabi (class_id, board_id, medium_id, lower(code));

CREATE TABLE IF NOT EXISTS syllabus_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  syllabus_id UUID NOT NULL,
  version VARCHAR(100) NOT NULL,
  effective_from DATE,
  effective_to DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT syllabus_versions_syllabus_fk FOREIGN KEY (syllabus_id)
    REFERENCES syllabi (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT syllabus_versions_version_not_blank CHECK (length(trim(version)) > 0),
  CONSTRAINT syllabus_versions_valid_date_range CHECK (
    effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_syllabus_versions_syllabus_version ON syllabus_versions (syllabus_id, lower(version));
CREATE INDEX IF NOT EXISTS idx_syllabus_versions_syllabus_id ON syllabus_versions (syllabus_id);

INSERT INTO boards (name, code, status)
VALUES
  ('Tamil Nadu State Board', 'TNSTATE', 'ACTIVE'),
  ('CBSE', 'CBSE', 'ACTIVE'),
  ('ICSE', 'ICSE', 'ACTIVE')
ON CONFLICT (lower(code)) DO NOTHING;

INSERT INTO mediums (name, code, status)
VALUES
  ('English', 'EN', 'ACTIVE'),
  ('Tamil', 'TA', 'ACTIVE'),
  ('Hindi', 'HI', 'ACTIVE')
ON CONFLICT (lower(code)) DO NOTHING;
