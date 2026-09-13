import type { ComponentType, SVGProps } from "react";
import {
  ChartBarIcon,
  GraduationCapIcon,
  HomeIcon,
  PenLineIcon,
  SparklesIcon,
  UserIcon,
} from "../components/icons";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * Primary student navigation. Shared by the desktop sidebar and the mobile
 * bottom navigation so the two stay in sync.
 */
export const primaryNav: NavItem[] = [
  { to: "/dashboard", label: "Home", icon: HomeIcon },
  { to: "/learning", label: "My Learning", icon: GraduationCapIcon },
  { to: "/practice", label: "Practice", icon: PenLineIcon },
  { to: "/results", label: "Results", icon: ChartBarIcon },
  { to: "/ai-teacher", label: "AI Teacher", icon: SparklesIcon },
  { to: "/profile", label: "Profile", icon: UserIcon },
];
