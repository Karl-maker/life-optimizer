import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AuditLog, EventOutbox } from "@edu-service/core";
import {
  createFinancialService,
  financialEventForProviderEvent,
  StripeAdapter,
  type EntitlementDefinition,
  type FinancialRepository,
  type FinancialTransactionRunner,
} from "../src/index.js";

const account = { id: "account-1", userId: "user-1" };
const definition: EntitlementDefinition = {
  key: "ai.chat",
  description: "Chat requests",
  unit: "request",
  resetStrategy: "calendar_day",
  resetIntervalSeconds: null,
};
const actor = { kind: "user" as const, userId: "user-1" };
const manager = {
  kind: "agent" as const,
  agentId: "billing-worker",
  onBehalfOf: "user-1",
  permissions: ["financial:manage" as const],
};
const auditContext = { correlationId: "test", source: "api" as const };

function setup(options: { allowance?: bigint | null; used?: bigint } = {}) {
  const usageWindows: (Date | null)[] = [];
  const outbox: unknown[] = [];
  const repository: FinancialRepository = {
    ensureAccount: async () => account,
    findAccountByKey: async () => account,
    bindAccountKey: async () => true,
    removeAccountKey: async () => true,
    findAccountById: async () => account,
    registerEntitlementDefinition: async (value) => value,
    findEntitlementDefinition: async () => definition,
    listPriceEntitlements: async () => [
      { priceId: "price-pro", entitlementKey: "ai.chat", quantity: 100n },
    ],
    findSolePurchaseOption: async () => ({
      productId: "product-pro",
      priceId: "price-pro",
    }),
    grantEntitlement: async (input) => ({ ...input, id: "grant-1" }),
    findEntitlementById: async (id) => ({
      id,
      accountId: account.id,
      key: definition.key,
      quantity: null,
      startsAt: new Date(),
      endsAt: null,
      revokedAt: null,
      productId: null,
      priceId: null,
    }),
    revokeEntitlement: async (id, revokedAt) => ({
      id,
      accountId: account.id,
      key: definition.key,
      quantity: null,
      startsAt: new Date(),
      endsAt: null,
      revokedAt,
      productId: null,
      priceId: null,
    }),
    findUsableEntitlement: async () => ({
      id: "grant-1",
      accountId: account.id,
      key: definition.key,
      quantity: options.allowance ?? null,
      startsAt: new Date(),
      endsAt: null,
      revokedAt: null,
      productId: null,
      priceId: null,
    }),
    entitlementQuantity: async () => options.allowance ?? null,
    usageTotal: async (_account, _key, since) => (
      usageWindows.push(since),
      options.used ?? 0n
    ),
    findUsageByKey: async () => null,
    findUsageById: async (id) => ({
      id,
      accountId: account.id,
      entitlementKey: definition.key,
      quantity: 5n,
      idempotencyKey: "original-usage",
      occurredAt: new Date("2026-02-18T10:00:00Z"),
      reversalOfId: null,
    }),
    usageReversedTotal: async () => 0n,
    recordUsage: async (input) => ({
      record: { ...input, id: "usage-1" },
      created: true,
    }),
    walletBalance: async () => 0n,
    findWalletEntryByKey: async () => null,
    addWalletEntry: async (input) => ({
      entry: { ...input, id: "entry-1" },
      created: true,
    }),
    savePaymentMethod: async (input) => ({
      ...input,
      id: "payment-method-1",
      revokedAt: null,
      createdAt: new Date(),
    }),
    findPaymentMethod: async (owner, id) =>
      owner === account.id && id === "payment-method-1"
        ? {
            id,
            accountId: owner,
            provider: "stripe",
            tokenReference: "pm_123",
            brand: "visa",
            last4: "4242",
            expiresMonth: 1,
            expiresYear: 2030,
            revokedAt: null,
            createdAt: new Date(),
          }
        : null,
    listPaymentMethods: async () => [],
    updatePaymentMethod: async (owner, id, metadata) => ({
      id,
      accountId: owner,
      provider: "stripe",
      tokenReference: "pm_123",
      ...metadata,
      revokedAt: null,
      createdAt: new Date(),
    }),
    revokePaymentMethod: async (id) => ({
      id,
      accountId: account.id,
      provider: "stripe",
      tokenReference: "pm_123",
      brand: "visa",
      last4: "4242",
      expiresMonth: 1,
      expiresYear: 2030,
      revokedAt: new Date(),
      createdAt: new Date(),
    }),
    recordProviderEvent: async () => true,
    syncInvoiceStatus: async () => ({ id: "invoice-1", accountId: account.id }),
    syncSubscriptionStatus: async () => ({
      id: "subscription-1",
      accountId: account.id,
    }),
  };
  const audit: AuditLog = { append: async () => undefined };
  const events: EventOutbox = {
    append: async (event) => {
      outbox.push(event);
    },
  };
  const transactions: FinancialTransactionRunner = {
    run: async (work) => work({ financial: repository, audit, events }),
  };
  return {
    service: createFinancialService({
      repository,
      transactions,
      clock: () => new Date("2026-02-18T15:00:00Z"),
    }),
    usageWindows,
    outbox,
  };
}

