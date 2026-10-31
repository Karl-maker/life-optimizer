import { createHash } from "node:crypto";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { InvalidWebhookError } from "./index.js";
import type { VerifiedStorePurchase } from "./store-purchases.js";

type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidWebhookError();
  return value as Json;
}
function string(value: unknown, max = 256): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max)
    throw new InvalidWebhookError();
  return value;
}
function date(value: unknown): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(string(value, 64));
  if (!Number.isFinite(parsed.getTime())) throw new InvalidWebhookError();
  return parsed;
}
export interface GooglePlayNotification {
  eventId: string;
  type: string;
  purchase: VerifiedStorePurchase | null;
  purchaseToken?: string;
  voided?: { orderId: string; tokenHash: string };
}
/** Uses Application Default Credentials with androidpublisher scope; no service account JSON enters the domain. */
export class GooglePlayAdapter {
  private readonly auth: GoogleAuth;
  private readonly tokenVerifier: OAuth2Client;
  constructor(
    private readonly config: {
      packageName: string;
      pubsubAudience: string;
      pubsubServiceAccountEmail: string;
      auth?: GoogleAuth;
      tokenVerifier?: OAuth2Client;
      clock?: () => Date;
    },
  ) {
    if (
      !/^[A-Za-z][A-Za-z0-9_.]{2,254}$/.test(config.packageName) ||
      !config.pubsubAudience.startsWith("https://") ||
      !/^[^@\s]+@[^@\s]+$/.test(config.pubsubServiceAccountEmail)
    )
      throw new Error("Google Play configuration is incomplete.");
    this.auth =
      config.auth ??
      new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/androidpublisher"],
      });
    this.tokenVerifier = config.tokenVerifier ?? new OAuth2Client();
  }
  private now() {
    return this.config.clock?.() ?? new Date();
  }
  private async get(path: string): Promise<Json> {
    const client = await this.auth.getClient();
    const response = await client.request<Json>({
      url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.config.packageName)}/purchases/${path}`,
      method: "GET",
    });
    return object(response.data);
  }
  private key(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  async verifyProductToken(token: string): Promise<VerifiedStorePurchase> {
    string(token, 4096);
    const data = await this.get(
      `productsv2/tokens/${encodeURIComponent(token)}`,
    );
    const lines = data.productLineItem;
    if (!Array.isArray(lines) || lines.length !== 1)
      throw new InvalidWebhookError();
    const line = object(lines[0]);
    const state = string(object(data.purchaseStateContext).purchaseState, 40);
    if (!["PURCHASED", "PENDING", "CANCELLED"].includes(state))
      throw new InvalidWebhookError();
    const tokenHash = this.key(token);
    const purchaseAt = date(data.purchaseCompletionTime);
    const quantity = object(line.productOfferDetails ?? {}).quantity ?? 1;
    if (
      !Number.isInteger(quantity) ||
      Number(quantity) < 1 ||
      Number(quantity) > 1000
    )
      throw new InvalidWebhookError();
    return {
      provider: "google",
      transactionId: data.orderId
        ? string(data.orderId)
        : `pending.${tokenHash}`,
      originalTransactionId: tokenHash,
      tokenHash,
      accountKey: data.obfuscatedExternalAccountId
        ? `iap.google.${string(data.obfuscatedExternalAccountId, 96)}`
        : null,
      sku: string(line.productId),
      kind: "one_time",
      status:
        state === "PURCHASED"
          ? "active"
          : state === "PENDING"
            ? "pending"
            : "revoked",
      environment: data.testPurchaseContext ? "sandbox" : "production",
      quantity: Number(quantity),
      currency: null,
      priceMilliunits: null,
      purchasedAt: purchaseAt,
      expiresAt: null,
      observedAt: this.now(),
    };
  }
  async verifySubscriptionToken(token: string): Promise<VerifiedStorePurchase> {
    string(token, 4096);
    const data = await this.get(
      `subscriptionsv2/tokens/${encodeURIComponent(token)}`,
    );
    const lines = data.lineItems;
    if (!Array.isArray(lines) || lines.length !== 1)
      throw new InvalidWebhookError();
    const line = object(lines[0]);
    const state = string(data.subscriptionState, 64);
    const activeStates = [
      "SUBSCRIPTION_STATE_ACTIVE",
      "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
      "SUBSCRIPTION_STATE_CANCELED",
    ];
    const pendingStates = ["SUBSCRIPTION_STATE_PENDING"];
    const revokedStates = [
      "SUBSCRIPTION_STATE_PAUSED",
      "SUBSCRIPTION_STATE_ON_HOLD",
      "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
    ];
    if (
      ![
        ...activeStates,
        ...pendingStates,
        ...revokedStates,
        "SUBSCRIPTION_STATE_EXPIRED",
      ].includes(state)
    )
      throw new InvalidWebhookError();
    const tokenHash = this.key(token);
    const expiresAt = date(line.expiryTime);
    const id = line.latestSuccessfulOrderId
      ? string(line.latestSuccessfulOrderId)
      : `pending.${tokenHash}`;
    const account = data.externalAccountIdentifiers
      ? object(data.externalAccountIdentifiers).obfuscatedExternalAccountId
      : undefined;
    return {
      provider: "google",
      transactionId: id,
      originalTransactionId: tokenHash,
      tokenHash,
      accountKey: account ? `iap.google.${string(account, 96)}` : null,
      sku: string(line.productId),
      kind: "subscription",
      status:
        activeStates.includes(state) && expiresAt && expiresAt > this.now()
          ? "active"
          : pendingStates.includes(state)
            ? "pending"
            : state === "SUBSCRIPTION_STATE_EXPIRED"
              ? "expired"
              : "suspended",
      environment: data.testPurchase ? "sandbox" : "production",
      quantity: 1,
      currency: null,
      priceMilliunits: null,
      purchasedAt: date(data.startTime),
      expiresAt,
      observedAt: this.now(),
    };
  }
  /** Verifies Google's authenticated Pub/Sub push JWT before decoding an RTDN. */
  async verifyNotification(
    authorization: string | undefined,
    body: unknown,
  ): Promise<GooglePlayNotification> {
    const match = /^Bearer ([A-Za-z0-9._-]{100,8192})$/.exec(
      authorization ?? "",
    );
    if (!match) throw new InvalidWebhookError();
    let claims;
    try {
      claims = (
        await this.tokenVerifier.verifyIdToken({
          idToken: match[1]!,
          audience: this.config.pubsubAudience,
        })
      ).getPayload();
    } catch {
      throw new InvalidWebhookError();
    }
    if (
      claims?.email !== this.config.pubsubServiceAccountEmail ||
      claims.email_verified !== true
    )
      throw new InvalidWebhookError();
    const envelope = object(body);
    const message = object(envelope.message);
    const eventId = string(message.messageId ?? message.message_id);
    const encoded = string(message.data, 65_536);
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      )
    )
      throw new InvalidWebhookError();
    let event: Json;
    try {
      event = object(
        JSON.parse(Buffer.from(encoded, "base64").toString("utf8")),
      );
    } catch {
      throw new InvalidWebhookError();
    }
    if (event.packageName !== this.config.packageName)
      throw new InvalidWebhookError();
    if (event.testNotification)
      return { eventId, type: "TEST", purchase: null };
    if (event.pendingRefundReviewNotification)
      return { eventId, type: "PENDING_REFUND_REVIEW", purchase: null };
    if (event.oneTimeProductNotification) {
      const detail = object(event.oneTimeProductNotification);
      if (![1, 2].includes(Number(detail.notificationType)))
        throw new InvalidWebhookError();
      const purchase = await this.verifyProductToken(
        string(detail.purchaseToken, 4096),
      );
      if (detail.sku !== purchase.sku) throw new InvalidWebhookError();
      return {
        eventId,
        type: `ONE_TIME_PRODUCT_${detail.notificationType}`,
        purchase,
        purchaseToken: string(detail.purchaseToken, 4096),
      };
    }
    if (event.subscriptionNotification) {
      const detail = object(event.subscriptionNotification);
      if (
        !Number.isInteger(detail.notificationType) ||
        Number(detail.notificationType) < 1 ||
        Number(detail.notificationType) > 22
      )
        throw new InvalidWebhookError();
      const purchase = await this.verifySubscriptionToken(
        string(detail.purchaseToken, 4096),
      );
      return {
        eventId,
        type: `SUBSCRIPTION_${detail.notificationType}`,
        purchase,
        purchaseToken: string(detail.purchaseToken, 4096),
      };
    }
    if (event.voidedPurchaseNotification) {
      const detail = object(event.voidedPurchaseNotification);
      const token = string(detail.purchaseToken, 4096);
      if (![1, 2].includes(Number(detail.productType)))
        throw new InvalidWebhookError();
      if (detail.refundType === 1)
        return {
          eventId,
          type: "VOIDED_FULL",
          purchase: null,
          voided: {
            orderId: string(detail.orderId),
            tokenHash: this.key(token),
          },
        };
      if (detail.refundType === 2)
        return { eventId, type: "VOIDED_PARTIAL", purchase: null };
      throw new InvalidWebhookError();
    }
    throw new InvalidWebhookError();
  }
  async acknowledge(
    purchase: VerifiedStorePurchase,
    token: string,
  ): Promise<void> {
    if (
      purchase.provider !== "google" ||
      purchase.status !== "active" ||
      this.key(token) !== purchase.tokenHash
    )
      throw new InvalidWebhookError();
    const client = await this.auth.getClient();
    const state = await this.get(
      purchase.kind === "one_time"
        ? `productsv2/tokens/${encodeURIComponent(token)}`
        : `subscriptionsv2/tokens/${encodeURIComponent(token)}`,
    );
    if (state.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
      return;
    if (state.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING")
      throw new InvalidWebhookError();
    const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.config.packageName)}/purchases/`;
    const path =
      purchase.kind === "one_time"
        ? `products/${encodeURIComponent(purchase.sku)}/tokens/${encodeURIComponent(token)}:acknowledge`
        : `subscriptions/${encodeURIComponent(purchase.sku)}/tokens/${encodeURIComponent(token)}:acknowledge`;
    await client.request({ url: base + path, method: "POST", data: {} });
  }
}
