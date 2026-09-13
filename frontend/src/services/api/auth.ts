import type {
  LoginCredentials,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  RefreshResponse,
} from "../../types/auth";
import { request } from "./client";

export type { LoginCredentials };

/** POST /api/auth/login */
export function login(credentials: LoginCredentials) {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: credentials,
  });
}

/** POST /api/auth/refresh */
export function refresh(refreshToken: string) {
  return request<RefreshResponse>("/api/auth/refresh", {
    method: "POST",
    body: { refreshToken },
  });
}

/** POST /api/auth/logout */
export function logout(refreshToken: string | null) {
  return request<LogoutResponse>("/api/auth/logout", {
    method: "POST",
    body: { refreshToken },
  });
}

/** GET /api/auth/me */
export function me() {
  return request<MeResponse>("/api/auth/me");
}
