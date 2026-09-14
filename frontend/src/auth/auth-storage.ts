import type { AuthUser } from "../types/auth";

const KEYS = {
  accessToken: "ai-teacher:accessToken",
  refreshToken: "ai-teacher:refreshToken",
  user: "ai-teacher:user",
} as const;

function read<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; sessions degrade to in-memory only.
  }
}

function remove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // ignore
  }
}

export function getStoredAccessToken(): string | null {
  return read<string>(KEYS.accessToken);
}

export function getStoredRefreshToken(): string | null {
  return read<string>(KEYS.refreshToken);
}

export function getStoredUser(): AuthUser | null {
  return read<AuthUser>(KEYS.user);
}

export function storeTokens(accessToken: string, refreshToken: string): void {
  write(KEYS.accessToken, accessToken);
  write(KEYS.refreshToken, refreshToken);
}

export function storeSession(
  accessToken: string,
  refreshToken: string,
  user: AuthUser,
): void {
  storeTokens(accessToken, refreshToken);
  write(KEYS.user, user);
}

export function clearSession(): void {
  remove(KEYS.accessToken);
  remove(KEYS.refreshToken);
  remove(KEYS.user);
}
