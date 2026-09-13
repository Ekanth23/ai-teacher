import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createApp } from "../../src/server.js";
import { hashRefreshToken } from "../../src/auth/tokens.js";

process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS ??= "7";

const app = createApp();
const createdUserIds: string[] = [];
const createdRefreshTokenHashes: string[] = [];

async function cleanupCreatedUsers() {
  if (createdUserIds.length === 0 && createdRefreshTokenHashes.length === 0) {
    return;
  }

  if (createdRefreshTokenHashes.length > 0) {
    await pool.query(
      `UPDATE refresh_tokens
       SET replaced_by_token_id = NULL
       WHERE token_hash = ANY($1::text[])`,
      [createdRefreshTokenHashes]
    );
    await pool.query(`DELETE FROM refresh_tokens WHERE token_hash = ANY($1::text[])`, [createdRefreshTokenHashes]);
    createdRefreshTokenHashes.length = 0;
  }

  if (createdUserIds.length > 0) {
    await pool.query(
      `UPDATE refresh_tokens
       SET replaced_by_token_id = NULL
       WHERE user_id = ANY($1::uuid[])`,
      [createdUserIds]
    );
    await pool.query(
      `DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`,
      [createdUserIds]
    );
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    createdUserIds.length = 0;
  }
}

afterEach(async () => {
  await cleanupCreatedUsers();
});

