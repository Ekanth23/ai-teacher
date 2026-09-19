import { expect, test, type Page } from "@playwright/test";

const sessionUser = {
  id: "00000000-0000-0000-0000-000000000001",
  full_name: "Test Student",
  email: "student@example.com",
  phone: null,
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00.000Z",
};

const QUESTIONS = [
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
];

const practiceFixture = {
  practice: {
    id: "practice-1",
    title: "Integers Quiz",
    description: "Test your skills on integer operations.",
    practice_type: "QUIZ",
    topic: { id: "topic-1", name: "Integers" },
    question_count: 2,
    questions: QUESTIONS,
  },
};

const startAttemptFixture = {
  attempt: {
    id: "attempt-1",
    practice_id: "practice-1",
    status: "IN_PROGRESS",
    started_at: "2026-09-17T00:00:00.000Z",
  },
  questions: QUESTIONS,
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

async function mockAttemptApis(page: Page) {
  await page.route(
    "**/api/student/practices/practice-1/attempts",
    (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(startAttemptFixture),
      }),
  );
  await page.route("**/api/student/practices/practice-1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(practiceFixture),
    }),
  );
  await page.route("**/api/student/attempts/attempt-1/answers", (route) => {
    const body = route.request().postDataJSON() as {
      answers: { question_id: string; selected_option: string }[];
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        answers: body.answers.map((answer) => ({
          ...answer,
          answered_at: "2026-09-17T00:00:00.000Z",
        })),
      }),
    });
  });
  await page.route("**/api/student/attempts/attempt-1/submit", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "attempt-1",
        practice_id: "practice-1",
        status: "SUBMITTED",
        started_at: "2026-09-17T00:00:00.000Z",
        submitted_at: "2026-09-17T00:05:00.000Z",
        score: 3,
        max_score: 3,
        percentage: 100,
        correct_count: 2,
        incorrect_count: 0,
        unanswered_count: 0,
      }),
    }),
  );
}

test.describe("practice attempt player", () => {
  test("start → answer → navigate → submit confirmation → submitted", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await mockAttemptApis(page);

    await page.goto("/practice/practice-1");
    await expect(
      page.getByRole("heading", { name: "Integers Quiz" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start Practice" }).click();

    await expect(page).toHaveURL(/\/practice\/practice-1\/attempt\/attempt-1$/);
    await expect(page.getByText("Question 1 of 2")).toBeVisible();
    await expect(page.getByText("0 of 2 answered")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

    await page.locator('input[type="radio"][value="B"]').click();
    await expect(
      page.locator('input[type="radio"][value="B"]'),
    ).toBeChecked();
    await expect(page.getByText("Answer saved")).toBeVisible();
    await expect(page.getByText("1 of 2 answered")).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Question 2 of 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await page.locator('input[type="radio"][value="C"]').click();
    await expect(page.getByText("2 of 2 answered")).toBeVisible();

    await page.getByRole("button", { name: "Previous" }).click();
    await expect(
      page.locator('input[type="radio"][value="B"]'),
    ).toBeChecked();

    await page.getByRole("button", { name: "Submit Practice" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Submission is final");
    await expect(dialog).toContainText("You have answered every question.");
    await dialog.getByRole("button", { name: "Confirm Submit" }).click();

    await expect(page.getByText("Practice submitted")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View Results" }),
    ).toHaveAttribute("href", "/results");
    // The backend score must not be rendered by the player.
    await expect(page.getByText("100")).toHaveCount(0);
  });

  test("cancel keeps the attempt without submitting", async ({ page }) => {
    await seedAuthenticatedSession(page);
    await mockAttemptApis(page);

    await page.goto("/practice/practice-1/attempt/attempt-1");
    await expect(page.getByText("Question 1 of 2")).toBeVisible();

    await page.getByRole("button", { name: "Submit Practice" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Practice submitted")).toHaveCount(0);
    await expect(page.getByText("Question 1 of 2")).toBeVisible();
  });
});
