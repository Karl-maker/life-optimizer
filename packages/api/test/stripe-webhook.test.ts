import { describe, expect, it } from "vitest";
import { createApiServer } from "../src/index.js";

describe("Stripe webhook route", () => {
  it("passes the exact signed JSON bytes to the verifier and documents the route", async () => {
    const seen: string[] = [];
    const body = '{ "id": "evt_123456", "data": {"object": {"id": "in_1"}} }';
    const app = await createApiServer({
      stripeWebhook: {
        actor: { kind: "user", userId: "service" },
        verifier: {
          verify: ({ rawBody }) => {
            seen.push(rawBody);
            return {
              provider: "stripe",
              eventId: "evt_123456",
              type: "invoice.paid",
              occurredAt: new Date(),
              payloadReference: "evt_123456",
            };
          },
        },
        sync: { applyProviderEvent: async () => ({ created: true }) },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "test",
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(seen).toEqual([body]);
    const openapi = (
      await app.inject({ method: "GET", url: "/openapi.json" })
    ).json();
    expect(openapi.paths["/v1/webhooks/stripe"]).toBeDefined();
    await app.close();
  });

  it("rejects unsigned notifications before synchronization", async () => {
    let applied = false;
    const app = await createApiServer({
      stripeWebhook: {
        actor: { kind: "user", userId: "service" },
        verifier: {
          verify: () => {
            throw Object.assign(
              new Error("Invalid payment provider notification."),
              { statusCode: 400 },
            );
          },
        },
        sync: {
          applyProviderEvent: async () => {
            applied = true;
            return { created: true };
          },
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "bad",
      },
      payload: "{}",
    });
    expect(response.statusCode).toBe(400);
    expect(applied).toBe(false);
    await app.close();
  });
});
