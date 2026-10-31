import type {
  SpeechTranscriber,
  TranscriptResult,
  TranscribeRequest,
} from "./index.js";

export interface OpenAiSpeechConfiguration {
  apiKey: string;
  baseUrl?: string;
}
export function readOpenAiSpeechConfiguration(
  environment: NodeJS.ProcessEnv,
): OpenAiSpeechConfiguration {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required.");
  return { apiKey };
}
/** OpenAI's multipart transcription endpoint supports gpt-4o-transcribe and whisper-1. */
export function createOpenAiTranscriber(options: {
  configuration: OpenAiSpeechConfiguration;
  fetch?: typeof globalThis.fetch;
}): SpeechTranscriber {
  const fetcher = options.fetch ?? globalThis.fetch;
  const baseUrl = options.configuration.baseUrl ?? "https://api.openai.com/v1";
  return {
    provider: "openai",
    async transcribe(input: TranscribeRequest): Promise<TranscriptResult> {
      const form = new FormData();
      form.set("file", input.audio, "audio");
      form.set("model", input.modelId ?? "gpt-4o-transcribe");
      if (input.languageCode) form.set("language", input.languageCode);
      if (input.prompt) form.set("prompt", input.prompt);
      if (input.includeTimestamps) form.set("response_format", "verbose_json");
      const response = await fetcher(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.configuration.apiKey}` },
        body: form,
      });
      if (!response.ok)
        throw new Error(`OpenAI returned HTTP ${response.status}.`);
      const value = (await response.json()) as {
        text?: string;
        language?: string;
        segments?: Array<{ text: string; start: number; end: number }>;
      };
      if (typeof value.text !== "string")
        throw new Error("OpenAI did not return a transcript.");
      const requestId = response.headers.get("x-request-id") ?? undefined;
      return {
        text: value.text,
        ...(value.language ? { languageCode: value.language } : {}),
        ...(value.segments
          ? {
              segments: value.segments.map((segment) => ({
                text: segment.text,
                startSeconds: segment.start,
                endSeconds: segment.end,
              })),
            }
          : {}),
        ...(requestId ? { providerRequestId: requestId } : {}),
        usage: {},
      };
    },
  };
}
