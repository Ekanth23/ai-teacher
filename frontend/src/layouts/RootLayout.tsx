import { Link, Outlet } from "react-router-dom";
import { Container } from "../components/Container";
import { BookIcon } from "../components/icons";

/**
 * Minimal root layout for the application foundation. Intentionally excluded
 * here: the full application shell (side/bottom navigation, profile menu,
 * logout, active-route state) which belongs to UI Epic 2.
 */
export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <Container className="flex h-14 items-center">
          <Link
            to="/"
            aria-label="AI Teacher home"
            className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <BookIcon className="h-6 w-6 text-primary-600" />
            <span className="text-base font-semibold text-neutral-900">
              AI Teacher
            </span>
          </Link>
        </Container>
      </header>
      <main className="flex-1 py-6">
        <Outlet />
      </main>
    </div>
  );
}
