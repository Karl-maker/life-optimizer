import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBroker } from "@edu-service/events";
import { createSpeechService, type SpeechSynthesizer } from "../src/index.js";
import { createElevenLabsSpeechAdapter } from "../src/elevenlabs.js";
import { createOpenAiTranscriber } from "../src/openai.js";

describe("speech adapters", () => {
  it("maps ElevenLabs controls and returns a requested byte payload", async () => {
    const mockFetch = vi.fn(
      async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(new Uint8Array([1, 2]), {
          headers: {
            "content-type": "audio/mpeg",
            "content-length": "2",
            "request-id": "r1",
          },
        }),
    );
    const adapter = createElevenLabsSpeechAdapter({
      configuration: { apiKey: "key" },
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await adapter.synthesize({
      text: "[whispers] hello",
      voiceId: "voice",
      modelId: "eleven_v4",
      delivery: "bytes",
      latencyOptimization: 2,
      voiceSettings: { speed: 1.1 },
      audioEffects: { backgroundNoiseId: "rain" },
    });
    expect(result.data).toEqual(new Uint8Array([1, 2]));
    expect(result.usage).toEqual({ inputCharacters: 16, outputAudioBytes: 2 });
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "optimize_streaming_latency=2",
    );
    expect(
      JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      model_id: "eleven_v4",
      voice_settings: { speed: 1.1 },
      audio_effects: { background_noise_id: "rain" },
    });
  });
  it("uses OpenAI multipart transcription without exposing the audio in telemetry", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: "hello", language: "en" }), {
          headers: { "x-request-id": "oa1" },
        }),
    );
    const result = await createOpenAiTranscriber({
      configuration: { apiKey: "key" },
      fetch: mockFetch as unknown as typeof fetch,
    }).transcribe({ audio: new Blob(["sound"]), modelId: "gpt-4o-transcribe" });
    expect(result).toMatchObject({
      text: "hello",
      languageCode: "en",
      providerRequestId: "oa1",
    });
  });
  it("publishes bounded ready events for future relays", async () => {
    const broker = new InMemoryEventBroker();
    await broker.apply({
      topics: [
        {
          topic: "speech",
          subscriptions: [
            {
              queue: "relay",
              policy: { maxDeliveries: 2, visibilityTimeoutMs: 1_000 },
            },
          ],
        },
      ],
    });
    const synthesizer: SpeechSynthesizer = {
      provider: "elevenlabs",
      synthesize: async () => ({
        data: new Uint8Array([1]),
        delivery: "bytes",
        contentType: "audio/mpeg",
        usage: {
          inputCharacters: 5,
          outputAudioBytes: 1,
          estimatedCostMicrousd: 2,
        },
      }),
    };
    await createSpeechService({
      synthesizers: [synthesizer],
      events: broker,
    }).synthesize("elevenlabs", {
      text: "hello",
      voiceId: "v",
      delivery: "bytes",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const events = await broker.receive("relay");
    expect(events.map((event) => event.event.type)).toEqual([
      "speech.synthesis.started",
      "speech.synthesis.ready",
    ]);
    expect(events[1]?.event.payload).toMatchObject({
      inputCharacters: 5,
      estimatedCostMicrousd: 2,
    });
  });
});
