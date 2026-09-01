import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import { pathToFileURL } from "node:url";
import pool from "./db.js";
import { InvalidCredentialsError, loginUser } from "./auth/login.js";
import { requireAuth, type AuthenticatedRequest as BasicAuthenticatedRequest } from "./auth/middleware.js";
import { DuplicateUserError, ValidationError, registerUser } from "./auth/register.js";
import {
  AuthorizationError,
  getUserOrganizations,
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

const PORT = 3000;

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

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

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

  app.post("/api/ai/reply", async (req, res) => {
    try {
      const { conversation_id, question } = req.body;

      const aiAnswer =
        "Fractions represent parts of a whole. For example, 1/2 means one out of two equal parts.";

      const result = await pool.query(
        `INSERT INTO messages (conversation_id, role, content)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [conversation_id, "assistant", aiAnswer]
      );

      res.status(201).json({
        status: "success",
        message: "AI reply created successfully",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("AI reply error:", error);

      res.status(500).json({
        status: "error",
        message: "Failed to generate AI reply",
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

      const client = await pool.connect();
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
      const user = await registerUser(req.body);

      return res.status(201).json({ user });
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
        const user_id = typeof req.body?.user_id === "string" ? req.body.user_id.trim() : "";
        const designation = typeof req.body?.designation === "string" ? req.body.designation.trim() : null;
        const qualification = typeof req.body?.qualification === "string" ? req.body.qualification.trim() : null;

        if (!user_id) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Teacher user_id is required." } });
        }

        const result = await pool.query(
          `INSERT INTO teachers (organization_id, user_id, designation, qualification)
           VALUES ($1, $2, $3, $4)
           RETURNING id, user_id, designation, qualification, created_at`,
          [orgId, user_id, designation, qualification]
        );

        return res.status(201).json({ teacher: result.rows[0] });
      } catch (error) {
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
                u.full_name,
                u.email,
                u.phone,
                t.designation,
                t.qualification,
                t.created_at
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
        const user_id = typeof req.body?.user_id === "string" ? req.body.user_id.trim() : "";
        const full_name = typeof req.body?.full_name === "string" ? req.body.full_name.trim() : "";
        const grade_level = typeof req.body?.grade_level === "string" ? req.body.grade_level.trim() : null;

        if (!user_id || !full_name) {
          return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Student user_id and full_name are required." } });
        }

        const result = await pool.query(
          `INSERT INTO students_v2 (organization_id, user_id, full_name, grade_level)
           VALUES ($1, $2, $3, $4)
           RETURNING id, user_id, full_name, grade_level, created_at`,
          [orgId, user_id, full_name, grade_level]
        );

        return res.status(201).json({ student: result.rows[0] });
      } catch (error) {
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
      const result = await pool.query(
        `SELECT s.id,
                s.full_name,
                s.grade_level,
                u.email,
                u.phone,
                s.created_at
         FROM students_v2 s
         JOIN users u ON u.id = s.user_id
         WHERE s.organization_id = $1
         ORDER BY s.created_at ASC`,
        [orgId]
      );

      return res.status(200).json({ students: result.rows });
    } catch (error) {
      console.error("List students error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list students." } });
    }
  });

  app.post("/api/organizations/:id/classes", requireAuth, requireOrganization, requireAnyRole(["SCHOOL_ADMIN", "COACHING_ADMIN"]), async (req, res) => {
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

      if (!name) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Class name is required." } });
      }

      const result = await pool.query(
        `INSERT INTO classes (organization_id, name, section, created_by_user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, section, created_at`,
        [orgId, name, section, user.id]
      );

      return res.status(201).json({ class: result.rows[0] });
    } catch (error) {
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
      const result = await pool.query(`SELECT id, name, section, created_at FROM classes WHERE organization_id = $1 ORDER BY created_at ASC`, [orgId]);

      return res.status(200).json({ classes: result.rows });
    } catch (error) {
      console.error("List classes error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list classes." } });
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

      const membershipResult = await pool.query(
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
        return res.status(403).json({ error: { code: "STUDENT_REQUIRED", message: "Only a student account can join with an invitation." } });
      }

      const studentResult = await pool.query(
        `SELECT id, organization_id, user_id
         FROM students_v2
         WHERE user_id = $1 AND organization_id = $2
         LIMIT 1`,
        [user.id, invitation.organization_id]
      );

      if (studentResult.rows.length === 0) {
        return res.status(403).json({ error: { code: "STUDENT_REQUIRED", message: "Student profile is required for this organization." } });
      }

      const studentRecord = studentResult.rows[0];
      const existingEnrollment = await pool.query(
        `SELECT id FROM student_enrollments
         WHERE student_id = $1 AND class_id = $2 AND status = 'ACTIVE'
         LIMIT 1`,
        [studentRecord.id, invitation.class_id]
      );

      if (existingEnrollment.rows.length > 0) {
        return res.status(409).json({ error: { code: "ALREADY_ENROLLED", message: "Student is already enrolled in this class." } });
      }

      const enrollmentResult = await pool.query(
        `INSERT INTO student_enrollments (organization_id, student_id, class_id, academic_year, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         RETURNING id, organization_id, student_id, class_id, academic_year, status, enrolled_on, created_at, updated_at`,
        [invitation.organization_id, studentRecord.id, invitation.class_id, invitation.academic_year]
      );

      await pool.query(
        `UPDATE class_invitations
         SET use_count = use_count + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [invitation.id]
      );

      return res.status(201).json({ enrollment: enrollmentResult.rows[0] });
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
         WHERE cs.class_id = $1 AND s.organization_id = $2
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
        `SELECT id FROM class_subjects WHERE class_id = $1 AND subject_id = $2 LIMIT 1`,
        [classId, subjectId]
      );
      if (existingResult.rows.length > 0) {
        return res.status(409).json({ error: { code: "DUPLICATE_CLASS_SUBJECT", message: "This subject is already assigned to the class." } });
      }

      const insertResult = await pool.query(
        `INSERT INTO class_subjects (organization_id, class_id, subject_id)
         VALUES ($1, $2, $3)
         RETURNING id, organization_id, class_id, subject_id, created_at`,
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

      const deleteResult = await pool.query(
        `DELETE FROM class_subjects
         WHERE class_id = $1 AND subject_id = $2 AND organization_id = $3
         RETURNING id, class_id, subject_id`,
        [classId, subjectId, orgId]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class subject assignment not found." } });
      }

      return res.status(200).json({ success: true, class_subject: deleteResult.rows[0] });
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

      if (!classId || !teacherId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "class id and teacher_id are required." } });
      }

      // Ensure class and teacher belong to same organization
      const classRes = await pool.query(`SELECT organization_id FROM classes WHERE id = $1 LIMIT 1`, [classId]);
      const teacherRes = await pool.query(`SELECT organization_id FROM teachers WHERE id = $1 LIMIT 1`, [teacherId]);

      if (classRes.rows.length === 0 || teacherRes.rows.length === 0) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Class or teacher not found." } });
      }

      if (classRes.rows[0].organization_id !== teacherRes.rows[0].organization_id) {
        return res.status(403).json({ error: { code: "ORGANIZATION_MISMATCH", message: "Class and teacher must belong to the same organization." } });
      }

      // Ensure the requesting user is a member of the class' organization
      try {
        await resolveOrganizationContext(req, user, classRes.rows[0].organization_id);
      } catch (err) {
        return res.status(403).json({ error: { code: "ORGANIZATION_REQUIRED", message: "You must be a member of this organization to assign teachers." } });
      }

      await pool.query(
        `INSERT INTO class_teacher_assignments (organization_id, class_id, teacher_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [classRes.rows[0].organization_id, classId, teacherId]
      );

      return res.status(201).json({ success: true });
    } catch (error) {
      console.error("Assign teacher to class error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to assign teacher to class." } });
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