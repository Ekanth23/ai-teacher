import { Link } from "react-router-dom";
import { cn } from "../lib/cn";
import { ChevronRightIcon } from "./icons";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("overflow-x-auto", className)}>
      <ol className="flex min-w-max items-center gap-1.5 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? (
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-neutral-400" />
              ) : null}
              {isLast || !item.href ? (
                <span aria-current="page" className="font-medium text-neutral-800">
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.href}
                  className="rounded text-neutral-500 transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
