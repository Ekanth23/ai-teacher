import { expect, test, type Page } from "@playwright/test";

const sessionUser = {
  id: "00000000-0000-0000-0000-000000000001",
  full_name: "Test Student",
  email: "student@example.com",
  phone: null,
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00.000Z",
};

const dashboardFixture = {
  student: { id: "student-1", full_name: "Alice Student", grade_level: "8" },
  classes: [{ id: "class-1", name: "Class 8", section: "A" }],
  current_class: { id: "class-1", name: "Class 8", section: "A" },
  subjects: [
    { id: "subject-1", name: "Mathematics", code: "MATH" },
    { id: "subject-2", name: "Science", code: "SCI" },
  ],
  recent_activity: [],
  learning_resources: [],
  curriculum_structures: [],
  progress: null,
};

// Seed the app's real auth persistence (the same localStorage session a
// successful sign-in writes) and intercept the dashboard API with a controlled
// fixture. No real backend, account, or credentials are used.
async function seedAuthenticatedSession(page: Page) {
  await page.addInitScript((user) => {
    window.localStorage.setItem(
      "ai-teacher:accessToken",
      JSON.stringify("test-access-token"),
    );
    window.localStorage.setItem(
      "ai-teacher:refreshToken",
      JSON.stringify("test-refresh-token"),
    );
    window.localStorage.setItem("ai-teacher:user", JSON.stringify(user));
  }, sessionUser);

  // The new auth bootstrap validates the stored token via GET /api/auth/me.
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: sessionUser, organizations: [] }),
    }),
  );
}

async function mockDashboard(page: Page, body: unknown) {
  await page.route("**/api/student/dashboard", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
}

test.describe("student dashboard", () => {
  test("renders welcome, current class, and subjects", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await mockDashboard(page, dashboardFixture);

    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: "Welcome back, Alice Student" }),
    ).toBeVisible();
    await expect(page.getByText("Class 8")).toBeVisible();
    await expect(page.getByText("Mathematics")).toBeVisible();
    await expect(page.getByText("Science")).toBeVisible();
  });

  test("shows empty states when there is no class or subjects", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await mockDashboard(page, {
      ...dashboardFixture,
      current_class: null,
      subjects: [],
    });

    await page.goto("/dashboard");

    await expect(page.getByText("No current class selected")).toBeVisible();
    await expect(page.getByText("No subjects yet")).toBeVisible();
  });
});
