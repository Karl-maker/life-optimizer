# `@edu-service/speech`

This package is the infrastructure boundary for making audio and recognizing user speech. It deliberately has no learning rules, database access, or credentials in core. Compose providers at an API/worker boundary, validate configuration there, and pass a correlation ID from the request.

## Capabilities and delivery

`createElevenLabsSpeechAdapter` supplies text-to-speech, ElevenLabs speech-to-text, and sound effects. `createOpenAiTranscriber` supplies file transcription. `createAwsTranscribeStreamingAdapter` maps a caller-owned AWS Transcribe Streaming SDK client; use it for live PCM/FLAC/Opus frames, not S3 batch jobs. AWS Polly is synthesis rather than transcription and can implement `SpeechSynthesizer` in the composition package if selected later.

`delivery: "stream"` returns the provider `ReadableStream<Uint8Array>` immediately; relay it directly to HTTP, WebSocket, or an audio player without buffering. `"bytes"` returns a `Uint8Array`; `"blob"` returns a `Blob`, both only after the complete audio is read. Use streaming for interaction and bytes/blob for storage or post-processing. `speech.synthesis.ready` means the upstream response is ready (and complete when buffered), not that a client finished consuming a stream.

```ts
const eleven = createElevenLabsSpeechAdapter({
  configuration: readElevenLabsConfiguration(process.env),
});
const speech = createSpeechService({
  synthesizers: [eleven],
  transcribers: [eleven],
  soundEffectGenerators: [eleven],
  events,
  operationLog,
});

const audio = await speech.synthesize("elevenlabs", {
  text: "Welcome back. [warmly] Let's start with a quick recap.",
  voiceId: "your-library-voice-id",
  modelId: "eleven_flash_v2_5",
  delivery: "stream",
  outputFormat: "mp3_44100_128",
  voiceSettings: { stability: 0.55, similarityBoost: 0.75, speed: 1 },
  correlationId: requestId,
});
```

## Writing text for speech

Write for the ear, not the page:

1. Use short, self-contained sentences. Spell out ambiguous symbols and write a number as words when its meaning matters (for example, “twenty-four hours” rather than `24h`).
2. Place punctuation where a listener should pause. A paragraph break is a larger beat; avoid excessive ellipses and ALL CAPS.
3. Put one idea in each clause. For long lessons, split at natural sentence boundaries and provide `previousText`/`nextText` so ElevenLabs can preserve prosody between calls.
4. With `eleven_v4`, `eleven_v4_turbo`, or `eleven_v3`, use short inline tags precisely where the performance changes: `[quietly]`, `[laughs]`, `[sound of a school bell]`. Tags are model directions, not a guaranteed scripting language; test each voice/model combination.
5. Use `pronunciationDictionaries` for names, technical terms, or IPA-level pronunciation—not ad hoc phonetic spelling scattered across content. Set `languageCode` only when the chosen model supports/enforces it.
6. Use `audioEffects` for reverb, panning, background noise, and filter presets. Effects do not add ElevenLabs request cost, but stereo effects cannot be combined with mono PCM/µ-law/A-law output. For a standalone generated sound, use `generateSoundEffect`; do not bury a long effect request in narration.

Choose models by experience: `eleven_flash_v2_5` is the economical, low-latency interactive default; `eleven_multilingual_v2` favors steady long-form narration; `eleven_v4` favors expressive, high-quality material; and `eleven_v4_turbo` is the expressive real-time choice. Start streaming requests below roughly 1,000 characters for fast time-to-first-audio. Use `latencyOptimization` only after measuring: level 4 disables text normalization and can mispronounce numbers/dates. Keep the default `applyTextNormalization: "auto"` unless the script has already been normalized.

## Listening/transcription

Pass a `Blob` to `speech.transcribe`. OpenAI defaults to `gpt-4o-transcribe`; use `includeTimestamps` when the caller needs segments. ElevenLabs can return word timestamps. For ongoing microphone audio, send frames to the AWS Transcribe Streaming composition adapter and yield final—not partial—results to this package. Do not treat a transcript as authoritative identity, consent, assessment, or command validation; those are core/application decisions.

## Usage, cost, audit, and events

The package never emits script text, transcript text, raw audio, credentials, provider error bodies, or URLs. It emits `speech.synthesis.started`, `.ready`, `.failed`, `speech.transcription.completed`, and `.failed` as typed, at-least-once `speech` topic events. Ready/completed payloads contain only provider, selected voice/delivery, safe request measurements (input characters; input/output audio seconds; bytes; tokens), and `estimatedCostMicrousd` when a provider response or caller price book knows it. These are suitable for an SSE/WebSocket relay after authorization, and all carry the caller's correlation ID.

Telemetry mirrors the same bounded usage plus duration. It is diagnostic and best effort. A financial/entitlement audit requires a durable application-level usage record written in the same transaction as the balance/quota change—do that in the future core use case, using the exact `SpeechUsage` returned here. Do not bill from at-least-once events. ElevenLabs meters TTS by characters and STT by audio minutes; OpenAI and AWS pricing/model rates change, so calculate micro-USD from a versioned, deployment-owned price book rather than hard-coding prices here.

## Configuration

Copy [`.env.example`](./.env.example) into an ignored composition environment. `ELEVENLABS_API_KEY` is required only when the ElevenLabs adapter is enabled; `OPENAI_API_KEY` is required only for OpenAI transcription. `EDU_SPEECH_AWS_REGION` is required with AWS Transcribe; production should use an IAM role, while static AWS credentials are a local-development exception. The configuration readers reject blank values and partial AWS credentials. Never place these values in model catalogs, telemetry, audit changes, or events.

## Research basis

The design follows provider streaming semantics and avoids buffering audio by default: [ElevenLabs streaming](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming), [audio streaming architecture](https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming), [ElevenLabs TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/stream), [Amazon Polly streaming comparison](https://docs.aws.amazon.com/polly/latest/dg/bidirectional-streaming-choosing.html), and [OpenAI audio transcription API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions). Provider behavior and pricing change, so verify model availability and account limits before deployment.
