import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekProvider } from "../../src/modules/ai/providers/deepseek.provider.js";

const originalFetch = globalThis.fetch;
const ORIGINAL_API_KEY = process.env.DEEPSEEK_API_KEY;
const ORIGINAL_BASE_URL = process.env.DEEPSEEK_BASE_URL;
const ORIGINAL_MODEL = process.env.DEEPSEEK_MODEL;

function createJsonResponse(payload: unknown, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(payload), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

function createTextResponse(text: string, status = 200, statusText = "OK"): Response {
  return new Response(text, {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();

  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
  } else {
    process.env.DEEPSEEK_API_KEY = ORIGINAL_API_KEY;
  }

  if (ORIGINAL_BASE_URL === undefined) {
    delete process.env.DEEPSEEK_BASE_URL;
  } else {
    process.env.DEEPSEEK_BASE_URL = ORIGINAL_BASE_URL;
  }

  if (ORIGINAL_MODEL === undefined) {
    delete process.env.DEEPSEEK_MODEL;
  } else {
    process.env.DEEPSEEK_MODEL = ORIGINAL_MODEL;
  }
});

describe("DeepSeekProvider", () => {
  it("returns the assistant text on a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: "assistant", content: "Hello from DeepSeek" } }],
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new DeepSeekProvider({ apiKey: "test-key", baseUrl: "https://example.com", model: "deepseek-chat" });
    const result = await provider.generate("Explain gravity");

    expect(result).toBe("Hello from DeepSeek");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/chat/completions");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("deepseek-chat");
    expect(body.messages).toEqual([{ role: "user", content: "Explain gravity" }]);
  });

  it("throws a clear error when the API key is missing", async () => {
    delete process.env.DEEPSEEK_API_KEY;

    const provider = new DeepSeekProvider();
    await expect(provider.generate("Hello")).rejects.toThrow("DEEPSEEK_API_KEY is not configured.");
  });

  it("throws a clear error on a non-2xx HTTP response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized", headers: { "Content-Type": "text/plain" } })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new DeepSeekProvider({ apiKey: "bad-key", baseUrl: "https://example.com" });
    await expect(provider.generate("Hello")).rejects.toThrow(
      "DeepSeek request failed with status 401 Unauthorized: Unauthorized"
    );
  });

  it("throws a clear error on malformed JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createTextResponse("not-json"));
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new DeepSeekProvider({ apiKey: "test-key", baseUrl: "https://example.com" });
    await expect(provider.generate("Hello")).rejects.toThrow(
      "DeepSeek request failed: response body is not valid JSON."
    );
  });

  it("throws a clear error when the response is missing assistant content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({ choices: [{ message: { role: "assistant", content: "" } }] })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new DeepSeekProvider({ apiKey: "test-key", baseUrl: "https://example.com" });
    await expect(provider.generate("Hello")).rejects.toThrow(
      "DeepSeek request failed: response did not contain an assistant message."
    );
  });
});