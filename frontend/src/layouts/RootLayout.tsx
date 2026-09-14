import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { primaryNav } from "../app/navigation";
import { useAuth } from "../auth/auth-context";
import { BookIcon, LogOutIcon } from "../components/icons";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { cn } from "../lib/cn";

/**
 * Authenticated application shell.
 *
 * Desktop: fixed left sidebar with brand, primary navigation, active-route
 * highlight, and the user area with logout.
 *
 * Mobile: compact sticky header (brand + logout) plus a bottom navigation bar.
 * The two navigation surfaces are mutually exclusive (CSS-driven), so only one
 * is present in the accessibility tree at any viewport.
 */
export function RootLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const displayName = user?.full_name?.trim() || "Student";

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const brand = (
    <Link
      to="/dashboard"
      aria-label="AI Teacher home"
      className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <BookIcon className="h-6 w-6 text-primary-600" />
      <span className="text-base font-semibold text-neutral-900">AI Teacher</span>
    </Link>
  );

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-neutral-200 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-neutral-200 px-5">
          {brand}
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {primaryNav.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                      isActive
                        ? "bg-primary-50 text-primary-700"
                        : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
                    )
                  }
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-3 border-t border-neutral-200 p-3">
          <div className="flex items-center gap-3 px-2">
            <Avatar name={displayName} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-800">
                {displayName}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={handleLogout}
          >
            <LogOutIcon className="h-4 w-4" />
            Log out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-4 lg:hidden">
        {brand}
        <IconButton aria-label="Log out" onClick={handleLogout}>
          <LogOutIcon className="h-5 w-5" />
        </IconButton>
      </header>

      {/* Main content */}
      <div className="pb-16 lg:pb-0 lg:pl-64">
        <main className="py-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-neutral-200 bg-white lg:hidden"
      >
        {primaryNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-1 px-1 py-2 text-center text-[11px] font-medium",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                isActive ? "text-primary-700" : "text-neutral-500",
              )
            }
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
