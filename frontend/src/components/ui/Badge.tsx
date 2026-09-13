import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type BadgeVariant =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "info";

const variantClasses: Record<BadgeVariant, string> = {
  neutral: "bg-neutral-100 text-neutral-700",
  primary: "bg-primary-50 text-primary-700",
  success: "bg-success-subtle text-success-content",
  warning: "bg-warning-subtle text-warning-content",
  error: "bg-error-subtle text-error-content",
  info: "bg-info-subtle text-info-content",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  variant = "neutral",
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
