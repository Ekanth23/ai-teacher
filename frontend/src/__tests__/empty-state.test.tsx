import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "../components/EmptyState";

describe("EmptyState", () => {
  it("renders title, description, and optional action", () => {
    render(
      <EmptyState
        title="No practices available yet"
        description="Practices you can attempt will show up here."
        action={<button>Get started</button>}
      />,
    );

    expect(screen.getByText("No practices available yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Practices you can attempt will show up here\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Get started" }),
    ).toBeInTheDocument();
  });

  it("renders without an action", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});
