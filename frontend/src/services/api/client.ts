import { getStoredAccessToken } from "../../auth/auth-storage";
import type { ApiErrorBody } from "../../types/api";
import { API_BASE_URL } from "./config";
import { ApiError } from "./errors";

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

/**
 * Thin JSON fetch client with consistent request/response/error handling.
 *
 * - base URL comes from environment configuration (no hard-coded hosts)
 * - JSON bodies are serialized automatically
 * - the access token is attached as a Bearer token when available
 * - non-2xx responses are normalized into an `ApiError`
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { headers, body, ...rest } = options;
  const token = getStoredAccessToken();

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

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, config);
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "Unable to reach the server. Please check your connection and try again.",
      0,
    );
  }

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
