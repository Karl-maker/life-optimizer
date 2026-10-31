import type { Actor, AuditContext, AuditLog } from "@edu-service/core";
import type { Readable } from "node:stream";

/** A provider-neutral object identifier. Keys are logical paths, never local file paths. */
export type StorageKey = string;
/** Provider-neutral data-access policy. Adapters map these to provider classes. */
export const STORAGE_TIER = {
  hot: "hot",
  automatic: "automatic",
  cool: "cool",
  singleZoneCool: "single-zone-cool",
  instantArchive: "instant-archive",
  archive: "archive",
  deepArchive: "deep-archive",
} as const;
export type StorageTier = (typeof STORAGE_TIER)[keyof typeof STORAGE_TIER];
export type UploadBody = Uint8Array | Blob | Readable;

export interface StorageObject {
  key: StorageKey;
  contentType?: string | undefined;
  contentLength?: number | undefined;
  eTag?: string | undefined;
  lastModified?: Date | undefined;
  storageTier?: StorageTier | undefined;
  metadata: Readonly<Record<string, string>>;
}
export interface ObjectLocation {
  key: StorageKey;
  /** Provider path, suitable for logs/audits but not a credential-bearing URL. */
  path: string;
  /** Configured CDN URL when available, otherwise the provider's canonical object URL. */
  url: string;
}
export interface PresignedUpload extends ObjectLocation {
  uploadUrl: string;
  expiresAt: Date;
}
export interface ServerUpload extends ObjectLocation {
  eTag?: string | undefined;
}
/** Context needed to create a durable storage audit record through the existing core port. */
export interface StorageAudit {
  actor: Actor;
  context: AuditContext;
  /** Storage can be shared by resources not owned by a company. */
  companyId?: string | null | undefined;
}
export interface StorageAuditWriter {
  audit: AuditLog;
  clock?: () => Date;
}
/** The portable contract another object-store implementation should satisfy. */
export interface ObjectStore {
  /** The configured public delivery origin, if this deployment uses a CDN. */
  cdnBaseUrl(): string | undefined;
  location(key: StorageKey): ObjectLocation;
  createUploadUrl(input: {
    key: StorageKey;
    contentType?: string;
    contentLength?: number;
    expiresInSeconds?: number;
    metadata?: Readonly<Record<string, string>>;
    audit?: StorageAudit;
  }): Promise<PresignedUpload>;
  confirmUpload(input: {
    key: StorageKey;
    audit?: StorageAudit;
  }): Promise<StorageObject>;
  upload(input: {
    key: StorageKey;
    body: UploadBody;
    contentType?: string;
    contentLength?: number;
    metadata?: Readonly<Record<string, string>>;
    storageTier?: StorageTier;
    audit?: StorageAudit;
  }): Promise<ServerUpload>;
  head(key: StorageKey): Promise<StorageObject | undefined>;
  exists(key: StorageKey): Promise<boolean>;
  delete(input: { key: StorageKey; audit?: StorageAudit }): Promise<void>;
  setStorageTier(input: {
    key: StorageKey;
    storageTier: StorageTier;
    audit?: StorageAudit;
  }): Promise<void>;
  /** Replaces provider metadata without downloading the object body. */
  updateMetadata(input: {
    key: StorageKey;
    metadata: Readonly<Record<string, string>>;
    contentType?: string;
    audit?: StorageAudit;
  }): Promise<void>;
}
