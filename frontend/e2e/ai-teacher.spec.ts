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
      title: "Maths · Fractions",
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
  const convTwoMessages = [
    {
      id: "msg-2-user",
      role: "user",
      content: "What is 2 + 2?",
      status: "COMPLETED",
      created_at: "2026-09-18T00:00:00.000Z",
    },
    {
      id: "msg-2-assistant",
      role: "assistant",
      content: "Answer to: What is 2 + 2?",
      status: "COMPLETED",
      created_at: "2026-09-18T00:00:01.000Z",
    },
  ];

  await page.route("**/api/ai/conversations", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { question?: string };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Conversation created successfully",
          conversation: {
            id: "conv-2",
            title: body.question ?? "New Conversation",
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
  await page.route("**/api/ai/conversations/conv-2/messages", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { question: string };
      const userMessage = {
        id: `msg-${convTwoMessages.length + 1}-user`,
        role: "user",
        content: body.question,
        status: "COMPLETED",
        created_at: "2026-09-18T00:01:00.000Z",
      };
      const assistantMessage = {
        id: `msg-${convTwoMessages.length + 2}-assistant`,
        role: "assistant",
        content: `Answer to: ${body.question}`,
        status: "COMPLETED",
        created_at: "2026-09-18T00:01:01.000Z",
      };
      convTwoMessages.push(userMessage, assistantMessage);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "AI reply created successfully",
          conversation: { id: "conv-2", title: "What is 2 + 2?", subject: null, topic: null },
          student_message: userMessage,
          response_message: assistantMessage,
          data: assistantMessage,
          attempt: {
            id: "attempt-new",
            conversation_id: "conv-2",
            request_message_id: userMessage.id,
            response_message_id: assistantMessage.id,
            attempt_type: "ORIGINAL",
            attempt_number: convTwoMessages.length,
            retry_of_attempt_id: null,
            parent_attempt_id: null,
            status: "COMPLETED",
            provider: "mock",
            model: "mock-model",
            request_id: null,
            error_category: null,
            usage_event_id: null,
            started_at: userMessage.created_at,
            completed_at: assistantMessage.created_at,
          },
          generation_status: "COMPLETED",
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success", messages: convTwoMessages, total: convTwoMessages.length }),
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
    await expect(
      page.getByRole("heading", { name: "Maths · Fractions", exact: true }),
    ).toBeVisible();

    await page.getByLabel("What would you like help with?").fill("What is 2 + 2?");
    await page.getByRole("button", { name: "Ask AI Teacher" }).click();
    await expect(page).toHaveURL(/\/ai-teacher\/conv-2$/);

    await expect(page.getByText("What is 2 + 2?", { exact: true })).toBeVisible();
    await expect(page.getByText("Answer to: What is 2 + 2?", { exact: true })).toBeVisible();
    await page.getByLabel("Message AI Teacher").fill("What is 3 + 3?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("AI Teacher is thinking…")).toBeVisible();

    await page.goto("/ai-teacher");
    await expect(
      page.getByRole("heading", { name: "Maths · Fractions", exact: true }),
    ).toBeVisible();
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

  test("edit, branch activation, regeneration, feedback, rename, and delete stay authoritative", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    type MockMessage = Record<string, unknown>;
    let title = "Maths · Fractions";
    let activeBranch = "primary-branch";
    let messages: MockMessage[] = [
      {
        id: "user-e2e",
        role: "user",
        content: "What is 2 + 2?",
        status: "COMPLETED",
        sequence_number: 1,
        created_at: "2026-09-18T00:00:00.000Z",
      },
      {
        id: "response-e2e",
        role: "assistant",
        content: "2 + 2 equals 4.",
        request_message_id: "user-e2e",
        generation_attempt_id: "attempt-e2e",
        regeneration_available: true,
        status: "COMPLETED",
        sequence_number: 1,
        variant_number: 1,
        created_at: "2026-09-18T00:00:01.000Z",
      },
    ];
    const branches = [
      {
        id: "primary-branch",
        conversation_id: "conv-e2e",
        parent_branch_id: null,
        branch_point_message_id: null,
        name: "Primary",
        is_primary: true,
        is_active: true,
        created_at: "2026-09-18T00:00:00.000Z",
        updated_at: "2026-09-18T00:00:00.000Z",
      },
      {
        id: "edited-branch",
        conversation_id: "conv-e2e",
        parent_branch_id: "primary-branch",
        branch_point_message_id: "user-e2e",
        name: "Edited",
        is_primary: false,
        is_active: false,
        created_at: "2026-09-18T00:01:00.000Z",
        updated_at: "2026-09-18T00:01:00.000Z",
      },
    ];
    const historyPayload = () => ({
      status: "success",
      conversation: {
        id: "conv-e2e",
        title,
        subject: "Maths",
        topic: "Fractions",
        active_branch_id: activeBranch,
      },
      messages,
      branches: branches.map((branch) => ({
        ...branch,
        is_active: branch.id === activeBranch,
      })),
      attempts: [],
      active_attempt: null,
      processing_attempt: null,
      feedback: [],
    });
    const attempt = (id: string, requestId: string, responseId: string | null, attemptNumber: number) => ({
      id,
      conversation_id: "conv-e2e",
      branch_id: activeBranch,
      request_message_id: requestId,
      response_message_id: responseId,
      attempt_type: attemptNumber === 1 ? "ORIGINAL" : "REGENERATION",
      attempt_number: attemptNumber,
      retry_of_attempt_id: null,
      parent_attempt_id: attemptNumber === 1 ? null : "attempt-e2e",
      status: "COMPLETED",
      provider: "mock",
      model: "mock-model",
      request_id: null,
      error_category: null,
      usage_event_id: null,
      started_at: "2026-09-18T00:00:00.000Z",
      completed_at: "2026-09-18T00:00:01.000Z",
    });

    await page.route("**/api/ai/conversations/conv-e2e/messages", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historyPayload()) });
      }
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.route("**/api/ai/conversations/conv-e2e/regenerate", async (route) => {
      const responseId = route.request().postDataJSON() as { response_message_id: string };
      const variantNumber = messages.filter((message) => message.role === "assistant").length + 1;
      const response = {
        id: `response-e2e-${variantNumber}`,
        role: "assistant",
        content: `Alternative answer ${variantNumber}`,
        request_message_id: "user-e2e",
        generation_attempt_id: `attempt-e2e-${variantNumber}`,
        regeneration_available: true,
        status: "COMPLETED",
        sequence_number: 1,
        variant_number: variantNumber,
        created_at: `2026-09-18T00:0${variantNumber}:00.000Z`,
      } satisfies MockMessage;
      messages = [...messages, response];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          conversation: historyPayload().conversation,
          student_message: messages[0],
          response_message: response,
          data: response,
          attempt: attempt(`attempt-e2e-${variantNumber}`, "user-e2e", response.id, variantNumber),
          generation_status: "COMPLETED",
          __selected_response_id: responseId.response_message_id,
        }),
      });
    });
    await page.route("**/api/ai/conversations/conv-e2e/messages/user-e2e", async (route) => {
      const body = route.request().postDataJSON() as { content: string };
      const edited = {
        id: "user-e2e-edited",
        role: "user",
        content: body.content,
        status: "COMPLETED",
        parent_message_id: "user-e2e",
        sequence_number: 1,
        created_at: "2026-09-18T00:02:00.000Z",
      } satisfies MockMessage;
      messages = [...messages, edited];
      activeBranch = "edited-branch";
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          conversation: historyPayload().conversation,
          student_message: edited,
          response_message: null,
          data: null,
          attempt: attempt("attempt-edit", edited.id, null, 1),
          generation_status: "COMPLETED",
        }),
      });
    });
    await page.route("**/api/ai/conversations/conv-e2e/messages/response-e2e/feedback", async (route) => {
      const body = route.request().postDataJSON() as { sentiment: string };
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          feedback: {
            id: "feedback-e2e",
            conversation_id: "conv-e2e",
            response_message_id: "response-e2e",
            sentiment: body.sentiment === "not helpful" ? "NOT_HELPFUL" : "HELPFUL",
            reason: null,
            created_at: "2026-09-18T00:03:00.000Z",
            updated_at: "2026-09-18T00:03:00.000Z",
          },
        }),
      });
    });
    await page.route("**/api/ai/conversations/conv-e2e/branches/primary-branch/activate", async (route) => {
      activeBranch = "primary-branch";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historyPayload()) });
    });
    await page.route("**/api/ai/conversations/conv-e2e", async (route) => {
      if (route.request().method() === "PATCH") {
        title = (route.request().postDataJSON() as { title: string }).title;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "success", conversation: historyPayload().conversation }) });
      }
      if (route.request().method() === "DELETE") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "success", message: "Conversation deleted successfully" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historyPayload()) });
    });

    await page.goto("/ai-teacher/conv-e2e");
    await expect(page.getByText("2 + 2 equals 4.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Regenerate response" }).click();
    await expect(page.getByText("Alternative answer 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous variant" }).click();
    await expect(page.getByText("2 + 2 equals 4.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Helpful", exact: true }).click();
    await expect(page.getByText("Feedback submitted")).toBeVisible();

    await page.getByRole("button", { name: "Edit message" }).click();
    await page.getByLabel("Edit message").fill("What is 2 + 2, with steps?");
    await page.getByRole("button", { name: "Save edited message" }).click();
    await expect(page.getByText("Active branch: Edited", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Primary" }).click();
    await expect(page.getByText("Active branch: Primary", { exact: true })).toBeVisible();

    await page.getByLabel("Conversation title").fill("My renamed notes");
    await page.getByRole("button", { name: "Save title" }).click();
    await expect(page.getByRole("heading", { name: "My renamed notes", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete conversation" }).click();
    await expect(page).toHaveURL(/\/ai-teacher$/);
  });

  test("failed requests remain visible while polling transitions to a terminal state", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    let reads = 0;
    const processingAttempt = {
      id: "attempt-processing",
      conversation_id: "conv-polling",
      branch_id: "primary-polling",
      request_message_id: "request-polling",
      response_message_id: null,
      attempt_type: "ORIGINAL",
      attempt_number: 1,
      retry_of_attempt_id: null,
      parent_attempt_id: null,
      status: "PROCESSING",
      provider: "mock",
      model: "mock-model",
      request_id: null,
      error_category: null,
      usage_event_id: null,
      started_at: "2026-09-18T00:00:00.000Z",
      completed_at: null,
    };
    const failedAttempt = { ...processingAttempt, status: "FAILED", error_category: "provider_error", completed_at: "2026-09-18T00:00:02.000Z" };
    const payload = () => {
      reads += 1;
      const failed = reads > 1;
      return {
        status: "success",
        conversation: { id: "conv-polling", title: "Polling", subject: null, topic: null },
        messages: [
          {
            id: "request-polling",
            role: "user",
            content: "A deferred question",
            status: failed ? "FAILED" : "PROCESSING",
            created_at: "2026-09-18T00:00:00.000Z",
          },
        ],
        branches: [],
        attempts: [failed ? failedAttempt : processingAttempt],
        active_attempt: failed ? null : processingAttempt,
        processing_attempt: failed ? null : processingAttempt,
        feedback: [],
      };
    };
    await page.route("**/api/ai/conversations/conv-polling/messages", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload()) });
      }
      return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ status: "error", message: "Generation failed" }) });
    });
    await page.goto("/ai-teacher/conv-polling");
    await expect.poll(() => reads).toBeGreaterThan(0);
    await page.waitForTimeout(2_200);
    await expect(page.getByText("Generation failed", { exact: true })).toBeVisible();
    // A persisted failed request remains blocked from becoming a second
    // original send; the authoritative recovery action is the retry below.
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Retry generation" })).toBeVisible();
  });
});
