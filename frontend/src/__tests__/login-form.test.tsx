import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "../components/auth/LoginForm";

describe("LoginForm", () => {
  it("renders identifier and password fields with a submit button", () => {
    render(<LoginForm onSubmit={() => {}} />);
    expect(screen.getByLabelText("Email or phone")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("shows validation errors when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSubmit={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email or phone.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
  });

  it("calls onSubmit with the entered values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Email or phone"), "student@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledWith({
      identifier: "student@example.com",
      password: "secret123",
    });
  });

  it("disables submission and shows a busy state while loading", () => {
    render(<LoginForm loading onSubmit={() => {}} />);
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("renders an external error message", () => {
    render(
      <LoginForm
        error="Invalid email/phone or password."
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid email/phone or password.",
    );
  });
});
