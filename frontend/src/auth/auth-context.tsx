import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "../types/auth";
import {
  login as loginRequest,
  logout as logoutRequest,
  type LoginCredentials,
} from "../services/api/auth";
import {
  clearSession,
  getStoredAccessToken,
  getStoredRefreshToken,
  getStoredUser,
  storeSession,
} from "./auth-storage";

export type AuthStatus = "authenticated" | "unauthenticated";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  isAuthenticated: boolean;
  signIn: (credentials: LoginCredentials) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readInitialAuth(): { status: AuthStatus; user: AuthUser | null } {
  if (!getStoredAccessToken()) {
    return { status: "unauthenticated", user: null };
  }
  return { status: "authenticated", user: getStoredUser() };
}

/**
 * Minimal authentication state boundary for future slices.
 *
 * This is a foundation only: it derives state from the persisted token and
 * exposes signIn/signOut backed by the confirmed backend auth contract. It
 * deliberately does not implement a login screen, validation flow, or any
 * fabricated user data.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; user: AuthUser | null }>(
    readInitialAuth,
  );

  const signIn = useCallback(async (credentials: LoginCredentials) => {
    const result = await loginRequest(credentials);
    storeSession(result.accessToken, result.refreshToken, result.user);
    setState({ status: "authenticated", user: result.user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest(getStoredRefreshToken());
    } catch {
      // Best-effort: always clear the local session even if the API fails.
    }
    clearSession();
    setState({ status: "unauthenticated", user: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      isAuthenticated: state.status === "authenticated",
      signIn,
      signOut,
    }),
    [state, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
