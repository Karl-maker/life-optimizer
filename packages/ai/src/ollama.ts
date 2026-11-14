import type {
  AiProvider,
  CompletionResponse,
  ImageRequest,
  ImageResponse,
} from "./index.js";

export const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL_ID = "ollama-qwen-agent-32k";
/** A large local model can need several minutes for structured daily-note imports. */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 600_000;

export function createOllamaProvider(
  options: {
    endpoint?: string;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
  } = {},
): AiProvider {
  const endpoint = parseEndpoint(options.endpoint ?? DEFAULT_OLLAMA_ENDPOINT);
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
  return {
    id: "ollama",
    async complete(model, request): Promise<CompletionResponse> {
      const response = await fetcher(new URL("/api/chat", endpoint), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: model.providerModelId,
          messages: request.messages,
          stream: false,
          // Keep the 19 GB local model loaded between daily imports and queries.
          keep_alive: "30m",
          ...(request.jsonSchema ? { format: request.jsonSchema } : {}),
          options: {
            num_ctx: 32_768,
            temperature: request.jsonSchema ? 0 : 0.2,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(
          `Ollama request failed (${response.status}): ${detail || response.statusText}`,
        );
      }
      const payload = (await response.json()) as {
        message?: { content?: unknown };
        prompt_eval_count?: unknown;
        eval_count?: unknown;
      };
      if (typeof payload.message?.content !== "string")
        throw new Error("Ollama returned no assistant message.");
      const text = payload.message.content;
      let structuredOutput: CompletionResponse["structuredOutput"];
      if (request.jsonSchema) {
        try {
          structuredOutput = JSON.parse(
            text,
          ) as CompletionResponse["structuredOutput"];
        } catch {
          throw new Error(
            "Ollama returned malformed JSON for a structured-output request.",
          );
        }
      }
      return {
        text,
        ...(structuredOutput === undefined ? {} : { structuredOutput }),
        ...(typeof payload.prompt_eval_count === "number"
          ? { inputTokens: payload.prompt_eval_count }
          : {}),
        ...(typeof payload.eval_count === "number"
          ? { outputTokens: payload.eval_count }
          : {}),
      };
    },
    async generateImage(
      _model,
      _request: ImageRequest,
    ): Promise<ImageResponse> {
      throw new Error(
        "The configured Ollama provider does not support image generation.",
      );
    },
  };
}

function parseEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Invalid Ollama endpoint: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new TypeError("Ollama endpoint must use http or https.");
  return url;
}
