import { cn } from "../../lib/cn";
import { SpinnerIcon } from "../icons";

export interface SpinnerProps {
  className?: string;
  label?: string;
}

export function Spinner({ className, label = "Loading" }: SpinnerProps) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <SpinnerIcon className="h-5 w-5 animate-spin text-primary-600" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
