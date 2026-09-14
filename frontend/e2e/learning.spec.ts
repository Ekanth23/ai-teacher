import { expect, test, type Page } from "@playwright/test";

const sessionUser = {
  id: "00000000-0000-0000-0000-000000000001",
  full_name: "Test Student",
  email: "student@example.com",
  phone: null,
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00.000Z",
};

const classesFixture = {
  classes: [{ id: "class-1", name: "Grade 8", section: "A" }],
  total: 1,
};

const subjectsFixture = {
  subjects: [{ id: "subject-1", name: "Mathematics", code: "MATH" }],
  total: 1,
};

const dashboardFixture = {
  student: { id: "student-1", full_name: "Test Student", grade_level: "8" },
  classes: classesFixture.classes,
  current_class: classesFixture.classes[0],
  subjects: subjectsFixture.subjects,
  recent_activity: [],
  learning_resources: [],
  curriculum_structures: [
    { id: "structure-1", class_id: "class-1", subject_id: "subject-1" },
  ],
  progress: null,
};

const chaptersFixture = {
  chapters: [
    {
      id: "chapter-1",
      curriculum_structure_id: "structure-1",
      parent_node_id: null,
      node_type_id: "chapter-type-1",
      node_type_code: "CHAPTER",
      node_type_name: "Chapter",
      subject_id: "subject-1",
      title: "Number Systems",
      code: "CH-1",
      description: "Learn about real numbers.",
      sequence_number: 1,
      metadata: {},
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  total: 1,
};

// Seed the app's real auth persistence (the same localStorage session a
// successful sign-in writes) and intercept the learning APIs with controlled
// fixtures. No real backend, account, or credentials are used.
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

async function mockLearning(page: Page) {
  await page.route("**/api/student/classes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(classesFixture),
    }),
  );
  await page.route("**/api/student/classes/*/subjects", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(subjectsFixture),
    }),
  );
  await page.route("**/api/student/dashboard", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dashboardFixture),
    }),
  );
  await page.route("**/api/curriculum/structures/*/chapters", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chaptersFixture),
    }),
  );
}

test.describe("curriculum learning journey", () => {
  test("navigates from My Learning through subjects to a chapter list", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await mockLearning(page);

    await page.goto("/learning");

    await expect(
      page.getByRole("heading", { name: "My Learning" }),
    ).toBeVisible();
    await expect(page.getByText("Grade 8")).toBeVisible();
    await expect(page.getByText("Section A")).toBeVisible();

    await page.getByRole("link", { name: /Grade 8/ }).click();
    await expect(page).toHaveURL(/\/learning\/class-1$/);

    await expect(page.getByRole("heading", { name: "Grade 8" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("My Learning");
    await expect(page.getByText("Mathematics")).toBeVisible();
    await expect(page.getByText("MATH", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: /Mathematics/ }).click();
    await expect(page).toHaveURL(/\/learning\/class-1\/subjects\/subject-1$/);

    await expect(
      page.getByRole("heading", { name: "Mathematics" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Grade 8");
    await expect(page.getByRole("heading", { name: "Chapters" })).toBeVisible();
    await expect(page.getByText("Number Systems")).toBeVisible();
    await expect(page.getByText("CH-1", { exact: true })).toBeVisible();
    await expect(page.getByText("Learn about real numbers.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Number Systems/ })).toHaveAttribute(
      "href",
      "/learning/class-1/subjects/subject-1/chapters/chapter-1",
    );
  });

  test("shows an empty state when the class has no subjects", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await page.route("**/api/student/classes", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(classesFixture),
      }),
    );
    await page.route("**/api/student/classes/*/subjects", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ subjects: [], total: 0 }),
      }),
    );

    await page.goto("/learning/class-1");

    await expect(
      page.getByRole("heading", { name: "Grade 8" }),
    ).toBeVisible();
    await expect(page.getByText("No subjects yet")).toBeVisible();
  });
});
