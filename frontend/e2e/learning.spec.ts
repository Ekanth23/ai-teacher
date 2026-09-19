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

const chapterFixture = {
  chapter: chaptersFixture.chapters[0],
};

const topicsFixture = {
  topics: [
    {
      id: "topic-1",
      curriculum_structure_id: "structure-1",
      parent_node_id: "chapter-1",
      node_type_id: "topic-type-1",
      node_type_code: "TOPIC",
      node_type_name: "Topic",
      subject_id: "subject-1",
      title: "Integers",
      code: "T-1",
      description: "Operations on integers.",
      sequence_number: 1,
      metadata: {},
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  total: 1,
};

const resourcesFixture = {
  learningResources: [
    {
      id: "resource-1",
      resource_type: "WORKSHEET",
      title: "Integers Practice Sheet",
      description: "Practice operations on integers.",
      language_code: "en",
      file_url: "https://cdn.example.com/integers-worksheet.pdf",
      file_name: "integers-worksheet.pdf",
      mime_type: "application/pdf",
      file_size_bytes: 102400,
      curriculum_node_id: "topic-1",
      class_id: null,
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
      body: JSON.stringify({
        user: sessionUser,
        organizations: [
          {
            id: "org-1",
            name: "Example School",
            slug: "example-school",
            type: "SCHOOL",
            membership_status: "ACTIVE",
            role_name: "STUDENT",
          },
        ],
      }),
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
  await page.route("**/api/curriculum/chapters/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chapterFixture),
    }),
  );
  await page.route("**/api/curriculum/chapters/*/topics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(topicsFixture),
    }),
  );
  await page.route("**/api/organizations/*/learning-resources*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(resourcesFixture),
    }),
  );
}

test.describe("curriculum learning journey", () => {
  test("navigates from My Learning through subjects to a chapter list", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await mockLearning(page);

    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: "Welcome back, Test Student" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "My Learning" }).first().click();
    await expect(page).toHaveURL(/\/learning$/);

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

    await page.getByRole("link", { name: /Number Systems/ }).click();
    await expect(page).toHaveURL(
      /\/learning\/class-1\/subjects\/subject-1\/chapters\/chapter-1$/,
    );
    await expect(page.getByRole("heading", { name: "Number Systems" })).toBeVisible();
    await expect(page.getByText("CH-1", { exact: true })).toBeVisible();
    await expect(page.getByText("Learn about real numbers.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Topics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Integers", exact: true })).toBeVisible();
    await expect(page.getByText("T-1", { exact: true })).toBeVisible();
    await expect(page.getByText("Operations on integers.")).toBeVisible();

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toContainText("My Learning");
    await expect(breadcrumb).toContainText("Grade 8");
    await expect(breadcrumb).toContainText("Mathematics");
    await expect(breadcrumb).toContainText("Number Systems");
    await expect(breadcrumb.getByText("Number Systems", { exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await expect(page.getByRole("link", { name: /Integers/ })).toHaveAttribute(
      "href",
      "/learning/class-1/subjects/subject-1/chapters/chapter-1/topics/topic-1",
    );
    await page.getByRole("link", { name: /Integers/ }).click();
    await expect(page).toHaveURL(
      /\/learning\/class-1\/subjects\/subject-1\/chapters\/chapter-1\/topics\/topic-1$/,
    );

    await expect(page.getByRole("heading", { name: "Integers", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learning Resources" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Integers Practice Sheet" }),
    ).toBeVisible();
    await expect(page.getByText("Worksheet", { exact: true })).toBeVisible();
    await expect(page.getByText("Practice operations on integers.")).toBeVisible();
    await expect(page.getByText("integers-worksheet.pdf")).toBeVisible();
    await expect(page.getByRole("link", { name: /Open resource/ })).toHaveAttribute(
      "href",
      "https://cdn.example.com/integers-worksheet.pdf",
    );

    const topicBreadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(topicBreadcrumb).toContainText("My Learning");
    await expect(topicBreadcrumb).toContainText("Grade 8");
    await expect(topicBreadcrumb).toContainText("Mathematics");
    await expect(topicBreadcrumb).toContainText("Number Systems");
    await expect(topicBreadcrumb).toContainText("Integers");
    await expect(topicBreadcrumb.getByText("Integers", { exact: true })).toHaveAttribute(
      "aria-current",
      "page",
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
