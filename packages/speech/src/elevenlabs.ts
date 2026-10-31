import type {
  AudioResult,
  SoundEffectGenerator,
  SoundEffectRequest,
  SpeechSynthesizer,
  SpeechTranscriber,
  SynthesizeSpeechRequest,
  TranscriptResult,
} from "./index.js";

export interface ElevenLabsConfiguration {
  apiKey: string;
  baseUrl?: string;
}
export function readElevenLabsConfiguration(
  environment: NodeJS.ProcessEnv,
): ElevenLabsConfiguration {
  const apiKey = environment.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is required.");
  return { apiKey };
}
/** HTTP adapter deliberately uses fetch so application composition owns provider SDK versions and retries. */
export function createElevenLabsSpeechAdapter(options: {
  configuration: ElevenLabsConfiguration;
  fetch?: typeof globalThis.fetch;
}): SpeechSynthesizer & SpeechTranscriber & SoundEffectGenerator {
  const fetcher = options.fetch ?? globalThis.fetch;
  const baseUrl = options.configuration.baseUrl ?? "https://api.elevenlabs.io";
  const request = async (path: string, init: RequestInit) => {
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: { "xi-api-key": options.configuration.apiKey, ...init.headers },
    });
    if (!response.ok)
      throw new Error(`ElevenLabs returned HTTP ${response.status}.`);
    return response;
  };
  const audio = async (
    path: string,
    payload: Record<string, unknown>,
    delivery:
      | SynthesizeSpeechRequest["delivery"]
      | SoundEffectRequest["delivery"] = "stream",
  ): Promise<AudioResult> => {
    const response = await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const contentType = response.headers.get("content-type") ?? "audio/mpeg";
    const inputCharacters =
      typeof payload.text === "string" ? payload.text.length : undefined;
    const outputAudioBytes = numberHeader(response, "content-length");
    const usage = {
      ...(inputCharacters === undefined ? {} : { inputCharacters }),
      ...(outputAudioBytes === undefined ? {} : { outputAudioBytes }),
    };
    return {
      data: await deliver(response, delivery),
      delivery,
      contentType,
      ...(requestId(response) === undefined
        ? {}
        : { providerRequestId: requestId(response)! }),
      usage,
    };
  };
  return {
    provider: "elevenlabs",
    async synthesize(input) {
      if (!input.text.trim() || !input.voiceId.trim())
        throw new TypeError("Speech text and voiceId are required.");
      const query = new URLSearchParams();
      if (input.outputFormat) query.set("output_format", input.outputFormat);
      if (input.latencyOptimization !== undefined)
        query.set(
          "optimize_streaming_latency",
          String(input.latencyOptimization),
        );
      if (input.enableLogging !== undefined)
        query.set("enable_logging", String(input.enableLogging));
      const path = `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/stream${query.size ? `?${query}` : ""}`;
      return audio(
        path,
        {
          text: input.text,
          model_id: input.modelId,
          language_code: input.languageCode,
          voice_settings: input.voiceSettings && {
            stability: input.voiceSettings.stability,
            similarity_boost: input.voiceSettings.similarityBoost,
            style: input.voiceSettings.style,
            use_speaker_boost: input.voiceSettings.useSpeakerBoost,
            speed: input.voiceSettings.speed,
          },
          audio_effects: input.audioEffects && {
            filter_preset_id: input.audioEffects.filterPresetId,
            environment_id: input.audioEffects.environmentId,
            environment_send_level: input.audioEffects.environmentSendLevel,
            background_noise_id: input.audioEffects.backgroundNoiseId,
            background_noise_volume: input.audioEffects.backgroundNoiseVolume,
            pan: input.audioEffects.pan,
          },
          pronunciation_dictionary_locators:
            input.pronunciationDictionaries?.map((item) => ({
              pronunciation_dictionary_id: item.id,
              version_id: item.versionId,
            })),
          seed: input.seed,
          apply_text_normalization: input.applyTextNormalization,
          previous_text: input.previousText,
          next_text: input.nextText,
          previous_request_ids: input.previousRequestIds,
          next_request_ids: input.nextRequestIds,
        },
        input.delivery,
      );
    },
    async generateSoundEffect(input) {
      if (!input.prompt.trim())
        throw new TypeError("Sound-effect prompt is required.");
      return audio(
        `/v1/sound-generation${input.outputFormat ? `?output_format=${encodeURIComponent(input.outputFormat)}` : ""}`,
        {
          text: input.prompt,
          duration_seconds: input.durationSeconds,
          prompt_influence: input.promptInfluence,
        },
        input.delivery,
      );
    },
    async transcribe(input): Promise<TranscriptResult> {
      const form = new FormData();
      form.set("file", input.audio, "audio");
      if (input.modelId) form.set("model_id", input.modelId);
      if (input.languageCode) form.set("language_code", input.languageCode);
      if (input.includeTimestamps) form.set("timestamps_granularity", "word");
      const response = await request("/v1/speech-to-text", {
        method: "POST",
        body: form,
      });
      const value = (await response.json()) as {
        text?: string;
        language_code?: string;
        words?: Array<{
          text: string;
          start: number;
          end: number;
          speaker_id?: string;
        }>;
      };
      if (typeof value.text !== "string")
        throw new Error("ElevenLabs did not return a transcript.");
      return {
        text: value.text,
        ...(value.language_code ? { languageCode: value.language_code } : {}),
        ...(value.words
          ? {
              segments: value.words.map((word) => ({
                text: word.text,
                startSeconds: word.start,
                endSeconds: word.end,
                ...(word.speaker_id ? { speaker: word.speaker_id } : {}),
              })),
            }
          : {}),
        ...(requestId(response)
          ? { providerRequestId: requestId(response)! }
          : {}),
        usage: {},
      };
    },
  };
}
async function deliver(
  response: Response,
  delivery: "stream" | "bytes" | "blob",
) {
  if (delivery === "stream") {
    if (!response.body) throw new Error("Provider returned no audio stream.");
    return response.body;
  }
  if (delivery === "blob") return response.blob();
  return new Uint8Array(await response.arrayBuffer());
}
function requestId(response: Response) {
  return (
    response.headers.get("request-id") ??
    response.headers.get("x-request-id") ??
    undefined
  );
}
function numberHeader(response: Response, name: string) {
  const value = response.headers.get(name);
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}
