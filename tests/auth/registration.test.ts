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

describe("auth registration", () => {
  it("registers a user with email only", async () => {
    const email = `${uniqueValue("email_only")}@example.com`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Email Only User",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    expect(response.body.user).toBeDefined();
    expect(response.body.user.email).toBe(email.toLowerCase());
    expect(response.body.user.phone).toBeNull();
    expect(response.body.user.status).toBe("PENDING_VERIFICATION");
    expect(response.body.user.password_hash).toBeUndefined();
    createdUserIds.push(response.body.user.id);

    const row = await pool.query("SELECT * FROM users WHERE id = $1", [response.body.user.id]);
    expect(row.rows[0].status).toBe("PENDING_VERIFICATION");
    expect(row.rows[0].email_verified_at).toBeNull();
    expect(row.rows[0].phone_verified_at).toBeNull();
    expect(await bcrypt.compare("StrongPassword123!", row.rows[0].password_hash)).toBe(true);
  });

  it("registers a user with phone only", async () => {
    const phone = `+1555${Date.now().toString().slice(-7)}`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Phone Only User",
        phone,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    expect(response.body.user.phone).toBe(phone);
    expect(response.body.user.email).toBeNull();
    expect(response.body.user.status).toBe("PENDING_VERIFICATION");
    createdUserIds.push(response.body.user.id);
  });

  it("registers a user with both email and phone", async () => {
    const email = `${uniqueValue("email_phone")}@example.com`;
    const phone = `+1555${Date.now().toString().slice(-8)}`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Dual User",
        email,
        phone,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(email.toLowerCase());
    expect(response.body.user.phone).toBe(phone);
    createdUserIds.push(response.body.user.id);
  });

  it("requires at least one of email or phone", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Missing Identity",
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toBe("At least one of email or phone is required.");
  });

  it("rejects duplicate email", async () => {
    const email = `${uniqueValue("dup_email")}@example.com`;

    await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Duplicate Email User",
        email,
        password: "StrongPassword123!",
      });

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Duplicate Email User Again",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DUPLICATE_USER");
    const row = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    createdUserIds.push(row.rows[0].id);
  });

  it("rejects duplicate phone", async () => {
    const phone = `+1555${Date.now().toString().slice(-7)}`;

    await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Duplicate Phone User",
        phone,
        password: "StrongPassword123!",
      });

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Duplicate Phone User Again",
        phone,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DUPLICATE_USER");
    const row = await pool.query("SELECT id FROM users WHERE phone = $1", [phone]);
    createdUserIds.push(row.rows[0].id);
  });

  it("rejects invalid email", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Invalid Email User",
        email: "not-an-email",
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires a password", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "No Password User",
        email: `${uniqueValue("no_password")}@example.com`,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toBe("password is required.");
  });

  it("stores a hashed password", async () => {
    const email = `${uniqueValue("hash_check")}@example.com`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Hash Check User",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    createdUserIds.push(response.body.user.id);

    const row = await pool.query("SELECT password_hash FROM users WHERE id = $1", [response.body.user.id]);
    expect(row.rows[0].password_hash).not.toBe("StrongPassword123!");
    expect(row.rows[0].password_hash).toMatch(/\$2[aby]\$/);
  });

  it("does not return password_hash in registration response", async () => {
    const email = `${uniqueValue("no_hash")}@example.com`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "No Hash User",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    expect(response.body.user.password_hash).toBeUndefined();
    expect(response.body.user.password).toBeUndefined();
    createdUserIds.push(response.body.user.id);
  });

  it("creates a user with PENDING_VERIFICATION status", async () => {
    const email = `${uniqueValue("pending_status")}@example.com`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Pending Status User",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    expect(response.body.user.status).toBe("PENDING_VERIFICATION");
    createdUserIds.push(response.body.user.id);
  });

  it("keeps verification timestamps null", async () => {
    const email = `${uniqueValue("verify_null")}@example.com`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Verify Null User",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    createdUserIds.push(response.body.user.id);

    const row = await pool.query(
      "SELECT email_verified_at, phone_verified_at FROM users WHERE id = $1",
      [response.body.user.id]
    );
    expect(row.rows[0].email_verified_at).toBeNull();
    expect(row.rows[0].phone_verified_at).toBeNull();
  });

  it("does not create an organization for a registered user", async () => {
    const email = `${uniqueValue("no_org")}@example.com`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "No Org User",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    createdUserIds.push(response.body.user.id);

    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM organizations WHERE created_by_user_id = $1",
      [response.body.user.id]
    );
    expect(result.rows[0].count).toBe(0);
  });

  it("does not create organization membership for a registered user", async () => {
    const email = `${uniqueValue("no_membership")}@example.com`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "No Membership User",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    createdUserIds.push(response.body.user.id);

    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM organization_members WHERE user_id = $1",
      [response.body.user.id]
    );
    expect(result.rows[0].count).toBe(0);
  });

  it("does not create a student profile for a registered user", async () => {
    const email = `${uniqueValue("no_student_profile")}@example.com`;

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "No Student Profile User",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    createdUserIds.push(response.body.user.id);

    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM student_profiles WHERE user_id = $1",
      [response.body.user.id]
    );
    expect(result.rows[0].count).toBe(0);
  });
});
