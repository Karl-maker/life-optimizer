import { describe, expect, it } from "vitest";
import {
  createPowerTranzCheckout,
  PowerTranzAdapter,
  type PowerTranzPendingSale,
  type PowerTranzSaleRepository,
} from "../src/index.js";

const userId = "00000000-0000-4000-8000-000000000001";
const invoiceId = "00000000-0000-4000-8000-000000000002";
const actor = {
  kind: "agent" as const,
  agentId: "payments",
  onBehalfOf: userId,
  permissions: ["financial:manage" as const],
};
const audit = {
  correlationId: "pt-test",
  source: "api" as const,
  actorSource: "service" as const,
};
const now = new Date("2026-10-31T12:00:00Z");

function setup(options: { owner?: string } = {}) {
  let sale: PowerTranzPendingSale | null = null;
  let paymentCalls = 0;
  let fulfilled = 0;
  let bound = 0;
  let dunning = 0;
  const repository: PowerTranzSaleRepository = {
    create: async (value) => {
      sale = value;
    },
    findByTokenHash: async (hash) => (sale?.tokenHash === hash ? sale : null),
    claim: async (id, at) => {
      if (!sale || sale.id !== id || sale.status !== "pending") return false;
      sale = { ...sale, status: "processing", processingStartedAt: at };
      return true;
    },
    setStatus: async (_id, status) => {
      sale = { ...sale!, status };
    },
  };
  const adapter = new PowerTranzAdapter({
    baseUrl: "https://staging.ptranz.com/Api",
    merchantId: "merchant",
    merchantPassword: "secret",
    pageSet: "PTZ/Hosted",
    pageName: "Pay",
    currency: "USD",
    numericCurrencyCode: "840",
    currencyExponent: 2,
    clock: () => now,
    fetch: (async (_url, init) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      if (typeof body === "string") {
        paymentCalls++;
        return new Response(
          JSON.stringify({
            TransactionIdentifier: sale!.transactionIdentifier,
            OrderIdentifier: invoiceId,
            TotalAmount: 10,
            CurrencyCode: "840",
            Approved: true,
            IsoResponseCode: "00",
          }),
        );
      }
      return new Response(
        JSON.stringify({
          TransactionIdentifier: body.TransactionIdentifier,
          OrderIdentifier: body.OrderIdentifier,
          TotalAmount: body.TotalAmount,
          CurrencyCode: body.CurrencyCode,
          Approved: false,
          IsoResponseCode: "SP4",
          SpiToken: "spi-token-1234",
          RedirectData: "<form></form>",
        }),
      );
    }) as typeof fetch,
  });
  const checkout = createPowerTranzCheckout({
    adapter,
    repository,
    agentId: "payments",
    clock: () => now,
    billing: {
      bindInvoiceProvider: async () => {
        bound++;
        return {} as never;
      },
      recordPayment: async () => {
        fulfilled++;
        return {} as never;
      },
      recordDunningFailure: async () => {
        dunning++;
        return {} as never;
      },
    },
    findAccountById: async () => ({ userId: options.owner ?? userId }),
    findInvoice: async () => ({
      id: invoiceId,
      accountId: "account",
      idempotencyKey: "order",
      currency: "USD",
      subtotalMinor: 1000n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 1000n,
      status: "open",
      provider: null,
      providerReference: null,
      subscriptionId: null,
      dueAt: null,
      issuedAt: now,
      paidAt: null,
      lines: [],
    }),
  });
  return {
    checkout,
    get sale() {
      return sale;
    },
    get paymentCalls() {
      return paymentCalls;
    },
    get fulfilled() {
      return fulfilled;
    },
    get bound() {
      return bound;
    },
    get dunning() {
      return dunning;
    },
  };
}

describe("PowerTranz checkout orchestration", () => {
  it("stores a token hash, binds the invoice, and settles after server-side approval once", async () => {
    const t = setup();
    const started = await t.checkout.begin({
      actor,
      audit,
      userId,
      invoiceId,
      merchantResponseUrl: "https://example.com/v1/webhooks/powertranz",
      threeDSecure: true,
    });
    expect(started.redirectData).toBe("<form></form>");
    expect(t.sale?.tokenHash).not.toBe("spi-token-1234");
    expect(t.bound).toBe(1);
    const callback = {
      TransactionIdentifier: started.transactionIdentifier,
      OrderIdentifier: invoiceId,
      TotalAmount: 10,
      CurrencyCode: "840",
      SpiToken: "spi-token-1234",
      IsoResponseCode: "3D0",
      RiskManagement: {
        ThreeDSecure: { AuthenticationStatus: "Y", Eci: "05", Cavv: "test" },
      },
    };
    expect(
      await t.checkout.complete({ audit, browserResult: callback }),
    ).toEqual({ status: "completed" });
    expect(
      await t.checkout.complete({ audit, browserResult: callback }),
    ).toEqual({ status: "completed" });
    expect(t.paymentCalls).toBe(1);
    expect(t.fulfilled).toBe(1);
  });

  it("rejects an unknown callback without charging", async () => {
    const t = setup();
    await expect(
      t.checkout.complete({
        audit,
        browserResult: { SpiToken: "unknown-token" },
      }),
    ).rejects.toThrow();
    expect(t.paymentCalls).toBe(0);
  });
  it("records failed 3DS as customer action without posting the SPI payment", async () => {
    const t = setup();
    const started = await t.checkout.begin({
      actor,
      audit,
      userId,
      invoiceId,
      merchantResponseUrl: "https://example.com/v1/webhooks/powertranz",
      threeDSecure: true,
    });
    const callback = {
      TransactionIdentifier: started.transactionIdentifier,
      OrderIdentifier: invoiceId,
      TotalAmount: 10,
      CurrencyCode: "840",
      SpiToken: "spi-token-1234",
      IsoResponseCode: "3D0",
      RiskManagement: {
        ThreeDSecure: { AuthenticationStatus: "N", Eci: "05", Cavv: "test" },
      },
    };
    expect(
      await t.checkout.complete({ audit, browserResult: callback }),
    ).toEqual({ status: "declined" });
    expect(t.paymentCalls).toBe(0);
    expect(t.dunning).toBe(1);
  });
  it("rejects another user's invoice before contacting the provider", async () => {
    const t = setup({ owner: "another-user" });
    await expect(
      t.checkout.begin({
        actor,
        audit,
        userId,
        invoiceId,
        merchantResponseUrl: "https://example.com/v1/webhooks/powertranz",
        threeDSecure: true,
      }),
    ).rejects.toThrow();
    expect(t.sale).toBeNull();
    expect(t.bound).toBe(0);
  });
});
