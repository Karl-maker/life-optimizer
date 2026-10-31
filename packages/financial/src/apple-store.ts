import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Type,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { InvalidWebhookError } from "./index.js";
import type { VerifiedStorePurchase } from "./store-purchases.js";

export interface AppleStoreNotification {
  eventId: string;
  type: string;
  purchase: VerifiedStorePurchase | null;
}

/** Apple-signed JWS data is verified against Apple roots, bundle ID, app ID and environment. */
export class AppleStoreAdapter {
  private readonly verifiers: readonly {
    environment: Environment;
    verifier: SignedDataVerifier;
    client: AppStoreServerAPIClient;
  }[];
  constructor(config: {
    bundleId: string;
    appAppleId: number;
    issuerId: string;
    keyId: string;
    privateKey: string;
    rootCertificates: readonly Buffer[];
    allowSandbox?: boolean;
  }) {
    if (
      !/^[A-Za-z0-9.-]{3,256}$/.test(config.bundleId) ||
      !Number.isSafeInteger(config.appAppleId) ||
      config.appAppleId <= 0 ||
      !config.issuerId ||
      !config.keyId ||
      !config.privateKey ||
      config.rootCertificates.length === 0
    )
      throw new Error("Apple App Store configuration is incomplete.");
    const environments = config.allowSandbox
      ? [Environment.PRODUCTION, Environment.SANDBOX]
      : [Environment.PRODUCTION];
    this.verifiers = environments.map((environment) => ({
      environment,
      verifier: new SignedDataVerifier(
        [...config.rootCertificates],
        true,
        environment,
        config.bundleId,
        environment === Environment.PRODUCTION ? config.appAppleId : undefined,
      ),
      client: new AppStoreServerAPIClient(
        config.privateKey,
        config.keyId,
        config.issuerId,
        config.bundleId,
        environment,
      ),
    }));
  }
  private async verifyTransaction(signed: string) {
    if (signed.length > 32_768) throw new InvalidWebhookError();
    for (const source of this.verifiers) {
      try {
        return {
          transaction: await source.verifier.verifyAndDecodeTransaction(signed),
          source,
        };
      } catch {
        /* Try the explicitly configured sandbox environment. */
      }
    }
    throw new InvalidWebhookError();
  }
  private normalize(
    transaction: JWSTransactionDecodedPayload,
    environment: Environment,
    observedAt: Date,
    override?: "revoked" | "expired" | "active",
  ): VerifiedStorePurchase {
    if (
      !transaction.transactionId ||
      !transaction.originalTransactionId ||
      !transaction.productId ||
      !transaction.purchaseDate ||
      ![
        Type.CONSUMABLE,
        Type.NON_CONSUMABLE,
        Type.AUTO_RENEWABLE_SUBSCRIPTION,
      ].includes(transaction.type as Type) ||
      transaction.inAppOwnershipType === "FAMILY_SHARED"
    )
      throw new InvalidWebhookError();
    const kind =
      transaction.type === Type.AUTO_RENEWABLE_SUBSCRIPTION
        ? "subscription"
        : "one_time";
    const expiresAt = transaction.expiresDate
      ? new Date(transaction.expiresDate)
      : null;
    const status =
      override ??
      (transaction.revocationDate
        ? "revoked"
        : expiresAt && expiresAt <= observedAt
          ? "expired"
          : "active");
    return {
      provider: "apple",
      transactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      tokenHash: null,
      accountKey: transaction.appAccountToken
        ? `iap.apple.${transaction.appAccountToken.toLowerCase()}`
        : null,
      sku: transaction.productId,
      kind,
      status,
      environment:
        environment === Environment.PRODUCTION ? "production" : "sandbox",
      quantity: transaction.quantity ?? 1,
      currency: transaction.currency ?? null,
      priceMilliunits:
        transaction.price === undefined ? null : BigInt(transaction.price),
      purchasedAt: new Date(transaction.purchaseDate),
      expiresAt,
      observedAt,
      permanentlyRevoked: Boolean(transaction.revocationDate),
    };
  }
  /** Device JWS is verified, then refreshed from Apple's server before granting access. */
  async verifyClientTransaction(
    signedTransaction: string,
  ): Promise<VerifiedStorePurchase> {
    const initial = await this.verifyTransaction(signedTransaction);
    if (!initial.transaction.transactionId) throw new InvalidWebhookError();
    const response = await initial.source.client.getTransactionInfo(
      initial.transaction.transactionId,
    );
    if (!response.signedTransactionInfo) throw new InvalidWebhookError();
    const refreshed = await initial.source.verifier.verifyAndDecodeTransaction(
      response.signedTransactionInfo,
    );
    if (refreshed.transactionId !== initial.transaction.transactionId)
      throw new InvalidWebhookError();
    const normalized = this.normalize(
      refreshed,
      initial.source.environment,
      new Date(),
    );
    // A historical signed transaction cannot establish current grace-period status.
    if (
      normalized.kind === "subscription" &&
      normalized.expiresAt &&
      normalized.expiresAt <= new Date()
    )
      throw new InvalidWebhookError();
    return normalized;
  }
  async verifyNotification(
    signedPayload: string,
  ): Promise<AppleStoreNotification> {
    if (signedPayload.length > 65_536) throw new InvalidWebhookError();
    for (const source of this.verifiers) {
      try {
        const notification =
          await source.verifier.verifyAndDecodeNotification(signedPayload);
        if (
          !notification.notificationUUID ||
          !notification.notificationType ||
          !notification.signedDate
        )
          throw new InvalidWebhookError();
        const signedTransaction = notification.data?.signedTransactionInfo;
        if (!signedTransaction)
          return {
            eventId: notification.notificationUUID,
            type: notification.notificationType,
            purchase: null,
          };
        const transaction =
          await source.verifier.verifyAndDecodeTransaction(signedTransaction);
        let override: "revoked" | "expired" | "active" | undefined;
        if (["REFUND", "REVOKE"].includes(notification.notificationType))
          override = "revoked";
        else if (
          ["EXPIRED", "GRACE_PERIOD_EXPIRED"].includes(
            notification.notificationType,
          ) ||
          (notification.notificationType === "DID_FAIL_TO_RENEW" &&
            notification.subtype !== "GRACE_PERIOD")
        )
          override = "expired";
        else if (notification.notificationType === "REFUND_REVERSED")
          override = "active";
        let graceEndsAt: Date | null = null;
        if (
          notification.notificationType === "DID_FAIL_TO_RENEW" &&
          notification.subtype === "GRACE_PERIOD"
        ) {
          if (!notification.data?.signedRenewalInfo)
            throw new InvalidWebhookError();
          const renewal = await source.verifier.verifyAndDecodeRenewalInfo(
            notification.data.signedRenewalInfo,
          );
          if (!renewal.gracePeriodExpiresDate) throw new InvalidWebhookError();
          graceEndsAt = new Date(renewal.gracePeriodExpiresDate);
          if (!Number.isFinite(graceEndsAt.getTime()))
            throw new InvalidWebhookError();
          override =
            graceEndsAt > new Date(notification.signedDate)
              ? "active"
              : "expired";
        }
        const normalized = this.normalize(
          transaction,
          source.environment,
          new Date(notification.signedDate),
          override,
        );
        return {
          eventId: notification.notificationUUID,
          type: notification.notificationType,
          purchase: {
            ...normalized,
            ...(graceEndsAt ? { expiresAt: graceEndsAt } : {}),
            reinstatement: notification.notificationType === "REFUND_REVERSED",
            permanentlyRevoked: ["REFUND", "REVOKE"].includes(
              notification.notificationType,
            ),
          },
        };
      } catch (error) {
        if (error instanceof InvalidWebhookError) throw error;
      }
    }
    throw new InvalidWebhookError();
  }
}
