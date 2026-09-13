import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge, type BadgeVariant } from "../components/ui/Badge";

const variants: BadgeVariant[] = [
  "neutral",
  "primary",
  "success",
  "warning",
  "error",
  "info",
];

describe("Badge", () => {
  it.each(variants)("renders the %s variant with its label", (variant) => {
    render(<Badge variant={variant}>Status</Badge>);
    expect(screen.getByText("Status")).toBeInTheDocument();
  });
});
