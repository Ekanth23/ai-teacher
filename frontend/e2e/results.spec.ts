import { expect, test, type Page } from "@playwright/test";

const sessionUser = {
  id: "00000000-0000-0000-0000-000000000001",
  full_name: "Test Student",
  email: "student@example.com",
  phone: null,
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00.000Z",
};

const historyFixture = {
  results: [
    {
      id: "attempt-1",
      practice: {
        id: "practice-1",
        title: "Integers Quiz",
        practice_type: "QUIZ",
        topic: "Integers",
      },
      status: "SUBMITTED",
      started_at: "2026-09-17T00:00:00.000Z",
      submitted_at: "2026-09-17T00:05:00.000Z",
      score: 1,
      max_score: 4,
      percentage: 25,
      correct_count: 1,
      incorrect_count: 1,
      unanswered_count: 1,
    },
  ],
  total: 1,
};

const resultFixture = {
  id: "attempt-1",
  practice: {
    id: "practice-1",
    title: "Integers Quiz",
    practice_type: "QUIZ",
    topic: "Integers",
  },
  status: "SUBMITTED",
  started_at: "2026-09-17T00:00:00.000Z",
  submitted_at: "2026-09-17T00:05:00.000Z",
  score: 1,
  max_score: 4,
  percentage: 25,
  correct_count: 1,
  incorrect_count: 1,
  unanswered_count: 1,
  questions: [
    {
      question_id: "q-1",
      question_text: "What is -3 + 5?",
      options: [
        { key: "A", text: "8" },
        { key: "B", text: "2" },
        { key: "C", text: "-2" },
        { key: "D", text: "-8" },
      ],
      selected_option: "B",
      correct_option: "B",
      is_correct: true,
      marks: 1,
      awarded_marks: 1,
      explanation: "Negative three plus five equals two.",
    },
    {
      question_id: "q-2",
      question_text: "Choose the even number.",
      options: [
        { key: "A", text: "3" },
        { key: "B", text: "5" },
        { key: "C", text: "6" },
        { key: "D", text: "7" },
      ],
      selected_option: null,
      correct_option: "C",
      is_correct: false,
      marks: 2,
      awarded_marks: 0,
      explanation: null,
    },
  ],
};

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

async function mockResults(page: Page) {
  await page.route("**/api/student/results", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(historyFixture),
    }),
  );
  await page.route("**/api/student/attempts/attempt-1/result", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(resultFixture),
    }),
  );
  await page.route(
    "**/api/student/practices/practice-1/attempts",
    (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          attempt: {
            id: "attempt-2",
            practice_id: "practice-1",
            status: "IN_PROGRESS",
            started_at: "2026-09-18T00:00:00.000Z",
          },
          questions: [],
        }),
      }),
  );
}

test.describe("results and review", () => {
  test("history → detail → summary → per-question review → try again", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await mockResults(page);

    await page.goto("/results");
    await expect(
      page.getByRole("heading", { name: "Results", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Integers Quiz" }),
    ).toBeVisible();
    await expect(page.getByText("1 of 4 · 25%")).toBeVisible();
    await expect(
      page.getByText("1 correct · 1 incorrect · 1 unanswered"),
    ).toBeVisible();

    await page.getByRole("link", { name: /Integers Quiz/ }).click();
    await expect(page).toHaveURL(/\/results\/attempt-1$/);

    await expect(
      page.getByRole("heading", { name: "Integers Quiz" }),
    ).toBeVisible();
    await expect(page.getByText("1 of 4 · 25%")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Question review" }),
    ).toBeVisible();
    await expect(page.getByText("What is -3 + 5?")).toBeVisible();
    await expect(page.getByText("Correct", { exact: true })).toBeVisible();
    await expect(page.getByText("1 of 1 mark")).toBeVisible();
    await expect(
      page.getByText("Negative three plus five equals two."),
    ).toBeVisible();
    await expect(page.getByText("Unanswered", { exact: true })).toBeVisible();
    await expect(
      page.getByText("You did not answer this question."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Try Again" }).click();
    await expect(page).toHaveURL(
      /\/practice\/practice-1\/attempt\/attempt-2$/,
    );
  });

  test("return navigation reaches results and practice", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await mockResults(page);

    await page.goto("/results/attempt-1");
    await expect(
      page.getByRole("heading", { name: "Integers Quiz" }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Back to Results" }),
    ).toHaveAttribute("href", "/results");
    await expect(
      page.getByRole("link", { name: "Back to Practice" }),
    ).toHaveAttribute("href", "/practice");

    await page.getByRole("link", { name: "Back to Results" }).click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(
      page.getByRole("heading", { name: "Integers Quiz" }),
    ).toBeVisible();
  });

  test("empty history offers a return to practice", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await page.route("**/api/student/results", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: [], total: 0 }),
      }),
    );

    await page.goto("/results");
    await expect(page.getByText("No results yet")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse Practice" }),
    ).toHaveAttribute("href", "/practice");
  });
});
