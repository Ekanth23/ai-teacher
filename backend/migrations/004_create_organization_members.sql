DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_member_status') THEN
    CREATE TYPE organization_member_status AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING', 'REMOVED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  role_id UUID NOT NULL,
  status organization_member_status NOT NULL DEFAULT 'ACTIVE',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_members_user_org_unique UNIQUE (user_id, organization_id),
  CONSTRAINT organization_members_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT organization_members_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT organization_members_role_fk FOREIGN KEY (role_id)
    REFERENCES roles (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_organization_members_org_role ON organization_members (organization_id, role_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_user_status ON organization_members (user_id, status);
CREATE INDEX IF NOT EXISTS idx_organization_members_status ON organization_members (status);
