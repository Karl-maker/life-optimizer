import { describe, expect, it } from "vitest";
import type {
  AppleStoreAdapter,
  GooglePlayAdapter,
  StorePurchase,
  VerifiedStorePurchase,
} from "@edu-service/financial";
import { createApiServer } from "../src/index.js";

const userId = "00000000-0000-4000-8000-000000000001";
const observedAt = new Date("2026-10-31T12:00:00Z");
const verified: VerifiedStorePurchase = {
  provider: "apple",
  transactionId: "tx.1",
  originalTransactionId: "tx.1",
  tokenHash: null,
  accountKey: `iap.apple.${userId}`,
  sku: "course.gold",
  kind: "one_time",
  status: "active",
  environment: "sandbox",
  quantity: 1,
  currency: "USD",
  priceMilliunits: 1990n,
  purchasedAt: observedAt,
  expiresAt: null,
  observedAt,
};
const row: StorePurchase = {
  ...verified,
  id: "00000000-0000-4000-8000-000000000002",
  accountId: "00000000-0000-4000-8000-000000000003",
  mappingId: "00000000-0000-4000-8000-000000000004",
  priceId: "00000000-0000-4000-8000-000000000005",
  permanentlyRevoked: false,
  createdAt: observedAt,
};
function setup() {
  const seen: string[] = [];
  const service = {
    voidGoogleOrder: async ({ orderId }: { orderId: string }) => {
      seen.push(`void:${orderId}`);
      return { matched: true };
    },
    sync: async ({ purchase }: { purchase: VerifiedStorePurchase }) => {
      seen.push(`sync:${purchase.provider}`);
      return { purchase: row, created: true, granted: 1, revoked: 0 };
    },
    recordNotification: async () => ({ created: true }),
    listPurchases: async () => [row],
  };
  const apple = {
    verifyClientTransaction: async () => verified,
    verifyNotification: async () => ({
      eventId: "apple-event-1",
      type: "ONE_TIME_CHARGE",
      purchase: verified,
    }),
  } as unknown as AppleStoreAdapter;
  const google = {
    verifyProductToken: async () => ({
      ...verified,
      provider: "google" as const,
    }),
    verifySubscriptionToken: async () => ({
      ...verified,
      provider: "google" as const,
      kind: "subscription" as const,
    }),
    verifyNotification: async () => ({
      eventId: "google-event-1",
      type: "ONE_TIME_PRODUCT_1",
      purchase: { ...verified, provider: "google" },
      purchaseToken: "secret",
    }),
    acknowledge: async () => {
      seen.push("acknowledged");
    },
  } as unknown as GooglePlayAdapter;
  return { seen, service, apple, google };
}

describe("store purchase HTTP routes", () => {
  it("requires authentication for device claims and never returns a purchase token", async () => {
    const { service, apple } = setup();
    const app = await createApiServer({
      storePurchases: {
        service,
        apple,
        authenticator: {
          authenticate: async ({ bearerToken }) =>
            bearerToken === "valid"
              ? {
                  id: userId,
                  kind: "bearer",
                  permissions: ["financial:purchase"],
                }
              : null,
        },
        resolveUserId: (principal) => principal.id,
        webhookActor: {
          kind: "agent",
          agentId: "webhook",
          onBehalfOf: userId,
          permissions: ["financial:manage"],
        },
      },
    });
    const payload = { signedTransaction: "x".repeat(100) };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/store-purchases/apple/claim",
          payload,
        })
      ).statusCode,
    ).toBe(401);
    const claim = await app.inject({
      method: "POST",
      url: "/store-purchases/apple/claim",
      headers: { authorization: "Bearer valid" },
      payload,
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toEqual({
      purchaseId: row.id,
      status: "active",
      granted: 1,
      revoked: 0,
    });
    expect(claim.body).not.toContain("signedTransaction");
    const list = await app.inject({
      method: "GET",
      url: "/store-purchases?limit=2",
      headers: { authorization: "Bearer valid" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data[0]).toMatchObject({
      provider: "apple",
      sku: "course.gold",
      priceMilliunits: "1990",
    });
    expect(list.body).not.toContain("accountKey");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/store-purchases?cursor=broken",
          headers: { authorization: "Bearer valid" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/openapi.json" })).json().paths[
        "/store-purchases/apple/claim"
      ],
    ).toBeDefined();
    await app.close();
  });
  it("receives Apple and Google notifications through their verifier adapters", async () => {
    const { service, apple, google, seen } = setup();
    const app = await createApiServer({
      storePurchases: {
        service,
        apple,
        google,
        authenticator: { authenticate: async () => null },
        resolveUserId: () => null,
        webhookActor: {
          kind: "agent",
          agentId: "webhook",
          onBehalfOf: userId,
          permissions: ["financial:manage"],
        },
      },
    });
    const appleResult = await app.inject({
      method: "POST",
      url: "/webhooks/apple-app-store",
      payload: { signedPayload: "x".repeat(100) },
    });
    expect(appleResult.statusCode).toBe(200);
    const googleResult = await app.inject({
      method: "POST",
      url: "/webhooks/google-play",
      headers: { authorization: `Bearer ${"x".repeat(100)}` },
      payload: { message: { data: "e30=", messageId: "message-1" } },
    });
    expect(googleResult.statusCode).toBe(200);
    expect(seen).toEqual(["sync:apple", "sync:google", "acknowledged"]);
    expect(
      (await app.inject({ method: "GET", url: "/openapi.json" })).json().paths[
        "/webhooks/google-play"
      ],
    ).toBeDefined();
    await app.close();
  });
  it("routes an authenticated Google full void to the exact-order handler", async () => {
    const { service, seen } = setup();
    const google = {
      verifyNotification: async () => ({
        eventId: "void.1",
        type: "VOIDED_FULL",
        purchase: null,
        voided: { orderId: "GPA.1234", tokenHash: "a".repeat(64) },
      }),
    } as unknown as GooglePlayAdapter;
    const app = await createApiServer({
      storePurchases: {
        service,
        google,
        authenticator: { authenticate: async () => null },
        resolveUserId: () => null,
        webhookActor: {
          kind: "agent",
          agentId: "webhook",
          onBehalfOf: userId,
          permissions: ["financial:manage"],
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/google-play",
      headers: { authorization: `Bearer ${"x".repeat(100)}` },
      payload: { message: { data: "e30=", messageId: "message-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(seen).toEqual(["void:GPA.1234"]);
    await app.close();
  });
});
