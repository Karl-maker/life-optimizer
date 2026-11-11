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

  it("returns a documented not-found problem when an owned read-state update cannot be applied", async () => {
    const service = {
      setRead: vi.fn(async () => null),
    } as unknown as NotificationInboxService;
    const app = await createApiServer({
      notifications: {
        service,
        authenticator: {
          authenticate: async () => ({
            id: "00000000-0000-4000-8000-000000000001",
            kind: "bearer" as const,
            permissions: ["user"],
          }),
        },
      },
    });
    const response = await app.inject({
      method: "PATCH",
      url: "/notifications/00000000-0000-4000-8000-000000000002/read",
      headers: { authorization: "Bearer test" },
      payload: { read: true },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "NOT_FOUND" });
    await app.close();
  });

  it("uses an opaque keyset cursor for notification pages", async () => {
    const createdAt = new Date("2026-11-10T12:00:00.000Z");
    const rows = [
      notification("00000000-0000-4000-8000-000000000003", createdAt),
      notification("00000000-0000-4000-8000-000000000002", createdAt),
    ];
    const list = vi
      .fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([rows[1]]);
    const app = await createApiServer({
      notifications: {
        service: { list } as unknown as NotificationInboxService,
        authenticator: {
          authenticate: async () => ({
            id: "00000000-0000-4000-8000-000000000001",
            kind: "bearer" as const,
            permissions: ["user"],
          }),
        },
      },
    });
    const first = await app.inject({
      method: "GET",
      url: "/notifications?limit=1",
      headers: { authorization: "Bearer test" },
    });
    expect(first.statusCode, first.body).toBe(200);
    const next = first.json().links.next as string;
    expect(next).toMatch(/^\/notifications\?limit=1&cursor=/);
    const second = await app.inject({
      method: "GET",
      url: next,
      headers: { authorization: "Bearer test" },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(list).toHaveBeenLastCalledWith(
      "00000000-0000-4000-8000-000000000001",
      1,
      { createdAt, id: rows[0]!.id },
    );
    await app.close();
  });
});

function notification(id: string, createdAt: Date) {
  return {
    id,
    userId: "00000000-0000-4000-8000-000000000001",
    title: "Update",
    body: "Something changed.",
    data: {},
    status: "unread" as const,
    readAt: null,
    dismissedAt: null,
    scheduledAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}
