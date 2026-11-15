import { describe, expect, it } from "vitest";
import type {
  Actor,
  AuditContext,
  AuditLog,
  EventOutbox,
} from "@life-optimizer/core";
import {
  createBillingService,
  type BillingCoupon,
  type BillingInvoice,
  type BillingPayment,
  type BillingRefund,
  type BillingSubscription,
  type BillingRepository,
  type BillingTransactionRunner,
  type FinancialRepository,
} from "../src/index.js";

const actor: Actor = {
  kind: "agent",
  agentId: "billing-worker",
  onBehalfOf: "00000000-0000-4000-8000-000000000001",
  permissions: ["financial:manage"],
};
const audit: AuditContext = {
  correlationId: "billing-test",
  source: "api",
  actorSource: "service",
};
const userId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-31T12:00:00.000Z");
const price = {
  id: "price-1",
  productId: "product-1",
  currency: "USD",
  unitAmountMinor: 1000n,
  frequency: "one_time" as const,
  intervalCount: 1,
  trialDays: 0,
  active: true,
  productName: "Course",
  productActive: true,
  productRiskLevel: "low" as const,
};

function setup(
  options: {
    free?: boolean;
    recurring?: boolean;
    blocked?: boolean;
    trialDays?: number;
  } = {},
) {
  const invoices = new Map<string, BillingInvoice>();
  const payments = new Map<string, BillingPayment>();
  const refunds = new Map<string, BillingRefund>();
  const subscriptions = new Map<string, BillingSubscription>();
  let currentTime = now;
  let defaultMethodId: string | null = null;
  const events: string[] = [];
  const audits: string[] = [];
  const grants: {
    id: string;
    invoiceId?: string | null;
    revokedAt: Date | null;
  }[] = [];
  const coupon: BillingCoupon = {
    id: "coupon-1",
    code: "SAVETEN1",
    percentOff: 10,
    amountOffMinor: null,
    currency: null,
    productId: null,
    maxRedemptions: 1,
    redeemBy: null,
    active: true,
  };
  let redemptions = 0;
  const providerEvents = new Set<string>();
  const dunning = new Map<
    string,
    {
      invoiceId: string;
      attemptNumber: number;
      status: string;
      nextAttemptAt: Date | null;
    }
  >();
  const billing = {
    findPrice: async () => ({
      ...price,
      unitAmountMinor: options.free ? 0n : price.unitAmountMinor,
      frequency: options.recurring ? ("month" as const) : price.frequency,
      trialDays: options.trialDays ?? 0,
      productRiskLevel: options.blocked
        ? ("blocked" as const)
        : price.productRiskLevel,
    }),
    findSubscription: async (id: string) =>
      subscriptions.get(id) ??
      (options.recurring && id === "sub-0001"
        ? {
            id,
            accountId: "account-1",
            productId: "product-1",
            priceId: "price-1",
            provider: null,
            providerReference: null,
            status: "active",
            trialEndsAt: null,
            currentPeriodStartsAt: new Date("2026-09-30T12:00:00Z"),
            currentPeriodEndsAt: now,
            cancelAtPeriodEnd: false,
            canceledAt: null,
          }
        : null),
    createSubscription: async (value: BillingSubscription) => {
      subscriptions.set(value.id, value);
      return value;
    },
    hasHadTrial: async (accountId: string, productId: string) =>
      [...subscriptions.values()].some(
        (value) =>
          value.accountId === accountId &&
          value.productId === productId &&
          value.trialEndsAt !== null,
      ),
    updateSubscription: async (
      id: string,
      update: Partial<BillingSubscription>,
    ) => {
      const prior = subscriptions.get(id)!;
      const next = { ...prior, ...update };
      subscriptions.set(id, next);
      return next;
    },
    findCoupon: async (code: string) => (code === coupon.code ? coupon : null),
    createCoupon: async (value: BillingCoupon) => value,
    countCouponRedemptions: async () => redemptions,
    findInvoiceByKey: async (key: string) =>
      [...invoices.values()].find((value) => value.idempotencyKey === key) ??
      null,
    findInvoice: async (id: string) => invoices.get(id) ?? null,
    findInvoiceByProviderReference: async (
      provider: string,
      reference: string,
    ) =>
      [...invoices.values()].find(
        (value) =>
          value.provider === provider && value.providerReference === reference,
      ) ?? null,
    createInvoice: async (value: BillingInvoice, redemption: unknown) => {
      invoices.set(value.id, value);
      if (redemption) redemptions++;
      return value;
    },
    bindInvoiceProvider: async (
      id: string,
      provider: string,
      reference: string,
    ) => {
      const value = invoices.get(id)!;
      const bound = { ...value, provider, providerReference: reference };
      invoices.set(id, bound);
      return bound;
    },
    recordPayment: async (value: BillingPayment) => {
      const prior = [...payments.values()].find(
        (p) =>
          p.provider === value.provider &&
          p.providerReference === value.providerReference,
      );
      if (prior) return { payment: prior, created: false };
      payments.set(value.id, value);
      return { payment: value, created: true };
    },
    paidTotal: async (id: string) =>
      [...payments.values()]
        .filter((value) => value.invoiceId === id)
        .reduce((sum, value) => sum + value.amountMinor, 0n),
    markInvoicePaid: async (id: string, at: Date) => {
      const value = invoices.get(id)!;
      if (value.status === "paid") return false;
      invoices.set(id, { ...value, status: "paid", paidAt: at });
      return true;
    },
    findPayment: async (id: string) => payments.get(id) ?? null,
    findPaymentByProviderReference: async (
      provider: string,
      reference: string,
    ) =>
      [...payments.values()].find(
        (value) =>
          value.provider === provider && value.providerReference === reference,
      ) ?? null,
    refundedTotal: async (id: string) =>
      [...refunds.values()]
        .filter((value) => value.paymentId === id)
        .reduce((sum, value) => sum + value.amountMinor, 0n),
    refundedTotalForInvoice: async (id: string) =>
      [...refunds.values()]
        .filter((value) =>
          [...payments.values()].some(
            (payment) =>
              payment.id === value.paymentId && payment.invoiceId === id,
          ),
        )
        .reduce((sum, value) => sum + value.amountMinor, 0n),
    findRefundByProviderReference: async (
      provider: string,
      reference: string,
    ) =>
      [...refunds.values()].find(
        (value) =>
          value.provider === provider && value.providerReference === reference,
      ) ?? null,
    recordRefund: async (value: BillingRefund) => {
      refunds.set(value.id, value);
      return { refund: value, created: true };
    },
    listEntitlementsForInvoice: async (id: string) =>
      grants
        .filter((value) => value.invoiceId === id)
        .map((value) => ({
          ...value,
          accountId: "account-1",
          key: "course.access",
          quantity: null,
          startsAt: now,
          endsAt: null,
          productId: "product-1",
          priceId: "price-1",
        })),
    findDunningByProviderEventId: async (id: string) => dunning.get(id) ?? null,
    countDunningAttempts: async (id: string) =>
      [...dunning.values()].filter((value) => value.invoiceId === id).length,
    recordDunning: async (value: {
      invoiceId: string;
      attemptNumber: number;
      status: string;
      nextAttemptAt: Date | null;
      providerEventId: string;
    }) => {
      if (dunning.has(value.providerEventId)) return false;
      dunning.set(value.providerEventId, value);
      return true;
    },
    findPaymentMethodByProviderReference: async () => ({
      id: "method-1",
      accountId: "account-1",
    }),
    setDefaultPaymentMethod: async (
      _accountId: string,
      methodId: string | null,
    ) => {
      defaultMethodId = methodId;
    },
    markPaymentMethodDetached: async () => {
      defaultMethodId = null;
      return true;
    },
  } as unknown as BillingRepository;
  const financial = {
    ensureAccount: async () => ({ id: "account-1", userId }),
    findPaymentMethod: async (_accountId: string, id: string) =>
      id === "method-1"
        ? {
            id,
            accountId: "account-1",
            provider: "stripe",
            tokenReference: "pm_12345",
            brand: "visa",
            last4: "4242",
            expiresMonth: 12,
            expiresYear: 2030,
            revokedAt: null,
            createdAt: now,
          }
        : null,
    recordProviderEvent: async (event: { eventId: string }) => {
      if (providerEvents.has(event.eventId)) return false;
      providerEvents.add(event.eventId);
      return true;
    },
    listPriceEntitlements: async () => [
      { priceId: "price-1", entitlementKey: "course.access", quantity: null },
    ],
    grantEntitlement: async (input: { invoiceId?: string | null }) => {
      const value = {
        id: `grant-${grants.length + 1}`,
        invoiceId: input.invoiceId ?? null,
        revokedAt: null,
      };
      grants.push(value);
      return {
        ...input,
        ...value,
        accountId: "account-1",
        key: "course.access",
        quantity: null,
        startsAt: now,
        endsAt: null,
        productId: "product-1",
        priceId: "price-1",
      };
    },
    revokeEntitlement: async (id: string, at: Date) => {
      const value = grants.find((grant) => grant.id === id)!;
      value.revokedAt = at;
      return {
        ...value,
        accountId: "account-1",
        key: "course.access",
        quantity: null,
        startsAt: now,
        endsAt: null,
        productId: "product-1",
        priceId: "price-1",
      };
    },
  } as unknown as FinancialRepository;
  const auditPort: AuditLog = {
    append: async (value) => {
      audits.push(value.action);
    },
  };
  const eventPort: EventOutbox = {
    append: async (value) => {
      events.push(value.type);
    },
  };
  const transactions: BillingTransactionRunner = {
    run: async (work) =>
      work({ billing, financial, audit: auditPort, events: eventPort }),
  };
  return {
    service: createBillingService({
      repository: billing,
      transactions,
      clock: () => currentTime,
    }),
    invoices,
    payments,
    refunds,
    grants,
    events,
    audits,
    dunning,
    subscriptions,
    advanceTo: (at: Date) => {
      currentTime = at;
    },
    get defaultMethodId() {
      return defaultMethodId;
    },
  };
}

