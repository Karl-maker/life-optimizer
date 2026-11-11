import { describe, expect, it, vi } from "vitest";
import type { NotificationInboxService } from "@edu-service/notifications";
import { createApiServer } from "../src/index.js";

describe("notification routes", () => {
  it("scopes inbox reads to the authenticated user and exposes safe admin configuration", async () => {
    const list = vi.fn(async () => []);
    const service = {
      list,
      unreadCount: async () => 2,
      configurations: async () => [
        {
          id: "push-primary",
          adapterId: "fcm",
          fallbackConfigurationIds: [],
          rateLimitMax: 100,
          rateLimitWindowSeconds: 3600,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    } as unknown as NotificationInboxService;
    const authenticator = {
      authenticate: async () => ({
        id: "00000000-0000-4000-8000-000000000001",
        kind: "bearer" as const,
        permissions: ["user", "notifications:manage"],
      }),
    };
    const app = await createApiServer({
      notifications: { service, authenticator },
    });
    const inbox = await app.inject({
      method: "GET",
      url: "/notifications",
      headers: { authorization: "Bearer test" },
    });
    expect(inbox.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      25,
      undefined,
    );
    const config = await app.inject({
      method: "GET",
      url: "/admin/notification-configurations",
      headers: { authorization: "Bearer test" },
    });
    expect(config.statusCode).toBe(200);
    expect(config.body).not.toMatch(/secret|credential|token/i);
    await app.close();
  });
});
