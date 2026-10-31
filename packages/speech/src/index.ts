import type { OperationLog } from "@edu-service/core";
import {
  createEvent,
  type EventDefinition,
  type EventPublisher,
  type EventType,
  type KnownEventEnvelope,
} from "@edu-service/events";

export type SpeechProviderId = "elevenlabs" | "openai" | "aws";
export type AudioDelivery = "stream" | "bytes" | "blob";
export type AudioData = ReadableStream<Uint8Array> | Uint8Array | Blob;

export interface AudioResult {
  data: AudioData;
  delivery: AudioDelivery;
  contentType: string;
  /** Provider request ID when one was returned; safe to use for support. */
  providerRequestId?: string;
  usage: SpeechUsage;
}
export interface SpeechUsage {
  inputCharacters?: number;
  outputAudioBytes?: number;
  inputAudioSeconds?: number;
  outputAudioSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Integer micro-USD when known or calculated by a caller's price book. */
  estimatedCostMicrousd?: number;
}
export interface VoiceSettings {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  speed?: number;
}
export interface AudioEffects {
  filterPresetId?: string;
  environmentId?: string;
  environmentSendLevel?: number;
  backgroundNoiseId?: string;
  backgroundNoiseVolume?: number;
  pan?: number;
}
export interface PronunciationDictionaryLocator {
  id: string;
  versionId: string;
}
/** Portable synthesis request. ElevenLabs fields intentionally retain its advanced API controls. */
export interface SynthesizeSpeechRequest {
  text: string;
  voiceId: string;
  modelId?: string;
  languageCode?: string;
  outputFormat?: string;
  delivery?: AudioDelivery;
  voiceSettings?: VoiceSettings;
  audioEffects?: AudioEffects;
  pronunciationDictionaries?: readonly PronunciationDictionaryLocator[];
  latencyOptimization?: 0 | 1 | 2 | 3 | 4;
  seed?: number;
  applyTextNormalization?: "auto" | "on" | "off";
  previousText?: string;
  nextText?: string;
  previousRequestIds?: readonly string[];
  nextRequestIds?: readonly string[];
  /** Enterprise-only ElevenLabs zero-retention mode. */
  enableLogging?: boolean;
  correlationId?: string;
}
export interface TranscribeRequest {
  audio: Blob;
  modelId?: string;
  languageCode?: string;
  prompt?: string;
  includeTimestamps?: boolean;
  correlationId?: string;
}
export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
  speaker?: string;
}
export interface TranscriptResult {
  text: string;
  languageCode?: string;
  segments?: readonly TranscriptSegment[];
  providerRequestId?: string;
  usage: SpeechUsage;
}
export interface SoundEffectRequest {
  prompt: string;
  durationSeconds?: number;
  promptInfluence?: number;
  outputFormat?: string;
  delivery?: AudioDelivery;
  correlationId?: string;
}
export interface SpeechSynthesizer {
  readonly provider: SpeechProviderId;
  synthesize(request: SynthesizeSpeechRequest): Promise<AudioResult>;
}
export interface SpeechTranscriber {
  readonly provider: SpeechProviderId;
  transcribe(request: TranscribeRequest): Promise<TranscriptResult>;
}
export interface SoundEffectGenerator {
  readonly provider: SpeechProviderId;
  generateSoundEffect(request: SoundEffectRequest): Promise<AudioResult>;
}

/**
 * Adds safe lifecycle events around provider adapters. `ready` means the response is
 * available (or fully buffered for bytes/blob), not that a streamed client consumed it.
 * Publish is best effort; charge/audit persistence belongs in the calling transaction.
 */
export function createSpeechService(options: {
  synthesizers?: readonly SpeechSynthesizer[];
  transcribers?: readonly SpeechTranscriber[];
  soundEffectGenerators?: readonly SoundEffectGenerator[];
  events?: EventPublisher;
  operationLog?: OperationLog;
  now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  const emit = <T extends EventType>(
    type: T,
    payload: EventDefinition<T>["payload"],
    correlationId?: string,
  ) => {
    if (!options.events) return;
    const event = createEvent({
      id: crypto.randomUUID(),
      type,
      occurredAt: now().toISOString(),
      payload,
      ...(correlationId === undefined ? {} : { correlationId }),
    }) as KnownEventEnvelope;
    void options.events.publish([event]).catch(() => undefined);
  };
  const one = <T extends { provider: SpeechProviderId }>(
    items: readonly T[] | undefined,
    provider: SpeechProviderId,
    kind: string,
  ): T => {
    const found = items?.find((item) => item.provider === provider);
    if (!found) throw new Error(`No ${kind} is configured for ${provider}.`);
    return found;
  };
  return {
    async synthesize(
      provider: SpeechProviderId,
      request: SynthesizeSpeechRequest,
    ) {
      const started = Date.now();
      emit("speech.synthesis.started", {
        provider,
        voiceId: request.voiceId,
        inputCharacters: request.text.length,
      });
      try {
        const result = await one(
          options.synthesizers,
          provider,
          "speech synthesizer",
        ).synthesize(request);
        const attributes = usageAttributes(
          result.usage,
          request.text.length,
          Date.now() - started,
        );
        options.operationLog?.info(
          "speech.synthesis.ready",
          {
            provider,
            voiceId: request.voiceId,
            delivery: result.delivery,
            ...attributes,
          },
          request.correlationId,
        );
        emit(
          "speech.synthesis.ready",
          {
            provider,
            voiceId: request.voiceId,
            delivery: result.delivery,
            ...eventUsage(result.usage, request.text.length),
          },
          request.correlationId,
        );
        return result;
      } catch (error) {
        options.operationLog?.error(
          "speech.synthesis.failed",
          { provider, durationMs: Date.now() - started },
          request.correlationId,
        );
        emit("speech.synthesis.failed", { provider, voiceId: request.voiceId });
        throw error;
      }
    },
    async transcribe(provider: SpeechProviderId, request: TranscribeRequest) {
      const started = Date.now();
      try {
        const result = await one(
          options.transcribers,
          provider,
          "speech transcriber",
        ).transcribe(request);
        const attributes = usageAttributes(
          result.usage,
          undefined,
          Date.now() - started,
        );
        options.operationLog?.info(
          "speech.transcription.completed",
          { provider, ...attributes },
          request.correlationId,
        );
        emit(
          "speech.transcription.completed",
          { provider, ...eventUsage(result.usage) },
          request.correlationId,
        );
        return result;
      } catch (error) {
        options.operationLog?.error(
          "speech.transcription.failed",
          { provider, durationMs: Date.now() - started },
          request.correlationId,
        );
        emit("speech.transcription.failed", { provider });
        throw error;
      }
    },
    async generateSoundEffect(
      provider: SpeechProviderId,
      request: SoundEffectRequest,
    ) {
      return one(
        options.soundEffectGenerators,
        provider,
        "sound-effect generator",
      ).generateSoundEffect(request);
    },
  };
}
function eventUsage(usage: SpeechUsage, fallbackCharacters?: number) {
  return {
    inputCharacters: usage.inputCharacters ?? fallbackCharacters ?? null,
    outputAudioBytes: usage.outputAudioBytes ?? null,
    inputAudioSeconds: usage.inputAudioSeconds ?? null,
    outputAudioSeconds: usage.outputAudioSeconds ?? null,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    estimatedCostMicrousd: usage.estimatedCostMicrousd ?? null,
  };
}
function usageAttributes(
  usage: SpeechUsage,
  fallbackCharacters: number | undefined,
  durationMs: number,
) {
  return { ...eventUsage(usage, fallbackCharacters), durationMs };
}
