import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createFinancialService } from "@edu-service/financial";
import {
  closeDatabase,
  db,
  insertUser,
  resetDatabase,
  sql,
} from "../support/test-db.js";

const audit = {
  correlationId: "financial-integration",
  source: "api" as const,
};
const manager = (userId: string) => ({
  kind: "agent" as const,
  agentId: "billing-worker",
  onBehalfOf: userId,
  permissions: ["financial:manage" as const],
});

describe("Prisma financial repository", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("persists grants, usage, reversals, audit and outbox together", async () => {
    const userId = await insertUser();
    const service = createFinancialService({
      repository: db.financial,
      transactions: db.financialTransactions,
      clock: () => new Date("2026-10-31T12:00:00Z"),
    });
    await service.registerEntitlementDefinition({
      key: "ai.chat",
      description: "Chat requests",
      unit: "request",
      resetStrategy: "calendar_day",
      resetIntervalSeconds: null,
    });
    await service.grant({
      actor: manager(userId),
      audit,
      userId,
      key: "ai.chat",
      quantity: 2n,
    });
    const input = {
      actor: { kind: "user" as const, userId },
      audit,
      userId,
      entitlementKey: "ai.chat",
      quantity: 1n,
      idempotencyKey: "usage-request-1",
    };
    const first = await service.recordUsage(input);
    expect((await service.recordUsage(input)).id).toBe(first.id);
    await expect(
      service.recordUsage({
        ...input,
        idempotencyKey: "usage-request-2",
        quantity: 2n,
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    const reversal = await service.reverseUsage({
      actor: manager(userId),
      audit,
      userId,
      originalUsageId: first.id,
      quantity: 1n,
      idempotencyKey: "usage-reversal-1",
    });
    expect(reversal.quantity).toBe(-1n);
    const { rows } = await sql.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM usage_records",
    );
    expect(rows[0]?.count).toBe("2");
    const auditRows = await sql.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE action LIKE 'financial.usage.%' ORDER BY occurred_at",
    );
    expect(auditRows.rows.map((row) => row.action)).toContain(
      "financial.usage.reversed",
    );
    const outbox = await sql.query<{ type: string }>(
      "SELECT type FROM event_outbox WHERE type LIKE 'financial.usage.%'",
    );
    expect(outbox.rows.map((row) => row.type)).toContain(
      "financial.usage.reversed",
    );
  });

  it("prevents two concurrent wallet debits from overspending", async () => {
    const userId = await insertUser();
    const service = createFinancialService({
      repository: db.financial,
      transactions: db.financialTransactions,
    });
    await service.adjustWallet({
      actor: manager(userId),
      audit,
      userId,
      currency: "USD",
      amountMinor: 100n,
      type: "credit",
      idempotencyKey: "initial-credit-1",
    });
    const results = await Promise.allSettled(
      ["debit-attempt-1", "debit-attempt-2"].map((idempotencyKey) =>
        service.adjustWallet({
          actor: { kind: "user", userId },
          audit,
          userId,
          currency: "USD",
          amountMinor: -80n,
          type: "debit",
          idempotencyKey,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await db.financial.walletBalance(
        (await db.financial.ensureAccount(userId)).id,
        "USD",
      ),
    ).toBe(20n);
  });

  it("binds an external key once and refuses reassignment", async () => {
    const firstUser = await insertUser("First");
    const secondUser = await insertUser("Second");
    const service = createFinancialService({
      repository: db.financial,
      transactions: db.financialTransactions,
    });
    await expect(
      service.bindAccountKey({
        actor: manager(firstUser),
        audit,
        userId: firstUser,
        key: "stripe.cus_1234",
      }),
    ).resolves.toEqual({ created: true });
    expect((await service.findAccountByKey("stripe.cus_1234"))?.userId).toBe(
      firstUser,
    );
    await expect(
      service.bindAccountKey({
        actor: manager(secondUser),
        audit,
        userId: secondUser,
        key: "stripe.cus_1234",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not bypass the payment ledger for a bound invoice event", async () => {
    const userId = await insertUser();
    const account = await db.financial.ensureAccount(userId);
    const { rows } = await sql.query<{ id: string }>(
      "INSERT INTO invoices (id, account_id, currency, total_minor, status, provider, provider_reference) VALUES (gen_random_uuid(), $1, 'USD', 100, 'open', 'stripe', 'in_123') RETURNING id",
      [account.id],
    );
    const service = createFinancialService({
      repository: db.financial,
      transactions: db.financialTransactions,
    });
    const occurredAt = new Date("2026-10-31T12:00:00Z");
    await service.applyProviderEvent({
      actor: manager(userId),
      audit,
      event: {
        provider: "stripe",
        eventId: "evt_paid_1",
        type: "invoice.paid",
        occurredAt,
        objectId: "in_123",
        payloadReference: "evt_paid_1",
      },
    });
    await service.applyProviderEvent({
      actor: manager(userId),
      audit,
      event: {
        provider: "stripe",
        eventId: "evt_old_1",
        type: "invoice.finalized",
        occurredAt: new Date("2026-10-31T11:00:00Z"),
        objectId: "in_123",
        payloadReference: "evt_old_1",
      },
    });
    const invoice = await sql.query<{ status: string }>(
      "SELECT status FROM invoices WHERE id = $1",
      [rows[0]?.id],
    );
    expect(invoice.rows[0]?.status).toBe("open");
  });
});
