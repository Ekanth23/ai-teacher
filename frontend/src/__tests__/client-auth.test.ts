import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStoredAccessToken,
  storeSession,
} from "../auth/auth-storage";
import { request } from "../services/api/client";
import { ApiError } from "../services/api/errors";

const sessionUser = {
  id: "user-1",
  full_name: "Dev Student",
  email: "dev.student@example.com",
  phone: null,
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00.000Z",
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json" : null,
    },
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

describe("api client 401 recovery", () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes once and retries the original request with the new token", async () => {
    storeSession("expired-token", "refresh-token", sessionUser as never);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: "INVALID_TOKEN", message: "Authentication required." } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { accessToken: "new-access", refreshToken: "new-refresh" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { classes: [], total: 0 }));

    const result = await request("/api/student/classes");

    expect(result).toEqual({ classes: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getStoredAccessToken()).toBe("new-access");

    const retryInit = fetchMock.mock.calls[2][1] as RequestInit;
    const retryHeaders = retryInit.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer new-access");
  });

  it("clears the session when refresh fails after a 401", async () => {
    storeSession("expired-token", "refresh-token", sessionUser as never);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: "INVALID_TOKEN", message: "Authentication required." } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: "INVALID_REFRESH_TOKEN", message: "Invalid refresh token." } }),
      );

    await expect(request("/api/student/classes")).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getStoredAccessToken()).toBeNull();
  });

  it("does not refresh when the failed request is an auth endpoint", async () => {
    storeSession("expired-token", "refresh-token", sessionUser as never);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: "INVALID_TOKEN", message: "Authentication required." } }),
    );

    await expect(request("/api/auth/me")).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getStoredAccessToken()).toBe("expired-token");
  });
});
