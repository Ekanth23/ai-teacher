-- Migration 012: class invitation and join flow

CREATE TABLE IF NOT EXISTS class_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  class_id UUID NOT NULL,
  created_by_user_id UUID NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT class_invitations_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT class_invitations_class_fk FOREIGN KEY (class_id)
    REFERENCES classes (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT class_invitations_creator_fk FOREIGN KEY (created_by_user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT class_invitations_max_uses_check CHECK (max_uses IS NULL OR max_uses > 0),
  CONSTRAINT class_invitations_use_count_check CHECK (use_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_class_invitations_token_hash ON class_invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_class_invitations_organization_id ON class_invitations (organization_id);
CREATE INDEX IF NOT EXISTS idx_class_invitations_class_id ON class_invitations (class_id);
CREATE INDEX IF NOT EXISTS idx_class_invitations_status ON class_invitations (status);
CREATE INDEX IF NOT EXISTS idx_class_invitations_expires_at ON class_invitations (expires_at);
CREATE INDEX IF NOT EXISTS idx_class_invitations_created_by_user_id ON class_invitations (created_by_user_id);
