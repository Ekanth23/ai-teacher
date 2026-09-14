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
}

// Endpoints that must never trigger an automatic refresh/retry — otherwise a
// failed login/refresh/logout/me would recurse into itself.
const AUTH_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/me",
]);

async function sendRequest(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  const { headers, body, ...rest } = options;

  const config: RequestInit = {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  };

  if (body !== undefined) {
    config.body = JSON.stringify(body);
  }

  try {
    return await fetch(`${API_BASE_URL}${path}`, config);
  } catch {
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
    const errorBody = (payload as ApiErrorBody | null)?.error;
    throw new ApiError(
      errorBody?.code ?? "REQUEST_FAILED",
      errorBody?.message ?? `Request failed with status ${response.status}.`,
      response.status,
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
    } else {
      clearSession();
      emitUnauthorized();
    }
  }

  return parseResponse<T>(response);
}