function uniqueValue(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createActiveUser({
  email,
  phone,
  password,
  fullName = "JWT Test User",
  status = "ACTIVE",
}: {
  email?: string | null;
  phone?: string | null;
  password: string;
  fullName?: string;
  status?: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION";
}) {
  const passwordHash = await import("bcryptjs").then(({ default: bcrypt }) => bcrypt.hash(password, 10));
  const result = await pool.query(
    `INSERT INTO users (email, phone, password_hash, full_name, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, full_name, email, phone, status, created_at`,
    [email ?? null, phone ?? null, passwordHash, fullName, status]
  );

  const user = result.rows[0];
  createdUserIds.push(user.id);
  return user;
}

async function loginAsUser(email: string, password = "StrongPassword123!") {
  return request(app)
    .post("/api/auth/login")
    .send({ identifier: email, password });
}

describe("auth jwt flow", () => {
  it("returns accessToken and refreshToken on successful login", async () => {
    const email = `${uniqueValue("jwt_login")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });

    const response = await loginAsUser(email);

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).toBeTruthy();
    expect(response.body.user.email).toBe(email.toLowerCase());

    const row = await pool.query("SELECT token_hash FROM refresh_tokens WHERE user_id = $1", [user.id]);
    expect(row.rows[0].token_hash).not.toBe(response.body.refreshToken);
    createdRefreshTokenHashes.push(row.rows[0].token_hash);
  });

  it("produces a structurally valid access token", async () => {
    const email = `${uniqueValue("jwt_valid")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });

    const response = await loginAsUser(email);
    const payload = jwt.verify(response.body.accessToken, process.env.JWT_ACCESS_SECRET!);

    expect(payload).toBeTruthy();
    expect((payload as jwt.JwtPayload).sub).toBe(user.id);
    expect((payload as jwt.JwtPayload).type).toBe("access");
  });

  it("rotates a refresh token and revokes the old one", async () => {
    const email = `${uniqueValue("jwt_rotation")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });
    const loginResponse = await loginAsUser(email);
    const oldRefreshToken = loginResponse.body.refreshToken;

    const rotateResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: oldRefreshToken });

    expect(rotateResponse.status).toBe(200);
    expect(rotateResponse.body.accessToken).toBeTruthy();
    expect(rotateResponse.body.refreshToken).toBeTruthy();
    expect(rotateResponse.body.refreshToken).not.toBe(oldRefreshToken);

    const oldTokenRow = await pool.query(
      "SELECT revoked_at, token_hash FROM refresh_tokens WHERE token_hash = $1",
      [hashRefreshToken(oldRefreshToken)]
    );
    expect(oldTokenRow.rows[0].revoked_at).not.toBeNull();

    const reuseResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: oldRefreshToken });
    expect(reuseResponse.status).toBe(401);
    expect(reuseResponse.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects invalid refresh token input", async () => {
    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects missing refresh token", async () => {
    const response = await request(app)
      .post("/api/auth/refresh")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects expired refresh tokens", async () => {
    const email = `${uniqueValue("jwt_expired_refresh")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });
    const expiredToken = "expired-refresh-token-value";
    const hashed = hashRefreshToken(expiredToken);
    const expiresAt = new Date(Date.now() - 5 * 60_000);
    const createdAt = new Date(Date.now() - 10 * 60_000);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, hashed, crypto.randomUUID(), createdAt, expiresAt]
    );
    createdRefreshTokenHashes.push(hashed);

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: expiredToken });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects revoked refresh tokens", async () => {
    const email = `${uniqueValue("jwt_revoked_refresh")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });
    const refreshToken = "revoked-refresh-token";
    const hashed = hashRefreshToken(refreshToken);
    const familyId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [user.id, hashed, familyId, new Date(Date.now() + 86_400_000)]
    );
    createdRefreshTokenHashes.push(hashed);

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects refresh tokens for inactive users", async () => {
    const email = `${uniqueValue("jwt_inactive_refresh")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!", status: "INACTIVE" });
    const refreshToken = "inactive-user-refresh-token";
    const hashed = hashRefreshToken(refreshToken);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, hashed, crypto.randomUUID(), new Date(Date.now() + 86_400_000)]
    );
    createdRefreshTokenHashes.push(hashed);

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("stores the replacement relationship for rotated refresh tokens", async () => {
    const email = `${uniqueValue("jwt_family")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });
    const loginResponse = await loginAsUser(email);
    const oldRefreshToken = loginResponse.body.refreshToken;

    const rotateResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: oldRefreshToken });

    const oldRow = await pool.query(
      "SELECT * FROM refresh_tokens WHERE token_hash = $1",
      [hashRefreshToken(oldRefreshToken)]
    );
    const newTokenValue = rotateResponse.body.refreshToken;
    const newRow = await pool.query(
      "SELECT * FROM refresh_tokens WHERE token_hash = $1",
      [hashRefreshToken(newTokenValue)]
    );

    expect(rotateResponse.status).toBe(200);
    expect(oldRow.rows[0].replaced_by_token_id).toBe(newRow.rows[0].id);
    expect(newRow.rows[0].replaced_by_token_id).toBeNull();
  });

  it("never stores the raw refresh token in the database", async () => {
    const email = `${uniqueValue("jwt_raw_store")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });

    const loginResponse = await loginAsUser(email);
    const rawRefreshToken = loginResponse.body.refreshToken;
    const rows = await pool.query("SELECT token_hash FROM refresh_tokens WHERE user_id = $1", [user.id]);

    expect(rows.rows[0].token_hash).not.toBe(rawRefreshToken);
    expect(rows.rows[0].token_hash).toMatch(/^[a-f0-9]+$/);
    createdRefreshTokenHashes.push(rows.rows[0].token_hash);
  });

  it("logs out a valid refresh token and blocks refresh afterward", async () => {
    const email = `${uniqueValue("jwt_logout")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });
    const loginResponse = await loginAsUser(email);

    const logoutResponse = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: loginResponse.body.refreshToken });

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body.success).toBe(true);

    const refreshResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: loginResponse.body.refreshToken });

    expect(refreshResponse.status).toBe(401);
  });

  it("logout is idempotent for an already revoked token", async () => {
    const email = `${uniqueValue("jwt_logout_twice")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });
    const loginResponse = await loginAsUser(email);

    await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: loginResponse.body.refreshToken });

    const repeatResponse = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: loginResponse.body.refreshToken });

    expect(repeatResponse.status).toBe(200);
    expect(repeatResponse.body.success).toBe(true);
  });

  it("allows a valid access token on /api/auth/me", async () => {
    const email = `${uniqueValue("jwt_me")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });
    const loginResponse = await loginAsUser(email);

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginResponse.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(user.id);
    expect(response.body.user.password_hash).toBeUndefined();
    expect(response.body.user.password).toBeUndefined();
  });

  it("rejects requests without an Authorization header", async () => {
    const response = await request(app).get("/api/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects malformed Authorization headers", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Token abc123");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects invalid JWTs", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer definitely-not-a-jwt");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects expired access tokens", async () => {
    const email = `${uniqueValue("jwt_expired_access")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });
    const expiredToken = jwt.sign({ sub: user.id, type: "access" }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: "-1s",
      issuer: "ai-teacher",
    });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects wrong token type", async () => {
    const email = `${uniqueValue("jwt_wrong_type")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });
    const wrongToken = jwt.sign({ sub: user.id, type: "refresh" }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: "15m",
      issuer: "ai-teacher",
    });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${wrongToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects access tokens for nonexistent users", async () => {
    const token = jwt.sign({ sub: crypto.randomUUID(), type: "access" }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: "15m",
      issuer: "ai-teacher",
    });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects access tokens for inactive users", async () => {
    const email = `${uniqueValue("jwt_inactive_me")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!", status: "INACTIVE" });
    const token = jwt.sign({ sub: user.id, type: "access" }, process.env.JWT_ACCESS_SECRET!, {
      expiresIn: "15m",
      issuer: "ai-teacher",
    });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });
});
