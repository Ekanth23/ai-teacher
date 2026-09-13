import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field, Input } from "../components/ui/Input";

describe("Input / Field", () => {
  it("associates the label with the input", () => {
    render(
      <Field label="Email">
        <Input placeholder="you@example.com" />
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("id");
  });

  it("wires error state with aria attributes", () => {
    render(
      <Field label="Password" error="Password is required.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby");
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
  });

  it("supports the disabled state", () => {
    render(
      <Field label="Email">
        <Input disabled />
      </Field>,
    );
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });
});
