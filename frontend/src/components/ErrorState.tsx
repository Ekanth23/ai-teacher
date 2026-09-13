import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { AlertIcon } from "./icons";
import { Button } from "./ui/Button";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn’t load this right now. Please try again.",
  onRetry,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-error-subtle bg-white px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-subtle text-error">
        <AlertIcon className="h-6 w-6" />
      </div>
      <h3 className="card-title">{title}</h3>
      <p className="secondary max-w-sm">{description}</p>
      {action ? (
        <div className="pt-2">{action}</div>
      ) : onRetry ? (
        <div className="pt-2">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
