import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import App from "../App";
import {
  renderWithProviders,
  seedAuthenticatedSession,
} from "../test/test-utils";

const protectedRoutes: Array<[string, string]> = [
  ["/dashboard", "Dashboard"],
  ["/learning", "My Learning"],
  ["/practice", "Practice"],
  ["/results", "Results"],
  ["/ai-teacher", "AI Teacher"],
  ["/profile", "Profile"],
];

describe("routes", () => {
  it.each(protectedRoutes)(
    "renders the %s placeholder when authenticated",
    (route, heading) => {
      seedAuthenticatedSession();
      renderWithProviders(<App />, { route });
      expect(
        screen.getByRole("heading", { name: heading }),
      ).toBeInTheDocument();
    },
  );
});
