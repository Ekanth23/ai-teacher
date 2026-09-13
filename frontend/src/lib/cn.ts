import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine class names, resolving Tailwind class conflicts (tailwind-merge)
 * and filtering out falsy values (clsx).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
