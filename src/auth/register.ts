import bcrypt from "bcryptjs";
import pool from "../db.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ValidationError extends ApiError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
  }
}

export class DuplicateUserError extends ApiError {
  constructor(message: string) {
    super("DUPLICATE_USER", message);
  }
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase();
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeIdentifier(value: unknown): {
  email: string | null;
  phone: string | null;
} {
  if (typeof value !== "string") {
    return { email: null, phone: null };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { email: null, phone: null };
  }

  const normalizedEmail = normalizeEmail(trimmed);
  if (normalizedEmail && EMAIL_REGEX.test(normalizedEmail)) {
    return { email: normalizedEmail, phone: null };
  }

  return { email: null, phone: normalizePhone(trimmed) };
}

export async function registerUser(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Request body must be a JSON object.");
  }

  const payload = input as Record<string, unknown>;

  const fullName = typeof payload.full_name === "string" ? payload.full_name.trim() : "";
  if (!fullName) {
    throw new ValidationError("full_name is required.");
  }

  const password = typeof payload.password === "string" ? payload.password : "";
  if (!password.trim()) {
    throw new ValidationError("password is required.");
  }

  const email = normalizeEmail(payload.email);
  if (payload.email !== undefined && payload.email !== null && payload.email !== "" && email !== null && !EMAIL_REGEX.test(email)) {
    throw new ValidationError("email is invalid.");
  }

  const phone = normalizePhone(payload.phone);
  if (payload.phone !== undefined && payload.phone !== null && payload.phone !== "" && phone === null) {
    throw new ValidationError("phone must be a non-empty string when provided.");
  }

  if (!email && !phone) {
    throw new ValidationError("At least one of email or phone is required.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query(
      `INSERT INTO users (email, phone, password_hash, full_name, status)
       VALUES ($1, $2, $3, $4, 'PENDING_VERIFICATION')
       RETURNING id, full_name, email, phone, status, created_at`,
      [email, phone, passwordHash, fullName]
    );

    const user = result.rows[0];

    return {
      id: user.id,
      full_name: user.full_name,
      email: email ?? null,
      phone: phone ?? null,
      status: user.status,
      created_at: user.created_at,
    };
  } catch (error: unknown) {
    const maybeError = error as { code?: string };
    if (maybeError.code === "23505") {
      throw new DuplicateUserError("A user with this email or phone already exists.");
    }

    throw new Error("Failed to register user.");
  }
}
