import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth/auth-context";
import { clearSession, storeSession } from "../auth/auth-storage";
import type { AuthUser } from "../types/auth";

/**
 * Test fixture only — isolated test data, never used by production code.
 */
export const testUser: AuthUser = {
  id: "00000000-0000-0000-0000-000000000001",
  full_name: "Test Student",
  email: "student@example.com",
  phone: null,
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00.000Z",
};

/** Persist an authenticated session using the real storage mechanism. */
export function seedAuthenticatedSession(): void {
  storeSession("test-access-token", "test-refresh-token", testUser);
}

export function resetSession(): void {
  clearSession();
}

interface RenderWithProvidersOptions {
  route?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = "/" }: RenderWithProvidersOptions = {},
) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </AuthProvider>,
  );
}
