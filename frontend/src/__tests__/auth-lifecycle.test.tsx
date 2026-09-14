import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth/auth-context";
import { AUTH_UNAUTHORIZED_EVENT } from "../auth/auth-events";
import { storeSession } from "../auth/auth-storage";
import LoginPage from "../pages/LoginPage";
import { ApiError } from "../services/api/errors";
import type { AuthUser } from "../types/auth";

const authApi = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  me: vi.fn(),
}));

vi.mock("../services/api/auth", () => ({
  login: authApi.login,
  logout: authApi.logout,
  refresh: authApi.refresh,
  me: authApi.me,
}));

const testUser: AuthUser = {
  id: "user-1",
  full_name: "Dev Student",
  email: "dev.student@example.com",
  phone: null,
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00.000Z",
};

function Probe() {
  const { status, user, signIn, signOut } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.full_name ?? "none"}</span>
      <button onClick={() => signIn({ identifier: "dev.student@example.com", password: "pw" })}>
        sign-in
      </button>
      <button onClick={() => signOut()}>sign-out</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("auth lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it("becomes unauthenticated when there is no stored session", async () => {
    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it("validates a stored token via /me and stays authenticated", async () => {
    storeSession("valid-token", "refresh-token", testUser);
    authApi.me.mockResolvedValue({ user: testUser, organizations: [] });

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent("Dev Student");
  });

  it("refreshes once when the stored token is invalid", async () => {
    storeSession("expired-token", "refresh-token", testUser);
    authApi.me
      .mockRejectedValueOnce(new ApiError("INVALID_TOKEN", "Authentication required.", 401))
      .mockResolvedValueOnce({ user: testUser, organizations: [] });
    authApi.refresh.mockResolvedValue({ accessToken: "new-token", refreshToken: "new-refresh" });

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
    expect(authApi.me).toHaveBeenCalledTimes(2);
  });

  it("clears the session when the token is invalid and refresh fails", async () => {
    storeSession("expired-token", "refresh-token", testUser);
    authApi.me.mockRejectedValue(
      new ApiError("INVALID_TOKEN", "Authentication required.", 401),
    );
    authApi.refresh.mockRejectedValue(
      new ApiError("INVALID_REFRESH_TOKEN", "Invalid refresh token.", 401),
    );

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(localStorage.getItem("ai-teacher:accessToken")).toBeNull();
  });
  it("shows the login form instead of redirecting when the stored token is invalid", async () => {
    storeSession("expired-token", "refresh-token", testUser);
    authApi.me.mockRejectedValue(
      new ApiError("INVALID_TOKEN", "Authentication required.", 401),
    );
    authApi.refresh.mockRejectedValue(
      new ApiError("INVALID_REFRESH_TOKEN", "Invalid refresh token.", 401),
    );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/login"]}>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });

  it("establishes an authenticated session on login", async () => {
    const user = userEvent.setup();
    authApi.login.mockResolvedValue({
      user: testUser,
      accessToken: "new-token",
      refreshToken: "new-refresh",
    });

    renderProbe();

    await user.click(screen.getByRole("button", { name: "sign-in" }));
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent("Dev Student");
  });

  it("clears the session on logout", async () => {
    const user = userEvent.setup();
    storeSession("valid-token", "refresh-token", testUser);
    authApi.me.mockResolvedValue({ user: testUser, organizations: [] });
    authApi.logout.mockResolvedValue({ success: true, message: "ok" });

    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    await user.click(screen.getByRole("button", { name: "sign-out" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
    expect(localStorage.getItem("ai-teacher:accessToken")).toBeNull();
  });

  it("transitions to unauthenticated when the client signals authorization failure", async () => {
    storeSession("valid-token", "refresh-token", testUser);
    authApi.me.mockResolvedValue({ user: testUser, organizations: [] });

    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"),
    );
    expect(localStorage.getItem("ai-teacher:accessToken")).toBeNull();
  });
});

