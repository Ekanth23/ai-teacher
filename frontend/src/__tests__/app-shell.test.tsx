import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { primaryNav } from "../app/navigation";
import { AuthProvider } from "../auth/auth-context";
import { RootLayout } from "../layouts/RootLayout";
import * as authApi from "../services/api/auth";
import { seedAuthenticatedSession } from "../test/test-utils";

vi.mock("../services/api/auth", () => ({
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  me: vi.fn(),
}));

const mockedLogout = vi.mocked(authApi.logout);

function renderShell(route = "/dashboard") {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route element={<RootLayout />}>
            <Route path="/dashboard" element={<div>Dashboard content</div>} />
            <Route path="/learning" element={<div>Learning content</div>} />
            <Route path="/practice" element={<div>Practice content</div>} />
            <Route path="/results" element={<div>Results content</div>} />
            <Route path="/ai-teacher" element={<div>AI Teacher content</div>} />
            <Route path="/profile" element={<div>Profile content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("application shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders brand, user area, and all primary navigation items", () => {
    seedAuthenticatedSession();
    renderShell("/dashboard");

    expect(screen.getByText("Test Student")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "AI Teacher home" }).length,
    ).toBeGreaterThan(0);

    for (const item of primaryNav) {
      expect(screen.getAllByRole("link", { name: item.label })).toHaveLength(2);
    }
  });

  it("the active destination is indicated and non-active destinations are not", () => {
    seedAuthenticatedSession();
    renderShell("/dashboard");

    screen
      .getAllByRole("link", { name: "Home" })
      .forEach((link) => expect(link).toHaveAttribute("aria-current", "page"));

    screen
      .getAllByRole("link", { name: "My Learning" })
      .forEach((link) => expect(link).not.toHaveAttribute("aria-current"));
  });

  it("renders both the desktop sidebar and the mobile bottom navigation", () => {
    seedAuthenticatedSession();
    renderShell("/dashboard");

    expect(
      screen.getAllByRole("navigation", { name: "Primary" }),
    ).toHaveLength(2);
  });

  it("signs out and clears the persisted session", async () => {
    const user = userEvent.setup();
    mockedLogout.mockResolvedValue({
      success: true,
      message: "Logged out successfully.",
    });
    seedAuthenticatedSession();
    renderShell("/dashboard");

    const logoutButtons = screen.getAllByRole("button", { name: "Log out" });
    await user.click(logoutButtons[0]);

    await waitFor(() => {
      expect(mockedLogout).toHaveBeenCalled();
      expect(localStorage.getItem("ai-teacher:accessToken")).toBeNull();
    });
  });
});
