import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "../types/auth";
import {
  login as loginRequest,
  logout as logoutRequest,
  me as meRequest,
  refresh as refreshRequest,
  type LoginCredentials,
} from "../services/api/auth";
import { ApiError } from "../services/api/errors";
import { AUTH_UNAUTHORIZED_EVENT } from "./auth-events";
import {
  clearSession,
  getStoredAccessToken,
  getStoredRefreshToken,
  getStoredUser,
  storeSession,
  storeTokens,
} from "./auth-storage";

export type AuthStatus = "checking" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  isAuthenticated: boolean;
  signIn: (credentials: LoginCredentials) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readInitialStatus(): AuthStatus {
  return getStoredAccessToken() ? "checking" : "unauthenticated";
}

/**
 * Authentication state boundary with real session lifecycle handling.
 *
 * On mount the provider validates a persisted access token against the backend
 * (`GET /api/auth/me`); an invalid token triggers at most one refresh, and a
 * definitively invalid session is cleared so the app returns to /login. It also
 * listens for the client's "unauthorized" event so a mid-session 401 that cannot
 * be recovered clears the session and flips the app to unauthenticated.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(readInitialStatus);
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());

  useEffect(() => {
    let cancelled = false;

    async function recoverSession(): Promise<boolean> {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) return false;
      try {
        const result = await refreshRequest(refreshToken);
        storeTokens(result.accessToken, result.refreshToken);
        return true;
      } catch {
        return false;
      }
    }

    async function bootstrap() {
      if (!getStoredAccessToken()) {
        if (!cancelled) {
          setUser(null);
          setStatus("unauthenticated");
        }
        return;
      }

      try {
        const me = await meRequest();
        if (!cancelled) {
          setUser(me.user);
          setStatus("authenticated");
        }
        return;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const recovered = await recoverSession();
          if (recovered) {
            try {
              const me = await meRequest();
              if (!cancelled) {
                setUser(me.user);
                setStatus("authenticated");
              }
              return;
            } catch (retryError) {
              if (!(retryError instanceof ApiError && retryError.status === 401)) {
                // Refresh succeeded but re-validation hit a transient error.
                // Keep the cached identity rather than logging out.
                if (!cancelled) setStatus("authenticated");
                return;
              }
            }
          }

          clearSession();
          if (!cancelled) {
            setUser(null);
            setStatus("unauthenticated");
          }
          return;
        }

        // Non-401 validation failure (e.g. network/server). Keep the cached
        // session optimistically rather than logging the user out on a transient
        // error; protected API calls will surface their own errors.
        if (!cancelled) setStatus("authenticated");
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearSession();
      setUser(null);
      setStatus("unauthenticated");
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const signIn = useCallback(async (credentials: LoginCredentials) => {
    const result = await loginRequest(credentials);
    storeSession(result.accessToken, result.refreshToken, result.user);
    setUser(result.user);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest(getStoredRefreshToken());
    } catch {
      // Best-effort: always clear the local session even if the API fails.
    }
    clearSession();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAuthenticated: status === "authenticated",
      signIn,
      signOut,
    }),
    [status, user, signIn, signOut],
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
