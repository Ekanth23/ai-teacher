import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";

/**
 * Guards a route branch. Unauthenticated users are redirected to /login with
 * the intended destination preserved so a future login flow can return them.
 */
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
