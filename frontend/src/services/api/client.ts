import {
  clearSession,
  getStoredAccessToken,
  getStoredRefreshToken,
  storeTokens,
} from "../../auth/auth-storage";
import { emitUnauthorized } from "../../auth/auth-events";
import type { ApiErrorBody } from "../../types/api";
import type { RefreshResponse } from "../../types/auth";
import { API_BASE_URL } from "./config";
import { ApiError } from "./errors";

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /**
   * Optional idempotency key for operations that can be safely retried after
   * an unknown network outcome. The client sends it as the standard header.
   */
  idempotencyKey?: string;
  /** Snake-case alias for callers using the API wire naming. */
  idempotency_key?: string;
}

// Endpoints that must never trigger an automatic refresh/retry — otherwise a
// failed login/refresh/logout/me would recurse into itself.
const AUTH_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/me",
]);

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name?: unknown }).name === "AbortError" ||
      (error as { message?: unknown }).message === "AbortError")
  );
}

async function sendRequest(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  const { headers, body, idempotencyKey, idempotency_key, ...rest } = options;
  const effectiveIdempotencyKey = idempotencyKey ?? idempotency_key;
  const suppliedHeaders =
    typeof Headers !== "undefined" && headers instanceof Headers
      ? Object.fromEntries(headers.entries())
      : Array.isArray(headers)
        ? Object.fromEntries(headers)
        : (headers as Record<string, string> | undefined);
  const requestHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...suppliedHeaders,
    ...(effectiveIdempotencyKey ? { "Idempotency-Key": effectiveIdempotencyKey } : {}),
  };

  const config: RequestInit = {
    ...rest,
    headers: requestHeaders,
  };

  if (body !== undefined) {
    config.body = JSON.stringify(body);
  }

  try {
    return await fetch(`${API_BASE_URL}${path}`, config);
  } catch (error) {
    // Cancellation is a control-flow signal for request sequencing. Do not
    // turn it into a network failure that can incorrectly block a newer view.
    if (isAbortError(error)) throw error;
    throw new ApiError(
      "NETWORK_ERROR",
      "Unable to reach the server. Please check your connection and try again.",
      0,
    );
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const responseBody = payload as (ApiErrorBody & {
      code?: string;
      status?: string;
      message?: string;
    }) | null;
    // Most services use { error: { code, message } }. The AI compatibility
    // routes intentionally preserve their { status, message } envelope, so
    // accept both without changing either server contract.
    const errorBody = responseBody?.error ??
      (typeof responseBody?.message === "string"
        ? { code: responseBody.code ?? "REQUEST_FAILED", message: responseBody.message }
        : undefined);
    throw new ApiError(
      errorBody?.code ?? "REQUEST_FAILED",
      errorBody?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      responseBody,
    );
  }

  return payload as T;
}

// Shared in-flight refresh: concurrent 401s share a single POST /api/auth/refresh
// instead of each firing their own (which would fight over token rotation).
let inFlightRefresh: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as RefreshResponse;
    if (typeof payload.accessToken !== "string" || !payload.accessToken) {
      return null;
    }

    storeTokens(payload.accessToken, payload.refreshToken ?? refreshToken);
    return payload.accessToken;
  } catch {
    return null;
  }
}

function refreshAccessToken(): Promise<string | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = performRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/**
 * Thin JSON fetch client with consistent request/response/error handling.
 *
 * - base URL comes from environment configuration (no hard-coded hosts)
 * - JSON bodies are serialized automatically
 * - the access token is attached as a Bearer token when available
 * - a 401 on an authenticated request attempts a single shared refresh and retry
 * - non-2xx responses are normalized into an `ApiError`
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const token = getStoredAccessToken();

  let response = await sendRequest(path, options, token);

  if (response.status === 401 && token && !AUTH_PATHS.has(path)) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      response = await sendRequest(path, options, refreshedToken);
      if (response.status === 401) {
        clearSession();
        emitUnauthorized();
      }
    } else {
      clearSession();
      emitUnauthorized();
    }
  }

  return parseResponse<T>(response);
}
