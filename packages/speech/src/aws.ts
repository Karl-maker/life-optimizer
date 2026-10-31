import type {
  SpeechTranscriber,
  TranscriptResult,
  TranscribeRequest,
} from "./index.js";

export interface AwsSpeechConfiguration {
  region: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}
export function readAwsSpeechConfiguration(
  environment: NodeJS.ProcessEnv,
): AwsSpeechConfiguration {
  const region = environment.EDU_SPEECH_AWS_REGION?.trim();
  if (!region) throw new Error("EDU_SPEECH_AWS_REGION is required.");
  const accessKeyId = environment.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.AWS_SECRET_ACCESS_KEY?.trim();
  if ((accessKeyId === undefined) !== (secretAccessKey === undefined))
    throw new Error(
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together.",
    );
  return {
    region,
    ...(accessKeyId
      ? { credentials: { accessKeyId, secretAccessKey: secretAccessKey! } }
      : {}),
  };
}
/** Minimal structural boundary for @aws-sdk/client-transcribe-streaming, kept injectable for testability. */
export interface AwsTranscribeStreamingClient {
  start(input: {
    audio: Blob;
    languageCode?: string;
  }): AsyncIterable<{
    transcript?: {
      text: string;
      isPartial: boolean;
      startSeconds?: number;
      endSeconds?: number;
      languageCode?: string;
    };
    requestId?: string;
  }>;
}
/**
 * Concrete mapping for an AWS Transcribe Streaming client. Supply an adapter around
 * StartStreamTranscriptionCommand at composition time; it must send PCM/FLAC/Opus
 * frames and yield only final results here. This package never stores raw audio.
 */
export function createAwsTranscribeStreamingAdapter(options: {
  client: AwsTranscribeStreamingClient;
}): SpeechTranscriber {
  return {
    provider: "aws",
    async transcribe(input: TranscribeRequest): Promise<TranscriptResult> {
      const segments: Array<{
        text: string;
        startSeconds: number;
        endSeconds: number;
      }> = [];
      let requestId: string | undefined;
      let languageCode: string | undefined;
      for await (const event of options.client.start({
        audio: input.audio,
        ...(input.languageCode ? { languageCode: input.languageCode } : {}),
      })) {
        requestId ??= event.requestId;
        const transcript = event.transcript;
        if (!transcript || transcript.isPartial || !transcript.text.trim())
          continue;
        languageCode ??= transcript.languageCode;
        segments.push({
          text: transcript.text,
          startSeconds: transcript.startSeconds ?? 0,
          endSeconds: transcript.endSeconds ?? 0,
        });
      }
      return {
        text: segments.map((segment) => segment.text).join(" "),
        ...(languageCode ? { languageCode } : {}),
        segments,
        ...(requestId ? { providerRequestId: requestId } : {}),
        usage: {},
      };
    },
  };
}
