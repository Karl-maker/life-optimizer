import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBillingService,
  createFinancialService,
} from "@life-optimizer/financial";
import {
  closeDatabase,
  db,
  insertUser,
  resetDatabase,
  sql,
} from "../support/test-db.js";

const audit = {
  correlationId: "billing-integration",
  source: "api" as const,
  actorSource: "service" as const,
};
const manager = (userId: string) => ({
  kind: "agent" as const,
  agentId: "billing-worker",
  onBehalfOf: userId,
  permissions: ["financial:manage" as const],
});

describe("Prisma billing transactions", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("persists invoice snapshots, coupon redemption, payment fulfillment, refund, credit note and audit/outbox", async () => {
    const userId = await insertUser();
    const financial = createFinancialService({
      repository: db.financial,
      transactions: db.financialTransactions,
    });
    const billing = createBillingService({
      repository: db.billing,
      transactions: db.billingTransactions,
      clock: () => new Date("2026-10-31T12:00:00Z"),
    });
    await financial.registerEntitlementDefinition({
      key: "course.access",
      description: "Course access",
      unit: "boolean",
      resetStrategy: "never",
      resetIntervalSeconds: null,
    });
    const product = await billing.createProduct({
      actor: manager(userId),
      audit,
      key: "course-basic",
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
    await expect(
      db.financialReporting.findCatalogProduct(product.id),
    ).resolves.toMatchObject({
      id: product.id,
      prices: [{ id: price.id, unitAmountMinor: 1000n }],
    });
    expect(await db.financial.findSolePurchaseOption("course.access")).toEqual({
      productId: product.id,
      priceId: price.id,
    });
    const coupon = await billing.createCoupon({
      actor: manager(userId),
      audit,
      code: "SAVE10XX",
      percentOff: 10,
    });
    const request = {
      actor: manager(userId),
      audit,
      userId,
      idempotencyKey: "order-integration-1",
      lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 750 }],
      couponCode: coupon.code,
    };
    const invoice = await billing.issueInvoice(request);
    expect(invoice.totalMinor).toBe(968n);
    expect((await billing.issueInvoice(request)).id).toBe(invoice.id);
    await billing.bindInvoiceProvider({
      actor: manager(userId),
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "cs_test_1234",
    });
    const paid = await billing.recordPayment({
      actor: manager(userId),
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "pi_1234",
      amountMinor: 968n,
      currency: "USD",
      occurredAt: new Date("2026-10-31T12:01:00Z"),
    });
    expect(paid.fulfilled).toBe(true);
    const refunded = await billing.recordRefund({
      actor: manager(userId),
      audit,
      userId,
      paymentId: paid.payment.id,
      providerReference: "re_1234",
      amountMinor: 968n,
      reason: "Customer requested refund",
      revokeAccess: true,
      occurredAt: new Date("2026-10-31T12:02:00Z"),
    });
    expect(
      (
        await billing.recordRefund({
          actor: manager(userId),
          audit,
          userId,
          paymentId: paid.payment.id,
          providerReference: "re_1234",
          amountMinor: 968n,
          reason: "Customer requested refund",
          revokeAccess: true,
          occurredAt: new Date("2026-10-31T12:02:00Z"),
        })
      ).id,
    ).toBe(refunded.id);
    const counts = await sql.query<{
      lines: string;
      redemptions: string;
      payments: string;
      refunds: string;
      notes: string;
      grants: string;
      revoked: string;
    }>(
      "SELECT (SELECT count(*) FROM invoice_lines)::text AS lines, (SELECT count(*) FROM coupon_redemptions)::text AS redemptions, (SELECT count(*) FROM payment_records)::text AS payments, (SELECT count(*) FROM refund_records)::text AS refunds, (SELECT count(*) FROM credit_notes)::text AS notes, (SELECT count(*) FROM entitlements WHERE invoice_id=$1)::text AS grants, (SELECT count(*) FROM entitlements WHERE invoice_id=$1 AND revoked_at IS NOT NULL)::text AS revoked",
      [invoice.id],
    );
    expect(counts.rows[0]).toMatchObject({
      lines: "1",
      redemptions: "1",
      payments: "1",
      refunds: "1",
      notes: "1",
      grants: "1",
      revoked: "1",
    });
    const outbox = await sql.query<{ type: string }>(
      "SELECT type FROM event_outbox WHERE type LIKE 'financial.%'",
    );
    expect(outbox.rows.map((row) => row.type)).toContain(
      "financial.fulfillment.completed",
    );
    const auditRows = await sql.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE action LIKE 'financial.%'",
    );
    expect(auditRows.rows.map((row) => row.action)).toContain(
      "financial.credit_note.issued",
    );
  });

  it("claims a PowerTranz sale once and stores only a token hash", async () => {
    const userId = await insertUser();
    const account = await db.financial.ensureAccount(userId);
    const created = await sql.query<{ id: string }>(
      "INSERT INTO invoices (id, account_id, currency, subtotal_minor, total_minor, status) VALUES (gen_random_uuid(), $1, 'USD', 1000, 1000, 'open') RETURNING id",
      [account.id],
    );
    const invoiceId = created.rows[0]!.id;
    const sale = {
      id: "00000000-0000-4000-8000-000000000019",
      invoiceId,
      userId,
      transactionIdentifier: "00000000-0000-4000-8000-000000000020",
      orderIdentifier: invoiceId,
      amountMinor: 1000n,
      currency: "USD",
      tokenHash: "a".repeat(64),
      expiresAt: new Date("2026-10-31T12:05:00Z"),
      threeDSecure: true,
      status: "pending" as const,
      processingStartedAt: null,
    };
    await db.powerTranzSales.create(sale);
    expect(
      (await db.powerTranzSales.findByTokenHash(sale.tokenHash))?.invoiceId,
    ).toBe(invoiceId);
    expect(
      await db.powerTranzSales.claim(sale.id, new Date("2026-10-31T12:01:00Z")),
    ).toBe(true);
    expect(
      await db.powerTranzSales.claim(sale.id, new Date("2026-10-31T12:01:00Z")),
    ).toBe(false);
    await db.powerTranzSales.setStatus(sale.id, "completed");
    expect(
      (await db.powerTranzSales.findByTokenHash(sale.tokenHash))?.status,
    ).toBe("completed");
  });
});
