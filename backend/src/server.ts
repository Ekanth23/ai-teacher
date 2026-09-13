
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import pool from "./db.js";
import { InvalidCredentialsError, loginUser } from "./auth/login.js";
import { requireAuth, type AuthenticatedRequest as BasicAuthenticatedRequest } from "./auth/middleware.js";
import { DuplicateUserError, ValidationError, registerUser } from "./auth/register.js";
import aiRoutes from "./modules/ai/ai.routes.js";
import {
  AuthorizationError,
  getUserOrganizations,
  isValidUuid,
  requireAnyRole,
  requireOrganization,
  requireRole,
  resolveOrganizationContext,
  type AuthenticatedRequest,
} from "./auth/organization.js";
import {
  createAccessToken,
  findRefreshTokenByHash,
  generateRefreshToken,
  getRefreshTokenExpiryDate,
  getUserById,
  hashRefreshToken,
  InvalidRefreshTokenError,
} from "./auth/tokens.js";
import curriculumRoutes from "./modules/curriculum/routes.js";
import academicRoutes from "./modules/academic/routes.js";
import contentRoutes from "./modules/content/routes.js";
import reportingRoutes from "./modules/reporting/routes.js";
import studentRoutes from "./modules/student/routes.js";
import practiceRoutes from "./modules/practice/routes.js";
import studentPracticeRoutes from "./modules/practice/student.routes.js";

const PORT = 3000;
type OrganizationDatabase = {
  connect: () => Promise<PoolClient>;
};

function generateInvitationToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashInvitationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseInvitationMaxUses(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseInvitationExpiresAt(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : parsed;
}

// Academic year strings follow the convention "YYYY-YY" (e.g. "2026-27") or
// "YYYY-YYYY" (e.g. "2026-2027"). The value is normalized to "YYYY-YY".
const ACADEMIC_YEAR_REGEX = /^\d{4}\s*-\s*\d{2,4}$/;

function normalizeAcademicYear(value: string): string | null {
  const trimmed = value.trim();
  if (!ACADEMIC_YEAR_REGEX.test(trimmed)) {
    return null;
  }
  const [start, end] = trimmed.split("-").map((part) => part.trim());
  return `${start}-${end.padStart(4, "0").slice(-2)}`;
}

export function createApp(organizationDatabase: OrganizationDatabase = pool) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(curriculumRoutes);
  app.use(academicRoutes);
  app.use(contentRoutes);
  app.use(reportingRoutes);
  app.use(studentRoutes);
  app.use(practiceRoutes);
  app.use(studentPracticeRoutes);
  app.use("/api/ai", aiRoutes);

  app.get("/api/health", (req, res) => {
    res.json({
      status: "success",
      message: "AI Teacher backend is running!",
    });
  });

  app.get("/api/db-test", async (req, res) => {
    try {
      const result = await pool.query("SELECT NOW()");

      res.json({
        status: "success",
        message: "PostgreSQL connection is working!",
        time: result.rows[0].now,
      });
    } catch (error) {
      console.error("Database connection error:", error);

      res.status(500).json({
        status: "error",
        message: "Database connection failed",
      });
    }
  });

  app.post("/api/students", async (req, res) => {
    try {
      const { name, email, grade } = req.body;

      const result = await pool.query(
        `INSERT INTO students (name, email, grade)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [name, email, grade]
      );

      res.status(201).json({
        status: "success",
        message: "Student created successfully",
        student: result.rows[0],
      });
    } catch (error) {
      console.error("Error creating student:", error);

      res.status(500).json({
        status: "error",
        message: "Failed to create student",
      });
    }
  });

  app.get("/api/students", async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM students ORDER BY id");

      res.json({
        status: "success",
        students: result.rows,
      });
    } catch (error) {
      console.error("Error fetching students:", error);

      res.status(500).json({
        status: "error",
        message: "Failed to fetch students",
      });
    }
  });

  app.get("/api/students/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query("SELECT * FROM students WHERE id = $1", [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Student not found",
        });
      }

      res.json({
        status: "success",
        student: result.rows[0],
      });
    } catch (error) {
      console.error("Error fetching student:", error);

      res.status(500).json({
        status: "error",
        message: "Failed to fetch student",
      });
    }
  });

  app.put("/api/students/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, grade } = req.body;

      const result = await pool.query(
        `UPDATE students
         SET name = $1,
             email = $2,
             grade = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
        [name, email, grade, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Student not found",
        });
      }

      res.json({
        status: "success",
        message: "Student updated successfully",
        student: result.rows[0],
      });
    } catch (error) {
      console.error("Update student error:", error);

      res.status(500).json({
        status: "error",
        message: "Failed to update student",
      });
    }
  });

  app.delete("/api/students/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `DELETE FROM students
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Student not found",
        });
      }

      res.json({
        status: "success",
        message: "Student deleted successfully",
        student: result.rows[0],
      });
    } catch (error) {
      console.error("Delete student error:", error);

      res.status(500).json({
        status: "error",
        message: "Failed to delete student",
      });
    }
  });

  app.post("/api/conversations", async (req, res) => {
    try {
      const { student_id, subject, topic } = req.body;

      const result = await pool.query(
        `INSERT INTO conversations (student_id, subject, topic)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [student_id, subject, topic]
      );

      res.status(201).json({
        status: "success",
        message: "Conversation created successfully",
        conversation: result.rows[0],
      });
    } catch (error) {
      console.error("Create conversation error:", error);

      res.status(500).json({
        status: "error",
        message: "Failed to create conversation",
      });
    }
  });

  app.post("/api/messages", async (req, res) => {
    try {
      const { conversation_id, role, content } = req.body;

      const result = await pool.query(
        `INSERT INTO messages (conversation_id, role, content)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [conversation_id, role, content]
      );

      res.status(201).json({
        status: "success",
        message: "Message created successfully",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Create message error:", error);

      res.status(500).json({
        status: "error",
        message: "Failed to create message",
      });
    }
  });

  app.get("/api/conversations/:id/messages", async (req, res) => {
    try {
      const conversationId = Number(req.params.id);

      const result = await pool.query(
        `SELECT *
         FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId]
      );

      res.status(200).json({
        status: "success",
        messages: result.rows,
      });
    } catch (error) {
      console.error("Get messages error:", error);

      res.status(500).json({
        status: "error",
        message: "Failed to get messages",
      });
    }
  });


  app.post("/api/auth/login", async (req, res) => {
    try {
      const authResult = await loginUser(req.body);

      return res.status(200).json(authResult);
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        return res.status(400).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      if (error instanceof InvalidCredentialsError) {
        return res.status(401).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      console.error("Login error:", error);

      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to login",
        },
      });
    }
  });

  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";

      if (!refreshToken) {
        return res.status(400).json({
          error: {
            code: "INVALID_REFRESH_TOKEN",
            message: "Refresh token is required.",
          },
        });
      }

      const tokenHash = hashRefreshToken(refreshToken);
      const tokenRecord = await findRefreshTokenByHash(tokenHash);

      if (!tokenRecord) {
        throw new InvalidRefreshTokenError();
      }

      if (tokenRecord.revoked_at) {
        await pool.query(
          `UPDATE refresh_tokens
           SET revoked_at = NOW()
           WHERE family_id = $1 AND revoked_at IS NULL`,
          [tokenRecord.family_id]
        );
        throw new InvalidRefreshTokenError();
      }

      if (new Date(tokenRecord.expires_at) <= new Date()) {
        throw new InvalidRefreshTokenError("Refresh token has expired.");
      }

      const user = await getUserById(tokenRecord.user_id);
      if (!user || user.status !== "ACTIVE") {
        throw new InvalidRefreshTokenError();
      }

      await pool.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE id = $1 AND revoked_at IS NULL`,
        [tokenRecord.id]
      );

      const nextRefreshToken = generateRefreshToken();
      const nextTokenHash = hashRefreshToken(nextRefreshToken);
      const nextRefreshTokenExpiry = getRefreshTokenExpiryDate();
      const replacementRecord = await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [user.id, nextTokenHash, tokenRecord.family_id, nextRefreshTokenExpiry]
      );

      await pool.query(
        `UPDATE refresh_tokens
         SET replaced_by_token_id = $1
         WHERE id = $2`,
        [replacementRecord.rows[0].id, tokenRecord.id]
      );

      const accessToken = createAccessToken(user.id);

      return res.status(200).json({
        accessToken,
        refreshToken: nextRefreshToken,
      });
    } catch (error: unknown) {
      if (error instanceof InvalidRefreshTokenError) {
        return res.status(401).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      if (error instanceof ValidationError) {
        return res.status(400).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      console.error("Refresh token error:", error);
      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to refresh authentication.",
        },
      });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";

      if (!refreshToken) {
        return res.status(400).json({
          error: {
            code: "INVALID_REFRESH_TOKEN",
            message: "Refresh token is required.",
          },
        });
      }

      const tokenHash = hashRefreshToken(refreshToken);
      await pool.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash]
      );

      return res.status(200).json({
        success: true,
        message: "Logged out successfully.",
      });
    } catch (error) {
      console.error("Logout error:", error);
      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Logout failed.",
        },
      });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
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

    const organizations = await getUserOrganizations(user.id);

    return res.status(200).json({
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        status: user.status,
        created_at: user.created_at,
      },
      organizations: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        type: organization.type,
        membership_status: organization.membership_status,
        role_name: organization.role_name,
      })),
    });
  });

  app.get("/api/organizations/context", requireAuth, requireOrganization, async (req, res) => {
    const authRequest = req as AuthenticatedRequest;
    const organizationContext = authRequest.organizationContext;

    if (!organizationContext) {
      return res.status(403).json({
        error: {
          code: "ORGANIZATION_REQUIRED",
          message: "Organization context is required.",
        },
      });
    }

    return res.status(200).json({
      user: {
        id: organizationContext.user.id,
        full_name: organizationContext.user.full_name,
      },
      organization: {
        id: organizationContext.organization.id,
        name: organizationContext.organization.name,
        slug: organizationContext.organization.slug,
        type: organizationContext.organization.type,
      },
      membership: {
        id: organizationContext.membership.id,
        status: organizationContext.membership.status,
      },
      role: {
        id: organizationContext.role.id,
        name: organizationContext.role.name,
      },
    });
  });

  app.get("/api/admin/school-check", requireAuth, requireOrganization, requireRole("SCHOOL_ADMIN"), (req, res) => {
    const authRequest = req as AuthenticatedRequest;
    return res.status(200).json({
      ok: true,
      organizationId: authRequest.organizationContext?.organization.id,
      role: authRequest.organizationContext?.role.name,
    });
  });

  app.get("/api/admin/coaching-check", requireAuth, requireOrganization, requireAnyRole(["COACHING_ADMIN"]), (req, res) => {
    const authRequest = req as AuthenticatedRequest;
    return res.status(200).json({
      ok: true,
      organizationId: authRequest.organizationContext?.organization.id,
      role: authRequest.organizationContext?.role.name,
    });
  });

  app.post("/api/organizations", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({
          error: {
            code: "INVALID_TOKEN",
            message: "Authentication required.",
          },
        });
      }

      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const rawSlug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
      const type = typeof req.body?.type === "string" ? req.body.type.trim().toUpperCase() : "";

      if (!name) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Organization name is required.",
          },
        });
      }

      if (!rawSlug) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Organization slug is required.",
          },
        });
      }

      if (!["SCHOOL", "COACHING_CENTRE"].includes(type)) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Organization type must be SCHOOL or COACHING_CENTRE.",
          },
        });
      }

      const slug = rawSlug.toLowerCase().replace(/\s+/g, "-");
      const adminRoleName = type === "SCHOOL" ? "SCHOOL_ADMIN" : "COACHING_ADMIN";

      const client = await organizationDatabase.connect();
      try {
        await client.query("BEGIN");

        const duplicateResult = await client.query(
          `SELECT id FROM organizations WHERE slug = $1 LIMIT 1`,
          [slug]
        );

        if (duplicateResult.rows.length > 0) {
          throw new AuthorizationError("DUPLICATE_ORGANIZATION", "Organization slug is already in use.");
        }

        const roleResult = await client.query(
          `SELECT id, name FROM roles WHERE name = $1 LIMIT 1`,
          [adminRoleName]
        );

        if (roleResult.rows.length === 0) {
          throw new Error("Missing admin role");
        }

        const orgResult = await client.query(
          `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
           VALUES ($1, $2, $3, 'PENDING', $4)
           RETURNING *`,
          [name, slug, type, user.id]
        );

        const organization = orgResult.rows[0];

        await client.query(
          `INSERT INTO organization_members (user_id, organization_id, role_id, status)
           VALUES ($1, $2, $3, 'ACTIVE')`,
          [user.id, organization.id, roleResult.rows[0].id]
        );

        await client.query("COMMIT");

        return res.status(201).json({
          organization: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            type: organization.type,
            status: organization.status,
            created_by_user_id: organization.created_by_user_id,
            created_at: organization.created_at,
            updated_at: organization.updated_at,
            role_name: roleResult.rows[0].name,
            membership_status: "ACTIVE",
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");

        if (error instanceof AuthorizationError && error.code === "DUPLICATE_ORGANIZATION") {
          return res.status(409).json({
            error: {
              code: error.code,
              message: error.message,
            },
          });
        }

        if (error instanceof AuthorizationError) {
          return res.status(403).json({
            error: {
              code: error.code,
              message: error.message,
            },
          });
        }

        console.error("Organization creation error:", error);
        return res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to create organization.",
          },
        });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Organization creation handler error:", error);
      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to create organization.",
        },
      });
    }
  });

  app.get("/api/organizations", requireAuth, async (req, res) => {
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

    const organizations = await getUserOrganizations(user.id);

    return res.status(200).json({
      organizations: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        type: organization.type,
        status: organization.status,
        created_by_user_id: organization.created_by_user_id,
        created_at: organization.created_at,
        updated_at: organization.updated_at,
        membership_status: organization.membership_status,
        role_name: organization.role_name,
      })),
    });
  });

  app.get("/api/organizations/:id", requireAuth, async (req, res) => {
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

    const organizationId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!organizationId || !/^[0-9a-fA-F-]{36}$/.test(organizationId)) {
      return res.status(403).json({
        error: {
          code: "ORGANIZATION_ACCESS_DENIED",
          message: "You are not a member of this organization.",
        },
      });
    }

    try {
      const organizationContext = await resolveOrganizationContext(req, user, organizationId);

      return res.status(200).json({
        organization: {
          id: organizationContext.organization.id,
          name: organizationContext.organization.name,
          slug: organizationContext.organization.slug,
          type: organizationContext.organization.type,
          status: organizationContext.organization.status,
          created_by_user_id: organizationContext.organization.created_by_user_id,
          created_at: organizationContext.organization.created_at,
          updated_at: organizationContext.organization.updated_at,
          membership_status: organizationContext.membership.status,
          role_name: organizationContext.role.name,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      console.error("Organization detail error:", error);
      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to load organization.",
        },
      });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const invitationToken = typeof req.body?.invitation_token === "string" ? req.body.invitation_token.trim() : "";
      let invitationContext: null | {
        id: string;
        organization_id: string;
        class_id: string;
        status: string;
        expires_at: string | null;
        max_uses: number | null;
        use_count: number;
        academic_year: string | null;
        organization_status: string;
      } = null;

      if (invitationToken) {
        const invitationResult = await pool.query(
          `SELECT ci.id,
                  ci.organization_id,
                  ci.class_id,
                  ci.status,
                  ci.expires_at,
                  ci.max_uses,
                  ci.use_count,
                  c.academic_year,
                  o.status AS organization_status
           FROM class_invitations ci
           JOIN classes c ON c.id = ci.class_id
           JOIN organizations o ON o.id = ci.organization_id
           WHERE ci.token_hash = $1
           LIMIT 1`,
          [hashInvitationToken(invitationToken)]
        );

        if (invitationResult.rows.length === 0) {
          return res.status(404).json({
            error: {
              code: "INVITATION_NOT_FOUND",
              message: "Invitation not found.",
            },
          });
        }

        invitationContext = invitationResult.rows[0];
        const invitation = invitationContext;
        if (!invitation) {
          return res.status(404).json({
            error: {
              code: "INVITATION_NOT_FOUND",
              message: "Invitation not found.",
            },
          });
        }

        if (invitation.organization_status !== "ACTIVE") {
          return res.status(410).json({
            error: {
              code: "INVITATION_INVALID",
              message: "Invitation is not valid for an active organization.",
            },
          });
        }

        if (invitation.status !== "ACTIVE") {
          return res.status(410).json({
            error: {
              code: "INVITATION_INVALID",
              message: "Invitation is no longer active.",
            },
          });
        }

        if (invitation.expires_at && new Date(invitation.expires_at) <= new Date()) {
          return res.status(410).json({
            error: {
              code: "INVITATION_EXPIRED",
              message: "Invitation has expired.",
            },
          });
        }

        if (invitation.max_uses !== null && invitation.use_count >= invitation.max_uses) {
          return res.status(410).json({
            error: {
              code: "INVITATION_LIMIT_REACHED",
              message: "Invitation usage limit has been reached.",
            },
          });
        }
      }

      const client = invitationContext ? await pool.connect() : null;

      try {
        if (invitationContext) {
          await client!.query("BEGIN");
        }

        const user = invitationContext ? await registerUser(req.body, client!) : await registerUser(req.body);

        if (invitationContext) {
          const studentRoleResult = await client!.query(`SELECT id FROM roles WHERE name = 'STUDENT' LIMIT 1`);
          const studentRoleId = studentRoleResult.rows[0]?.id;
          if (!studentRoleId) {
           throw new Error("STUDENT role is not configured.");
          }

          const existingMembership = await client!.query(
           `SELECT role_id, status
             FROM organization_members
             WHERE user_id = $1 AND organization_id = $2
             LIMIT 1`,
           [user.id, invitationContext.organization_id]
          );

          if (existingMembership.rows.length > 0 && existingMembership.rows[0].role_id !== studentRoleId) {
           await client!.query("ROLLBACK");
           return res.status(403).json({
             error: {
               code: "ROLE_REQUIRED",
               message: "This account is already associated with a different role in this organization.",
             },
           });
          }

          const membershipResult = await client!.query(
           `INSERT INTO organization_members (user_id, organization_id, role_id, status)
             VALUES ($1, $2, $3, 'ACTIVE')
             ON CONFLICT (user_id, organization_id)
             DO UPDATE SET role_id = EXCLUDED.role_id, status = 'ACTIVE', updated_at = NOW()
             RETURNING id, user_id, organization_id, role_id, status`,
           [user.id, invitationContext.organization_id, studentRoleId]
          );

          const existingStudent = await client!.query(
           `SELECT id, user_id, organization_id, full_name, grade_level FROM students_v2
             WHERE user_id = $1 AND organization_id = $2
             LIMIT 1`,
           [user.id, invitationContext.organization_id]
          );

          const fullName = typeof req.body?.full_name === "string" ? req.body.full_name.trim() : user.full_name;
          const gradeLevel = typeof req.body?.grade_level === "string" ? req.body.grade_level.trim() : null;
          let studentRecord;

          if (existingStudent.rows.length > 0) {
           studentRecord = await client!.query(
             `UPDATE students_v2
               SET full_name = $3,
                   grade_level = COALESCE($4, grade_level),
                   updated_at = NOW()
               WHERE id = $1
               RETURNING id, user_id, organization_id, full_name, grade_level, status`,
             [existingStudent.rows[0].id, invitationContext.organization_id, fullName, gradeLevel]
           );
          } else {
           studentRecord = await client!.query(
             `INSERT INTO students_v2 (organization_id, user_id, full_name, grade_level, status)
               VALUES ($1, $2, $3, $4, 'ACTIVE')
               RETURNING id, user_id, organization_id, full_name, grade_level, status`,
             [invitationContext.organization_id, user.id, fullName, gradeLevel]
           );
          }

          const existingEnrollment = await client!.query(
           `SELECT id, organization_id, student_id, class_id, academic_year, status
             FROM student_enrollments
             WHERE student_id = $1 AND class_id = $2 AND status = 'ACTIVE'
             LIMIT 1`,
           [studentRecord.rows[0].id, invitationContext.class_id]
          );

          let enrollmentResponse = existingEnrollment.rows[0] ?? null;
          if (!enrollmentResponse) {
           const enrollmentResult = await client!.query(
             `INSERT INTO student_enrollments (organization_id, student_id, class_id, academic_year, status)
               VALUES ($1, $2, $3, $4, 'ACTIVE')
               RETURNING id, organization_id, student_id, class_id, academic_year, status, enrolled_on`,
             [invitationContext.organization_id, studentRecord.rows[0].id, invitationContext.class_id, invitationContext.academic_year]
           );
           enrollmentResponse = enrollmentResult.rows[0];
          }

          await client!.query(
           `UPDATE class_invitations
             SET use_count = use_count + 1,
                 updated_at = NOW()
             WHERE id = $1`,
           [invitationContext.id]
          );

          const updatedUserResult = await client!.query(
           `UPDATE users
             SET status = 'ACTIVE',
                 email_verified_at = CASE WHEN email IS NOT NULL AND email_verified_at IS NULL THEN NOW() ELSE email_verified_at END,
                 phone_verified_at = CASE WHEN phone IS NOT NULL AND phone_verified_at IS NULL THEN NOW() ELSE phone_verified_at END,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, full_name, email, phone, status, created_at`,
           [user.id]
          );

          await client!.query("COMMIT");

          return res.status(201).json({
           user: updatedUserResult.rows[0],
           membership: membershipResult.rows[0],
           student: studentRecord.rows[0],
           enrollment: enrollmentResponse,
           invitation: {
             id: invitationContext.id,
             organization_id: invitationContext.organization_id,
             class_id: invitationContext.class_id,
           },
          });
        }

        return res.status(201).json({ user });
      } catch (error: unknown) {
        if (client) {
          try {
           await client.query("ROLLBACK");
          } catch {
           // Ignore rollback errors after a failed transaction.
          }
        }
        throw error;
      } finally {
        if (client) {
          client.release();
        }
      }
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        const validationError = error as ValidationError;
        return res.status(400).json({
          error: {
            code: validationError.code,
            message: validationError.message,
          },
        });
      }

      if (error instanceof DuplicateUserError) {
        const duplicateError = error as DuplicateUserError;
        return res.status(409).json({
          error: {
            code: duplicateError.code,
            message: duplicateError.message,
          },
        });
      }

      console.error("Registration error:", error);

      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to register user",
        },
      });
    }
  });

  // Organization-scoped academic endpoints: teachers, students, classes, assignments, enrollments
  // These use existing auth/organization utilities to enforce tenant isolation and roles.

  app.post(
    "/api/organizations/:id/teachers",
    requireAuth,
    requireOrganization,
    requireAnyRole(["SCHOOL_ADMIN", "COACHING_ADMIN"]),
    async (req, res) => {
      try {
        const authRequest = req as AuthenticatedRequest;
        const organizationContext = authRequest.organizationContext;
        const user = authRequest.user;

        if (!organizationContext || !user) {
          return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
        }

        const orgId = organizationContext.organization.id;
        const userId = typeof req.body?.user_id === "string" ? req.body.user_id.trim() : "";
        const designation = typeof req.body?.designation === "string" ? req.body.designation.trim() : null;
        const qualification = typeof req.body?.qualification === "string" ? req.body.qualification.trim() : null;

        if (!userId || !isValidUuid(userId)) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Teacher user_id is required and must be a valid user id." } });
        }

        const userResult = await pool.query(`SELECT id FROM users WHERE id = $1 LIMIT 1`, [userId]);
        if (userResult.rows.length === 0) {
          return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found." } });
        }

        const result = await pool.query(
          `INSERT INTO teachers (organization_id, user_id, designation, qualification)
           VALUES ($1, $2, $3, $4)
           RETURNING id, organization_id, user_id, designation, qualification, status, created_at, updated_at`,
          [orgId, userId, designation, qualification]
        );

        return res.status(201).json({ teacher: result.rows[0] });
      } catch (error) {
        const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
        if (errorCode === "23505") {
          return res.status(409).json({
            error: { code: "DUPLICATE_TEACHER", message: "A teacher profile for this user already exists in this organization." },
          });
        }
        console.error("Create teacher error:", error);
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create teacher." } });
      }
    }
  );

  app.get("/api/organizations/:id/teachers", requireAuth, requireOrganization, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const organizationContext = authRequest.organizationContext;

      if (!organizationContext) {
        return res.status(403).json({ error: { code: "ORGANIZATION_REQUIRED", message: "Organization context is required." } });
      }

      const orgId = organizationContext.organization.id;
      const result = await pool.query(
        `SELECT t.id,
                t.organization_id,
                t.user_id,
                u.full_name,
                u.email,
                u.phone,
                t.designation,
                t.qualification,
                t.status,
                t.created_at,
                t.updated_at
         FROM teachers t
         JOIN users u ON u.id = t.user_id
         WHERE t.organization_id = $1
         ORDER BY t.created_at ASC`,
        [orgId]
      );

      return res.status(200).json({ teachers: result.rows });
    } catch (error) {
      console.error("List teachers error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list teachers." } });
    }
  });

  app.get("/api/teachers/:teacherId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const teacherId = typeof req.params?.teacherId === "string" ? req.params.teacherId.trim() : "";
      if (!teacherId || !isValidUuid(teacherId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Teacher id is invalid." } });
      }

      const teacherResult = await pool.query(
        `SELECT t.id, t.organization_id, t.user_id, t.designation, t.qualification, t.status, t.created_at, t.updated_at,
                u.full_name, u.email, u.phone
         FROM teachers t
         JOIN users u ON u.id = t.user_id
         WHERE t.id = $1
         LIMIT 1`,
        [teacherId]
      );

      if (teacherResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Teacher not found." } });
      }

      const teacher = teacherResult.rows[0];
      await resolveOrganizationContext(req, user, teacher.organization_id);

      return res.status(200).json({ teacher });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Get teacher error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch teacher." } });
    }
  });

  app.patch("/api/teachers/:teacherId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const teacherId = typeof req.params?.teacherId === "string" ? req.params.teacherId.trim() : "";
      if (!teacherId || !isValidUuid(teacherId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Teacher id is invalid." } });
      }

      const teacherResult = await pool.query(
        `SELECT id, organization_id FROM teachers WHERE id = $1 LIMIT 1`,
        [teacherId]
      );

      if (teacherResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Teacher not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, teacherResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to update teachers." } });
      }

      const designationProvided = typeof req.body?.designation === "string";
      const designation = designationProvided ? (req.body.designation.trim() || null) : undefined;
      const qualificationProvided = typeof req.body?.qualification === "string";
      const qualification = qualificationProvided ? (req.body.qualification.trim() || null) : undefined;

      const result = await pool.query(
        `UPDATE teachers
         SET designation = CASE WHEN $2 THEN $3 ELSE designation END,
             qualification = CASE WHEN $4 THEN $5 ELSE qualification END,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $6
         RETURNING id, organization_id, user_id, designation, qualification, status, created_at, updated_at`,
        [teacherId, designationProvided, designation, qualificationProvided, qualification, organizationContext.organization.id]
      );

      return res.status(200).json({ teacher: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Update teacher error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update teacher." } });
    }
  });

  app.post("/api/teachers/:teacherId/status", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const teacherId = typeof req.params?.teacherId === "string" ? req.params.teacherId.trim() : "";
      if (!teacherId || !isValidUuid(teacherId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Teacher id is invalid." } });
      }

      const status = typeof req.body?.status === "string" ? req.body.status.trim().toUpperCase() : "";
      if (!["ACTIVE", "INACTIVE"].includes(status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be ACTIVE or INACTIVE." } });
      }

      const teacherResult = await pool.query(
        `SELECT id, organization_id FROM teachers WHERE id = $1 LIMIT 1`,
        [teacherId]
      );

      if (teacherResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Teacher not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, teacherResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to manage teachers." } });
      }

      const result = await pool.query(
        `UPDATE teachers
         SET status = $2, updated_at = NOW()
         WHERE id = $1 AND organization_id = $3
         RETURNING id, organization_id, user_id, designation, qualification, status, created_at, updated_at`,
        [teacherId, status, organizationContext.organization.id]
      );

      return res.status(200).json({ teacher: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Update teacher status error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update teacher status." } });
    }
  });

  app.post(
    "/api/organizations/:id/students",
    requireAuth,
    requireOrganization,
    requireAnyRole(["SCHOOL_ADMIN", "COACHING_ADMIN"]),
    async (req, res) => {
      try {
        const authRequest = req as AuthenticatedRequest;
        const organizationContext = authRequest.organizationContext;
        const user = authRequest.user;

        if (!organizationContext || !user) {
          return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
        }

        const orgId = organizationContext.organization.id;
        const userId = typeof req.body?.user_id === "string" ? req.body.user_id.trim() : "";
        const fullName = typeof req.body?.full_name === "string" ? req.body.full_name.trim() : "";
        const gradeLevel = typeof req.body?.grade_level === "string" ? req.body.grade_level.trim() : null;
        const enrollmentNumber = typeof req.body?.enrollment_number === "string" && req.body.enrollment_number.trim() ? req.body.enrollment_number.trim() : null;

        if (!userId || !isValidUuid(userId) || !fullName) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Student user_id and full_name are required, and user_id must be a valid user id." } });
        }

        const userResult = await pool.query(`SELECT id FROM users WHERE id = $1 LIMIT 1`, [userId]);
        if (userResult.rows.length === 0) {
          return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found." } });
        }

        const result = await pool.query(
          `INSERT INTO students_v2 (organization_id, user_id, full_name, grade_level, enrollment_number)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, organization_id, user_id, enrollment_number, full_name, grade_level, status, created_at, updated_at`,
          [orgId, userId, fullName, gradeLevel, enrollmentNumber]
        );

        return res.status(201).json({ student: result.rows[0] });
      } catch (error) {
        const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
        if (errorCode === "23505") {
          return res.status(409).json({
            error: { code: "DUPLICATE_STUDENT", message: "A student profile for this user or enrollment number already exists in this organization." },
          });
        }
        console.error("Create student error:", error);
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create student." } });
      }
    }
  );

  app.get("/api/organizations/:id/students", requireAuth, requireOrganization, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const organizationContext = authRequest.organizationContext;

      if (!organizationContext) {
        return res.status(403).json({ error: { code: "ORGANIZATION_REQUIRED", message: "Organization context is required." } });
      }

      const orgId = organizationContext.organization.id;
      const enrollmentNumber = typeof req.query?.enrollment_number === "string" ? req.query.enrollment_number.trim() : "";
      const result = await pool.query(
        `SELECT s.id,
                s.organization_id,
                s.user_id,
                s.enrollment_number,
                s.full_name,
                s.grade_level,
                s.status,
                u.email,
                u.phone,
                s.created_at,
                s.updated_at
         FROM students_v2 s
         JOIN users u ON u.id = s.user_id
         WHERE s.organization_id = $1
           AND ($2 = '' OR s.enrollment_number = $2)
         ORDER BY s.created_at ASC`,
        [orgId, enrollmentNumber]
      );

      return res.status(200).json({ students: result.rows });
    } catch (error) {
      console.error("List students error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list students." } });
    }
  });

  app.get("/api/organizations/:organizationId/students/:studentId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId.trim() : "";
      const studentId = typeof req.params?.studentId === "string" ? req.params.studentId.trim() : "";
      if (!organizationId || !isValidUuid(organizationId) || !studentId || !isValidUuid(studentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Organization id and student id are required and must be valid." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, organizationId);

      const studentResult = await pool.query(
        `SELECT s.id, s.organization_id, s.user_id, s.enrollment_number, s.full_name, s.grade_level, s.status, s.created_at, s.updated_at,
                u.email, u.phone
         FROM students_v2 s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.organization_id = $2
         LIMIT 1`,
        [studentId, organizationContext.organization.id]
      );

      if (studentResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Student not found." } });
      }

      return res.status(200).json({ student: studentResult.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Get student error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch student." } });
    }
  });

  app.patch("/api/organizations/:organizationId/students/:studentId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId.trim() : "";
      const studentId = typeof req.params?.studentId === "string" ? req.params.studentId.trim() : "";
      if (!organizationId || !isValidUuid(organizationId) || !studentId || !isValidUuid(studentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Organization id and student id are required and must be valid." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, organizationId);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to update students." } });
      }

      const studentResult = await pool.query(`SELECT id FROM students_v2 WHERE id = $1 AND organization_id = $2 LIMIT 1`, [studentId, organizationContext.organization.id]);
      if (studentResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Student not found." } });
      }

      const fullNameProvided = typeof req.body?.full_name === "string";
      const fullName = fullNameProvided ? req.body.full_name.trim() : undefined;
      if (fullNameProvided && !fullName) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Student full_name cannot be empty." } });
      }
      const gradeLevelProvided = typeof req.body?.grade_level === "string";
      const gradeLevel = gradeLevelProvided ? (req.body.grade_level.trim() || null) : undefined;
      const enrollmentNumberProvided = typeof req.body?.enrollment_number === "string";
      const enrollmentNumber = enrollmentNumberProvided ? (req.body.enrollment_number.trim() || null) : undefined;

      const result = await pool.query(
        `UPDATE students_v2
         SET full_name = COALESCE($2, full_name),
             grade_level = CASE WHEN $3 THEN $4 ELSE grade_level END,
             enrollment_number = CASE WHEN $5 THEN $6 ELSE enrollment_number END,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $7
         RETURNING id, organization_id, user_id, enrollment_number, full_name, grade_level, status, created_at, updated_at`,
        [studentId, fullName ?? null, gradeLevelProvided, gradeLevel, enrollmentNumberProvided, enrollmentNumber, organizationContext.organization.id]
      );

      return res.status(200).json({ student: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
      if (errorCode === "23505") {
        return res.status(409).json({
          error: { code: "DUPLICATE_STUDENT", message: "A student with this enrollment number already exists in this organization." },
        });
      }
      console.error("Update student error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update student." } });
    }
  });

  app.post("/api/organizations/:organizationId/students/:studentId/status", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId.trim() : "";
      const studentId = typeof req.params?.studentId === "string" ? req.params.studentId.trim() : "";
      if (!organizationId || !isValidUuid(organizationId) || !studentId || !isValidUuid(studentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Organization id and student id are required and must be valid." } });
      }

      const status = typeof req.body?.status === "string" ? req.body.status.trim().toUpperCase() : "";
      if (!["ACTIVE", "INACTIVE"].includes(status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be ACTIVE or INACTIVE." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, organizationId);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to manage students." } });
      }

      const studentResult = await pool.query(`SELECT id FROM students_v2 WHERE id = $1 AND organization_id = $2 LIMIT 1`, [studentId, organizationContext.organization.id]);
      if (studentResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Student not found." } });
      }

      const result = await pool.query(
        `UPDATE students_v2
         SET status = $2, updated_at = NOW()
         WHERE id = $1 AND organization_id = $3
         RETURNING id, organization_id, user_id, enrollment_number, full_name, grade_level, status, created_at, updated_at`,
        [studentId, status, organizationContext.organization.id]
      );

      return res.status(200).json({ student: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Update student status error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update student status." } });
    }
  });

  // ==========================================================================
  // Parent / Guardian profile & relationship endpoints (US-029)
  // Parent profile = WHO the parent is (an org-scoped identity). The
  // parent-student relationship = WHICH students the parent may represent.
  // Parent involvement is OPTIONAL: no student requires a parent, and no parent
  // profile requires a student. Parent access is granted only through explicit
  // authorized relationships, never by org membership or name alone.
  // ==========================================================================

  app.post(
    "/api/organizations/:id/parents",
    requireAuth,
    requireOrganization,
    requireAnyRole(["SCHOOL_ADMIN", "COACHING_ADMIN"]),
    async (req, res) => {
      try {
        const authRequest = req as AuthenticatedRequest;
        const organizationContext = authRequest.organizationContext;
        const user = authRequest.user;

        if (!organizationContext || !user) {
          return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
        }

        const orgId = organizationContext.organization.id;
        const userId = typeof req.body?.user_id === "string" ? req.body.user_id.trim() : "";

        if (!userId || !isValidUuid(userId)) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Parent user_id is required and must be a valid user id." } });
        }

        const userResult = await pool.query(`SELECT id FROM users WHERE id = $1 LIMIT 1`, [userId]);
        if (userResult.rows.length === 0) {
          return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found." } });
        }

        const result = await pool.query(
          `INSERT INTO parent_profiles (organization_id, user_id)
           VALUES ($1, $2)
           RETURNING id, organization_id, user_id, status, created_at, updated_at`,
          [orgId, userId]
        );

        return res.status(201).json({ parent: result.rows[0] });
      } catch (error) {
        const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
        if (errorCode === "23505") {
          return res.status(409).json({
            error: { code: "DUPLICATE_PARENT", message: "A parent profile for this user already exists in this organization." },
          });
        }
        console.error("Create parent error:", error);
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create parent." } });
      }
    }
  );

  app.get("/api/organizations/:id/parents", requireAuth, requireOrganization, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const organizationContext = authRequest.organizationContext;

      if (!organizationContext) {
        return res.status(403).json({ error: { code: "ORGANIZATION_REQUIRED", message: "Organization context is required." } });
      }

      const orgId = organizationContext.organization.id;
      const result = await pool.query(
        `SELECT p.id,
                p.organization_id,
                p.user_id,
                u.full_name,
                u.email,
                u.phone,
                p.status,
                p.created_at,
                p.updated_at
         FROM parent_profiles p
         JOIN users u ON u.id = p.user_id
         WHERE p.organization_id = $1
         ORDER BY p.created_at ASC`,
        [orgId]
      );

      return res.status(200).json({ parents: result.rows });
    } catch (error) {
      console.error("List parents error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list parents." } });
    }
  });

  app.get("/api/parents/:parentId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const parentId = typeof req.params?.parentId === "string" ? req.params.parentId.trim() : "";
      if (!parentId || !isValidUuid(parentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Parent id is invalid." } });
      }

      const parentResult = await pool.query(
        `SELECT p.id, p.organization_id, p.user_id, p.status, p.created_at, p.updated_at,
                u.full_name, u.email, u.phone
         FROM parent_profiles p
         JOIN users u ON u.id = p.user_id
         WHERE p.id = $1
         LIMIT 1`,
        [parentId]
      );

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Parent not found." } });
      }

      const parent = parentResult.rows[0];
      await resolveOrganizationContext(req, user, parent.organization_id);

      return res.status(200).json({ parent });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Get parent error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch parent." } });
    }
  });

  app.patch("/api/parents/:parentId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const parentId = typeof req.params?.parentId === "string" ? req.params.parentId.trim() : "";
      if (!parentId || !isValidUuid(parentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Parent id is invalid." } });
      }

      const parentResult = await pool.query(
        `SELECT id, organization_id, user_id FROM parent_profiles WHERE id = $1 LIMIT 1`,
        [parentId]
      );

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Parent not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, parentResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to update parents." } });
      }

      const statusProvided = typeof req.body?.status === "string";
      const status = statusProvided ? req.body.status.trim().toUpperCase() : undefined;
      if (statusProvided && !["ACTIVE", "INACTIVE"].includes(status as string)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be ACTIVE or INACTIVE." } });
      }

      const result = await pool.query(
        `UPDATE parent_profiles
         SET status = COALESCE($2, status),
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $3
         RETURNING id, organization_id, user_id, status, created_at, updated_at`,
        [parentId, status ?? null, organizationContext.organization.id]
      );

      return res.status(200).json({ parent: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Update parent error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update parent." } });
    }
  });

  app.post("/api/parents/:parentId/status", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const parentId = typeof req.params?.parentId === "string" ? req.params.parentId.trim() : "";
      if (!parentId || !isValidUuid(parentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Parent id is invalid." } });
      }

      const status = typeof req.body?.status === "string" ? req.body.status.trim().toUpperCase() : "";
      if (!["ACTIVE", "INACTIVE"].includes(status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be ACTIVE or INACTIVE." } });
      }

      const parentResult = await pool.query(
        `SELECT id, organization_id FROM parent_profiles WHERE id = $1 LIMIT 1`,
        [parentId]
      );

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Parent not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, parentResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to manage parents." } });
      }

      const result = await pool.query(
        `UPDATE parent_profiles
         SET status = $2, updated_at = NOW()
         WHERE id = $1 AND organization_id = $3
         RETURNING id, organization_id, user_id, status, created_at, updated_at`,
        [parentId, status, organizationContext.organization.id]
      );

      return res.status(200).json({ parent: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Update parent status error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update parent status." } });
    }
  });

  app.post("/api/parents/:parentId/students", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const parentId = typeof req.params?.parentId === "string" ? req.params.parentId.trim() : "";
      if (!parentId || !isValidUuid(parentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Parent id is invalid." } });
      }

      const parentResult = await pool.query(
        `SELECT id, organization_id, user_id FROM parent_profiles WHERE id = $1 LIMIT 1`,
        [parentId]
      );

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Parent not found." } });
      }

      const parent = parentResult.rows[0];
      const organizationContext = await resolveOrganizationContext(req, user, parent.organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to manage parent relationships." } });
      }

      const studentId = typeof req.body?.student_id === "string" ? req.body.student_id.trim() : "";
      if (!studentId || !isValidUuid(studentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "student_id is required and must be a valid student id." } });
      }

      const relationshipType = typeof req.body?.relationship_type === "string" ? req.body.relationship_type.trim().toUpperCase() : "PARENT";
      if (!["PARENT", "GUARDIAN"].includes(relationshipType)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "relationship_type must be PARENT or GUARDIAN." } });
      }

      const isPrimary = req.body?.is_primary === true || req.body?.is_primary === "true";

      const studentResult = await pool.query(
        `SELECT id, organization_id FROM students_v2 WHERE id = $1 LIMIT 1`,
        [studentId]
      );

      if (studentResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Student not found." } });
      }

      if (studentResult.rows[0].organization_id !== parent.organization_id) {
        return res.status(403).json({ error: { code: "ORGANIZATION_MISMATCH", message: "Parent and student must belong to the same organization." } });
      }

      const result = await pool.query(
        `INSERT INTO parent_student_relationships (organization_id, parent_profile_id, student_id, relationship_type, is_primary)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, parent_profile_id, student_id, relationship_type, is_primary, status, created_at, updated_at`,
        [parent.organization_id, parentId, studentId, relationshipType, isPrimary]
      );

      return res.status(201).json({ relationship: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
      if (errorCode === "23505") {
        return res.status(409).json({
          error: { code: "DUPLICATE_RELATIONSHIP", message: "A parent-student relationship already exists for this student." },
        });
      }
      console.error("Create parent relationship error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create parent relationship." } });
    }
  });

  app.get("/api/parents/:parentId/students", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const parentId = typeof req.params?.parentId === "string" ? req.params.parentId.trim() : "";
      if (!parentId || !isValidUuid(parentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Parent id is invalid." } });
      }

      const parentResult = await pool.query(
        `SELECT id, organization_id, user_id FROM parent_profiles WHERE id = $1 LIMIT 1`,
        [parentId]
      );

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Parent not found." } });
      }

      const parent = parentResult.rows[0];
      const organizationContext = await resolveOrganizationContext(req, user, parent.organization_id);

      const isAdmin = ["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name);
      const isSelf = user.id === parent.user_id;
      if (!isAdmin && !isSelf) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to view this parent's students." } });
      }

      const result = await pool.query(
        `SELECT psr.id AS relationship_id,
                psr.relationship_type,
                psr.is_primary,
                psr.status AS relationship_status,
                s.id AS student_id,
                s.full_name,
                s.grade_level,
                s.enrollment_number,
                s.status AS student_status
         FROM parent_student_relationships psr
         JOIN students_v2 s ON s.id = psr.student_id
         WHERE psr.parent_profile_id = $1
           AND psr.organization_id = $2
         ORDER BY psr.created_at ASC`,
        [parentId, parent.organization_id]
      );

      return res.status(200).json({ students: result.rows });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("List parent students error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list parent students." } });
    }
  });

  app.get("/api/organizations/:organizationId/students/:studentId/parents", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId.trim() : "";
      const studentId = typeof req.params?.studentId === "string" ? req.params.studentId.trim() : "";
      if (!organizationId || !isValidUuid(organizationId) || !studentId || !isValidUuid(studentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Organization id and student id are required and must be valid." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, organizationId);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to view this student's parents." } });
      }

      const result = await pool.query(
        `SELECT psr.id AS relationship_id,
                psr.relationship_type,
                psr.is_primary,
                psr.status AS relationship_status,
                p.id AS parent_id,
                p.status AS parent_status,
                u.full_name,
                u.email,
                u.phone
         FROM parent_student_relationships psr
         JOIN parent_profiles p ON p.id = psr.parent_profile_id
         JOIN users u ON u.id = p.user_id
         WHERE psr.student_id = $1
           AND psr.organization_id = $2
         ORDER BY psr.created_at ASC`,
        [studentId, organizationContext.organization.id]
      );

      return res.status(200).json({ parents: result.rows });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("List student parents error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list student parents." } });
    }
  });

  app.patch("/api/parent-student-relationships/:relationshipId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const relationshipId = typeof req.params?.relationshipId === "string" ? req.params.relationshipId.trim() : "";
      if (!relationshipId || !isValidUuid(relationshipId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Relationship id is invalid." } });
      }

      const relationshipResult = await pool.query(
        `SELECT id, organization_id, parent_profile_id, student_id FROM parent_student_relationships WHERE id = $1 LIMIT 1`,
        [relationshipId]
      );

      if (relationshipResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Relationship not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, relationshipResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to update parent relationships." } });
      }

      const relationshipTypeProvided = typeof req.body?.relationship_type === "string";
      const relationshipType = relationshipTypeProvided ? req.body.relationship_type.trim().toUpperCase() : undefined;
      if (relationshipTypeProvided && !["PARENT", "GUARDIAN"].includes(relationshipType as string)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "relationship_type must be PARENT or GUARDIAN." } });
      }

      const isPrimaryProvided = typeof req.body?.is_primary === "boolean" || req.body?.is_primary === "true" || req.body?.is_primary === "false";
      const isPrimary = isPrimaryProvided ? (req.body?.is_primary === true || req.body?.is_primary === "true") : undefined;

      const statusProvided = typeof req.body?.status === "string";
      const status = statusProvided ? req.body.status.trim().toUpperCase() : undefined;
      if (statusProvided && !["ACTIVE", "INACTIVE"].includes(status as string)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be ACTIVE or INACTIVE." } });
      }

      const result = await pool.query(
        `UPDATE parent_student_relationships
         SET relationship_type = COALESCE($2, relationship_type),
             is_primary = COALESCE($3, is_primary),
             status = COALESCE($4, status),
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $5
         RETURNING id, organization_id, parent_profile_id, student_id, relationship_type, is_primary, status, created_at, updated_at`,
        [relationshipId, relationshipType ?? null, isPrimary ?? null, status ?? null, organizationContext.organization.id]
      );

      return res.status(200).json({ relationship: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Update parent relationship error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update parent relationship." } });
    }
  });

  app.post("/api/parent-student-relationships/:relationshipId/status", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const relationshipId = typeof req.params?.relationshipId === "string" ? req.params.relationshipId.trim() : "";
      if (!relationshipId || !isValidUuid(relationshipId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Relationship id is invalid." } });
      }

      const status = typeof req.body?.status === "string" ? req.body.status.trim().toUpperCase() : "";
      if (!["ACTIVE", "INACTIVE"].includes(status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be ACTIVE or INACTIVE." } });
      }

      const relationshipResult = await pool.query(
        `SELECT id, organization_id FROM parent_student_relationships WHERE id = $1 LIMIT 1`,
        [relationshipId]
      );

      if (relationshipResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Relationship not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, relationshipResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to manage parent relationships." } });
      }

      const result = await pool.query(
        `UPDATE parent_student_relationships
         SET status = $2, updated_at = NOW()
         WHERE id = $1 AND organization_id = $3
         RETURNING id, organization_id, parent_profile_id, student_id, relationship_type, is_primary, status, created_at, updated_at`,
        [relationshipId, status, organizationContext.organization.id]
      );

      return res.status(200).json({ relationship: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Update parent relationship status error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update parent relationship status." } });
    }
  });

  app.post(
    "/api/organizations/:id/classes", requireAuth, requireOrganization, requireAnyRole(["SCHOOL_ADMIN", "COACHING_ADMIN"]), async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const organizationContext = authRequest.organizationContext;
      const user = authRequest.user;

      if (!organizationContext || !user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const orgId = organizationContext.organization.id;
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const section = typeof req.body?.section === "string" ? req.body.section.trim() : null;
      const academicYearProvided = typeof req.body?.academic_year === "string" && req.body.academic_year.trim() !== "";
      const academicYear = academicYearProvided ? normalizeAcademicYear(req.body.academic_year) : null;

      if (!name) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class name is required." } });
      }

      if (academicYearProvided && !academicYear) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "academic_year must use the format YYYY-YY (e.g. 2026-27)." } });
      }

      const result = await pool.query(
        `INSERT INTO classes (organization_id, name, section, academic_year, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, name, section, academic_year, status, created_at, updated_at`,
        [orgId, name, section, academicYear, user.id]
      );

      return res.status(201).json({ class: result.rows[0] });
    } catch (error) {
      const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
      if (errorCode === "23505") {
        return res.status(409).json({
          error: {
            code: "DUPLICATE_CLASS",
            message: "A class or grade with this name already exists in this organization.",
          },
        });
      }

      console.error("Create class error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create class." } });
    }
  });

  app.get("/api/organizations/:id/classes", requireAuth, requireOrganization, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const organizationContext = authRequest.organizationContext;

      if (!organizationContext) {
        return res.status(403).json({ error: { code: "ORGANIZATION_REQUIRED", message: "Organization context is required." } });
      }

      const orgId = organizationContext.organization.id;
      const result = await pool.query(`SELECT id, organization_id, name, section, academic_year, status, created_at, updated_at FROM classes WHERE organization_id = $1 ORDER BY created_at ASC`, [orgId]);

      return res.status(200).json({ classes: result.rows });
    } catch (error) {
      console.error("List classes error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list classes." } });
    }
  });

  app.get("/api/classes/:classId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      if (!classId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id is required." } });
      }

      const classResult = await pool.query(
        `SELECT id, organization_id, name, section, academic_year, status, created_at, updated_at
         FROM classes
         WHERE id = $1
         LIMIT 1`,
        [classId]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const classRecord = classResult.rows[0];
      await resolveOrganizationContext(req, user, classRecord.organization_id);

      return res.status(200).json({ class: classRecord });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      console.error("Get class error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch class." } });
    }
  });

  app.patch("/api/classes/:classId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      if (!classId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id is required." } });
      }

      const classResult = await pool.query(
        `SELECT id, organization_id FROM classes WHERE id = $1 LIMIT 1`,
        [classId]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, classResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to update classes." } });
      }

      const nameProvided = typeof req.body?.name === "string";
      const name = nameProvided ? req.body.name.trim() : undefined;
      if (nameProvided && !name) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class name cannot be empty." } });
      }

      const sectionProvided = typeof req.body?.section === "string";
      const section = sectionProvided ? (req.body.section.trim() || null) : undefined;

      const academicYearProvided = typeof req.body?.academic_year === "string";
      let academicYear: string | null | undefined;
      if (academicYearProvided) {
        if (req.body.academic_year.trim() === "") {
          academicYear = null;
        } else {
          const normalized = normalizeAcademicYear(req.body.academic_year);
          if (!normalized) {
            return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "academic_year must use the format YYYY-YY (e.g. 2026-27)." } });
          }
          academicYear = normalized;
        }
      }

      const result = await pool.query(
        `UPDATE classes
         SET name = COALESCE($2, name),
             section = CASE WHEN $3 THEN $4 ELSE section END,
             academic_year = CASE WHEN $5 THEN $6 ELSE academic_year END,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $7
         RETURNING id, organization_id, name, section, academic_year, status, created_at, updated_at`,
        [classId, name ?? null, sectionProvided, section ?? null, academicYearProvided, academicYear ?? null, organizationContext.organization.id]
      );

      return res.status(200).json({ class: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
      if (errorCode === "23505") {
        return res.status(409).json({
          error: {
            code: "DUPLICATE_CLASS",
            message: "A class or grade with this name already exists in this organization.",
          },
        });
      }

      console.error("Update class error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update class." } });
    }
  });

  app.post("/api/classes/:classId/status", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      if (!classId || !isValidUuid(classId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id is invalid." } });
      }

      const status = typeof req.body?.status === "string" ? req.body.status.trim().toUpperCase() : "";
      if (!["ACTIVE", "INACTIVE"].includes(status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be ACTIVE or INACTIVE." } });
      }

      const classResult = await pool.query(`SELECT id, organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      if (classResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, classResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to manage classes." } });
      }

      const result = await pool.query(
        `UPDATE classes
         SET status = $2, updated_at = NOW()
         WHERE id = $1 AND organization_id = $3
         RETURNING id, organization_id, name, section, academic_year, status, created_at, updated_at`,
        [classId, status, organizationContext.organization.id]
      );

      return res.status(200).json({ class: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Update class status error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update class status." } });
    }
  });

  app.post("/api/classes/:classId/invitations", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      if (!classId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id is required." } });
      }

      const classResult = await pool.query(
        `SELECT c.id, c.organization_id, c.name, c.section, c.academic_year,
                o.status AS organization_status, o.name AS organization_name, o.type AS organization_type
         FROM classes c
         JOIN organizations o ON o.id = c.organization_id
         WHERE c.id = $1
         LIMIT 1`,
        [classId]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const classRecord = classResult.rows[0];
      if (classRecord.organization_status !== "ACTIVE") {
        return res.status(403).json({ error: { code: "ORGANIZATION_INACTIVE", message: "Organization is not active." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, classRecord.organization_id);
      const isAdmin = ["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name);
      const teacherResult = await pool.query(
        `SELECT t.id
         FROM teachers t
         JOIN class_teacher_assignments cta ON cta.teacher_id = t.id
         WHERE t.user_id = $1
           AND t.organization_id = $2
           AND cta.class_id = $3
         LIMIT 1`,
        [user.id, classRecord.organization_id, classId]
      );

      if (!isAdmin && teacherResult.rows.length === 0) {
        return res.status(403).json({ error: { code: "FORBIDDEN", message: "You are not authorized to create invitations for this class." } });
      }

      const rawToken = generateInvitationToken();
      const expiresAt = parseInvitationExpiresAt(req.body?.expires_at);
      const maxUses = parseInvitationMaxUses(req.body?.max_uses);

      const invitationResult = await pool.query(
        `INSERT INTO class_invitations (
            organization_id,
            class_id,
            created_by_user_id,
            token_hash,
            expires_at,
            max_uses,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
          RETURNING id, organization_id, class_id, created_by_user_id, expires_at, max_uses, use_count, status, created_at, updated_at`,
        [classRecord.organization_id, classId, user.id, hashInvitationToken(rawToken), expiresAt, maxUses]
      );

      const invitation = invitationResult.rows[0];
      const joinUrl = `/api/invitations/${rawToken}`;

      return res.status(201).json({
        invitation: {
          id: invitation.id,
          class_id: invitation.class_id,
          organization_id: invitation.organization_id,
          status: invitation.status,
          expires_at: invitation.expires_at,
          max_uses: invitation.max_uses,
          use_count: invitation.use_count,
          join_url: joinUrl,
          token: rawToken,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      console.error("Create class invitation error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create invitation." } });
    }
  });

  app.get("/api/classes/:classId/invitations", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      if (!classId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id is required." } });
      }

      const classResult = await pool.query(
        `SELECT c.id, c.organization_id
         FROM classes c
         WHERE c.id = $1
         LIMIT 1`,
        [classId]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, classResult.rows[0].organization_id);
      const isAdmin = ["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name);
      if (!isAdmin) {
        const teacherResult = await pool.query(
          `SELECT t.id
           FROM teachers t
           JOIN class_teacher_assignments cta ON cta.teacher_id = t.id
           WHERE t.user_id = $1
             AND t.organization_id = $2
             AND cta.class_id = $3
           LIMIT 1`,
          [user.id, classResult.rows[0].organization_id, classId]
        );

        if (teacherResult.rows.length === 0) {
          return res.status(403).json({ error: { code: "FORBIDDEN", message: "You are not authorized to list invitations for this class." } });
        }
      }

      const invitations = await pool.query(
        `SELECT id, class_id, organization_id, status, expires_at, max_uses, use_count, created_at, updated_at
         FROM class_invitations
         WHERE class_id = $1
         ORDER BY created_at DESC`,
        [classId]
      );

      return res.status(200).json({ invitations: invitations.rows });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      console.error("List class invitations error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list invitations." } });
    }
  });

  app.delete("/api/classes/:classId/invitations/:invitationId", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      const invitationId = typeof req.params?.invitationId === "string" ? req.params.invitationId.trim() : "";
      if (!classId || !invitationId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id and invitation id are required." } });
      }

      const invitationResult = await pool.query(
        `SELECT ci.id, ci.organization_id, ci.class_id, ci.status
         FROM class_invitations ci
         WHERE ci.id = $1 AND ci.class_id = $2
         LIMIT 1`,
        [invitationId, classId]
      );

      if (invitationResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Invitation not found." } });
      }

      const invitation = invitationResult.rows[0];
      const organizationContext = await resolveOrganizationContext(req, user, invitation.organization_id);
      const isAdmin = ["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name);
      if (!isAdmin) {
        const teacherResult = await pool.query(
          `SELECT t.id
           FROM teachers t
           JOIN class_teacher_assignments cta ON cta.teacher_id = t.id
           WHERE t.user_id = $1
             AND t.organization_id = $2
             AND cta.class_id = $3
           LIMIT 1`,
          [user.id, invitation.organization_id, classId]
        );

        if (teacherResult.rows.length === 0) {
          return res.status(403).json({ error: { code: "FORBIDDEN", message: "You are not authorized to revoke this invitation." } });
        }
      }

      const revokedResult = await pool.query(
        `UPDATE class_invitations
         SET status = 'REVOKED', updated_at = NOW()
         WHERE id = $1
         RETURNING id, status`,
        [invitationId]
      );

      return res.status(200).json({ invitation: revokedResult.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      console.error("Revoke class invitation error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to revoke invitation." } });
    }
  });

  app.get("/api/invitations/:token", async (req, res) => {
    try {
      const rawToken = typeof req.params?.token === "string" ? req.params.token.trim() : "";
      if (!rawToken) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invitation token is required." } });
      }

      const tokenHash = hashInvitationToken(rawToken);
      const result = await pool.query(
        `SELECT ci.id,
                ci.status,
                ci.expires_at,
                ci.max_uses,
                ci.use_count,
                c.name AS class_name,
                c.section,
                c.academic_year,
                o.name AS organization_name,
                o.slug AS organization_slug,
                o.type AS organization_type,
                o.status AS organization_status
         FROM class_invitations ci
         JOIN classes c ON c.id = ci.class_id
         JOIN organizations o ON o.id = ci.organization_id
         WHERE ci.token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: { code: "INVITATION_NOT_FOUND", message: "Invitation not found." } });
      }

      const invitation = result.rows[0];
      if (invitation.organization_status !== "ACTIVE") {
        return res.status(410).json({ error: { code: "INVITATION_INVALID", message: "Invitation is not valid for an active organization." } });
      }

      if (invitation.status !== "ACTIVE") {
        return res.status(410).json({ error: { code: "INVITATION_INVALID", message: "Invitation is no longer active." } });
      }

      if (invitation.expires_at && new Date(invitation.expires_at) <= new Date()) {
        return res.status(410).json({ error: { code: "INVITATION_EXPIRED", message: "Invitation has expired." } });
      }

      if (invitation.max_uses !== null && invitation.use_count >= invitation.max_uses) {
        return res.status(410).json({ error: { code: "INVITATION_LIMIT_REACHED", message: "Invitation usage limit has been reached." } });
      }

      return res.status(200).json({
        invitation: {
          id: invitation.id,
          status: invitation.status,
          class: {
            name: invitation.class_name,
            section: invitation.section,
            academic_year: invitation.academic_year,
          },
          organization: {
            name: invitation.organization_name,
            slug: invitation.organization_slug,
            type: invitation.organization_type,
          },
          expires_at: invitation.expires_at,
          max_uses: invitation.max_uses,
          use_count: invitation.use_count,
        },
      });
    } catch (error) {
      console.error("Lookup invitation error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load invitation." } });
    }
  });

  app.post("/api/invitations/:token/join", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const rawToken = typeof req.params?.token === "string" ? req.params.token.trim() : "";
      if (!rawToken) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invitation token is required." } });
      }

      const tokenHash = hashInvitationToken(rawToken);
      const invitationResult = await pool.query(
        `SELECT ci.id,
                ci.organization_id,
                ci.class_id,
                ci.status,
                ci.expires_at,
                ci.max_uses,
                ci.use_count,
                c.name AS class_name,
                c.section,
                c.academic_year,
                o.name AS organization_name,
                o.status AS organization_status,
                o.type AS organization_type
         FROM class_invitations ci
         JOIN classes c ON c.id = ci.class_id
         JOIN organizations o ON o.id = ci.organization_id
         WHERE ci.token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );

      if (invitationResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "INVITATION_NOT_FOUND", message: "Invitation not found." } });
      }

      const invitation = invitationResult.rows[0];
      if (invitation.organization_status !== "ACTIVE") {
        return res.status(410).json({ error: { code: "INVITATION_INVALID", message: "Invitation is not valid for an active organization." } });
      }

      if (invitation.status !== "ACTIVE") {
        return res.status(410).json({ error: { code: "INVITATION_INVALID", message: "Invitation is no longer active." } });
      }

      if (invitation.expires_at && new Date(invitation.expires_at) <= new Date()) {
        return res.status(410).json({ error: { code: "INVITATION_EXPIRED", message: "Invitation has expired." } });
      }

      if (invitation.max_uses !== null && invitation.use_count >= invitation.max_uses) {
        return res.status(410).json({ error: { code: "INVITATION_LIMIT_REACHED", message: "Invitation usage limit has been reached." } });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const membershipResult = await client.query(
         `SELECT om.organization_id, r.name AS role_name
           FROM organization_members om
           JOIN roles r ON r.id = om.role_id
           WHERE om.user_id = $1
             AND om.status = 'ACTIVE'
             AND om.organization_id = $2
           LIMIT 1`,
         [user.id, invitation.organization_id]
        );

        if (membershipResult.rows.length === 0 || membershipResult.rows[0].role_name !== "STUDENT") {
         await client.query("ROLLBACK");
         return res.status(403).json({ error: { code: "STUDENT_REQUIRED", message: "Only a student account can join with an invitation." } });
        }

        const studentResult = await client.query(
         `SELECT id, organization_id, user_id
           FROM students_v2
           WHERE user_id = $1 AND organization_id = $2
           LIMIT 1`,
         [user.id, invitation.organization_id]
        );

        let studentRecord = studentResult.rows[0] ?? null;
        if (!studentRecord) {
         const userResult = await client.query(
           `SELECT full_name FROM users WHERE id = $1 LIMIT 1`,
           [user.id]
         );
         const fallbackName = typeof userResult.rows[0]?.full_name === "string" ? userResult.rows[0].full_name.trim() : "Student";
         const createdStudentResult = await client.query(
           `INSERT INTO students_v2 (organization_id, user_id, full_name, grade_level, status)
             VALUES ($1, $2, $3, $4, 'ACTIVE')
             RETURNING id, organization_id, user_id, full_name, grade_level`,
           [invitation.organization_id, user.id, fallbackName || "Student", null]
         );
         studentRecord = createdStudentResult.rows[0];
        }

        const existingEnrollment = await client.query(
         `SELECT id FROM student_enrollments
           WHERE student_id = $1 AND class_id = $2 AND status = 'ACTIVE'
           LIMIT 1`,
         [studentRecord.id, invitation.class_id]
        );

        if (existingEnrollment.rows.length > 0) {
         await client.query("ROLLBACK");
         return res.status(409).json({ error: { code: "ALREADY_ENROLLED", message: "Student is already enrolled in this class." } });
        }

        const enrollmentResult = await client.query(
         `INSERT INTO student_enrollments (organization_id, student_id, class_id, academic_year, status)
           VALUES ($1, $2, $3, $4, 'ACTIVE')
           RETURNING id, organization_id, student_id, class_id, academic_year, status, enrolled_on, created_at, updated_at`,
         [invitation.organization_id, studentRecord.id, invitation.class_id, invitation.academic_year]
        );

        await client.query(
         `UPDATE class_invitations
           SET use_count = use_count + 1,
               updated_at = NOW()
           WHERE id = $1`,
         [invitation.id]
        );

        await client.query("COMMIT");

        return res.status(201).json({ enrollment: enrollmentResult.rows[0] });
      } catch (error) {
        try {
         await client.query("ROLLBACK");
        } catch {
         // Ignore rollback errors after transaction failure.
        }
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      console.error("Join class invitation error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to join class." } });
    }
  });

  app.get("/api/organizations/:orgId/subjects", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const orgId = typeof req.params?.orgId === "string" ? req.params.orgId.trim() : "";
      if (!orgId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Organization id is required." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, orgId);
      const result = await pool.query(
        `SELECT id, organization_id, name, code, status, created_at, updated_at
         FROM subjects
         WHERE organization_id = $1
         ORDER BY name ASC`,
        [organizationContext.organization.id]
      );

      return res.status(200).json({ subjects: result.rows });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      console.error("List subjects error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list subjects." } });
    }
  });

  app.post("/api/organizations/:orgId/subjects", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const orgId = typeof req.params?.orgId === "string" ? req.params.orgId.trim() : "";
      if (!orgId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Organization id is required." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, orgId);
      const allowedRoles = ["SCHOOL_ADMIN", "COACHING_ADMIN"];
      if (!allowedRoles.includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to create subjects." } });
      }

      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Subject name is required." } });
      }

      const code = typeof req.body?.code === "string" && req.body.code.trim() ? req.body.code.trim() : null;

      const result = await pool.query(
        `INSERT INTO subjects (organization_id, name, code)
         VALUES ($1, $2, $3)
         RETURNING id, organization_id, name, code, status, created_at, updated_at`,
        [organizationContext.organization.id, name, code]
      );

      return res.status(201).json({ subject: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
      if (errorCode === "23505") {
        return res.status(409).json({
          error: {
            code: "DUPLICATE_SUBJECT",
            message: "A subject with the same name or code already exists in this organization.",
          },
        });
      }

      console.error("Create subject error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create subject." } });
    }
  });

  app.get("/api/subjects/:subjectId", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const subjectId = typeof req.params?.subjectId === "string" ? req.params.subjectId.trim() : "";
      if (!subjectId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Subject id is required." } });
      }

      const subjectResult = await pool.query(
        `SELECT id, organization_id, name, code, status, created_at, updated_at
         FROM subjects
         WHERE id = $1
         LIMIT 1`,
        [subjectId]
      );

      if (subjectResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Subject not found." } });
      }

      const subject = subjectResult.rows[0];
      await resolveOrganizationContext(req, user, subject.organization_id);

      return res.status(200).json({ subject });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      console.error("Get subject error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch subject." } });
    }
  });

  app.patch("/api/subjects/:subjectId", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const subjectId = typeof req.params?.subjectId === "string" ? req.params.subjectId.trim() : "";
      if (!subjectId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Subject id is required." } });
      }

      const subjectResult = await pool.query(
        `SELECT id, organization_id FROM subjects WHERE id = $1 LIMIT 1`,
        [subjectId]
      );

      if (subjectResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Subject not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, subjectResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to update subjects." } });
      }

      const nameProvided = typeof req.body?.name === "string";
      const name = nameProvided ? req.body.name.trim() : undefined;
      if (nameProvided && !name) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Subject name cannot be empty." } });
      }

      const codeProvided = typeof req.body?.code === "string";
      const code = codeProvided ? (req.body.code.trim() || null) : undefined;

      const result = await pool.query(
        `UPDATE subjects
         SET name = COALESCE($2, name),
             code = CASE WHEN $3 THEN $4 ELSE code END,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $5
         RETURNING id, organization_id, name, code, status, created_at, updated_at`,
        [subjectId, name ?? null, codeProvided, code ?? null, organizationContext.organization.id]
      );

      return res.status(200).json({ subject: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
      if (errorCode === "23505") {
        return res.status(409).json({
          error: {
            code: "DUPLICATE_SUBJECT",
            message: "A subject with the same name or code already exists in this organization.",
          },
        });
      }

      console.error("Update subject error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update subject." } });
    }
  });

  app.post("/api/subjects/:subjectId/status", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const subjectId = typeof req.params?.subjectId === "string" ? req.params.subjectId.trim() : "";
      if (!subjectId || !isValidUuid(subjectId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Subject id is invalid." } });
      }

      const status = typeof req.body?.status === "string" ? req.body.status.trim().toUpperCase() : "";
      if (!["ACTIVE", "INACTIVE"].includes(status)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "status must be ACTIVE or INACTIVE." } });
      }

      const subjectResult = await pool.query(`SELECT id, organization_id FROM subjects WHERE id = $1 LIMIT 1`, [subjectId]);
      if (subjectResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Subject not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, subjectResult.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to manage subjects." } });
      }

      const result = await pool.query(
        `UPDATE subjects
         SET status = $2, updated_at = NOW()
         WHERE id = $1 AND organization_id = $3
         RETURNING id, organization_id, name, code, status, created_at, updated_at`,
        [subjectId, status, organizationContext.organization.id]
      );

      return res.status(200).json({ subject: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Update subject status error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update subject status." } });
    }
  });

  app.get("/api/classes/:classId/subjects", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      if (!classId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id is required." } });
      }

      const classResult = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      if (classResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, classResult.rows[0].organization_id);
      const result = await pool.query(
        `SELECT cs.id,
                cs.class_id,
                cs.subject_id,
                s.organization_id,
                s.name,
                s.code,
                s.status,
                s.created_at,
                s.updated_at
         FROM class_subjects cs
         JOIN subjects s ON s.id = cs.subject_id
         WHERE cs.class_id = $1 AND s.organization_id = $2 AND cs.status = 'ACTIVE'
         ORDER BY s.name ASC`,
        [classId, organizationContext.organization.id]
      );

      return res.status(200).json({ subjects: result.rows });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      console.error("List class subjects error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list class subjects." } });
    }
  });

  app.post("/api/classes/:classId/subjects/:subjectId", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      const subjectId = typeof req.params?.subjectId === "string" ? req.params.subjectId.trim() : "";
      if (!classId || !subjectId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id and subject id are required." } });
      }

      const classResult = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      if (classResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const subjectResult = await pool.query(`SELECT organization_id FROM subjects WHERE id = $1 LIMIT 1`, [subjectId]);
      if (subjectResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Subject not found." } });
      }

      const orgId = classResult.rows[0].organization_id;
      if (subjectResult.rows[0].organization_id !== orgId) {
        return res.status(403).json({ error: { code: "ORGANIZATION_MISMATCH", message: "Class and subject must belong to the same organization." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, orgId);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to assign subjects to classes." } });
      }

      const existingResult = await pool.query(
        `SELECT id, status FROM class_subjects WHERE organization_id = $1 AND class_id = $2 AND subject_id = $3 LIMIT 1`,
        [orgId, classId, subjectId]
      );

      if (existingResult.rows.length > 0 && existingResult.rows[0].status === "ACTIVE") {
        return res.status(409).json({ error: { code: "DUPLICATE_CLASS_SUBJECT", message: "This subject is already assigned to the class." } });
      }

      if (existingResult.rows.length > 0) {
        // Reactivate a previously deactivated mapping (historical preservation).
        const reactivated = await pool.query(
          `UPDATE class_subjects
           SET status = 'ACTIVE', updated_at = NOW()
           WHERE id = $1
           RETURNING id, organization_id, class_id, subject_id, status, created_at, updated_at`,
          [existingResult.rows[0].id]
        );
        return res.status(200).json({ class_subject: reactivated.rows[0] });
      }

      const insertResult = await pool.query(
        `INSERT INTO class_subjects (organization_id, class_id, subject_id)
         VALUES ($1, $2, $3)
         RETURNING id, organization_id, class_id, subject_id, status, created_at, updated_at`,
        [orgId, classId, subjectId]
      );

      return res.status(201).json({ class_subject: insertResult.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: string }).code) : "";
      if (errorCode === "23505") {
        return res.status(409).json({ error: { code: "DUPLICATE_CLASS_SUBJECT", message: "This subject is already assigned to the class." } });
      }

      console.error("Assign subject to class error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to assign subject to class." } });
    }
  });

  // Bulk map subjects to a class (minimum admin data entry).
  app.post("/api/classes/:classId/subjects", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      if (!classId || !isValidUuid(classId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id is invalid." } });
      }

      const rawSubjectIds = Array.isArray(req.body?.subject_ids) ? req.body.subject_ids : [];
      const subjectIds = Array.from(new Set(rawSubjectIds.filter((id: unknown): id is string => typeof id === "string" && isValidUuid(id.trim())).map((id: string) => id.trim())));
      if (subjectIds.length === 0) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "subject_ids must be a non-empty array of subject ids." } });
      }

      const classResult = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      if (classResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const orgId = classResult.rows[0].organization_id;
      const organizationContext = await resolveOrganizationContext(req, user, orgId);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to assign subjects to classes." } });
      }

      const subjectsResult = await pool.query(
        `SELECT id FROM subjects WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [orgId, subjectIds]
      );
      if (subjectsResult.rows.length !== subjectIds.length) {
        return res.status(403).json({ error: { code: "ORGANIZATION_MISMATCH", message: "One or more subjects do not belong to this organization." } });
      }

      const mapped = [];
      for (const subjectId of subjectIds) {
        const result = await pool.query(
          `INSERT INTO class_subjects (organization_id, class_id, subject_id, status)
           VALUES ($1, $2, $3, 'ACTIVE')
           ON CONFLICT (organization_id, class_id, subject_id)
           DO UPDATE SET status = 'ACTIVE', updated_at = NOW()
           RETURNING id, organization_id, class_id, subject_id, status, created_at, updated_at`,
          [orgId, classId, subjectId]
        );
        mapped.push(result.rows[0]);
      }

      return res.status(201).json({ class_subjects: mapped, total: mapped.length });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Bulk assign subjects error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to assign subjects to class." } });
    }
  });

  app.delete("/api/classes/:classId/subjects/:subjectId", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.classId === "string" ? req.params.classId.trim() : "";
      const subjectId = typeof req.params?.subjectId === "string" ? req.params.subjectId.trim() : "";
      if (!classId || !subjectId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id and subject id are required." } });
      }

      const classResult = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      if (classResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const subjectResult = await pool.query(`SELECT organization_id FROM subjects WHERE id = $1 LIMIT 1`, [subjectId]);
      if (subjectResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Subject not found." } });
      }

      const orgId = classResult.rows[0].organization_id;
      if (subjectResult.rows[0].organization_id !== orgId) {
        return res.status(403).json({ error: { code: "ORGANIZATION_MISMATCH", message: "Class and subject must belong to the same organization." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, orgId);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to remove subjects from classes." } });
      }

      // Soft-deactivate the mapping to preserve historical information.
      const deactivateResult = await pool.query(
        `UPDATE class_subjects
         SET status = 'INACTIVE', updated_at = NOW()
         WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3 AND status = 'ACTIVE'
         RETURNING id, organization_id, class_id, subject_id, status, created_at, updated_at`,
        [classId, subjectId, orgId]
      );

      if (deactivateResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class subject assignment not found." } });
      }

      return res.status(200).json({ success: true, class_subject: deactivateResult.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }

      console.error("Delete class subject error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to remove subject from class." } });
    }
  });

  app.post("/api/classes/:id/teachers", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;

      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.id === "string" ? req.params.id.trim() : "";
      const teacherId = typeof req.body?.teacher_id === "string" ? req.body.teacher_id.trim() : "";

      if (!classId || !isValidUuid(classId) || !teacherId || !isValidUuid(teacherId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Valid class id and teacher_id are required." } });
      }

      // Ensure class and teacher belong to same organization
      const classRes = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      const teacherRes = await pool.query(`SELECT organization_id, status FROM teachers WHERE id = $1 LIMIT 1`, [teacherId]);

      if (classRes.rows.length === 0 || teacherRes.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class or teacher not found." } });
      }

      if (classRes.rows[0].organization_id !== teacherRes.rows[0].organization_id) {
        return res.status(403).json({ error: { code: "ORGANIZATION_MISMATCH", message: "Class and teacher must belong to the same organization." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, classRes.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to designate a class teacher." } });
      }

      const orgId = organizationContext.organization.id;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Deactivate any other ACTIVE Class Teacher for this class (preserving history).
        await client.query(
          `UPDATE class_teacher_assignments
           SET status = 'INACTIVE', updated_at = NOW()
           WHERE class_id = $1 AND status = 'ACTIVE' AND teacher_id <> $2`,
          [classId, teacherId]
        );

        const result = await client.query(
          `INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id, status)
           VALUES ($1, $2, $3, 'ACTIVE')
           ON CONFLICT (class_id) WHERE status = 'ACTIVE'
           DO UPDATE SET organization_id = EXCLUDED.organization_id,
                         teacher_id = EXCLUDED.teacher_id,
                         status = 'ACTIVE',
                         updated_at = NOW()
           RETURNING id, organization_id, class_id, teacher_id, status, created_at, updated_at`,
          [orgId, classId, teacherId]
        );

        await client.query("COMMIT");
        return res.status(201).json({ classTeacher: result.rows[0] });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Designate class teacher error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to designate class teacher." } });
    }
  });

  // List Class Teacher assignments for a class (ACTIVE first, historical preserved).
  app.get("/api/classes/:id/teachers", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.id === "string" ? req.params.id.trim() : "";
      if (!classId || !isValidUuid(classId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id is invalid." } });
      }

      const classRes = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      if (classRes.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, classRes.rows[0].organization_id);
      const result = await pool.query(
        `SELECT cta.id, cta.organization_id, cta.class_id, cta.teacher_id, cta.status, cta.created_at, cta.updated_at,
                t.user_id, u.full_name, u.email
         FROM class_teacher_assignments cta
         JOIN teachers t ON t.id = cta.teacher_id
         JOIN users u ON u.id = t.user_id
         WHERE cta.class_id = $1 AND cta.organization_id = $2
         ORDER BY CASE WHEN cta.status = 'ACTIVE' THEN 0 ELSE 1 END, cta.created_at DESC`,
        [classId, organizationContext.organization.id]
      );

      return res.status(200).json({ classTeachers: result.rows });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("List class teachers error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list class teachers." } });
    }
  });

  // Subject Teacher assignment (teacher <-> class <-> subject). Logically separate
  // from the Class Teacher designation, so a class may have many subject teachers.
  app.post("/api/classes/:id/subject-teachers", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.id === "string" ? req.params.id.trim() : "";
      const teacherId = typeof req.body?.teacher_id === "string" ? req.body.teacher_id.trim() : "";
      const subjectId = typeof req.body?.subject_id === "string" ? req.body.subject_id.trim() : "";

      if (!classId || !isValidUuid(classId) || !teacherId || !isValidUuid(teacherId) || !subjectId || !isValidUuid(subjectId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Valid class id, subject_id and teacher_id are required." } });
      }

      const classRes = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      const subjectRes = await pool.query(`SELECT organization_id FROM subjects WHERE id = $1 LIMIT 1`, [subjectId]);
      const teacherRes = await pool.query(`SELECT organization_id FROM teachers WHERE id = $1 LIMIT 1`, [teacherId]);

      if (classRes.rows.length === 0 || subjectRes.rows.length === 0 || teacherRes.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class, subject or teacher not found." } });
      }

      const orgId = classRes.rows[0].organization_id;
      if (subjectRes.rows[0].organization_id !== orgId || teacherRes.rows[0].organization_id !== orgId) {
        return res.status(403).json({ error: { code: "ORGANIZATION_MISMATCH", message: "Class, subject and teacher must belong to the same organization." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, orgId);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to assign subject teachers." } });
      }

      const classSubject = await pool.query(
        `SELECT id FROM class_subjects WHERE organization_id = $1 AND class_id = $2 AND subject_id = $3 LIMIT 1`,
        [orgId, classId, subjectId]
      );
      if (classSubject.rows.length === 0) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "The subject must be assigned to the class before assigning a subject teacher." } });
      }

      const result = await pool.query(
        `INSERT INTO class_subject_teachers (organization_id, class_id, subject_id, teacher_id, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (organization_id, class_id, subject_id, teacher_id) WHERE status = 'ACTIVE'
         DO UPDATE SET status = 'ACTIVE', updated_at = NOW()
         RETURNING id, organization_id, class_id, subject_id, teacher_id, status, created_at, updated_at`,
        [orgId, classId, subjectId, teacherId]
      );

      return res.status(201).json({ subjectTeacher: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Assign subject teacher error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to assign subject teacher." } });
    }
  });

  // List Subject Teacher assignments for a class.
  app.get("/api/classes/:id/subject-teachers", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.id === "string" ? req.params.id.trim() : "";
      if (!classId || !isValidUuid(classId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class id is invalid." } });
      }

      const classRes = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      if (classRes.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, classRes.rows[0].organization_id);
      const result = await pool.query(
        `SELECT cst.id, cst.organization_id, cst.class_id, cst.subject_id, cst.teacher_id, cst.status, cst.created_at, cst.updated_at,
                s.name AS subject_name, s.code AS subject_code,
                u.full_name, u.email
         FROM class_subject_teachers cst
         JOIN subjects s ON s.id = cst.subject_id
         JOIN teachers t ON t.id = cst.teacher_id
         JOIN users u ON u.id = t.user_id
         WHERE cst.class_id = $1 AND cst.organization_id = $2 AND cst.status = 'ACTIVE'
         ORDER BY s.name ASC, u.full_name ASC`,
        [classId, organizationContext.organization.id]
      );

      return res.status(200).json({ subjectTeachers: result.rows });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("List subject teachers error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list subject teachers." } });
    }
  });

  // Remove a Subject Teacher assignment (soft-deactivate for historical preservation).
  app.delete("/api/classes/:id/subject-teachers/:assignmentId", requireAuth, async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.id === "string" ? req.params.id.trim() : "";
      const assignmentId = typeof req.params?.assignmentId === "string" ? req.params.assignmentId.trim() : "";

      if (!classId || !isValidUuid(classId) || !assignmentId || !isValidUuid(assignmentId)) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Valid class id and assignment id are required." } });
      }

      const classRes = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      if (classRes.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class not found." } });
      }

      const organizationContext = await resolveOrganizationContext(req, user, classRes.rows[0].organization_id);
      if (!["SCHOOL_ADMIN", "COACHING_ADMIN"].includes(organizationContext.role.name)) {
        return res.status(403).json({ error: { code: "ROLE_REQUIRED", message: "You do not have permission to remove subject teachers." } });
      }

      const result = await pool.query(
        `UPDATE class_subject_teachers
         SET status = 'INACTIVE', updated_at = NOW()
         WHERE id = $1 AND class_id = $2 AND organization_id = $3
         RETURNING id, organization_id, class_id, subject_id, teacher_id, status, created_at, updated_at`,
        [assignmentId, classId, organizationContext.organization.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Subject teacher assignment not found." } });
      }

      return res.status(200).json({ subjectTeacher: result.rows[0] });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return res.status(403).json({ error: { code: error.code, message: error.message } });
      }
      console.error("Remove subject teacher error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to remove subject teacher." } });
    }
  });

  app.post("/api/classes/:id/students", requireAuth, async (req, res) => {
    try {
      const authRequest = req as AuthenticatedRequest;
      const user = authRequest.user;

      if (!user) {
        return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Authentication required." } });
      }

      const classId = typeof req.params?.id === "string" ? req.params.id.trim() : "";
      const studentId = typeof req.body?.student_id === "string" ? req.body.student_id.trim() : "";

      if (!classId || !studentId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "class id and student_id are required." } });
      }

      // Ensure class and student belong to same organization
      const classRes = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      const studentRes = await pool.query(`SELECT organization_id FROM students_v2 WHERE id = $1 LIMIT 1`, [studentId]);

      if (classRes.rows.length === 0 || studentRes.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class or student not found." } });
      }

      if (classRes.rows[0].organization_id !== studentRes.rows[0].organization_id) {
        return res.status(403).json({ error: { code: "ORGANIZATION_MISMATCH", message: "Class and student must belong to the same organization." } });
      }

      await pool.query(
        `INSERT INTO student_enrollments (organization_id, student_id, class_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [classRes.rows[0].organization_id, studentId, classId]
      );

      return res.status(201).json({ success: true });
    } catch (error) {
      console.error("Enroll student error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to enroll student." } });
    }
  });

  app.get("/api/classes/:id/students", requireAuth, async (req, res) => {
    try {
      const classId = typeof req.params?.id === "string" ? req.params.id.trim() : "";
      if (!classId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "class id is required." } });
      }

      const rosterRes = await pool.query(
        `SELECT s.id, s.full_name, se.enrolled_on
         FROM student_enrollments se
         JOIN students_v2 s ON s.id = se.student_id
         WHERE se.class_id = $1 AND se.status = 'ACTIVE'
         ORDER BY se.enrolled_on ASC`,
        [classId]
      );

      return res.status(200).json({ students: rosterRes.rows });
    } catch (error) {
      console.error("Get class roster error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load class roster." } });
    }
  });

  return app;
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`AI Teacher backend running on http://localhost:${PORT}`);
  });
}

export default createApp;