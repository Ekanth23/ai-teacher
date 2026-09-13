import type { ElementType, HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  as?: ElementType;
}

/**
 * Responsive content container: consistent max width and horizontal padding
 * across mobile, tablet, and desktop.
 */
export function Container({
  as: Component = "div",
  className,
  ...props
}: ContainerProps) {
  return (
    <Component
      className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}
      {...props}
    />
  );
}
