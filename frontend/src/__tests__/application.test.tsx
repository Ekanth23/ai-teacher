import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import App from "../App";
import { renderWithProviders } from "../test/test-utils";

describe("application", () => {
  it("renders the sign-in screen", () => {
    renderWithProviders(<App />, { route: "/login" });
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });

  it("redirects the root path to the sign-in screen when unauthenticated", () => {
    renderWithProviders(<App />, { route: "/" });
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });
});
