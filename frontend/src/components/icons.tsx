import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

/**
 * Minimal, dependency-free inline icon set. Icons are decorative by default
 * (aria-hidden) and inherit the current text color.
 */
const baseProps: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function BookIcon({ className, ...props }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

export function SpinnerIcon({ className, ...props }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...props}>
      <circle cx="12" cy="12" r="10" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" strokeWidth="3" />
    </svg>
  );
}

export function CheckIcon({ className, ...props }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function AlertIcon({ className, ...props }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function InfoIcon({ className, ...props }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function ChevronRightIcon({ className, ...props }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...props}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
