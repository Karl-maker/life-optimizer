import type {
  AiAgentResponse,
  AiProvider,
  AiSource,
  AiToolCall,
  CompletionResponse,
  ImageRequest,
  ImageResponse,
} from "./index.js";
import { AiToolExecutionError } from "./index.js";

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
    async runAgent(model, request): Promise<AiAgentResponse> {
      const maxSteps = request.maxSteps ?? 8;
      if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12)
        throw new TypeError("Agent maxSteps must be an integer from 1 to 12.");
      const maxToolRetries = request.maxToolRetries ?? 3;
      if (
        !Number.isInteger(maxToolRetries) ||
        maxToolRetries < 0 ||
        maxToolRetries > 5
      )
        throw new TypeError(
          "Agent maxToolRetries must be an integer from 0 to 5.",
        );
      const input: unknown[] = request.messages.map((message) => ({
        role: message.role === "system" ? "developer" : message.role,
        content: message.content,
      }));
      const allCalls: AiToolCall[] = [];
      const allSources: AiSource[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let webSearchCalls = 0;
      const failures = new Map<string, number>();
      for (let step = 0; step < maxSteps; step++) {
        const result = await fetchAgentResponse({
          fetcher,
          endpoint,
          apiKey,
          timeoutMs,
          body: {
            model: model.providerModelId,
            input,
            tools: request.tools,
            parallel_tool_calls: false,
            include: ["web_search_call.action.sources"],
            store: false,
            stream: request.onTextDelta !== undefined,
          },
          onTextDelta: request.onTextDelta,
        });
        inputTokens += numberOrZero(result.usage?.input_tokens);
        outputTokens += numberOrZero(result.usage?.output_tokens);
        const output = Array.isArray(result.output) ? result.output : [];
        webSearchCalls += output.filter(
          (item) => isRecord(item) && item.type === "web_search_call",
        ).length;
        const calls = functionCalls(output);
        allCalls.push(...calls);
        allSources.push(...responseSources(output));
        if (calls.length === 0) {
          const text = outputText(result);
          if (text === undefined)
            throw new Error("OpenAI returned no agent output text.");
          return {
            text,
            toolCalls: allCalls,
            sources: uniqueSources(allSources),
            inputTokens,
            outputTokens,
            webSearchCalls,
          };
        }
        input.push(...output);
        for (const call of calls) {
          let toolOutput: string;
          try {
            toolOutput = await request.executeTool(call);
          } catch (error) {
            const attempt = (failures.get(call.name) ?? 0) + 1;
            failures.set(call.name, attempt);
            const retryable =
              (!(error instanceof AiToolExecutionError) || error.retryable) &&
              attempt <= maxToolRetries;
            toolOutput = JSON.stringify({
              ok: false,
              error: safeToolError(error),
              attempt,
              maxRetries: maxToolRetries,
              retryable,
              instruction: retryable
                ? "Correct the tool arguments using this validation error, then call the tool again."
                : error instanceof AiToolExecutionError && !error.retryable
                  ? "Do not retry this action. Respect the denial or safety boundary and explain it to the user."
                  : "Do not call this tool again in this turn; explain the remaining problem to the user.",
            });
          }
          input.push({
            type: "function_call_output",
            call_id: call.callId,
            output: toolOutput,
          });
        }
      }
      throw new Error(`AI agent exceeded its ${maxSteps}-step tool limit.`);
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

function safeToolError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function fetchAgentResponse(input: {
  fetcher: typeof globalThis.fetch;
  endpoint: URL;
  apiKey: string;
  timeoutMs: number;
  body: Record<string, unknown>;
  onTextDelta?: ((delta: string) => void) | undefined;
}): Promise<OpenAiResponse> {
  const response = await input.fetcher(
    new URL("/v1/responses", input.endpoint),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(input.timeoutMs),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `OpenAI request failed (${response.status}): ${detail || response.statusText}`,
    );
  }
  if (!input.onTextDelta) return (await response.json()) as OpenAiResponse;
  if (!response.body) throw new Error("OpenAI returned no response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: OpenAiResponse | undefined;
  const consume = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    if (
      event["type"] === "response.output_text.delta" &&
      typeof event["delta"] === "string"
    )
      input.onTextDelta?.(event["delta"]);
    if (event["type"] === "response.completed" && isRecord(event["response"]))
      completed = event["response"] as OpenAiResponse;
    if (event["type"] === "error")
      throw new Error("OpenAI agent stream failed.");
  };
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consume(block);
    if (chunk.done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!completed)
    throw new Error("OpenAI agent stream ended before completion.");
  return completed;
}

interface OpenAiResponse {
  output_text?: unknown;
  output?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

function functionCalls(output: readonly unknown[]): AiToolCall[] {
  return output.flatMap((item) =>
    isRecord(item) &&
    item.type === "function_call" &&
    typeof item.call_id === "string" &&
    typeof item.name === "string" &&
    typeof item.arguments === "string"
      ? [
          {
            callId: item.call_id,
            name: item.name,
            arguments: item.arguments,
          },
        ]
      : [],
  );
}

function responseSources(output: readonly unknown[]): AiSource[] {
  const sources: AiSource[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (Array.isArray(item.content))
      for (const content of item.content) {
        if (!isRecord(content) || !Array.isArray(content.annotations)) continue;
        for (const annotation of content.annotations)
          if (
            isRecord(annotation) &&
            annotation.type === "url_citation" &&
            typeof annotation.url === "string"
          )
            sources.push({
              type: "web",
              title:
                typeof annotation.title === "string"
                  ? annotation.title
                  : annotation.url,
              url: annotation.url,
            });
      }
    if (isRecord(item.action) && Array.isArray(item.action.sources))
      for (const source of item.action.sources)
        if (isRecord(source) && typeof source.url === "string")
          sources.push({
            type: "web",
            title: typeof source.title === "string" ? source.title : source.url,
            url: source.url,
          });
  }
  return sources;
}

function uniqueSources(sources: readonly AiSource[]): AiSource[] {
  return [...new Map(sources.map((source) => [source.url, source])).values()];
}

const numberOrZero = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

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
