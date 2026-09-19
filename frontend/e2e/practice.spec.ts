import { expect, test, type Page } from "@playwright/test";

const sessionUser = {
  id: "00000000-0000-0000-0000-000000000001",
  full_name: "Test Student",
  email: "student@example.com",
  phone: null,
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00.000Z",
};

const practicesFixture = {
  practices: [
    {
      id: "practice-1",
      title: "Integers Quiz",
      description: "Test your skills on integer operations.",
      practice_type: "QUIZ",
      topic: { id: "topic-1", name: "Integers" },
    },
    {
      id: "practice-2",
      title: "Life Mathematics Practice",
      description: null,
      practice_type: "SELF_ASSESSMENT",
      topic: { id: "topic-2", name: "Life Mathematics" },
    },
  ],
  total: 2,
};

const practiceFixture = {
  practice: {
    id: "practice-1",
    title: "Integers Quiz",
    description: "Test your skills on integer operations.",
    practice_type: "QUIZ",
    topic: { id: "topic-1", name: "Integers" },
    question_count: 2,
    questions: [
      {
        id: "q-1",
        sequence_number: 1,
        question_text: "What is -3 + 5?",
        options: [
          { key: "A", text: "8" },
          { key: "B", text: "2" },
          { key: "C", text: "-2" },
          { key: "D", text: "-8" },
        ],
        marks: 1,
      },
      {
        id: "q-2",
        sequence_number: 2,
        question_text: "Choose the even number.",
        options: [
          { key: "A", text: "3" },
          { key: "B", text: "5" },
          { key: "C", text: "6" },
          { key: "D", text: "7" },
        ],
        marks: 2,
      },
    ],
  },
};

const startAttemptFixture = {
  attempt: {
    id: "attempt-1",
    practice_id: "practice-1",
    status: "IN_PROGRESS",
    started_at: "2026-09-17T00:00:00.000Z",
  },
  questions: practiceFixture.practice.questions,
};

// Seed the app's real auth persistence (the same localStorage session a
// successful sign-in writes) and intercept the practice APIs with controlled
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

async function mockPractice(page: Page) {
  await page.route("**/api/student/practices/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(practiceFixture),
    }),
  );
  await page.route("**/api/student/practices/*/attempts", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(startAttemptFixture),
    }),
  );
  await page.route("**/api/student/practices", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(practicesFixture),
    }),
  );
}

test.describe("practice discovery and detail", () => {
  test("discovers a practice, previews it, and starts an attempt", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await mockPractice(page);

    await page.goto("/practice");

    await expect(
      page.getByRole("heading", { name: "Practice", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Integers Quiz" })).toBeVisible();
    await expect(page.getByText("Integers", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Life Mathematics Practice" }),
    ).toBeVisible();
    await expect(page.getByText("Self-assessment")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Integers Quiz/ }),
    ).toHaveAttribute("href", "/practice/practice-1");

    await page.getByRole("link", { name: /Integers Quiz/ }).click();
    await expect(page).toHaveURL(/\/practice\/practice-1$/);

    await expect(
      page.getByRole("heading", { name: "Integers Quiz" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Integers Quiz");
    await expect(page.getByText(/Integers · 2 questions/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
    await expect(page.getByText("What is -3 + 5?")).toBeVisible();
    await expect(page.getByText("Choose the even number.")).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Start Practice" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start Practice" }).click();

    await expect(page).toHaveURL(/\/practice\/practice-1\/attempt\/attempt-1$/);
    await expect(page.getByText("Question 1 of 2")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit Practice" }),
    ).toBeVisible();
  });

  test("shows an empty state when no practices are published", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await page.route("**/api/student/practices", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ practices: [], total: 0 }),
      }),
    );

    await page.goto("/practice");

    await expect(page.getByText("No practices yet")).toBeVisible();
  });
});