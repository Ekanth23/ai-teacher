import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorState } from "../components/ErrorState";

describe("ErrorState", () => {
  it("renders a human-readable message and invokes retry", () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Couldn’t load your results"
        description="Please try again in a moment."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Couldn’t load your results")).toBeInTheDocument();
    expect(screen.getByText("Please try again in a moment.")).toBeInTheDocument();

    const retry = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("uses safe defaults when no copy is provided", () => {
    render(<ErrorState />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
