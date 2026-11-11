import { describe, expect, it } from "vitest";
import type { GoogleAuth, OAuth2Client } from "google-auth-library";
import {
  AppleStoreAdapter,
  GooglePlayAdapter,
  readStoreProviderConfiguration,
} from "../src/index.js";

const product = {
  productLineItem: [
    { productId: "course.gold", productOfferDetails: { quantity: 1 } },
  ],
  purchaseStateContext: { purchaseState: "PURCHASED" },
  orderId: "GPA.1234",
  obfuscatedExternalAccountId: "account-1",
  purchaseCompletionTime: "2026-10-31T12:00:00Z",
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
};
function google(options: { verified?: boolean; state?: object } = {}) {
  const requests: string[] = [];
  const auth = {
    getClient: async () => ({
      request: async ({ url }: { url: string }) => {
        requests.push(url);
        return { data: options.state ?? product };
      },
    }),
  } as unknown as GoogleAuth;
  const verifier = {
    verifyIdToken: async () => {
      if (options.verified === false) throw new Error("bad signature");
      return {
        getPayload: () => ({
          email: "push@example.iam.gserviceaccount.com",
          email_verified: true,
        }),
      };
    },
  } as unknown as OAuth2Client;
  return {
    adapter: new GooglePlayAdapter({
      packageName: "com.example.edu",
      pubsubAudience: "https://api.example.com/webhooks/google-play",
      pubsubServiceAccountEmail: "push@example.iam.gserviceaccount.com",
      auth,
      tokenVerifier: verifier,
      clock: () => new Date("2026-10-31T12:01:00Z"),
    }),
    requests,
  };
}
const push = (value: object) => ({
  message: {
    messageId: "msg-1",
    data: Buffer.from(JSON.stringify(value)).toString("base64"),
  },
});
const authorization = `Bearer ${"x".repeat(100)}`;

describe("store verification adapters", () => {
  it("uses Play Developer API state after authenticating a Pub/Sub push", async () => {
    const { adapter, requests } = google();
    const result = await adapter.verifyNotification(
      authorization,
      push({
        packageName: "com.example.edu",
        oneTimeProductNotification: {
          notificationType: 1,
          purchaseToken: "secret-token",
          sku: "course.gold",
        },
      }),
    );
    expect(result.purchase).toMatchObject({
      provider: "google",
      transactionId: "GPA.1234",
      sku: "course.gold",
      status: "active",
      accountKey: "iap.google.account-1",
    });
    expect(result.purchase?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(requests[0]).toContain("productsv2/tokens/secret-token");
    await adapter.acknowledge(result.purchase!, "secret-token");
    expect(requests.at(-1)).toContain(":acknowledge");
  });
  it("rejects unsigned pushes, wrong packages and pending purchases without a grantable state", async () => {
    const { adapter } = google({ verified: false });
    await expect(
      adapter.verifyNotification(
        authorization,
        push({ packageName: "com.example.edu", testNotification: {} }),
      ),
    ).rejects.toHaveProperty("statusCode", 400);
    const valid = google().adapter;
    await expect(
      valid.verifyNotification(
        authorization,
        push({ packageName: "com.other.app", testNotification: {} }),
      ),
    ).rejects.toHaveProperty("statusCode", 400);
    const pending = google({
      state: {
        ...product,
        orderId: undefined,
        purchaseStateContext: { purchaseState: "PENDING" },
      },
    }).adapter;
    expect((await pending.verifyProductToken("secret-token")).status).toBe(
      "pending",
    );
  });
  it("identifies the exact voided Play order without relying on the latest subscription order", async () => {
    const { adapter, requests } = google();
    const notice = await adapter.verifyNotification(
      authorization,
      push({
        packageName: "com.example.edu",
        voidedPurchaseNotification: {
          purchaseToken: "secret-token",
          orderId: "GPA.old-order",
          productType: 1,
          refundType: 1,
        },
      }),
    );
    expect(notice).toMatchObject({
      type: "VOIDED_FULL",
      purchase: null,
      voided: { orderId: "GPA.old-order" },
    });
    expect(notice.voided?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(requests).toEqual([]);
  });
  it("rejects incomplete Apple verifier configuration at startup", () => {
    expect(
      () =>
        new AppleStoreAdapter({
          bundleId: "",
          appAppleId: 0,
          issuerId: "",
          keyId: "",
          privateKey: "",
          rootCertificates: [],
        }),
    ).toThrow();
  });
  it("reports unconfigured store providers without exposing credentials", () => {
    const events: unknown[] = [];
    const providers = readStoreProviderConfiguration({}, {
      error: (name: string, attributes: unknown) =>
        events.push({ name, attributes }),
    } as never);
    expect(providers).toEqual({ apple: null, google: null });
    expect(events).toEqual([
      {
        name: "financial.provider.unavailable",
        attributes: { provider: "apple", reason: "missing_configuration" },
      },
      {
        name: "financial.provider.unavailable",
        attributes: { provider: "google", reason: "missing_configuration" },
      },
    ]);
    expect(() =>
      readStoreProviderConfiguration({
        EDU_APPLE_BUNDLE_ID: "com.example.edu",
      }),
    ).toThrow("Apple App Store");
    expect(() =>
      readStoreProviderConfiguration({
        EDU_GOOGLE_PLAY_PACKAGE_NAME: "com.example.edu",
      }),
    ).toThrow("Google Play");
  });
});
