import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import pool from "../../src/db.js";
import { createApp } from "../../src/server.js";

const app = createApp();
const createdUserIds: string[] = [];

async function cleanupCreatedUsers() {
  if (createdUserIds.length === 0) {
    return;
  }

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
  fullName = "Test User",
  status = "ACTIVE",
}: {
  email?: string | null;
  phone?: string | null;
  password: string;
  fullName?: string;
  status?: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION";
}) {
  const passwordHash = await bcrypt.hash(password, 10);
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

describe("auth login", () => {
  it("logs in with a valid email and password", async () => {
    const email = `${uniqueValue("login_email")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: email, password: "StrongPassword123!" });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email.toLowerCase());
    expect(response.body.user.password).toBeUndefined();
    expect(response.body.user.password_hash).toBeUndefined();
  });

  it("logs in with a valid phone and password", async () => {
    const phone = `+1555${Date.now().toString().slice(-8)}`;
    await createActiveUser({ phone, password: "StrongPassword123!" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: phone, password: "StrongPassword123!" });

    expect(response.status).toBe(200);
    expect(response.body.user.phone).toBe(phone);
  });

  it("normalizes email identifiers before login", async () => {
    const email = `${uniqueValue("login_email_case")}@Example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: `  ${email.toUpperCase()}  `, password: "StrongPassword123!" });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email.toLowerCase());
  });

  it("trims phone identifiers before login", async () => {
    const phone = `+1555${Date.now().toString().slice(-8)}`;
    await createActiveUser({ phone, password: "StrongPassword123!" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: `  ${phone}  `, password: "StrongPassword123!" });

    expect(response.status).toBe(200);
    expect(response.body.user.phone).toBe(phone);
  });

  it("rejects a wrong password with the same generic authentication error", async () => {
    const email = `${uniqueValue("wrong_password")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: email, password: "WrongPassword!" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(response.body.error.message).toBe("Invalid email/phone or password.");
  });

  it("rejects an unknown email with the same generic authentication error", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: `${uniqueValue("unknown_email")}@example.com`, password: "StrongPassword123!" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(response.body.error.message).toBe("Invalid email/phone or password.");
  });

  it("rejects an unknown phone with the same generic authentication error", async () => {
    const phone = `+1555${Date.now().toString().slice(-8)}`;

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: phone, password: "StrongPassword123!" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(response.body.error.message).toBe("Invalid email/phone or password.");
  });

  it("requires an identifier", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ password: "StrongPassword123!" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toBe("identifier is required.");
  });

  it("requires a password", async () => {
    const email = `${uniqueValue("missing_password")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: email });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toBe("password is required.");
  });

  it("blocks a pending user from logging in", async () => {
    const email = `${uniqueValue("pending_login")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!", status: "PENDING_VERIFICATION" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: email, password: "StrongPassword123!" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("blocks an inactive user from logging in", async () => {
    const email = `${uniqueValue("inactive_login")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!", status: "INACTIVE" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: email, password: "StrongPassword123!" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("blocks a suspended user from logging in", async () => {
    const email = `${uniqueValue("suspended_login")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!", status: "SUSPENDED" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: email, password: "StrongPassword123!" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("updates last_login_at on successful login", async () => {
    const email = `${uniqueValue("last_login")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: email, password: "StrongPassword123!" });

    expect(response.status).toBe(200);
    const row = await pool.query("SELECT last_login_at FROM users WHERE email = $1", [email]);
    expect(row.rows[0].last_login_at).not.toBeNull();
  });

  it("does not update last_login_at on failed login attempts", async () => {
    const email = `${uniqueValue("failed_login")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });

    const before = await pool.query("SELECT last_login_at FROM users WHERE email = $1", [email]);
    expect(before.rows[0].last_login_at).toBeNull();

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: email, password: "WrongPassword!" });

    expect(response.status).toBe(401);
    const after = await pool.query("SELECT last_login_at FROM users WHERE email = $1", [email]);
    expect(after.rows[0].last_login_at).toBeNull();
  });

  it("never returns password_hash in the login response", async () => {
    const email = `${uniqueValue("hash_response")}@example.com`;
    await createActiveUser({ email, password: "StrongPassword123!" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ identifier: email, password: "StrongPassword123!" });

    expect(response.status).toBe(200);
    expect(response.body.user.password_hash).toBeUndefined();
    expect(response.body.user.password).toBeUndefined();
  });
});
