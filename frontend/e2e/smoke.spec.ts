import { expect, test } from "@playwright/test";

test.describe("sign-in screen", () => {
  test("renders the login identity and form controls", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email or phone")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
  });

  test("shows validation messages when submitted empty", async ({ page }) => {
    await page.goto("/login");

    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter your email or phone.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
  });
});

test.describe("route protection", () => {
  test("redirects unauthenticated users from /dashboard to /login", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  });
});
