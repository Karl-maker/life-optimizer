import { describe, expect, it, vi } from "vitest";
import { createOllamaProvider, type AiModel } from "../src/index.js";

const model: AiModel = {
  id: "ollama-qwen-agent-32k",
  provider: "ollama",
  providerModelId: "qwen-agent:32k",
  displayName: "Qwen",
  tier: "balanced",
  capabilities: ["chat", "structured-output"],
  inputPriceMicrousdPerMillionTokens: 0,
  outputPriceMicrousdPerMillionTokens: 0,
  deprecatesAt: null,
  fallbackModelIds: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Ollama provider", () => {
  it("calls the local chat endpoint and parses schema-constrained JSON", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: { content: '{"logs":[]}' },
            prompt_eval_count: 12,
            eval_count: 4,
          }),
          { status: 200 },
        ),
    );
    const response = await createOllamaProvider({
      fetch: fetcher as typeof fetch,
    }).complete(model, {
      messages: [{ role: "user", content: "text" }],
      jsonSchema: {
        type: "object",
        required: ["logs"],
        properties: { logs: { type: "array" } },
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("http://localhost:11434/api/chat"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"keep_alive":"30m"'),
      }),
    );
    expect(response).toMatchObject({
      structuredOutput: { logs: [] },
      inputTokens: 12,
      outputTokens: 4,
    });
  });
  it("rejects malformed structured output and unsafe endpoint protocols", async () => {
    expect(() =>
      createOllamaProvider({ endpoint: "file:///tmp/ollama" }),
    ).toThrow(/http/);
    const fetcher = async () =>
      new Response(JSON.stringify({ message: { content: "no" } }), {
        status: 200,
      });
    await expect(
      createOllamaProvider({ fetch: fetcher as typeof fetch }).complete(model, {
        messages: [],
        jsonSchema: { type: "object" },
      }),
    ).rejects.toThrow(/malformed JSON/);
  });
});
