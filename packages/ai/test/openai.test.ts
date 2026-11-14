import { describe, expect, it, vi } from "vitest";
import { createOpenAiProvider, type AiModel } from "../src/index.js";

const model: AiModel = {
  id: "openai-gpt-4.1-mini",
  provider: "openai",
  providerModelId: "gpt-4.1-mini",
  displayName: "GPT-4.1 mini",
  tier: "economy",
  capabilities: ["chat", "structured-output"],
  inputPriceMicrousdPerMillionTokens: 0,
  outputPriceMicrousdPerMillionTokens: 0,
  deprecatesAt: null,
  fallbackModelIds: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("OpenAI provider", () => {
  it("uses Responses structured output without exposing the key in the body", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: '{"logs":[]}' }],
              },
            ],
            usage: { input_tokens: 12, output_tokens: 4 },
          }),
          { status: 200 },
        ),
    );
    const response = await createOpenAiProvider({
      apiKey: "test-key",
      fetch: fetcher as typeof fetch,
    }).complete(model, {
      messages: [{ role: "system", content: "instructions" }],
      jsonSchema: { type: "object", properties: { logs: { type: "array" } } },
    });

    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://api.openai.com/v1/responses"),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer test-key" }),
        body: expect.stringContaining('"json_schema"'),
      }),
    );
    expect(response).toMatchObject({
      structuredOutput: { logs: [] },
      inputTokens: 12,
      outputTokens: 4,
    });
  });

  it("rejects a missing key and non-HTTPS endpoint", () => {
    expect(() => createOpenAiProvider({ apiKey: " " })).toThrow(/key/);
    expect(() =>
      createOpenAiProvider({ apiKey: "key", endpoint: "http://localhost" }),
    ).toThrow(/https/);
  });
});