describe("financial allowances", () => {
  it("uses the UTC calendar-day boundary and emits usage", async () => {
    const t = setup({ allowance: 10n, used: 9n });
    await t.service.recordUsage({
      actor,
      audit: auditContext,
      userId: "user-1",
      entitlementKey: "ai.chat",
      quantity: 1n,
      idempotencyKey: "usage-key-1",
    });
    expect(t.usageWindows).toEqual([new Date("2026-02-18T00:00:00Z")]);
    expect(t.outbox).toEqual([
      expect.objectContaining({ type: "financial.usage.recorded" }),
    ]);
  });
  it("denies use above a finite period allowance", async () => {
    const t = setup({ allowance: 10n, used: 10n });
    await expect(
      t.service.recordUsage({
        actor,
        audit: auditContext,
        userId: "user-1",
        entitlementKey: "ai.chat",
        quantity: 1n,
        idempotencyKey: "usage-key-2",
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      details: {
        entitlementKey: "ai.chat",
        productId: "product-pro",
        priceId: "price-pro",
      },
    });
  });
  it("rejects an invalid rolling reset", async () => {
    const t = setup();
    await expect(
      t.service.registerEntitlementDefinition({
        ...definition,
        resetStrategy: "rolling",
        resetIntervalSeconds: null,
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
  });
  it("grants limits mapped to a selected price", async () => {
    const t = setup();
    await expect(
      t.service.grantForPrice({
        actor: manager,
        audit: auditContext,
        userId: "user-1",
        priceId: "price-pro",
        productId: "product-pro",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ key: "ai.chat", quantity: 100n }),
    ]);
  });
  it("maps an action-required payment event without treating it as cancellation", () => {
    expect(
      financialEventForProviderEvent("invoice.payment_action_required"),
    ).toBe("financial.dunning.action_required");
    expect(
      financialEventForProviderEvent("customer.subscription.deleted"),
    ).toBe("financial.subscription.canceled");
  });
  it("accepts only provider tokens and safe display metadata for a payment method", async () => {
    const t = setup();
    await expect(
      t.service.registerPaymentMethod({
        actor: manager,
        audit: auditContext,
        userId: "user-1",
        provider: "stripe",
        tokenReference: "pm_123",
        brand: "visa",
        last4: "4242",
        expiresMonth: 1,
        expiresYear: 2030,
      }),
    ).resolves.toMatchObject({ last4: "4242" });
    await expect(
      t.service.registerPaymentMethod({
        actor: manager,
        audit: auditContext,
        userId: "user-1",
        provider: "stripe",
        tokenReference: "pm_456",
        last4: "424",
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
  });
  it("does not allow a user to self-grant or mint wallet credit", async () => {
    const t = setup();
    await expect(
      t.service.grant({
        actor,
        audit: auditContext,
        userId: "user-1",
        key: "ai.chat",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      t.service.adjustWallet({
        actor,
        audit: auditContext,
        userId: "user-1",
        currency: "USD",
        amountMinor: 100n,
        type: "credit",
        idempotencyKey: "wallet-key-2",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not allow an adjustment to overdraw the wallet", async () => {
    const t = setup();
    await expect(
      t.service.adjustWallet({
        actor: manager,
        audit: auditContext,
        userId: "user-1",
        currency: "USD",
        amountMinor: -1n,
        type: "adjustment",
        idempotencyKey: "wallet-adjust-1",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });
  it("updates payment method display metadata without exposing its token", async () => {
    const t = setup();
    const method = await t.service.updatePaymentMethod({
      actor: manager,
      audit: auditContext,
      userId: "user-1",
      paymentMethodId: "payment-method-1",
      expiresMonth: 2,
    });
    expect(method).toMatchObject({ expiresMonth: 2 });
    expect(method).not.toHaveProperty("tokenReference");
  });
  it("scopes payment method reads to the owning user", async () => {
    const t = setup();
    expect(
      await t.service.getPaymentMethod({
        actor,
        userId: "user-1",
        id: "payment-method-1",
      }),
    ).not.toHaveProperty("tokenReference");
    await expect(
      t.service.getPaymentMethod({
        actor,
        userId: "user-2",
        id: "payment-method-1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("binds a stable account key through a manager and emits an event", async () => {
    const t = setup();
    await expect(
      t.service.bindAccountKey({
        actor: manager,
        audit: auditContext,
        userId: "user-1",
        key: "stripe.cus_1234",
      }),
    ).resolves.toEqual({ created: true });
    expect(t.outbox).toEqual([
      expect.objectContaining({ type: "financial.account-key.bound" }),
    ]);
  });
  it("records a reversal against the original usage period", async () => {
    const t = setup();
    await expect(
      t.service.reverseUsage({
        actor: manager,
        audit: auditContext,
        userId: "user-1",
        originalUsageId: "usage-original",
        quantity: 2n,
        idempotencyKey: "reversal-key-1",
      }),
    ).resolves.toMatchObject({
      quantity: -2n,
      reversalOfId: "usage-original",
      occurredAt: new Date("2026-02-18T10:00:00Z"),
    });
    expect(t.outbox).toEqual([
      expect.objectContaining({ type: "financial.usage.reversed" }),
    ]);
  });
  it("refuses a reversal larger than the original usage", async () => {
    const t = setup();
    await expect(
      t.service.reverseUsage({
        actor: manager,
        audit: auditContext,
        userId: "user-1",
        originalUsageId: "usage-original",
        quantity: 6n,
        idempotencyKey: "reversal-key-2",
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
  });
  it("does not mark a bound invoice paid through status-only synchronization", async () => {
    const t = setup();
    await expect(
      t.service.applyProviderEvent({
        actor: manager,
        audit: auditContext,
        event: {
          provider: "stripe",
          eventId: "evt_123456",
          type: "invoice.paid",
          occurredAt: new Date(),
          payloadReference: "evt_123456",
          objectId: "in_1",
        },
      }),
    ).resolves.toEqual({ created: true });
    expect(t.outbox).toEqual([
      expect.objectContaining({ type: "financial.provider-event.applied" }),
    ]);
  });
  it("does not assert local payment for an unbound provider event", async () => {
    const t = setup();
    await t.service.applyProviderEvent({
      actor: manager,
      audit: auditContext,
      event: {
        provider: "stripe",
        eventId: "evt_123457",
        type: "invoice.paid",
        occurredAt: new Date(),
        payloadReference: "evt_123457",
      },
    });
    expect(t.outbox).toEqual([
      expect.objectContaining({ type: "financial.provider-event.applied" }),
    ]);
  });
  it("rejects another user's usage and wallet changes", async () => {
    const t = setup();
    await expect(
      t.service.recordUsage({
        actor,
        audit: auditContext,
        userId: "user-2",
        entitlementKey: "ai.chat",
        quantity: 1n,
        idempotencyKey: "usage-key-3",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      t.service.adjustWallet({
        actor,
        audit: auditContext,
        userId: "user-2",
        currency: "USD",
        amountMinor: 100n,
        type: "credit",
        idempotencyKey: "wallet-key-1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Stripe webhook verification", () => {
  const adapter = new StripeAdapter({
    secretKey: "test",
    webhookSecret: "whsec_test",
    clock: () => new Date("2026-10-31T12:00:00Z"),
  });
  const rawBody = JSON.stringify({
    id: "evt_123456",
    type: "invoice.paid",
    created: 1793448000,
    data: { object: { id: "in_123", status: "paid" } },
  });
  const sign = (timestamp: number, body = rawBody) =>
    `t=${timestamp},v1=${createHmac("sha256", "whsec_test").update(`${timestamp}.${body}`).digest("hex")}`;
  it("accepts a current signature over the exact body", () => {
    expect(
      adapter.verify({
        headers: { "stripe-signature": sign(1793448000) },
        rawBody,
      }),
    ).toMatchObject({
      eventId: "evt_123456",
      objectId: "in_123",
      objectStatus: "paid",
    });
  });
  it("rejects stale, changed, and malformed notifications", () => {
    expect(() =>
      adapter.verify({
        headers: { "stripe-signature": sign(1793447000) },
        rawBody,
      }),
    ).toThrow();
    expect(() =>
      adapter.verify({
        headers: { "stripe-signature": sign(1793448000) },
        rawBody: `${rawBody} `,
      }),
    ).toThrow();
    expect(() =>
      adapter.verify({
        headers: { "stripe-signature": sign(1793448000, "{}") },
        rawBody: "{}",
      }),
    ).toThrow();
  });
});

describe("Stripe Checkout adapter", () => {
  it("rejects invalid money and non-HTTPS return URLs before contacting Stripe", async () => {
    let called = false;
    const adapter = new StripeAdapter({
      secretKey: "test",
      webhookSecret: "test",
      fetch: (async () => {
        called = true;
        throw new Error("unexpected call");
      }) as typeof fetch,
    });
    const input = {
      amount: { currency: "USD", amountMinor: 100n },
      accountKey: "stripe.cus_123",
      idempotencyKey: "checkout-123",
      description: "Course",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/cancel",
    };
    await expect(
      adapter.createOneOffCheckout({
        ...input,
        amount: { currency: "USD", amountMinor: 0n },
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
    await expect(
      adapter.createOneOffCheckout({
        ...input,
        successUrl: "http://example.com/ok",
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
    expect(called).toBe(false);
  });
});
