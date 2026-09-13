import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import App from "../App";
import { renderWithProviders } from "../test/test-utils";

describe("application", () => {
  it("renders the login placeholder without crashing", () => {
    renderWithProviders(<App />, { route: "/login" });
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
  });

  it("redirects the root path to login when unauthenticated", () => {
    renderWithProviders(<App />, { route: "/" });
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
  });
});
