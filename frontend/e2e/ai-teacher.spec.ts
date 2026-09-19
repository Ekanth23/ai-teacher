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
  status: "success",
  conversations: [
    {
      id: "conv-1",
      subject: "Maths",
      topic: "Fractions",
      updated_at: "2026-09-17T00:05:00.000Z",
    },
  ],
  total: 1,
};

const threadFixture = {
  status: "success",
  messages: [
    {
      id: "msg-1",
      role: "user",
      content: "What is 2 + 2?",
      created_at: "2026-09-17T00:00:00.000Z",
    },
    {
      id: "msg-2",
      role: "assistant",
      content: "2 + 2 equals 4.",
      created_at: "2026-09-17T00:00:05.000Z",
    },
  ],
  total: 2,
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

async function mockAiTeacher(page: Page) {
  await page.route("**/api/ai/conversations", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Conversation created successfully",
          conversation: {
            id: "conv-2",
            subject: null,
            topic: null,
            created_at: "2026-09-18T00:00:00.000Z",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(historyFixture),
    });
  });
  await page.route("**/api/ai/conversations/conv-1/messages", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(threadFixture),
    }),
  );
  await page.route("**/api/ai/conversations/conv-2/messages", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success", messages: [], total: 0 }),
    }),
  );
  await page.route("**/api/ai/reply", async (route) => {
    const body = route.request().postDataJSON() as {
      conversation_id: string;
      question: string;
    };
    // Small delay so the thinking state is observable.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "AI reply created successfully",
        data: {
          id: "msg-9",
          conversation_id: body.conversation_id,
          role: "assistant",
          content: `Answer to: ${body.question}`,
          created_at: "2026-09-18T00:01:00.000Z",
        },
      }),
    });
  });
}

test.describe("AI Teacher experience", () => {
  test("enter → start → send → reply → revisit from history", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await mockAiTeacher(page);

    await page.goto("/ai-teacher");
    await expect(
      page.getByRole("heading", { name: "AI Teacher", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Explain this topic in simple terms" }),
    ).toBeVisible();
    await expect(page.getByText("Maths · Fractions")).toBeVisible();

    await page.getByLabel("What would you like help with?").fill("What is 2 + 2?");
    await page.getByRole("button", { name: "Ask AI Teacher" }).click();
    await expect(page).toHaveURL(/\/ai-teacher\/conv-2$/);

    await expect(page.getByText("Start the conversation")).toBeVisible();
    await page.getByLabel("Message AI Teacher").fill("What is 3 + 3?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("AI Teacher is thinking…")).toBeVisible();

    await page.goto("/ai-teacher");
    await expect(page.getByText("Maths · Fractions")).toBeVisible();
    await page.getByRole("link", { name: /Maths · Fractions/ }).click();
    await expect(page).toHaveURL(/\/ai-teacher\/conv-1$/);
    await expect(page.getByText("What is 2 + 2?")).toBeVisible();
    await expect(page.getByText("2 + 2 equals 4.")).toBeVisible();
    await expect(page.getByText("You", { exact: true })).toBeVisible();
  });

  test("suggested prompt fills the composer and empty history is explained", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await mockAiTeacher(page);
    await page.route("**/api/ai/conversations", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            status: "success",
            message: "Conversation created successfully",
            conversation: {
              id: "conv-2",
              subject: null,
              topic: null,
              created_at: "2026-09-18T00:00:00.000Z",
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "success", conversations: [], total: 0 }),
      });
    });

    await page.goto("/ai-teacher");
    await expect(page.getByText("No conversations yet")).toBeVisible();
    await page
      .getByRole("button", { name: "Give me a practice question" })
      .click();
    await expect(page.getByLabel("What would you like help with?")).toHaveValue(
      "Give me a practice question",
    );
  });
});
