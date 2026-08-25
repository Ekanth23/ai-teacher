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