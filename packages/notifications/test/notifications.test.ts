import { describe, expect, it, vi } from "vitest";
import {
  createFcmAdapter,
  type NotificationConfiguration,
  type NotificationDevice,
} from "../src/index.js";

const configuration: NotificationConfiguration = {
  id: "mobile",
  adapterId: "fcm",
  fallbackConfigurationIds: [],
  rateLimitMax: 3,
  rateLimitWindowSeconds: 3600,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const device: NotificationDevice = {
  id: "device-1",
  recipientId: "user-1",
  adapterId: "fcm",
  endpoint: "fcm-token",
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("FCM adapter", () => {
  it("sends a bounded notification through the HTTP v1 endpoint", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: "projects/app/messages/1" }), {
          status: 200,
        }),
    );
    const adapter = createFcmAdapter({
      projectId: "life-optimizer",
      accessToken: async () => "temporary-token",
      fetch: fetcher,
    });
    await expect(
      adapter.send({
        configuration,
        device,
        title: "Lesson ready",
        body: "Your lesson is available.",
        data: { lessonId: "lesson-1" },
      }),
    ).resolves.toEqual({ providerMessageId: "projects/app/messages/1" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://fcm.googleapis.com/v1/projects/life-optimizer/messages:send",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
