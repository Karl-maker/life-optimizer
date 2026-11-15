import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { UserNotification } from "@life-optimizer/notifications";
import {
  closeDatabase,
  db,
  insertUser,
  resetDatabase,
} from "../support/test-db.js";

const createdAt = new Date("2026-11-10T12:00:00.000Z");

describe("PrismaNotificationRepository", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("paginates equal-timestamp inbox rows with a stable createdAt and ID keyset", async () => {
    const userId = await insertUser();
    const olderId = "00000000-0000-4000-8000-000000000002";
    const newerId = "00000000-0000-4000-8000-000000000003";
    await db.notifications.createInbox(notification(olderId, userId));
    await db.notifications.createInbox(notification(newerId, userId));

    const first = await db.notifications.listInbox(userId, 1);
    expect(first.map(({ id }) => id)).toEqual([newerId, olderId]);
    const second = await db.notifications.listInbox(userId, 1, {
      createdAt,
      id: newerId,
    });
    expect(second.map(({ id }) => id)).toEqual([olderId]);
  });
});

function notification(id: string, userId: string): UserNotification {
  return {
    id,
    userId,
    title: "Update",
    body: "Something changed.",
    data: {},
    status: "unread",
    readAt: null,
    dismissedAt: null,
    scheduledAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}
