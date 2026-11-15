import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPatronService,
  defaultPatronConfiguration,
} from "@life-optimizer/patron";
import {
  closeDatabase,
  db,
  insertUser,
  resetDatabase,
  sql,
} from "../support/test-db.js";

const audit = {
  correlationId: "patron-integration",
  source: "api" as const,
  actorSource: "service" as const,
};
const manager = (userId: string) => ({
  kind: "agent" as const,
  agentId: "finance-admin",
  onBehalfOf: userId,
  permissions: ["financial:manage" as const],
});
const actor = (userId: string) => ({ kind: "user" as const, userId });

describe("Prisma Patron repository", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("persists configurable budgets, action credit guides and idempotent credit entries", async () => {
    const userId = await insertUser();
    const patron = createPatronService({
      repository: db.patron,
      transactions: db.patronTransactions,
      clock: () => new Date("2026-11-01T12:00:00Z"),
    });
    const config = defaultPatronConfiguration(new Date("2026-11-01T12:00:00Z"));
    await patron.configure({
      actor: manager(userId),
      audit,
      config: { ...config, creditMicrousd: 25_000 },
    });
    await patron.configureActionCredit({
      actor: manager(userId),
      audit,
      key: "commented",
      description: "Quality comment accepted",
      creditDelta: 3n,
      guide:
        "Finance may tune this after comparing moderation quality with AI spend.",
    });
    await patron.applyCreditSituation({
      actor: actor(userId),
      audit,
      userId,
      situationKey: "commented",
      idempotencyKey: "comment-event-1",
    });
    await patron.applyCreditSituation({
      actor: actor(userId),
      audit,
      userId,
      situationKey: "commented",
      idempotencyKey: "comment-event-1",
    });
    await expect(patron.explain(userId)).resolves.toMatchObject({
      creditBalance: 3n,
      recentCredits: [expect.objectContaining({ situationKey: "commented" })],
    });
    const stored = await db.patron.getConfiguration("default");
    expect(stored?.creditMicrousd).toBe(25_000);
    const counts = await sql.query<{
      credits: string;
      audits: string;
      outbox: string;
    }>(
      "SELECT (SELECT count(*) FROM patron_credit_entries)::text AS credits, (SELECT count(*) FROM audit_events WHERE action LIKE 'patron.%')::text AS audits, (SELECT count(*) FROM event_outbox WHERE topic='patron')::text AS outbox",
    );
    expect(counts.rows[0]).toEqual({
      credits: "1",
      audits: "3",
      outbox: "3",
    });
  });
});
