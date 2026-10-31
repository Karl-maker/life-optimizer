import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StripeAdapter } from "../src/index.js";

function setup(responses: Record<string, unknown>[]) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const adapter = new StripeAdapter({
    secretKey: "sk_test_only",
    webhookSecret: "whsec_test_only",
    fetch: (async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    }) as typeof fetch,
  });
  return { adapter, requests };
}

describe("Stripe provider operations", () => {
  it("extracts only bounded refund fields from a signed snapshot event", () => {
    const at = new Date("2026-10-31T12:00:00Z");
    const adapter = new StripeAdapter({
      secretKey: "sk_test_only",
      webhookSecret: "whsec_test_only",
      clock: () => at,
    });
    const rawBody = JSON.stringify({
      id: "evt_12345",
      type: "refund.updated",
      created: Math.floor(at.getTime() / 1000),
      data: {
        object: {
          id: "re_12345",
          status: "succeeded",
          payment_intent: "pi_12345",
          amount: 500,
          currency: "usd",
        },
      },
    });
    const timestamp = String(Math.floor(at.getTime() / 1000));
    const digest = createHmac("sha256", "whsec_test_only")
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    expect(
      adapter.verify({
        headers: { "stripe-signature": `t=${timestamp},v1=${digest}` },
        rawBody,
      }),
    ).toMatchObject({
      type: "refund.updated",
      objectId: "re_12345",
      paymentReference: "pi_12345",
      amountMinor: 500n,
      currency: "USD",
      objectStatus: "succeeded",
    });
  });
  it("refunds a confirmed PaymentIntent amount with an idempotency key", async () => {
    const t = setup([
      {
        id: "re_12345",
        payment_intent: "pi_12345",
        amount: 500,
        currency: "usd",
        status: "succeeded",
      },
    ]);
    expect(
      await t.adapter.refundPayment({
        paymentIntentId: "pi_12345",
        amountMinor: 500n,
        currency: "USD",
        idempotencyKey: "refund-order-1",
        reason: "requested_by_customer",
      }),
    ).toEqual({ providerReference: "re_12345", status: "succeeded" });
    expect(t.requests[0]?.url).toBe("https://api.stripe.com/v1/refunds");
    expect(
      (t.requests[0]?.init?.headers as Record<string, string>)[
        "idempotency-key"
      ],
    ).toBe("refund-order-1");
    expect(String(t.requests[0]?.init?.body)).toContain(
      "payment_intent=pi_12345",
    );
  });
  it("checks method ownership before detach and verifies the provider result", async () => {
    const t = setup([{ id: "pm_12345", customer: "cus_other" }]);
    await expect(
      t.adapter.detachPaymentMethod({
        customerId: "cus_12345",
        paymentMethodId: "pm_12345",
      }),
    ).rejects.toThrow();
    expect(t.requests).toHaveLength(1);
    const good = setup([
      { id: "pm_12345", customer: "cus_12345" },
      { id: "pm_12345", customer: null },
    ]);
    expect(
      await good.adapter.detachPaymentMethod({
        customerId: "cus_12345",
        paymentMethodId: "pm_12345",
      }),
    ).toEqual({ providerReference: "pm_12345" });
    expect(good.requests[1]?.url).toBe(
      "https://api.stripe.com/v1/payment_methods/pm_12345/detach",
    );
  });
  it("selects the attached customer's default method and rejects a mismatched response", async () => {
    const t = setup([
      { id: "pm_12345", customer: "cus_12345" },
      {
        id: "cus_12345",
        invoice_settings: { default_payment_method: "pm_12345" },
      },
    ]);
    await t.adapter.setDefaultPaymentMethod({
      customerId: "cus_12345",
      paymentMethodId: "pm_12345",
    });
    expect(String(t.requests[1]?.init?.body)).toContain(
      "invoice_settings%5Bdefault_payment_method%5D=pm_12345",
    );
    const bad = setup([
      { id: "pm_12345", customer: "cus_12345" },
      {
        id: "cus_12345",
        invoice_settings: { default_payment_method: "pm_other" },
      },
    ]);
    await expect(
      bad.adapter.setDefaultPaymentMethod({
        customerId: "cus_12345",
        paymentMethodId: "pm_12345",
      }),
    ).rejects.toThrow();
  });
});
