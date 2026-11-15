import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeDatabase,
  db,
  insertUser,
  resetDatabase,
  sql,
} from "../support/test-db.js";

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("PrismaLifeLogRepository", () => {
  it("stores timezone-aware logs and filters by owner, local day, type, text, and range", async () => {
    const userId = await insertUser();
    await db.lifeLogs.createMany([
      {
        userId,
        description: "Walked in Queen's Park",
        type: "exercise",
        occurredAt: new Date("2026-11-14T13:30:00Z"),
        timeZone: "America/Port_of_Spain",
        localDate: "2026-11-14",
        localTime: "09:30:00",
        metadataKey: null,
        metadataValue: null,
        agentSessionId: null,
      },
      {
        userId,
        description: "Screen time: 15h",
        type: "metadata",
        occurredAt: new Date("2026-11-15T02:00:00Z"),
        timeZone: "America/Port_of_Spain",
        localDate: "2026-11-14",
        localTime: "22:00:00",
        metadataKey: "screen-time",
        metadataValue: "15h",
        agentSessionId: null,
      },
    ]);
    await expect(
      db.lifeLogs.list({
        userId,
        localDate: "2026-11-14",
        search: "PARK",
        type: "exercise",
        from: new Date("2026-11-14T00:00:00Z"),
        to: new Date("2026-11-15T00:00:00Z"),
        limit: 10,
        order: "asc",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        description: "Walked in Queen's Park",
        localTime: "09:30:00",
      }),
    ]);
    await expect(
      db.lifeLogs.list({
        userId,
        search: "screen-time",
        limit: 10,
        order: "desc",
      }),
    ).resolves.toEqual([expect.objectContaining({ metadataValue: "15h" })]);
  });

  it("rejects categories outside the fixed list at the database boundary", async () => {
    const userId = await insertUser();

    await expect(
      sql.query(
        `INSERT INTO life_logs
          (id, user_id, description, type, occurred_at, time_zone, local_date, local_time)
         VALUES (gen_random_uuid(), $1, 'Lifted weights', 'fitness', now(), 'UTC', CURRENT_DATE, LOCALTIME)`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("persists agent provenance, supports regex search, and updates a located log", async () => {
    const userId = await insertUser();
    const [created] = await db.lifeLogs.createMany([
      {
        userId,
        description: "Walked briskly for 30 minutes",
        type: "exercise",
        occurredAt: new Date("2026-11-14T22:15:00Z"),
        timeZone: "America/Port_of_Spain",
        localDate: "2026-11-14",
        localTime: "18:15:00",
        metadataKey: null,
        metadataValue: null,
        agentSessionId: "33333333-3333-4333-8333-333333333333",
      },
    ]);

    await expect(db.lifeLogs.findById(created!.id)).resolves.toMatchObject({
      agentSessionId: "33333333-3333-4333-8333-333333333333",
    });
    await expect(
      db.lifeLogs.list({
        userId,
        regex: "walk(ed)?\\s+briskly",
        limit: 10,
        order: "asc",
      }),
    ).resolves.toHaveLength(1);
    await expect(
      db.lifeLogs.update({ ...created!, description: "Walked for 40 minutes" }),
    ).resolves.toMatchObject({
      id: created!.id,
      description: "Walked for 40 minutes",
      agentSessionId: "33333333-3333-4333-8333-333333333333",
    });
  });
});
