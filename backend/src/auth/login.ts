import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { ApiError, ValidationError, normalizeIdentifier } from "./register.js";
import { createAccessToken, generateRefreshToken, getRefreshTokenExpiryDate, getRefreshTokenExpiresDays, hashRefreshToken } from "./tokens.js";

export class InvalidCredentialsError extends ApiError {
  constructor() {
    super("INVALID_CREDENTIALS", "Invalid email/phone or password.");
  }
}

export async function loginUser(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Request body must be a JSON object.");
  }

  const payload = input as Record<string, unknown>;
  const identifier = typeof payload.identifier === "string" ? payload.identifier : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!identifier.trim()) {
    throw new ValidationError("identifier is required.");
  }

  if (!password.trim()) {
    throw new ValidationError("password is required.");
  }

  const { email, phone } = normalizeIdentifier(identifier);
  const lookupValue = email ?? phone;

  if (!lookupValue) {
    throw new InvalidCredentialsError();
  }

  const userResult = await pool.query(
    email
      ? `SELECT id, full_name, email, phone, password_hash, status, created_at
         FROM users WHERE email = $1 LIMIT 1`
      : `SELECT id, full_name, email, phone, password_hash, status, created_at
         FROM users WHERE phone = $1 LIMIT 1`,
    [lookupValue]
  );

  const user = userResult.rows[0];

  if (!user) {
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError();
  }

  if (user.status !== "ACTIVE") {
    throw new InvalidCredentialsError();
  }

  const updatedUserResult = await pool.query(
    `UPDATE users
     SET last_login_at = NOW()
     WHERE id = $1
     RETURNING id, full_name, email, phone, status, created_at`,
    [user.id]
  );

  const updatedUser = updatedUserResult.rows[0] ?? user;
  const normalizedEmail = typeof updatedUser.email === "string" ? updatedUser.email.toLowerCase() : null;

  const accessToken = createAccessToken(updatedUser.id);
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const familyId = crypto.randomUUID();
  const expiresAt = getRefreshTokenExpiryDate();

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [updatedUser.id, refreshTokenHash, familyId, expiresAt]
  );

  return {
    user: {
      id: updatedUser.id,
      full_name: updatedUser.full_name,
      email: normalizedEmail,
      phone: updatedUser.phone ?? null,
      status: updatedUser.status,
      created_at: updatedUser.created_at,
    },
    accessToken,
    refreshToken,
  };
}
