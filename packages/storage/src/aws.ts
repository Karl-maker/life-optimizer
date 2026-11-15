import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type StorageClass as AwsStorageClass,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AUDIT_ACTION } from "@life-optimizer/core";
import {
  createEvent,
  type EventDefinition,
  type EventPublisher,
  type EventType,
  type KnownEventEnvelope,
} from "@life-optimizer/events";
import type {
  ObjectLocation,
  ObjectStore,
  PresignedUpload,
  ServerUpload,
  StorageAudit,
  StorageAuditWriter,
  StorageKey,
  StorageObject,
  StorageTier,
  UploadBody,
} from "./index.js";

const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_PRESIGN_SECONDS = 15 * 60;
const MIN_PART_SIZE = 5 * 1024 * 1024;
const AWS_STORAGE_CLASS_BY_TIER = {
  hot: "STANDARD",
  automatic: "INTELLIGENT_TIERING",
  cool: "STANDARD_IA",
  "single-zone-cool": "ONEZONE_IA",
  "instant-archive": "GLACIER_IR",
  archive: "GLACIER",
  "deep-archive": "DEEP_ARCHIVE",
} as const satisfies Record<StorageTier, AwsStorageClass>;

export interface AwsStorageConfiguration {
  region: string;
  bucket: string;
  endpoint?: string;
  cdnBaseUrl?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** Validates AWS configuration at the adapter boundary without exposing credentials to core. */
export function readAwsStorageConfiguration(
  environment: NodeJS.ProcessEnv,
): AwsStorageConfiguration {
  const region = required(environment, "EDU_STORAGE_AWS_REGION");
  const bucket = required(environment, "EDU_STORAGE_S3_BUCKET");
  const endpoint = optionalHttpUrl(
    environment.EDU_STORAGE_AWS_ENDPOINT,
    "EDU_STORAGE_AWS_ENDPOINT",
  );
  const cdnBaseUrl = optionalHttpUrl(
    environment.EDU_STORAGE_CDN_BASE_URL,
    "EDU_STORAGE_CDN_BASE_URL",
  );
  const accessKeyId = environment.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.AWS_SECRET_ACCESS_KEY?.trim();
  if ((accessKeyId === undefined) !== (secretAccessKey === undefined))
    throw new Error(
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together.",
    );
  return {
    region,
    bucket,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(cdnBaseUrl === undefined ? {} : { cdnBaseUrl }),
    ...(accessKeyId === undefined
      ? {}
      : { credentials: { accessKeyId, secretAccessKey: secretAccessKey! } }),
  };
}

export interface S3ObjectStoreOptions {
  configuration: AwsStorageConfiguration;
  /** Supply a client in tests or when composition owns retry/middleware setup. */
  client?: S3Client;
  /** Status notifications are best effort and intentionally contain no object body. */
  events?: EventPublisher;
  audit?: StorageAuditWriter;
  now?: () => Date;
  multipart?: {
    thresholdBytes?: number;
    partSizeBytes?: number;
    queueSize?: number;
  };
}

/**
 * AWS S3 object store. Browser uploads use short-lived, object-scoped PUT URLs;
 * server uploads use AWS's multipart helper for buffers, blobs, and streams.
 */
export function createS3ObjectStore(
  options: S3ObjectStoreOptions,
): ObjectStore {
  const now = options.now ?? (() => new Date());
  const client =
    options.client ??
    new S3Client({
      region: options.configuration.region,
      ...(options.configuration.endpoint === undefined
        ? {}
        : { endpoint: options.configuration.endpoint }),
      ...(options.configuration.credentials === undefined
        ? {}
        : { credentials: options.configuration.credentials }),
    });
  const threshold = options.multipart?.thresholdBytes ?? MIN_PART_SIZE;
  const partSize = options.multipart?.partSizeBytes ?? MIN_PART_SIZE;
  if (!Number.isInteger(threshold) || threshold < 0)
    throw new Error("multipart.thresholdBytes must be a non-negative integer.");
  if (!Number.isInteger(partSize) || partSize < MIN_PART_SIZE)
    throw new Error(
      `multipart.partSizeBytes must be at least ${MIN_PART_SIZE}.`,
    );

  const location = (key: StorageKey): ObjectLocation =>
    objectLocation(options.configuration, key);
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
  const record = async (
    action: keyof typeof AUDIT_ACTION,
    key: string,
    audit: StorageAudit | undefined,
    changes: Record<string, string | number | boolean | null>,
  ) => {
    if (!audit || !options.audit) return;
    await options.audit.audit.append({
      occurredAt: (options.audit.clock ?? now)(),
      companyId: audit.companyId ?? null,
      actor: audit.actor,
      action: AUDIT_ACTION[action],
      outcome: "succeeded",
      resource: { type: "storage-object", id: key },
      context: audit.context,
      changes,
    });
  };
  const head = async (key: StorageKey): Promise<StorageObject | undefined> => {
    const safeKey = validateKey(key);
    try {
      const object = await client.send(
        new HeadObjectCommand({
          Bucket: options.configuration.bucket,
          Key: safeKey,
        }),
      );
      return {
        key: safeKey,
        ...(object.ContentType === undefined
          ? {}
          : { contentType: object.ContentType }),
        ...(object.ContentLength === undefined
          ? {}
          : { contentLength: object.ContentLength }),
        ...(object.ETag === undefined ? {} : { eTag: object.ETag }),
        ...(object.LastModified === undefined
          ? {}
          : { lastModified: object.LastModified }),
        ...(toStorageTier(object.StorageClass) === undefined
          ? {}
          : { storageTier: toStorageTier(object.StorageClass)! }),
        metadata: object.Metadata ?? {},
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  };
  return {
    cdnBaseUrl() {
      return options.configuration.cdnBaseUrl;
    },
    location(key) {
      return location(validateKey(key));
    },
    async createUploadUrl(input): Promise<PresignedUpload> {
      const key = validateKey(input.key);
      const expiresIn = input.expiresInSeconds ?? DEFAULT_PRESIGN_SECONDS;
      validateExpiry(expiresIn);
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: options.configuration.bucket,
          Key: key,
          ...(input.contentType === undefined
            ? {}
            : { ContentType: input.contentType }),
          ...(input.contentLength === undefined
            ? {}
            : { ContentLength: input.contentLength }),
          ...(input.metadata === undefined ? {} : { Metadata: input.metadata }),
        }),
        { expiresIn },
      );
      const result = {
        ...location(key),
        uploadUrl,
        expiresAt: new Date(now().getTime() + expiresIn * 1_000),
      };
      await record("storageUploadRequested", key, input.audit, {
        contentType: input.contentType ?? null,
        contentLength: input.contentLength ?? null,
      });
      emit(
        "storage.upload.requested",
        {
          key,
          contentType: input.contentType ?? null,
          contentLength: input.contentLength ?? null,
        },
        input.audit?.context.correlationId,
      );
      return result;
    },
    async confirmUpload(input): Promise<StorageObject> {
      const object = await head(input.key);
      if (!object)
        throw new Error(`Storage object ${input.key} does not exist.`);
      await record("storageObjectUploaded", object.key, input.audit, {
        contentType: object.contentType ?? null,
        contentLength: object.contentLength ?? null,
      });
      emit(
        "storage.object.uploaded",
        {
          key: object.key,
          contentType: object.contentType ?? null,
          contentLength: object.contentLength ?? null,
        },
        input.audit?.context.correlationId,
      );
      return object;
    },
    async upload(input): Promise<ServerUpload> {
      const key = validateKey(input.key);
      let lastProgressBucket = -1;
      const reportProgress = (loaded: number, total: number | undefined) => {
        if (total === undefined || total < 1) return;
        // Progress callbacks can be very frequent. At most 21 events per upload
        // is enough for an eventual SSE relay without flooding its broker.
        const bucket = Math.min(20, Math.floor((loaded / total) * 20));
        if (bucket <= lastProgressBucket) return;
        lastProgressBucket = bucket;
        emit(
          "storage.upload.progressed",
          { key, loaded, total },
          input.audit?.context.correlationId,
        );
      };
      emit(
        "storage.upload.requested",
        {
          key,
          contentType: input.contentType ?? null,
          contentLength: input.contentLength ?? null,
        },
        input.audit?.context.correlationId,
      );
      try {
        let eTag: string | undefined;
        if (
          input.contentLength !== undefined &&
          input.contentLength < threshold
        ) {
          const result = await client.send(
            new PutObjectCommand({
              Bucket: options.configuration.bucket,
              Key: key,
              Body: input.body,
              ...(input.contentType === undefined
                ? {}
                : { ContentType: input.contentType }),
              ...(input.contentLength === undefined
                ? {}
                : { ContentLength: input.contentLength }),
              ...(input.metadata === undefined
                ? {}
                : { Metadata: input.metadata }),
              ...(input.storageTier === undefined
                ? {}
                : {
                    StorageClass: AWS_STORAGE_CLASS_BY_TIER[input.storageTier],
                  }),
            }),
          );
          eTag = result.ETag;
        } else {
          const upload = new Upload({
            client,
            params: {
              Bucket: options.configuration.bucket,
              Key: key,
              Body: input.body,
              ...(input.contentType === undefined
                ? {}
                : { ContentType: input.contentType }),
              ...(input.metadata === undefined
                ? {}
                : { Metadata: input.metadata }),
              ...(input.storageTier === undefined
                ? {}
                : {
                    StorageClass: AWS_STORAGE_CLASS_BY_TIER[input.storageTier],
                  }),
            },
            partSize,
            queueSize: options.multipart?.queueSize ?? 4,
            leavePartsOnError: false,
          });
          upload.on("httpUploadProgress", (progress) =>
            reportProgress(progress.loaded ?? 0, progress.total),
          );
          const result = await upload.done();
          eTag = result.ETag;
        }
        await record("storageObjectUploaded", key, input.audit, {
          contentType: input.contentType ?? null,
          contentLength: input.contentLength ?? null,
        });
        emit(
          "storage.object.uploaded",
          {
            key,
            contentType: input.contentType ?? null,
            contentLength: input.contentLength ?? null,
          },
          input.audit?.context.correlationId,
        );
        return { ...location(key), ...(eTag === undefined ? {} : { eTag }) };
      } catch (error) {
        emit(
          "storage.upload.failed",
          { key, operation: "server" },
          input.audit?.context.correlationId,
        );
        throw error;
      }
    },
    head,
    async exists(key) {
      return (await head(key)) !== undefined;
    },
    async delete(input) {
      const key = validateKey(input.key);
      await client.send(
        new DeleteObjectCommand({
          Bucket: options.configuration.bucket,
          Key: key,
        }),
      );
      await record("storageObjectDeleted", key, input.audit, {});
      emit(
        "storage.object.deleted",
        { key },
        input.audit?.context.correlationId,
      );
    },
    async setStorageTier(input) {
      const key = validateKey(input.key);
      await client.send(
        new CopyObjectCommand({
          Bucket: options.configuration.bucket,
          Key: key,
          CopySource: `${encodeURIComponent(options.configuration.bucket)}/${encodeKeyForCopy(key)}`,
          MetadataDirective: "COPY",
          StorageClass: AWS_STORAGE_CLASS_BY_TIER[input.storageTier],
        }),
      );
      await record("storageObjectTierChanged", key, input.audit, {
        storageTier: input.storageTier,
      });
      emit(
        "storage.object.tier.changed",
        { key, storageTier: input.storageTier },
        input.audit?.context.correlationId,
      );
    },
    async updateMetadata(input) {
      const key = validateKey(input.key);
      const existing = await head(key);
      if (!existing) throw new Error(`Storage object ${key} does not exist.`);
      await client.send(
        new CopyObjectCommand({
          Bucket: options.configuration.bucket,
          Key: key,
          CopySource: `${encodeURIComponent(options.configuration.bucket)}/${encodeKeyForCopy(key)}`,
          MetadataDirective: "REPLACE",
          Metadata: input.metadata,
          ContentType: input.contentType ?? existing.contentType,
        }),
      );
      await record("storageObjectUploaded", key, input.audit, {
        contentType: input.contentType ?? existing.contentType ?? null,
        contentLength: existing.contentLength ?? null,
      });
      emit(
        "storage.object.uploaded",
        {
          key,
          contentType: input.contentType ?? existing.contentType ?? null,
          contentLength: existing.contentLength ?? null,
        },
        input.audit?.context.correlationId,
      );
    },
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the AWS S3 adapter.`);
  return value;
}
function optionalHttpUrl(
  value: string | undefined,
  name: string,
): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${name} must be an HTTP(S) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(`${name} must be an HTTP(S) URL.`);
  return parsed.toString().replace(/\/$/, "");
}
function validateKey(key: string): string {
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error(
      "Storage keys must be non-empty relative slash-separated paths.",
    );
  return key;
}
function validateExpiry(seconds: number): void {
  if (
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > MAX_PRESIGN_SECONDS
  )
    throw new Error(
      `expiresInSeconds must be an integer between 1 and ${MAX_PRESIGN_SECONDS}.`,
    );
}
function objectLocation(
  configuration: AwsStorageConfiguration,
  key: string,
): ObjectLocation {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return {
    key,
    path: `s3://${configuration.bucket}/${key}`,
    url:
      configuration.cdnBaseUrl === undefined
        ? `https://${configuration.bucket}.s3.${configuration.region}.amazonaws.com/${encodedKey}`
        : `${configuration.cdnBaseUrl}/${encodedKey}`,
  };
}
function encodeKeyForCopy(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}
function toStorageTier(
  storageClass: AwsStorageClass | undefined,
): StorageTier | undefined {
  if (storageClass === undefined || storageClass === "STANDARD") return "hot";
  if (storageClass === "INTELLIGENT_TIERING") return "automatic";
  if (storageClass === "STANDARD_IA") return "cool";
  if (storageClass === "ONEZONE_IA") return "single-zone-cool";
  if (storageClass === "GLACIER_IR") return "instant-archive";
  if (storageClass === "GLACIER") return "archive";
  if (storageClass === "DEEP_ARCHIVE") return "deep-archive";
  return undefined;
}
function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.$metadata.httpStatusCode === 404 ||
      error.name === "NotFound" ||
      error.name === "NoSuchKey")
  );
}

export type { UploadBody };
