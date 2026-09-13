import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { ApiError } from "../services/api/errors";
import * as authApi from "../services/api/auth";
import {
  renderWithProviders,
  seedAuthenticatedSession,
  testUser,
} from "../test/test-utils";

vi.mock("../services/api/auth", () => ({
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  me: vi.fn(),
}));

const mockedLogin = vi.mocked(authApi.login);

describe("login flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("logs in successfully and redirects into the application", async () => {
    const user = userEvent.setup();
    mockedLogin.mockResolvedValue({
      user: testUser,
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    });

    renderWithProviders(<App />, { route: "/login" });

    await user.type(
      screen.getByLabelText("Email or phone"),
      "student@example.com",
    );
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(mockedLogin).toHaveBeenCalledWith({
        identifier: "student@example.com",
        password: "secret123",
      });
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Dashboard" }),
      ).toBeInTheDocument();
    });
  });

  it("shows an error message on invalid credentials", async () => {
    const user = userEvent.setup();
    mockedLogin.mockRejectedValue(
      new ApiError("INVALID_CREDENTIALS", "Invalid email/phone or password.", 401),
    );

    renderWithProviders(<App />, { route: "/login" });

    await user.type(
      screen.getByLabelText("Email or phone"),
      "student@example.com",
    );
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(
        screen.getByText("Invalid email/phone or password."),
      ).toBeInTheDocument();
    });
  });

  it("redirects authenticated users away from /login", async () => {
    seedAuthenticatedSession();

    renderWithProviders(<App />, { route: "/login" });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Dashboard" }),
      ).toBeInTheDocument();
    });
  });
});
