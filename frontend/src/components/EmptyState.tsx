import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { InfoIcon } from "./icons";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
        {icon ?? <InfoIcon className="h-6 w-6" />}
      </div>
      <h3 className="card-title">{title}</h3>
      {description ? <p className="secondary max-w-sm">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
