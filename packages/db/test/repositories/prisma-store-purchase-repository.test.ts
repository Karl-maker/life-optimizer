import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBillingService,
  createFinancialService,
  createStorePurchaseService,
} from "@life-optimizer/financial";
import {
  closeDatabase,
  db,
  insertUser,
  resetDatabase,
  sql,
} from "../support/test-db.js";

const audit = {
  correlationId: "store-integration",
  source: "api" as const,
  actorSource: "service" as const,
};
const manager = (userId: string) => ({
  kind: "agent" as const,
  agentId: "store-worker",
  onBehalfOf: userId,
  permissions: ["financial:manage" as const],
});
const at = new Date("2026-10-31T12:00:00Z");

describe("Prisma store purchase ledger", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);
  it("persists a Google full-void tombstone once and rejects a different token", async () => {
    const input = {
      provider: "google" as const,
      transactionId: "GPA.void-before-claim",
      tokenHash: "a".repeat(64),
      eventId: "void-event-1",
      occurredAt: at,
    };
    expect(await db.storePurchases.recordVoid(input)).toBe(true);
    expect(await db.storePurchases.recordVoid(input)).toBe(false);
    expect(
      await db.storePurchases.findVoid("google", input.transactionId),
    ).toEqual({ tokenHash: input.tokenHash });
    await expect(
      db.storePurchases.recordVoid({ ...input, tokenHash: "b".repeat(64) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const rows = await sql.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM store_voids WHERE transaction_id = $1",
      [input.transactionId],
    );
    expect(rows.rows[0]?.count).toBe("1");
  });
  it("stores a mapped Apple purchase, grant, notification, audit and outbox together and revokes on refund", async () => {
    const userId = await insertUser();
    const financial = createFinancialService({
      repository: db.financial,
      transactions: db.financialTransactions,
    });
    const billing = createBillingService({
      repository: db.billing,
      transactions: db.billingTransactions,
      clock: () => at,
    });
    const store = createStorePurchaseService({
      repository: db.storePurchases,
      transactions: db.storePurchaseTransactions,
      clock: () => at,
    });
    await financial.registerEntitlementDefinition({
      key: "course.access",
      description: "Access",
      unit: "boolean",
      resetStrategy: "never",
      resetIntervalSeconds: null,
    });
    const product = await billing.createProduct({
      actor: manager(userId),
      audit,
      key: "course-access",
      name: "Course",
      riskLevel: "low",
    });
    const price = await billing.createPrice({
      actor: manager(userId),
      audit,
      productId: product.id,
      currency: "USD",
      unitAmountMinor: 1000n,
      frequency: "one_time",
      intervalCount: 1,
      trialDays: 0,
      entitlements: [{ key: "course.access", quantity: null }],
    });
    await financial.bindAccountKey({
      actor: manager(userId),
      audit,
      userId,
      key: `iap.apple.${userId}`,
    });
    await store.mapProduct({
      actor: manager(userId),
      audit,
      provider: "apple",
      sku: "course.gold",
      priceId: price.id,
    });
    const verified = {
      provider: "apple" as const,
      transactionId: "apple-tx-1",
      originalTransactionId: "apple-tx-1",
      tokenHash: null,
      accountKey: `iap.apple.${userId}`,
      sku: "course.gold",
      kind: "one_time" as const,
      status: "active" as const,
      environment: "sandbox" as const,
      quantity: 1,
      currency: "USD",
      priceMilliunits: 1990n,
      purchasedAt: at,
      expiresAt: null,
      observedAt: at,
    };
    const first = await store.sync({
      actor: manager(userId),
      audit,
      purchase: verified,
      notification: { eventId: "apple-note-1", type: "ONE_TIME_CHARGE" },
    });
    expect(first.granted).toBe(1);
    expect(
      (
        await store.sync({
          actor: manager(userId),
          audit,
          purchase: verified,
          notification: { eventId: "apple-note-1", type: "ONE_TIME_CHARGE" },
        })
      ).granted,
    ).toBe(0);
    const purchaseRow = await sql.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM store_purchases WHERE transaction_id = 'apple-tx-1'",
    );
    expect(purchaseRow.rows[0]?.count).toBe("1");
    const grant = await sql.query<{ store_purchase_id: string }>(
      "SELECT store_purchase_id FROM entitlements WHERE key = 'course.access'",
    );
    expect(grant.rows).toEqual([{ store_purchase_id: first.purchase.id }]);
    const revoked = await store.sync({
      actor: manager(userId),
      audit,
      purchase: {
        ...verified,
        status: "revoked",
        observedAt: new Date(at.getTime() + 1000),
      },
      notification: { eventId: "apple-note-2", type: "REFUND" },
    });
    expect(revoked.revoked).toBe(1);
    const state = await sql.query<{ status: string; revoked_at: Date }>(
      "SELECT p.status, e.revoked_at FROM store_purchases p JOIN entitlements e ON e.store_purchase_id = p.id WHERE p.id = $1",
      [first.purchase.id],
    );
    expect(state.rows[0]?.status).toBe("revoked");
    expect(state.rows[0]?.revoked_at).not.toBeNull();
    const facts = await sql.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox WHERE type = 'financial.store-purchase.synced'",
    );
    expect(Number(facts.rows[0]?.count)).toBeGreaterThanOrEqual(2);
  });
});