describe("billing ledger and fulfillment", () => {
  it("snapshots discount and tax, deduplicates issuance, and fulfills only after full payment", async () => {
    const state = setup();
    const input = {
      actor,
      audit,
      userId,
      idempotencyKey: "order-0001",
      lines: [{ priceId: price.id, quantity: 2n, taxRateBps: 750 }],
      couponCode: "SAVETEN1",
    };
    const invoice = await state.service.issueInvoice(input);
    expect(invoice.lines[0]).toMatchObject({
      subtotalMinor: 2000n,
      discountMinor: 200n,
      taxMinor: 135n,
      totalMinor: 1935n,
    });
    expect((await state.service.issueInvoice(input)).id).toBe(invoice.id);
    await state.service.bindInvoiceProvider({
      actor,
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "checkout-0001",
    });
    const paymentInput = {
      actor,
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "charge-0001",
      amountMinor: 1935n,
      currency: "USD",
      occurredAt: now,
    };
    expect((await state.service.recordPayment(paymentInput)).fulfilled).toBe(
      true,
    );
    expect((await state.service.recordPayment(paymentInput)).fulfilled).toBe(
      false,
    );
    expect(state.grants).toHaveLength(1);
    expect(state.events).toContain("financial.fulfillment.completed");
    expect(state.audits).toContain("financial.invoice.paid_local");
  });

  it("records a refund once, issues a credit note, and revokes paid access on full refund", async () => {
    const state = setup();
    const invoice = await state.service.issueInvoice({
      actor,
      audit,
      userId,
      idempotencyKey: "order-0002",
      lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 0 }],
    });
    await state.service.bindInvoiceProvider({
      actor,
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "checkout-0002",
    });
    await state.service.recordPayment({
      actor,
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "charge-0002",
      amountMinor: 1000n,
      currency: "USD",
      occurredAt: now,
    });
    const paymentId = [...state.payments.keys()][0]!;
    const request = {
      actor,
      audit,
      userId,
      paymentId,
      providerReference: "refund-0002",
      amountMinor: 1000n,
      reason: "Customer requested refund",
      revokeAccess: true,
      occurredAt: now,
    };
    const result = await state.service.recordRefund(request);
    expect((await state.service.recordRefund(request)).id).toBe(result.id);
    expect(state.refunds).toHaveProperty("size", 1);
    expect(state.grants[0]?.revokedAt).toEqual(now);
    expect(state.events).toContain("financial.credit_note.issued");
  });

  it("rejects malformed tax and cross-account payment access", async () => {
    const state = setup();
    await expect(
      state.service.issueInvoice({
        actor,
        audit,
        userId,
        idempotencyKey: "order-0003",
        lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 10_001 }],
      }),
    ).rejects.toThrow();
    const invoice = await state.service.issueInvoice({
      actor,
      audit,
      userId,
      idempotencyKey: "order-0004",
      lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 0 }],
    });
    await expect(
      state.service.recordPayment({
        actor: { ...actor, onBehalfOf: "other-user" },
        audit,
        userId,
        invoiceId: invoice.id,
        provider: "stripe",
        providerReference: "charge-0004",
        amountMinor: 1000n,
        currency: "USD",
        occurredAt: now,
      }),
    ).rejects.toThrow();
  });

  it("refuses to invoice a blocked-risk product", async () => {
    const state = setup({ blocked: true });
    await expect(
      state.service.issueInvoice({
        actor,
        audit,
        userId,
        idempotencyKey: "order-0007",
        lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 0 }],
      }),
    ).rejects.toThrow();
  });

  it("fulfills a zero total invoice once without a provider charge", async () => {
    const state = setup({ free: true });
    const request = {
      actor,
      audit,
      userId,
      idempotencyKey: "order-0005",
      lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 0 }],
    };
    const invoice = await state.service.issueInvoice(request);
    expect(invoice.totalMinor).toBe(0n);
    await state.service.issueInvoice(request);
    expect(state.grants).toHaveLength(1);
    expect(state.events).toContain("financial.fulfillment.completed");
  });

  it("settles a signed Stripe checkout event in the same ledger and deduplicates delivery", async () => {
    const state = setup();
    const invoice = await state.service.issueInvoice({
      actor,
      audit,
      userId,
      idempotencyKey: "order-0006",
      lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 0 }],
    });
    await state.service.bindInvoiceProvider({
      actor,
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "cs_test_1234",
    });
    const event = {
      provider: "stripe",
      eventId: "evt_1234",
      type: "checkout.session.completed",
      occurredAt: now,
      payloadReference: "evt_1234",
      objectId: "cs_test_1234",
      paymentStatus: "paid",
      amountMinor: 1000n,
      currency: "USD",
      paymentReference: "pi_1234",
    };
    expect(
      await state.service.applyProviderEvent({ actor, audit, event }),
    ).toEqual({ created: true, fulfilled: true });
    expect(
      await state.service.applyProviderEvent({ actor, audit, event }),
    ).toEqual({ created: false, fulfilled: false });
    expect(state.payments.size).toBe(1);
    expect(state.grants).toHaveLength(1);
  });

  it("retains an incomplete Stripe invoice event for reconciliation without granting access", async () => {
    const state = setup();
    const invoice = await state.service.issueInvoice({
      actor,
      audit,
      userId,
      idempotencyKey: "order-0009",
      lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 0 }],
    });
    await state.service.bindInvoiceProvider({
      actor,
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "in_1234",
    });
    const event = {
      provider: "stripe",
      eventId: "evt_1235",
      type: "invoice.paid",
      occurredAt: now,
      payloadReference: "evt_1235",
      objectId: "in_1234",
      amountMinor: 1000n,
      currency: "USD",
    };
    expect(
      await state.service.applyProviderEvent({ actor, audit, event }),
    ).toEqual({ created: true, fulfilled: false });
    expect(state.grants).toHaveLength(0);
  });

  it("issues one renewal with a clamped UTC calendar month period", async () => {
    const state = setup({ recurring: true });
    const request = {
      actor,
      audit,
      userId,
      subscriptionId: "sub-0001",
      taxRateBps: 0,
    };
    const invoice = await state.service.issueRenewalInvoice(request);
    expect(invoice.lines[0]?.serviceStartsAt).toEqual(now);
    expect(invoice.lines[0]?.serviceEndsAt).toEqual(
      new Date("2026-11-30T12:00:00Z"),
    );
    expect((await state.service.issueRenewalInvoice(request)).id).toBe(
      invoice.id,
    );
  });

  it("records customer action instead of exhaustion and deduplicates a failed event", async () => {
    const state = setup();
    const invoice = await state.service.issueInvoice({
      actor,
      audit,
      userId,
      idempotencyKey: "order-0008",
      lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 0 }],
    });
    const input = {
      actor,
      audit,
      userId,
      invoiceId: invoice.id,
      providerEventId: "evt_failure_1234",
      failureCategory: "payment_failed",
      requiresCustomerAction: true,
      schedule: { delaysSeconds: [] as number[], graceSeconds: 0 },
    };
    expect(await state.service.recordDunningFailure(input)).toMatchObject({
      attemptNumber: 1,
      status: "action_required",
      created: true,
    });
    expect(await state.service.recordDunningFailure(input)).toMatchObject({
      attemptNumber: 1,
      status: "action_required",
      created: false,
    });
    expect(state.dunning.size).toBe(1);
    expect(state.events).toContain(
      "financial.dunning.action_required_recorded",
    );
  });
  it("grants a first trial once and completes a scheduled cancellation at its end", async () => {
    const state = setup({ recurring: true, trialDays: 7 });
    const first = await state.service.startSubscription({
      actor,
      audit,
      userId,
      priceId: price.id,
    });
    expect(first.status).toBe("trialing");
    expect(state.grants).toHaveLength(1);
    const second = await state.service.startSubscription({
      actor,
      audit,
      userId,
      priceId: price.id,
    });
    expect(second.status).toBe("incomplete");
    expect(state.grants).toHaveLength(1);
    await state.service.cancelSubscription({
      actor,
      audit,
      userId,
      subscriptionId: first.id,
    });
    await expect(
      state.service.finishSubscription({
        actor,
        audit,
        userId,
        subscriptionId: first.id,
      }),
    ).rejects.toThrow();
    state.advanceTo(new Date("2026-11-08T12:00:00Z"));
    expect(
      (
        await state.service.finishSubscription({
          actor,
          audit,
          userId,
          subscriptionId: first.id,
        })
      ).status,
    ).toBe("canceled");
    expect(state.events).toContain("financial.subscription.canceled_local");
  });
  it("selects and clears a local default method after confirmed detach", async () => {
    const state = setup();
    await state.service.setDefaultPaymentMethod({
      actor,
      audit,
      userId,
      paymentMethodId: "method-1",
    });
    expect(state.defaultMethodId).toBe("method-1");
    await state.service.markPaymentMethodDetached({
      actor,
      audit,
      userId,
      paymentMethodId: "method-1",
    });
    expect(state.defaultMethodId).toBeNull();
    expect(state.events).toContain(
      "financial.payment_method.provider_detached",
    );
  });
  it("generates opaque coupon codes and rejects invalid discount combinations", async () => {
    const state = setup();
    const generated = await state.service.createCoupon({
      actor,
      audit,
      percentOff: 25,
    });
    expect(generated.code).toMatch(/^[A-Z0-9_-]{8,64}$/);
    await expect(
      state.service.createCoupon({
        actor,
        audit,
        code: "TOOSHORT",
        percentOff: 10,
        amountOffMinor: 100n,
        currency: "USD",
      }),
    ).rejects.toThrow();
  });
  it("reconciles a succeeded Stripe refund and method detach with ledger events", async () => {
    const state = setup();
    const invoice = await state.service.issueInvoice({
      actor,
      audit,
      userId,
      idempotencyKey: "order-0010",
      lines: [{ priceId: price.id, quantity: 1n, taxRateBps: 0 }],
    });
    await state.service.bindInvoiceProvider({
      actor,
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "cs_test_1000",
    });
    await state.service.recordPayment({
      actor,
      audit,
      userId,
      invoiceId: invoice.id,
      provider: "stripe",
      providerReference: "pi_10000",
      amountMinor: 1000n,
      currency: "USD",
      occurredAt: now,
    });
    const event = {
      provider: "stripe",
      eventId: "evt_refund_1000",
      type: "refund.updated",
      occurredAt: now,
      payloadReference: "evt_refund_1000",
      objectId: "re_10000",
      objectStatus: "succeeded",
      paymentReference: "pi_10000",
      amountMinor: 1000n,
      currency: "USD",
    };
    expect(
      await state.service.applyProviderEvent({
        actor,
        audit,
        event,
        revokeOnFullRefund: true,
      }),
    ).toEqual({ created: true, fulfilled: false });
    expect(state.refunds.size).toBe(1);
    expect(state.grants[0]?.revokedAt).toEqual(now);
    await state.service.applyProviderEvent({
      actor,
      audit,
      event: {
        provider: "stripe",
        eventId: "evt_detach_1000",
        type: "payment_method.detached",
        occurredAt: now,
        payloadReference: "evt_detach_1000",
        objectId: "pm_10000",
      },
    });
    expect(state.events).toContain(
      "financial.payment_method.provider_detached",
    );
  });
});
