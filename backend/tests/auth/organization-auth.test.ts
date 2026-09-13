import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createApp } from "../../src/server.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS ??= "7";

const app = createApp();
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

async function cleanupCreatedData() {
  if (createdOrganizationIds.length > 0) {
    await pool.query(
      `DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])`,
      [createdOrganizationIds]
    );
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [createdOrganizationIds]);
    createdOrganizationIds.length = 0;
  }

  if (createdUserIds.length > 0) {
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    createdUserIds.length = 0;
  }
}

afterEach(async () => {
  await cleanupCreatedData();
});

function uniqueValue(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createActiveUser({
  email,
  phone,
  password,
  fullName = "Org User",
}: {
  email?: string | null;
  phone?: string | null;
  password: string;
  fullName?: string;
}) {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, phone, password_hash, full_name, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE')
     RETURNING id, full_name, email, phone, status, created_at`,
    [email ?? null, phone ?? null, passwordHash, fullName]
  );

  const user = result.rows[0];
  createdUserIds.push(user.id);
  return user;
}

async function createAuthenticatedUser({
  email,
  phone,
  password,
  fullName,
}: {
  email?: string | null;
  phone?: string | null;
  password: string;
  fullName?: string;
}) {
  const user = await createActiveUser({ email, phone, password, fullName });
  const loginResponse = await request(app)
    .post("/api/auth/login")
    .send({ identifier: user.email ?? user.phone ?? "", password });

  return {
    user,
    accessToken: loginResponse.body.accessToken,
    refreshToken: loginResponse.body.refreshToken,
  };
}

async function createOrganizationForUser({
  userId,
  type,
  name,
  slug,
}: {
  userId: string;
  type: "SCHOOL" | "COACHING_CENTRE";
  name: string;
  slug: string;
}) {
  const orgResult = await pool.query(
    `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
     VALUES ($1, $2, $3, 'ACTIVE', $4)
     RETURNING *`,
    [name, slug, type, userId]
  );

  const organization = orgResult.rows[0];
  createdOrganizationIds.push(organization.id);

  const roleResult = await pool.query(
    `SELECT id FROM roles WHERE name = $1 LIMIT 1`,
    [type === "SCHOOL" ? "SCHOOL_ADMIN" : "COACHING_ADMIN"]
  );

  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [userId, organization.id, roleResult.rows[0].id]
  );

  return organization;
}

async function addMembership({
  userId,
  organizationId,
  roleName,
  status = "ACTIVE",
}: {
  userId: string;
  organizationId: string;
  roleName: string;
  status?: "ACTIVE" | "INACTIVE" | "PENDING" | "REMOVED";
}) {
  const roleResult = await pool.query(
    `SELECT id FROM roles WHERE name = $1 LIMIT 1`,
    [roleName]
  );

  await pool.query(
    `INSERT INTO organization_members (user_id, organization_id, role_id, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, organization_id)
     DO UPDATE SET role_id = EXCLUDED.role_id, status = EXCLUDED.status, updated_at = NOW()`,
    [userId, organizationId, roleResult.rows[0].id, status]
  );
}

describe("organization membership and role authorization", () => {
  it("returns 400 when organization name is missing", async () => {
    const { accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("missing_name")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Missing Name User",
    });

    const response = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        slug: `missing-name-${uniqueValue("slug")}`,
        type: "SCHOOL",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toBe("Organization name is required.");
  });

  it("returns 400 when organization slug is missing", async () => {
    const { accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("missing_slug")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Missing Slug User",
    });

    const response = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Missing Slug Org",
        type: "SCHOOL",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toBe("Organization slug is required.");
  });

  it("returns 400 when organization type is invalid", async () => {
    const { accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("invalid_type")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Invalid Type User",
    });

    const response = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Bad Type Org",
        slug: `bad-type-${uniqueValue("slug")}`,
        type: "UNIVERSITY",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toBe("Organization type must be SCHOOL or COACHING_CENTRE.");
  });

  it("returns 409 when the organization slug already exists", async () => {
    const { accessToken, user } = await createAuthenticatedUser({
      email: `${uniqueValue("duplicate_slug")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Duplicate Slug User",
    });

    const slug = `duplicate-${uniqueValue("slug")}`;
    await createOrganizationForUser({
      userId: user.id,
      type: "SCHOOL",
      name: "Original Org",
      slug,
    });

    const response = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Duplicate Slug Org",
        slug,
        type: "SCHOOL",
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DUPLICATE_ORGANIZATION");
  });

  it("allows an authenticated user to create a school organization", async () => {
    const { user, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("school_org")}@example.com`,
      password: "StrongPassword123!",
      fullName: "School Owner",
    });

    const response = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Green Valley School",
        slug: `green-valley-${uniqueValue("slug")}`,
        type: "SCHOOL",
      });

    createdOrganizationIds.push(response.body.organization.id);

    expect(response.status).toBe(201);
    expect(response.body.organization.role_name).toBe("SCHOOL_ADMIN");
    expect(response.body.organization.membership_status).toBe("ACTIVE");

    const membershipResult = await pool.query(
      `SELECT om.status, r.name AS role_name
       FROM organization_members om
       JOIN roles r ON r.id = om.role_id
       WHERE om.user_id = $1 AND om.organization_id = $2`,
      [user.id, response.body.organization.id]
    );

    expect(membershipResult.rows[0].status).toBe("ACTIVE");
    expect(membershipResult.rows[0].role_name).toBe("SCHOOL_ADMIN");
  });

  it("allows an authenticated user to create a coaching center organization", async () => {
    const { user, accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("coaching_org")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Coaching Owner",
    });

    const response = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Aspire Coaching Center",
        slug: `aspire-${uniqueValue("slug")}`,
        type: "COACHING_CENTRE",
      });

    createdOrganizationIds.push(response.body.organization.id);

    expect(response.status).toBe(201);
    expect(response.body.organization.role_name).toBe("COACHING_ADMIN");

    const membershipResult = await pool.query(
      `SELECT r.name AS role_name
       FROM organization_members om
       JOIN roles r ON r.id = om.role_id
       WHERE om.user_id = $1 AND om.organization_id = $2`,
      [user.id, response.body.organization.id]
    );

    expect(membershipResult.rows[0].role_name).toBe("COACHING_ADMIN");
  });

  it("returns 401 when creating an organization without authentication", async () => {
    const response = await request(app)
      .post("/api/organizations")
      .send({
        name: "No Auth Org",
        slug: "no-auth-org",
        type: "SCHOOL",
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns 403 when organization context is required and missing", async () => {
    const { accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("missing_org_context")}@example.com`,
      password: "StrongPassword123!",
    });

    const response = await request(app)
      .get("/api/organizations/context")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORGANIZATION_REQUIRED");
  });

  it("rejects invalid organization UUID values safely", async () => {
    const { accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("invalid_uuid")}@example.com`,
      password: "StrongPassword123!",
    });

    const response = await request(app)
      .get("/api/organizations/not-a-valid-uuid")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("prevents non-members from accessing organization detail", async () => {
    const owner = await createAuthenticatedUser({
      email: `${uniqueValue("owner_user")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Owner User",
    });

    const outsider = await createAuthenticatedUser({
      email: `${uniqueValue("outsider_user")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Outsider User",
    });

    const organization = await createOrganizationForUser({
      userId: owner.user.id,
      type: "SCHOOL",
      name: "Private School",
      slug: `private-school-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .get(`/api/organizations/${organization.id}`)
      .set("Authorization", `Bearer ${outsider.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("prevents inactive memberships from accessing organization detail", async () => {
    const owner = await createAuthenticatedUser({
      email: `${uniqueValue("inactive_owner")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Inactive Owner",
    });

    const organization = await createOrganizationForUser({
      userId: owner.user.id,
      type: "SCHOOL",
      name: "Inactive Org",
      slug: `inactive-org-${uniqueValue("slug")}`,
    });

    const roleResult = await pool.query(`SELECT id FROM roles WHERE name = 'STUDENT' LIMIT 1`);
    await pool.query(
      `UPDATE organization_members
       SET role_id = $1, status = 'INACTIVE', updated_at = NOW()
       WHERE user_id = $2 AND organization_id = $3`,
      [roleResult.rows[0].id, owner.user.id, organization.id]
    );

    const response = await request(app)
      .get(`/api/organizations/${organization.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("blocks STUDENT on SCHOOL_ADMIN-only route", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("student_school_admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Student School User",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "SCHOOL",
      name: "Student School",
      slug: `student-school-${uniqueValue("slug")}`,
    });

    const studentRole = await pool.query(`SELECT id FROM roles WHERE name = 'STUDENT' LIMIT 1`);
    await pool.query(
      `UPDATE organization_members
       SET role_id = $1
       WHERE user_id = $2 AND organization_id = $3`,
      [studentRole.rows[0].id, user.user.id, organization.id]
    );

    const response = await request(app)
      .get("/api/admin/school-check")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .set("X-Organization-Id", organization.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_REQUIRED");
  });

  it("blocks PARENT on SCHOOL_ADMIN-only route", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("parent_school_admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Parent School User",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "SCHOOL",
      name: "Parent School",
      slug: `parent-school-${uniqueValue("slug")}`,
    });

    const parentRole = await pool.query(`SELECT id FROM roles WHERE name = 'PARENT' LIMIT 1`);
    await pool.query(
      `UPDATE organization_members
       SET role_id = $1
       WHERE user_id = $2 AND organization_id = $3`,
      [parentRole.rows[0].id, user.user.id, organization.id]
    );

    const response = await request(app)
      .get("/api/admin/school-check")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .set("X-Organization-Id", organization.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_REQUIRED");
  });

  it("blocks COACHING_ADMIN on SCHOOL_ADMIN-only route", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("coaching_school_admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Coaching School User",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "SCHOOL",
      name: "Coaching School",
      slug: `coaching-school-${uniqueValue("slug")}`,
    });

    const coachingAdminRole = await pool.query(`SELECT id FROM roles WHERE name = 'COACHING_ADMIN' LIMIT 1`);
    await pool.query(
      `UPDATE organization_members
       SET role_id = $1
       WHERE user_id = $2 AND organization_id = $3`,
      [coachingAdminRole.rows[0].id, user.user.id, organization.id]
    );

    const response = await request(app)
      .get("/api/admin/school-check")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .set("X-Organization-Id", organization.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_REQUIRED");
  });

  it("blocks TEACHER on COACHING_ADMIN-only route", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("teacher_coaching_admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Teacher Coaching User",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "COACHING_CENTRE",
      name: "Teacher Coaching",
      slug: `teacher-coaching-${uniqueValue("slug")}`,
    });

    const teacherRole = await pool.query(`SELECT id FROM roles WHERE name = 'TEACHER' LIMIT 1`);
    await pool.query(
      `UPDATE organization_members
       SET role_id = $1
       WHERE user_id = $2 AND organization_id = $3`,
      [teacherRole.rows[0].id, user.user.id, organization.id]
    );

    const response = await request(app)
      .get("/api/admin/coaching-check")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .set("X-Organization-Id", organization.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_REQUIRED");
  });

  it("makes organization creation atomic when membership insertion fails", async () => {
    const { accessToken } = await createAuthenticatedUser({
      email: `${uniqueValue("atomic_org")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Atomic Org User",
    });
    const slug = `atomic-org-${uniqueValue("slug")}`;
    const client = await pool.connect();
    const originalQuery = client.query.bind(client);
    const originalRelease = client.release.bind(client);
    let released = false;
    client.query = (async (statement: string, values?: unknown[]) => {
      if (/^\s*INSERT\s+INTO\s+organization_members\b/i.test(statement)) {
        throw new Error("Simulated membership creation failure");
      }
      return originalQuery(statement, values);
    }) as typeof client.query;
    client.release = () => {
      released = true;
      client.query = originalQuery as typeof client.query;
      client.release = originalRelease;
      originalRelease();
    };
    const atomicApp = createApp({
      connect: async () => client,
    });

    try {
      const response = await request(atomicApp)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          name: "Atomic Org",
          slug,
          type: "SCHOOL",
        });

      expect(response.status).toBe(500);

      const check = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [slug]);
      expect(check.rows.length).toBe(0);
    } finally {
      if (!released) {
        client.release = originalRelease;
        originalRelease();
      }
    }
  });

  it("shows only organizations where the user has an active membership", async () => {
    const userOne = await createAuthenticatedUser({
      email: `${uniqueValue("list_user")}@example.com`,
      password: "StrongPassword123!",
      fullName: "List User",
    });

    const otherUser = await createAuthenticatedUser({
      email: `${uniqueValue("list_other")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Other User",
    });

    await createOrganizationForUser({
      userId: userOne.user.id,
      type: "SCHOOL",
      name: "User One School",
      slug: `user-one-school-${uniqueValue("slug")}`,
    });

    const otherOrg = await createOrganizationForUser({
      userId: otherUser.user.id,
      type: "COACHING_CENTRE",
      name: "Other Coaching",
      slug: `other-coaching-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .get("/api/organizations")
      .set("Authorization", `Bearer ${userOne.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.organizations.some((org: any) => org.id === otherOrg.id)).toBe(false);
    expect(response.body.organizations.length).toBeGreaterThanOrEqual(1);
  });

  it("denies access when organization status is INACTIVE even with ACTIVE membership", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("inactive_org_user")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Inactive Org User",
    });

    // create organization with INACTIVE status
    const orgResult = await pool.query(
      `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
       VALUES ($1, $2, $3, 'INACTIVE', $4) RETURNING *`,
      ["Inactive Org", `inactive-org-${uniqueValue("slug")}`, "SCHOOL", user.user.id]
    );

    const organization = orgResult.rows[0];
    createdOrganizationIds.push(organization.id);

    const roleResult = await pool.query(`SELECT id FROM roles WHERE name = 'SCHOOL_ADMIN' LIMIT 1`);
    await pool.query(
      `INSERT INTO organization_members (user_id, organization_id, role_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [user.user.id, organization.id, roleResult.rows[0].id]
    );

    const response = await request(app)
      .get(`/api/organizations/${organization.id}`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("denies access when organization status is PENDING even with ACTIVE membership", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("pending_org_user")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Pending Org User",
    });

    // create organization with PENDING status
    const orgResult = await pool.query(
      `INSERT INTO organizations (name, slug, type, status, created_by_user_id)
       VALUES ($1, $2, $3, 'PENDING', $4) RETURNING *`,
      ["Pending Org", `pending-org-${uniqueValue("slug")}`, "SCHOOL", user.user.id]
    );

    const organization = orgResult.rows[0];
    createdOrganizationIds.push(organization.id);

    const roleResult = await pool.query(`SELECT id FROM roles WHERE name = 'SCHOOL_ADMIN' LIMIT 1`);
    await pool.query(
      `INSERT INTO organization_members (user_id, organization_id, role_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [user.user.id, organization.id, roleResult.rows[0].id]
    );

    const response = await request(app)
      .get(`/api/organizations/${organization.id}`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("allows a user to belong to multiple organizations with different roles", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("multi_org")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Multi Org User",
    });

    const orgA = await createOrganizationForUser({
      userId: user.user.id,
      type: "SCHOOL",
      name: "School A",
      slug: `school-a-${uniqueValue("slug")}`,
    });

    const orgB = await createOrganizationForUser({
      userId: user.user.id,
      type: "COACHING_CENTRE",
      name: "Coaching B",
      slug: `coaching-b-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .get("/api/organizations")
      .set("Authorization", `Bearer ${user.accessToken}`);

    const orgs = response.body.organizations;
    expect(orgs.some((item: any) => item.id === orgA.id && item.role_name === "SCHOOL_ADMIN")).toBe(true);
    expect(orgs.some((item: any) => item.id === orgB.id && item.role_name === "COACHING_ADMIN")).toBe(true);
  });

  it("allows an active member to retrieve an organization detail", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("detail_org")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Detail User",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "SCHOOL",
      name: "Detail School",
      slug: `detail-school-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .get(`/api/organizations/${organization.id}`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.organization.id).toBe(organization.id);
    expect(response.body.organization.role_name).toBe("SCHOOL_ADMIN");
  });

  it("returns a generic 403 for nonexistent organizations so tenants are not leaked", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("missing_org")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Missing Org User",
    });

    const response = await request(app)
      .get(`/api/organizations/${"00000000-0000-4000-8000-000000000000"}`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("allows SCHOOL_ADMIN through the school role check route", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("school_admin_check")}@example.com`,
      password: "StrongPassword123!",
      fullName: "School Admin Check",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "SCHOOL",
      name: "School Admin Route",
      slug: `school-admin-route-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .get("/api/admin/school-check")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .set("X-Organization-Id", organization.id);

    expect(response.status).toBe(200);
    expect(response.body.role).toBe("SCHOOL_ADMIN");
  });

  it("blocks non-admin roles from school-admin-only routes", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("teacher_role")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Teacher User",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "SCHOOL",
      name: "Teacher School",
      slug: `teacher-school-${uniqueValue("slug")}`,
    });

    const teacherRole = await pool.query(`SELECT id FROM roles WHERE name = 'TEACHER' LIMIT 1`);
    await pool.query(
      `UPDATE organization_members
       SET role_id = $1
       WHERE user_id = $2 AND organization_id = $3`,
      [teacherRole.rows[0].id, user.user.id, organization.id]
    );

    const response = await request(app)
      .get("/api/admin/school-check")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .set("X-Organization-Id", organization.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_REQUIRED");
  });

  it("allows COACHING_ADMIN through the coaching role check route", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("coaching_admin_check")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Coaching Admin Check",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "COACHING_CENTRE",
      name: "Coaching Admin Route",
      slug: `coaching-admin-route-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .get("/api/admin/coaching-check")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .set("X-Organization-Id", organization.id);

    expect(response.status).toBe(200);
    expect(response.body.role).toBe("COACHING_ADMIN");
  });

  it("does not allow a school admin to pass a coaching admin check", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("school_not_coaching_admin")}@example.com`,
      password: "StrongPassword123!",
      fullName: "School Not Coaching",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "SCHOOL",
      name: "School Not Coaching",
      slug: `school-not-coaching-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .get("/api/admin/coaching-check")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .set("X-Organization-Id", organization.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_REQUIRED");
  });

  it("rejects a user who tries to force another organization via X-Organization-Id", async () => {
    const owner = await createAuthenticatedUser({
      email: `${uniqueValue("org_force_owner")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Org Force Owner",
    });

    const intruder = await createAuthenticatedUser({
      email: `${uniqueValue("org_force_intruder")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Intruder",
    });

    const organization = await createOrganizationForUser({
      userId: owner.user.id,
      type: "SCHOOL",
      name: "Force Protected",
      slug: `force-protected-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .get("/api/organizations/context")
      .set("Authorization", `Bearer ${intruder.accessToken}`)
      .set("X-Organization-Id", organization.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("never exposes password hash on organization responses", async () => {
    const user = await createAuthenticatedUser({
      email: `${uniqueValue("org_hash")}@example.com`,
      password: "StrongPassword123!",
      fullName: "Hash User",
    });

    const organization = await createOrganizationForUser({
      userId: user.user.id,
      type: "SCHOOL",
      name: "Hash Org",
      slug: `hash-org-${uniqueValue("slug")}`,
    });

    const response = await request(app)
      .get(`/api/organizations/${organization.id}`)
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.organization).not.toHaveProperty("password_hash");
    expect(response.body.organization).not.toHaveProperty("password");
  });
});
