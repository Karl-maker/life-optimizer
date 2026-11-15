import { describe, expect, it, vi } from "vitest";
import {
  AiToolExecutionError,
  createOpenAiProvider,
  type AiModel,
} from "../src/index.js";

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

  it("loops over function calls and records web sources and token usage", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                call_id: "call-1",
                name: "search_life_logs",
                arguments: '{"query":"sleep"}',
              },
            ],
            usage: { input_tokens: 10, output_tokens: 3 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "You slept well.",
                    annotations: [
                      {
                        type: "url_citation",
                        title: "Sleep source",
                        url: "https://example.com/sleep",
                      },
                    ],
                  },
                ],
              },
            ],
            usage: { input_tokens: 14, output_tokens: 5 },
          }),
          { status: 200 },
        ),
      );
    const executeTool = vi.fn(async () => '[{"id":"log-1"}]');

    const response = await createOpenAiProvider({
      apiKey: "test-key",
      fetch: fetcher as typeof fetch,
    }).runAgent!(model, {
      messages: [{ role: "user", content: "How did I sleep?" }],
      tools: [
        {
          type: "function",
          name: "search_life_logs",
          description: "Search logs",
          strict: true,
          parameters: { type: "object", additionalProperties: false },
        },
      ],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ callId: "call-1", name: "search_life_logs" }),
    );
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call-1",
        }),
      ]),
    );
    expect(response).toMatchObject({
      text: "You slept well.",
      inputTokens: 24,
      outputTokens: 8,
      webSearchCalls: 0,
      sources: [
        {
          title: "Sleep source",
          url: "https://example.com/sleep",
        },
      ],
    });
  });

  it("returns tool validation errors to the model so it can correct and retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                call_id: "bad-date",
                name: "search_life_logs",
                arguments: '{"from":"2024-04-26T00:00:00"}',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                call_id: "fixed-date",
                name: "search_life_logs",
                arguments: '{"from":"26-04-2024"}',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "I found the day." }],
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const executeTool = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Use DD-MM-YYYY HH:mm[:ss] or ISO 8601 with an offset; received "2024-04-26T00:00:00".',
        ),
      )
      .mockResolvedValueOnce("[]");

    const response = await createOpenAiProvider({
      apiKey: "test-key",
      fetch: fetcher as typeof fetch,
    }).runAgent!(model, {
      messages: [{ role: "user", content: "What was my day like?" }],
      tools: [],
      maxToolRetries: 3,
      executeTool,
    });

    const retryInput = JSON.parse(fetcher.mock.calls[1]![1]!.body as string)
      .input as Array<{ type?: string; output?: string }>;
    const failure = retryInput.find(
      (item) => item.type === "function_call_output",
    );
    expect(JSON.parse(failure!.output!)).toMatchObject({
      ok: false,
      attempt: 1,
      retryable: true,
      error: expect.stringContaining("DD-MM-YYYY"),
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(response.text).toBe("I found the day.");
  });

  it("tells the model not to retry a human denial", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                call_id: "command-1",
                name: "run_command",
                arguments: '{"program":"ls"}',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "The action was denied, so I did not run it.",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      );

    await createOpenAiProvider({
      apiKey: "test-key",
      fetch: fetcher as typeof fetch,
    }).runAgent!(model, {
      messages: [{ role: "user", content: "Run a command" }],
      tools: [],
      executeTool: async () => {
        throw new AiToolExecutionError("Denied by the human.", {
          retryable: false,
        });
      },
    });

    const nextInput = JSON.parse(fetcher.mock.calls[1]![1]!.body as string)
      .input as Array<{ type?: string; output?: string }>;
    const failure = nextInput.find(
      (item) => item.type === "function_call_output",
    );
    expect(JSON.parse(failure!.output!)).toMatchObject({
      ok: false,
      retryable: false,
      instruction: expect.stringContaining("Do not retry"),
    });
  });

  it("streams text deltas and accepts a final SSE event without a blank line", async () => {
    const completed = {
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Hello" }],
        },
      ],
      usage: { input_tokens: 2, output_tokens: 1 },
    };
    const stream = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hel" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "lo" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.completed", response: completed })}`,
    ].join("");
    const onTextDelta = vi.fn();
    const provider = createOpenAiProvider({
      apiKey: "test-key",
      fetch: vi.fn(async () => new Response(stream)) as typeof fetch,
    });

    await expect(
      provider.runAgent!(model, {
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
        onTextDelta,
        executeTool: vi.fn(),
      }),
    ).resolves.toMatchObject({
      text: "Hello",
      inputTokens: 2,
      outputTokens: 1,
    });
    expect(onTextDelta.mock.calls.flat()).toEqual(["Hel", "lo"]);
  });
});
