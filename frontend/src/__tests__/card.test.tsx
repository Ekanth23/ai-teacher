import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/Card";

describe("Card", () => {
  it("renders its sections and content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Mathematics</CardTitle>
          <CardDescription>Explore your learning topics.</CardDescription>
        </CardHeader>
        <CardContent>Topic content goes here.</CardContent>
      </Card>,
    );

    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(
      screen.getByText("Explore your learning topics."),
    ).toBeInTheDocument();
    expect(screen.getByText("Topic content goes here.")).toBeInTheDocument();
  });
});
