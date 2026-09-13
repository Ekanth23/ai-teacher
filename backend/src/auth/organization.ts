import type { NextFunction, Request, Response } from "express";
import pool from "../db.js";
import type { AuthenticatedUser } from "./tokens.js";

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export class AuthorizationError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type OrganizationContext = {
  user: AuthenticatedUser;
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
    status: string;
    created_by_user_id: string;
    created_at: string;
    updated_at: string;
  };
  membership: {
    id: string;
    user_id: string;
    organization_id: string;
    role_id: string;
    status: string;
    joined_at: string;
    created_at: string;
    updated_at: string;
  };
  role: {
    id: string;
    name: string;
  };
};

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
  organizationContext?: OrganizationContext;
};

export function isValidUuid(value: string | null | undefined) {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export async function resolveOrganizationContext(
  req: Request,
  user: AuthenticatedUser,
  explicitOrganizationId?: string | null
): Promise<OrganizationContext> {
  const requestedOrganizationId =
    explicitOrganizationId ??
    (typeof req.headers["x-organization-id"] === "string" ? req.headers["x-organization-id"] : null) ??
    (typeof req.params?.id === "string" ? req.params.id : null);

  if (!requestedOrganizationId || !requestedOrganizationId.trim()) {
    throw new AuthorizationError("ORGANIZATION_REQUIRED", "Organization context is required.");
  }

  const normalizedOrganizationId = requestedOrganizationId.trim();

  if (!isValidUuid(normalizedOrganizationId)) {
    throw new AuthorizationError("ORGANIZATION_ACCESS_DENIED", "You are not a member of this organization.");
  }

  const result = await pool.query(
    `SELECT
       o.id,
       o.name,
       o.slug,
       o.type,
       o.status,
       o.created_by_user_id,
       o.created_at,
       o.updated_at,
       om.id AS membership_id,
       om.user_id AS membership_user_id,
       om.organization_id AS membership_organization_id,
       om.role_id AS membership_role_id,
       om.status AS membership_status,
       om.joined_at,
       om.created_at AS membership_created_at,
       om.updated_at AS membership_updated_at,
       r.id AS role_id,
       r.name AS role_name
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     JOIN roles r ON r.id = om.role_id
     WHERE o.id = $1
       AND o.status = 'ACTIVE'
       AND om.user_id = $2
       AND om.status = 'ACTIVE'
     LIMIT 1`,
    [normalizedOrganizationId, user.id]
  );

  if (result.rows.length === 0) {
    throw new AuthorizationError("ORGANIZATION_ACCESS_DENIED", "You are not a member of this organization.");
  }

  const row = result.rows[0];

  return {
    user,
    organization: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      type: row.type,
      status: row.status,
      created_by_user_id: row.created_by_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    membership: {
      id: row.membership_id,
      user_id: row.membership_user_id,
      organization_id: row.membership_organization_id,
      role_id: row.membership_role_id,
      status: row.membership_status,
      joined_at: row.joined_at,
      created_at: row.membership_created_at,
      updated_at: row.membership_updated_at,
    },
    role: {
      id: row.role_id,
      name: row.role_name,
    },
  };
}

export async function requireOrganization(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authRequest = req as AuthenticatedRequest;
  const user = authRequest.user;

  if (!user) {
    return res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: "Authentication required.",
      },
    });
  }

  try {
    authRequest.organizationContext = await resolveOrganizationContext(req, user);
    return next();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return res.status(403).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    console.error("Organization middleware error:", error);
    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to resolve organization context.",
      },
    });
  }
}

export function requireRole(requiredRole: string | string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authRequest = req as AuthenticatedRequest;
    const user = authRequest.user;

    if (!user) {
      return res.status(401).json({
        error: {
          code: "INVALID_TOKEN",
          message: "Authentication required.",
        },
      });
    }

    try {
      if (!authRequest.organizationContext) {
        authRequest.organizationContext = await resolveOrganizationContext(req, user);
      }

      const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      const currentRole = authRequest.organizationContext.role.name;

      if (!allowedRoles.includes(currentRole)) {
        return res.status(403).json({
          error: {
            code: "ROLE_REQUIRED",
            message: "You do not have permission to perform this action.",
          },
        });
      }

      return next();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      console.error("Role middleware error:", error);
      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to authorize request.",
        },
      });
    }
  };
}

export function requireAnyRole(requiredRoles: string[]) {
  return requireRole(requiredRoles);
}

export async function getUserOrganizations(userId: string) {
  const result = await pool.query(
    `SELECT
       o.id,
       o.name,
       o.slug,
       o.type,
       o.status,
       o.created_by_user_id,
       o.created_at,
       o.updated_at,
       om.status AS membership_status,
       r.name AS role_name
     FROM organization_members om
     JOIN organizations o ON o.id = om.organization_id
     JOIN roles r ON r.id = om.role_id
     WHERE om.user_id = $1
       AND om.status = 'ACTIVE'
     ORDER BY o.name ASC`,
    [userId]
  );

  return result.rows;
}
