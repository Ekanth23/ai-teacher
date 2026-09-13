import crypto from "node:crypto";
import jwt, { type JwtPayload, type SignOptions, type VerifyOptions } from "jsonwebtoken";
import pool from "../db.js";

export type AuthenticatedUser = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
};

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class InvalidTokenError extends AuthError {
  constructor() {
    super("INVALID_TOKEN", "Authentication required.");
  }
}

export class InvalidRefreshTokenError extends AuthError {
  constructor(message = "Invalid refresh token.") {
    super("INVALID_REFRESH_TOKEN", message);
  }
}

export function getJwtAccessSecret() {
  const secret = process.env.JWT_ACCESS_SECRET ?? "development-access-secret";

  if (!process.env.JWT_ACCESS_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("JWT_ACCESS_SECRET is required in production.");
  }

  return secret;
}

export function getJwtAccessExpiresIn() {
  return process.env.JWT_ACCESS_EXPIRES_IN ?? "15m";
}

export function getRefreshTokenExpiresDays() {
  const rawValue = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? "7");
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 7;
}

export function createAccessToken(userId: string) {
  const options = {
    algorithm: "HS256" as const,
    expiresIn: getJwtAccessExpiresIn() as SignOptions["expiresIn"],
    issuer: "ai-teacher",
  } as SignOptions;

  return jwt.sign({ sub: userId, type: "access" }, getJwtAccessSecret(), options);
}

export function verifyAccessToken(token: string) {
  try {
    const options: VerifyOptions = {
      algorithms: ["HS256"],
      issuer: "ai-teacher",
    };

    const payload = jwt.verify(token, getJwtAccessSecret(), options) as JwtPayload;

    if (!payload || typeof payload !== "object") {
      throw new InvalidTokenError();
    }

    if (payload.type !== "access" || typeof payload.sub !== "string") {
      throw new InvalidTokenError();
    }

    return payload as JwtPayload & { sub: string; type: string };
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      throw error;
    }

    throw new InvalidTokenError();
  }
}

export function generateRefreshToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashRefreshToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getRefreshTokenExpiryDate() {
  return new Date(Date.now() + getRefreshTokenExpiresDays() * 24 * 60 * 60 * 1000);
}

export async function getUserById(userId: string): Promise<AuthenticatedUser | null> {
  const result = await pool.query(
    `SELECT id, full_name, email, phone, status, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function findRefreshTokenByHash(tokenHash: string) {
  const result = await pool.query(
    `SELECT *
     FROM refresh_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

export function getBearerToken(headerValue: string | undefined) {
  if (!headerValue) {
    return null;
  }

  const parts = headerValue.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return null;
  }

  return parts[1];
}
