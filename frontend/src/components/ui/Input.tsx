import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Renders error styling and sets aria-invalid. */
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-10 w-full rounded-md border bg-white px-3 text-sm text-neutral-800 placeholder:text-neutral-400",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
        invalid
          ? "border-error focus-visible:ring-error"
          : "border-neutral-300 focus-visible:ring-primary-500",
        "disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400",
        className,
      )}
      {...props}
    />
  );
});

export interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Accessible form field. Wraps a single form control, associates it with a
 * label, and wires up aria-describedby / aria-invalid for hint and error text.
 *
 * The child control is the source of validation state; `error` here is only
 * used for presentation and accessibility wiring.
 */
export function Field({ label, error, hint, className, children }: FieldProps) {
  const autoId = useId();
  const id = `field-${autoId}`;
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const injectedProps: Record<string, unknown> = {
    id,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": true } : {}),
  };

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, injectedProps)
    : children;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      {control}
      {hint && !error ? (
        <p id={`${id}-hint`} className="caption">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
