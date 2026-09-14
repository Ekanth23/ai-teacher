import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../auth/auth-context";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { seedAuthenticatedSession } from "../test/test-utils";

vi.mock("../services/api/auth", () => ({
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  me: vi.fn().mockResolvedValue({
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      full_name: "Test Student",
      email: "student@example.com",
      phone: null,
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    organizations: [],
  }),
}));

function renderProtected(initialRoute: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<div>Protected content</div>} />
          </Route>
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("ProtectedRoute", () => {
  it("redirects unauthenticated users to /login", () => {
    renderProtected("/dashboard");
    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders protected content when authenticated", async () => {
    seedAuthenticatedSession();
    renderProtected("/dashboard");
    expect(await screen.findByText("Protected content")).toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });
});
