import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { LoginForm, type LoginFormValues } from "../components/auth/LoginForm";
import { BookIcon } from "../components/icons";
import { Card } from "../components/ui/Card";
import { ApiError } from "../services/api/errors";

interface LoginLocationState {
  from?: { pathname?: string };
}

export default function LoginPage() {
  const { isAuthenticated, signIn } = useAuth();
  const location = useLocation();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = location.state as LoginLocationState | null;
  const destination =
    state?.from?.pathname && state.from.pathname.startsWith("/")
      ? state.from.pathname
      : "/dashboard";

  const handleSubmit = async (values: LoginFormValues) => {
    setLoading(true);
    setError(null);
    try {
      await signIn(values);
      // On success the AuthProvider flips to authenticated and the guard below
      // redirects into the application (back to the intended destination).
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Unable to sign in. Please try again.",
      );
      setLoading(false);
    }
  };

  if (isAuthenticated) {
    return <Navigate to={destination} replace />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
              <BookIcon className="h-7 w-7" />
            </div>
            <div>
              <h1 className="page-title">Welcome back</h1>
              <p className="secondary mt-1">Sign in to continue learning.</p>
            </div>
          </div>
          <Card className="p-6">
            <LoginForm loading={loading} error={error} onSubmit={handleSubmit} />
          </Card>
        </div>
      </main>
    </div>
  );
}
