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
    // Nullify any replaced_by references that point to these tokens (by id)
    await pool.query(
      `UPDATE refresh_tokens
       SET replaced_by_token_id = NULL
       WHERE replaced_by_token_id IN (SELECT id FROM refresh_tokens WHERE token_hash = ANY($1::text[]))`,
      [createdRefreshTokenHashes]
    );
    // Also nullify replaced_by_token_id on the tokens themselves (defensive)
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

async function createActiveUser({ email, phone, password, fullName = "Security Test User", status = "ACTIVE" }: { email?: string | null; phone?: string | null; password: string; fullName?: string; status?: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION"; }) {
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

async function loginAsUser(identifier: string, password = "StrongPassword123!") {
  return request(app)
    .post("/api/auth/login")
    .send({ identifier, password });
}

describe("auth jwt security additions", () => {
  it("rejects access tokens with the wrong issuer", async () => {
    const email = `${uniqueValue("wrong_issuer")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });
    const token = jwt.sign({ sub: user.id, type: "access" }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "15m", issuer: "bad-issuer" });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe("INVALID_TOKEN");
    expect(response.body.error?.message).toBe("Authentication required.");
  });

  it("rejects tampered access tokens", async () => {
    const email = `${uniqueValue("tamper")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });
    const loginResponse = await loginAsUser(email);
    const originalToken: string = loginResponse.body.accessToken;

    // Tamper the payload segment to invalidate signature but keep structure
    const parts = originalToken.split('.');
    expect(parts.length).toBe(3);
    const header = parts[0];
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    const payloadObj = JSON.parse(payload);
    payloadObj.sub = crypto.randomUUID(); // change subject
    const tamperedPayload = Buffer.from(JSON.stringify(payloadObj)).toString('base64').replace(/=+$/g, '');
    const tamperedToken = `${header}.${tamperedPayload}.${parts[2]}`;

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tamperedToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe("INVALID_TOKEN");
    expect(response.body.error?.message).toBe("Authentication required.");
  });

  it("refresh token issues access token for the token owner", async () => {
    const emailA = `${uniqueValue("owner_a")}@example.com`;
    const emailB = `${uniqueValue("owner_b")}@example.com`;

    const userA = await createActiveUser({ email: emailA, password: "StrongPassword123!" });
    const userB = await createActiveUser({ email: emailB, password: "StrongPassword123!" });

    const loginA = await loginAsUser(emailA);
    const loginB = await loginAsUser(emailB);

    const refreshTokenA: string = loginA.body.refreshToken;

    const rotateResponse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshTokenA });

    expect(rotateResponse.status).toBe(200);
    const newAccessToken: string = rotateResponse.body.accessToken;
    const payload = jwt.verify(newAccessToken, process.env.JWT_ACCESS_SECRET!);

    expect((payload as jwt.JwtPayload).sub).toBe(userA.id);
    // Ensure it's not for user B
    expect((payload as jwt.JwtPayload).sub).not.toBe(userB.id);

    // cleanup inserted tokens
    const row = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [userA.id]);
    if (row.rows[0]) createdRefreshTokenHashes.push(row.rows[0].token_hash);
  });

  it("does not return token_hash or secrets in API responses", async () => {
    const email = `${uniqueValue("no_secrets")}@example.com`;
    const user = await createActiveUser({ email, password: "StrongPassword123!" });
    const response = await loginAsUser(email);

    // Response should not include token_hash
    expect(response.body.token_hash).toBeUndefined();
    // Stringified body should not include token hash field name
    expect(JSON.stringify(response.body)).not.toContain('token_hash');

    // Should not leak environment secrets (check for env var names or keys, values may collide with other data)
    const bodyStr = JSON.stringify(response.body);
    expect(bodyStr).not.toContain('JWT_ACCESS_SECRET');
    expect(bodyStr).not.toContain('REFRESH_TOKEN_EXPIRES_DAYS');

    // Also ensure refresh token value is returned (raw) but DB stores the hash only
    const dbRow = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [user.id]);
    expect(dbRow.rows[0].token_hash).not.toBe(response.body.refreshToken);
    createdRefreshTokenHashes.push(dbRow.rows[0].token_hash);
  });

  it("does not leak JWT_ACCESS_SECRET value in API responses", async () => {
    const email = `${uniqueValue("no_leak")}@example.com`;
    // create user first
    await createActiveUser({ email, password: "StrongPassword123!" });

    const originalSecret = process.env.JWT_ACCESS_SECRET;
    // strong unique test-only secret
    const uniqueSecret = `test-only-secret-${crypto.randomBytes(48).toString('hex')}`;

    try {
      process.env.JWT_ACCESS_SECRET = uniqueSecret;

      const response = await loginAsUser(email);

      // Serialize full response body
      const bodyStr = JSON.stringify(response.body);

      // The actual secret value must not appear anywhere in the response
      expect(bodyStr).not.toContain(uniqueSecret);

      // Env var names and token_hash key should not be present
      expect(bodyStr).not.toContain('JWT_ACCESS_SECRET');
      expect(bodyStr).not.toContain('REFRESH_TOKEN_EXPIRES_DAYS');
      expect(bodyStr).not.toContain('token_hash');

      // The legitimate raw refreshToken returned to the client is allowed
      expect(response.body.refreshToken).toBeTruthy();
      expect(response.body.refreshToken).not.toBe(uniqueSecret);

      // DB must store only the hash (not the raw token)
      const dbRow = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [response.body.user.id]);
      expect(dbRow.rows[0].token_hash).not.toBe(response.body.refreshToken);
      createdRefreshTokenHashes.push(dbRow.rows[0].token_hash);
    } finally {
      // Restore original secret without printing it
      if (originalSecret === undefined) {
        delete process.env.JWT_ACCESS_SECRET;
      } else {
        process.env.JWT_ACCESS_SECRET = originalSecret;
      }
    }
  });

  it("GET /api/health returns success", async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.message).toBe('AI Teacher backend is running!');
  });
});
