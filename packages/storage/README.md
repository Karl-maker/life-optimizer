# Storage

`@edu-service/storage` provides a small, provider-neutral `ObjectStore` contract and an AWS S3 adapter. It keeps S3, credentials, multipart mechanics, and CDN configuration outside `@edu-service/core`; core can later depend only on the contract when a learning use case needs to attach an image, audio file, or other content.

## AWS S3 setup

Use a private bucket. Give the workload IAM permission only for the configured prefix: `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`, `s3:DeleteObject`, and `s3:PutObject`/`s3:GetObject` for multipart uploads. Configure CORS on the bucket for the browser origins and the `Content-Type` request header. Configure a lifecycle rule to abort incomplete multipart uploads; this is important if a browser closes during a large transfer.

Copy [`.env.example`](./.env.example) into an ignored environment file in the composition service. `EDU_STORAGE_AWS_REGION` and `EDU_STORAGE_S3_BUCKET` are required. `EDU_STORAGE_CDN_BASE_URL` is optional and changes the returned permanent delivery URL, not the short-lived upload authorization. Use an IAM role in deployed environments; static AWS keys are a local-development escape hatch and never enter core, events, audit records, or telemetry.

```ts
import {
  createS3ObjectStore,
  readAwsStorageConfiguration,
} from "@edu-service/storage/aws";

const storage = createS3ObjectStore({
  configuration: readAwsStorageConfiguration(process.env),
  events, // optional EventPublisher from @edu-service/events
  audit: { audit: transactionAuditLog }, // optional core AuditLog at the composition boundary
});
```

## Browser upload with a presigned URL

Authorize the user before generating a URL; the URL is a bearer capability for exactly one S3 object and expires quickly. The result deliberately returns the provider `path`, a stable CDN/S3 `url`, and the temporary `uploadUrl`. Call `storage.cdnBaseUrl()` when a consumer needs to inspect the configured delivery origin without constructing a key. The stable URL is only publicly readable when your CDN or bucket policy permits it; private content should use a separately presigned download URL in a future access-controlled feature.

```ts
const pending = await storage.createUploadUrl({
  key: `questions/${questionId}/image.png`,
  contentType: "image/png",
  contentLength: image.size,
  expiresInSeconds: 15 * 60,
  audit: { actor, context: auditContext, companyId },
});

await fetch(pending.uploadUrl, {
  method: "PUT",
  headers: { "content-type": "image/png" },
  body: image,
});

// This verifies the object exists and records the completed-upload audit/event.
const object = await storage.confirmUpload({
  key: pending.key,
  audit: { actor, context: auditContext, companyId },
});
```

The URL-issuance audit is accurate immediately; S3 cannot notify this package when the browser actually uses a presigned URL. Call `confirmUpload` after the client reports success (and enforce a bucket lifecycle rule for abandoned objects). For stricter workflows, persist a pending-upload business record and only attach the object to a question after confirmation.

## Server-side bytes, status, and operations

`upload` accepts `Uint8Array`, `Blob`, or a Node `Readable`, such as an audio stream returned by ElevenLabs. Known small payloads use `PutObject`; streams and payloads at or above 5 MiB use AWS's managed multipart upload with bounded parallelism. The adapter publishes typed `storage.upload.requested`, `storage.upload.progressed`, `storage.object.uploaded`, and failure/status events through `@edu-service/events`; multipart progress is limited to 5% increments (at most 21 events) so an eventual SSE relay does not flood its broker. Those notifications are best effort, so an event-broker outage never corrupts a completed S3 write. Consumers must deduplicate by event ID.

```ts
const saved = await storage.upload({
  key: `audio/${lessonId}.mp3`,
  body: elevenLabsAudioStream,
  contentType: "audio/mpeg",
  audit: { actor, context: auditContext },
});

const exists = await storage.exists(saved.key);
const metadata = await storage.head(saved.key);
await storage.setStorageTier({
  key: saved.key,
  storageTier: "automatic",
});
await storage.updateMetadata({
  key: saved.key,
  metadata: { source: "elevenlabs" },
});
await storage.delete({
  key: saved.key,
  audit: { actor, context: auditContext },
});
```

`upload` replaces an existing key; `updateMetadata` and `setStorageTier` perform S3's server-side copy onto the same key, so they do not download object bytes. The portable tiers are `hot`, `automatic`, `cool`, `single-zone-cool`, `instant-archive`, `archive`, and `deep-archive`; only the AWS adapter maps them to S3 storage classes. These actions and deletion have optional durable audit records through the existing core `AuditLog`; invoke storage from the application workflow that owns authorization and its transaction. S3 itself cannot join PostgreSQL's transaction, so never claim cross-service atomicity: reconcile failed or orphaned writes with a job.

## Add another provider

Keep business rules in `@edu-service/core`. Implement the exported `ObjectStore` interface in a new outer adapter package (for example, `@edu-service/storage-r2`), validate its configuration at that package boundary, and return the same `ObjectLocation`/presigned-upload contracts. Do not add provider SDK imports to core. Preserve key validation, short-lived bearer URLs, metadata limits, event payload safety, and the audit handoff; provider-specific lifecycle/CORS/IAM setup belongs in that adapter's README and IaC.
