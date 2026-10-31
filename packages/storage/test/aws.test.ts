import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  createS3ObjectStore,
  readAwsStorageConfiguration,
} from "../src/aws.js";

const configuration = {
  region: "us-east-1",
  bucket: "learning-content",
  cdnBaseUrl: "https://cdn.example.test",
};
const auditContext = {
  actor: { kind: "user" as const, userId: "user-1" },
  context: { correlationId: "request-1", source: "api" as const },
};

describe("S3 object store", () => {
  it("returns a canonical CDN location and rejects traversal-like keys", () => {
    const store = createS3ObjectStore({ configuration });
    expect(store.location("questions/q1/image one.png")).toEqual({
      key: "questions/q1/image one.png",
      path: "s3://learning-content/questions/q1/image one.png",
      url: "https://cdn.example.test/questions/q1/image%20one.png",
    });
    expect(store.cdnBaseUrl()).toBe("https://cdn.example.test");
    expect(() => store.location("../secrets")).toThrow(
      "relative slash-separated",
    );
    expect(() => store.location("/absolute")).toThrow(
      "relative slash-separated",
    );
  });

  it("uploads a known small buffer, records an audit, and publishes a typed completion event", async () => {
    const send = vi.fn().mockResolvedValue({ ETag: "etag-1" });
    const append = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue(undefined);
    const store = createS3ObjectStore({
      configuration,
      client: { send } as unknown as S3Client,
      audit: { audit: { append } },
      events: { publish },
    });

    const result = await store.upload({
      key: "audio/lesson-1.mp3",
      body: new Uint8Array([1, 2]),
      contentLength: 2,
      contentType: "audio/mpeg",
      audit: auditContext,
    });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(result).toMatchObject({
      key: "audio/lesson-1.mp3",
      path: "s3://learning-content/audio/lesson-1.mp3",
      eTag: "etag-1",
    });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "storage.object.uploaded",
        resource: { type: "storage-object", id: "audio/lesson-1.mp3" },
        changes: { contentType: "audio/mpeg", contentLength: 2 },
      }),
    );
    await vi.waitFor(() =>
      expect(publish).toHaveBeenCalledWith([
        expect.objectContaining({
          type: "storage.object.uploaded",
          correlationId: "request-1",
        }),
      ]),
    );
  });

  it("issues a short-lived object-scoped URL and audits the authorization", async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const store = createS3ObjectStore({
      configuration: {
        ...configuration,
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      },
      audit: { audit: { append } },
      now: () => new Date("2026-10-31T00:00:00.000Z"),
    });
    const result = await store.createUploadUrl({
      key: "questions/q1/image.png",
      contentType: "image/png",
      contentLength: 10,
      expiresInSeconds: 60,
      audit: auditContext,
    });
    expect(result).toMatchObject({
      key: "questions/q1/image.png",
      path: "s3://learning-content/questions/q1/image.png",
      expiresAt: new Date("2026-10-31T00:01:00.000Z"),
    });
    expect(result.uploadUrl).toContain("X-Amz-Signature=");
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "storage.upload.requested" }),
    );
    await expect(
      store.createUploadUrl({
        key: "questions/q1/late.png",
        expiresInSeconds: 0,
      }),
    ).rejects.toThrow("between 1");
  });

  it("heads, checks, changes tier, and deletes without transferring object bytes", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ContentType: "image/png",
        ContentLength: 3,
        Metadata: { source: "question" },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const store = createS3ObjectStore({
      configuration,
      client: { send } as unknown as S3Client,
    });

    expect(await store.head("questions/q1/image.png")).toMatchObject({
      contentType: "image/png",
      contentLength: 3,
      metadata: { source: "question" },
    });
    await store.setStorageTier({
      key: "questions/q1/image.png",
      storageTier: "automatic",
    });
    await store.delete({ key: "questions/q1/image.png" });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CopyObjectCommand);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });
});

describe("AWS storage configuration", () => {
  it("requires a region and bucket and normalizes the CDN origin", () => {
    expect(
      readAwsStorageConfiguration({
        EDU_STORAGE_AWS_REGION: "us-east-1",
        EDU_STORAGE_S3_BUCKET: "content",
        EDU_STORAGE_CDN_BASE_URL: "https://cdn.example.test/",
      }),
    ).toMatchObject({ cdnBaseUrl: "https://cdn.example.test" });
    expect(() =>
      readAwsStorageConfiguration({ EDU_STORAGE_S3_BUCKET: "content" }),
    ).toThrow("EDU_STORAGE_AWS_REGION");
    expect(() =>
      readAwsStorageConfiguration({
        EDU_STORAGE_AWS_REGION: "us-east-1",
        EDU_STORAGE_S3_BUCKET: "content",
        AWS_ACCESS_KEY_ID: "one",
      }),
    ).toThrow("set together");
  });
});
