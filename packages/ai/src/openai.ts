import type {
  AiProvider,
  CompletionResponse,
  ImageRequest,
  ImageResponse,
} from "./index.js";

export const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com";
export const DEFAULT_OPENAI_MODEL_ID = "openai-gpt-4.1-mini";

/** Uses the Responses API and its strict JSON Schema mode when a schema is requested. */
export function createOpenAiProvider(options: {
  apiKey: string;
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): AiProvider {
  const endpoint = parseEndpoint(options.endpoint ?? DEFAULT_OPENAI_ENDPOINT);
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new TypeError("OpenAI API key is required.");
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 120_000;
  return {
    id: "openai",
    async complete(model, request): Promise<CompletionResponse> {
      const response = await fetcher(new URL("/v1/responses", endpoint), {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: model.providerModelId,
          input: request.messages.map((message) => ({
            role: message.role === "system" ? "developer" : message.role,
            content: message.content,
          })),
          ...(request.jsonSchema
            ? {
                text: {
                  format: {
                    type: "json_schema",
                    name: "life_log_output",
                    strict: true,
                    schema: request.jsonSchema,
                  },
                },
              }
            : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(
          `OpenAI request failed (${response.status}): ${detail || response.statusText}`,
        );
      }
      const payload = (await response.json()) as {
        output_text?: unknown;
        output?: unknown;
        usage?: { input_tokens?: unknown; output_tokens?: unknown };
      };
      const text = outputText(payload);
      if (text === undefined)
        throw new Error("OpenAI returned no output text.");
      let structuredOutput: CompletionResponse["structuredOutput"];
      if (request.jsonSchema) {
        try {
          structuredOutput = JSON.parse(
            text,
          ) as CompletionResponse["structuredOutput"];
        } catch {
          throw new Error(
            "OpenAI returned malformed JSON for a structured-output request.",
          );
        }
      }
      return {
        text,
        ...(structuredOutput === undefined ? {} : { structuredOutput }),
        ...(typeof payload.usage?.input_tokens === "number"
          ? { inputTokens: payload.usage.input_tokens }
          : {}),
        ...(typeof payload.usage?.output_tokens === "number"
          ? { outputTokens: payload.usage.output_tokens }
          : {}),
      };
    },
    async generateImage(
      _model,
      _request: ImageRequest,
    ): Promise<ImageResponse> {
      throw new Error(
        "The configured OpenAI provider does not support image generation in this CLI.",
      );
    },
  };
}

/** The REST Responses API returns generated text in message output items. */
function outputText(payload: {
  output_text?: unknown;
  output?: unknown;
}): string | undefined {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return undefined;
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content)
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      )
        return content.text;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Invalid OpenAI endpoint: ${value}`);
  }
  if (url.protocol !== "https:")
    throw new TypeError("OpenAI endpoint must use https.");
  return url;
}
