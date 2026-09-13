import { cn } from "../../lib/cn";

export type AvatarSize = "sm" | "md" | "lg";

const sizeClasses: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
};

export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  className?: string;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const label = name || "User";
  const fallback = initials(name) || "?";

  return (
    <span
      aria-label={`${label} avatar`}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary-100 font-medium text-primary-700",
        sizeClasses[size],
        className,
      )}
    >
      {src ? (
        <img src={src} alt={`${label}'s avatar`} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true">{fallback}</span>
      )}
    </span>
  );
}
