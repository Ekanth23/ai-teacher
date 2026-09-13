import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { DeepSeekProvider } from "../../src/modules/ai/providers/deepseek.provider.js";
import type { LlmProvider } from "../../src/modules/ai/providers/llm.provider.js";
import { MockLlmProvider } from "../../src/modules/ai/providers/mock.provider.js";
import { OllamaProvider } from "../../src/modules/ai/providers/ollama.provider.js";
import {
  createLlmProvider,
  DEFAULT_AI_PROVIDER,
} from "../../src/modules/ai/providers/provider.factory.js";

const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER;

afterEach(() => {
  if (ORIGINAL_AI_PROVIDER === undefined) {
    delete process.env.AI_PROVIDER;
  } else {
    process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
  }
});

describe("createLlmProvider", () => {
  it("returns a MockLlmProvider when AI_PROVIDER=mock", () => {
    const provider = createLlmProvider("mock");
    expect(provider).toBeInstanceOf(MockLlmProvider);
  });

  it("returns a DeepSeekProvider when AI_PROVIDER=deepseek", () => {
    const provider = createLlmProvider("deepseek");
    expect(provider).toBeInstanceOf(DeepSeekProvider);
  });

  it("returns an OllamaProvider when AI_PROVIDER=ollama", () => {
    const provider = createLlmProvider("ollama");
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it("reads AI_PROVIDER from the environment", () => {
    process.env.AI_PROVIDER = "mock";
    const provider = createLlmProvider();
    expect(provider).toBeInstanceOf(MockLlmProvider);
  });

  it("throws a clear configuration error for an unsupported provider", () => {
    expect(() => createLlmProvider("gpt-5")).toThrow(
      'Unsupported AI_PROVIDER "gpt-5". Supported values: ollama, deepseek, mock.'
    );
  });

  it("does not fall back to another provider on an invalid value", () => {
    process.env.AI_PROVIDER = "unknown-provider";
    expect(() => createLlmProvider()).toThrow(/Unsupported AI_PROVIDER/);
  });

  it("returns the documented default provider when AI_PROVIDER is missing", () => {
    delete process.env.AI_PROVIDER;
    const provider = createLlmProvider();
    expect(DEFAULT_AI_PROVIDER).toBe("mock");
    expect(provider).toBeInstanceOf(MockLlmProvider);
  });

  it("treats empty AI_PROVIDER as missing (documented default)", () => {
    process.env.AI_PROVIDER = "  ";
    const provider = createLlmProvider();
    expect(provider).toBeInstanceOf(MockLlmProvider);
  });

  it("normalizes provider names to lowercase", () => {
    const provider = createLlmProvider("DEEPSEEK");
    expect(provider).toBeInstanceOf(DeepSeekProvider);
  });

  it("factory-created provider satisfies the LlmProvider contract", async () => {
    const provider: LlmProvider = createLlmProvider("mock");
    expect(typeof provider.generate).toBe("function");
    const output = await provider.generate("Explain gravity");
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });
});