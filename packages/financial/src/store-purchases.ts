import { randomUUID } from "node:crypto";
import {
  AUDIT_ACTION,
  DomainError,
  type Actor,
  type AuditContext,
  type AuditLog,
  type EventOutbox,
} from "@life-optimizer/core";
import type { BillingRepository } from "./billing.js";
import type { FinancialRepository } from "./index.js";

export type StoreProvider = "apple" | "google";
export type StorePurchaseStatus =
  "pending" | "active" | "expired" | "suspended" | "revoked";
export interface VerifiedStorePurchase {
  provider: StoreProvider;
  transactionId: string;
  originalTransactionId: string;
  tokenHash: string | null;
  accountKey: string | null;
  sku: string;
  kind: "one_time" | "subscription";
  status: StorePurchaseStatus;
  environment: "production" | "sandbox";
  quantity: number;
  currency: string | null;
  /** Apple reports price in milliunits; Google product v2 does not report a price. */
  priceMilliunits: bigint | null;
  purchasedAt: Date | null;
  expiresAt: Date | null;
  observedAt: Date;
  permanentlyRevoked?: boolean;
  /** Set only for a provider-confirmed reversal of a prior refund. */
  reinstatement?: boolean;
}
export interface StoreProductMapping {
  id: string;
  provider: StoreProvider;
  sku: string;
  priceId: string;
  active: boolean;
}
export interface StorePurchase extends Omit<
  VerifiedStorePurchase,
  "accountKey" | "reinstatement" | "permanentlyRevoked"
> {
  id: string;
  accountId: string | null;
  mappingId: string;
  priceId: string;
  permanentlyRevoked: boolean;
  createdAt: Date;
}
export interface StorePurchaseRepository {
  findMapping(
    provider: StoreProvider,
    sku: string,
  ): Promise<StoreProductMapping | null>;
  saveMapping(input: StoreProductMapping): Promise<StoreProductMapping>;
  findByTransaction(
    provider: StoreProvider,
    transactionId: string,
  ): Promise<StorePurchase | null>;
  findByOriginal(
    provider: StoreProvider,
    originalId: string,
  ): Promise<StorePurchase | null>;
  findByTokenHash(
    provider: StoreProvider,
    tokenHash: string,
  ): Promise<StorePurchase | null>;
  findVoid(
    provider: StoreProvider,
    transactionId: string,
  ): Promise<{ tokenHash: string } | null>;
  recordVoid(input: {
    provider: StoreProvider;
    transactionId: string;
    tokenHash: string;
    eventId: string;
    occurredAt: Date;
  }): Promise<boolean>;
  savePurchase(
    input: StorePurchase,
  ): Promise<{ purchase: StorePurchase; changed: boolean; created: boolean }>;
  listGrants(
    purchaseId: string,
  ): Promise<readonly { id: string; revokedAt: Date | null }[]>;
  listForAccount(
    accountId: string,
    cursor: { createdAt: Date; id: string } | null,
    limit: number,
  ): Promise<readonly StorePurchase[]>;
  recordNotification(input: {
    provider: StoreProvider;
    eventId: string;
    type: string;
    purchaseId: string | null;
    occurredAt: Date;
  }): Promise<boolean>;
}
export interface StorePurchaseTransactionRunner {
  run<T>(
    work: (ports: {
      store: StorePurchaseRepository;
      billing: BillingRepository;
      financial: FinancialRepository;
      audit: AuditLog;
      events: EventOutbox;
    }) => Promise<T>,
  ): Promise<T>;
}
function validRef(value: string): boolean {
  return value.length > 0 && value.length <= 256 && /^[\w.:-]+$/.test(value);
}
function validate(value: VerifiedStorePurchase): void {
  if (
    !["apple", "google"].includes(value.provider) ||
    !validRef(value.transactionId) ||
    !validRef(value.originalTransactionId) ||
    !validRef(value.sku) ||
    (value.tokenHash !== null && !/^[a-f0-9]{64}$/.test(value.tokenHash)) ||
    (value.accountKey !== null &&
      !/^[A-Za-z0-9._:-]{4,128}$/.test(value.accountKey)) ||
    !["one_time", "subscription"].includes(value.kind) ||
    !["pending", "active", "expired", "suspended", "revoked"].includes(
      value.status,
    ) ||
    !["production", "sandbox"].includes(value.environment) ||
    !Number.isInteger(value.quantity) ||
    value.quantity < 1 ||
    value.quantity > 1000 ||
    (value.currency !== null && !/^[A-Z]{3}$/.test(value.currency)) ||
    (value.priceMilliunits !== null &&
      (value.priceMilliunits < 0n ||
        value.priceMilliunits > 9_223_372_036_854_775_807n)) ||
    !Number.isFinite(value.observedAt.getTime()) ||
    (value.reinstatement !== undefined &&
      typeof value.reinstatement !== "boolean") ||
    (value.permanentlyRevoked !== undefined &&
      typeof value.permanentlyRevoked !== "boolean") ||
    (value.purchasedAt !== null &&
      !Number.isFinite(value.purchasedAt.getTime())) ||
    (value.expiresAt !== null && !Number.isFinite(value.expiresAt.getTime())) ||
    (value.kind === "subscription" &&
      value.status === "active" &&
      value.expiresAt === null)
  )
    throw new DomainError(
      "INVALID_NAME",
      "Verified store purchase fields are invalid.",
    );
}
function manager(actor: Actor): void {
  if (actor.kind !== "agent" || !actor.permissions.includes("financial:manage"))
    throw new DomainError(
      "FORBIDDEN",
      "Financial management permission is required.",
    );
}
function fact(
  type: string,
  at: Date,
  payload: Record<string, string | number | boolean | null>,
) {
  return {
    topic: "financial",
    type,
    version: 1 as const,
    occurredAt: at,
    payload,
  };
}

/** Inputs are verified by the Apple/Google adapters before reaching this use case. */
export function createStorePurchaseService(deps: {
  repository: StorePurchaseRepository;
  transactions: StorePurchaseTransactionRunner;
  clock?: () => Date;
}) {
  const clock = deps.clock ?? (() => new Date());
  return {
    async voidGoogleOrder(input: {
      actor: Actor;
      audit: AuditContext;
      eventId: string;
      orderId: string;
      tokenHash: string;
    }) {
      manager(input.actor);
      if (
        !validRef(input.eventId) ||
        !validRef(input.orderId) ||
        !/^[a-f0-9]{64}$/.test(input.tokenHash)
      )
        throw new DomainError(
          "INVALID_NAME",
          "Google void identifiers are invalid.",
        );
      const at = clock();
      const prior = await deps.transactions.run(async (ports) => {
        const existing = await ports.store.findByTransaction(
          "google",
          input.orderId,
        );
        if (existing && existing.tokenHash !== input.tokenHash)
          throw new DomainError(
            "FORBIDDEN",
            "Google void does not match the stored purchase token.",
          );
        const created = await ports.store.recordVoid({
          provider: "google",
          transactionId: input.orderId,
          tokenHash: input.tokenHash,
          eventId: input.eventId,
          occurredAt: at,
        });
        if (created) {
          await ports.audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.storeVoidRecorded,
            outcome: "succeeded",
            resource: { type: "store-void", id: `google:${input.orderId}` },
            context: input.audit,
            changes: {
              provider: "google",
              transactionId: input.orderId,
              matched: Boolean(existing),
            },
          });
          await ports.events.append(
            fact("financial.store-void.recorded", at, {
              provider: "google",
              transactionId: input.orderId,
              matched: Boolean(existing),
            }),
          );
        }
        return existing;
      });
      if (!prior) {
        await this.recordNotification({
          actor: input.actor,
          audit: input.audit,
          provider: "google",
          eventId: input.eventId,
          type: "VOIDED_UNKNOWN_ORDER",
        });
        return { matched: false };
      }
      await this.sync({
        actor: input.actor,
        audit: input.audit,
        notification: { eventId: input.eventId, type: "VOIDED_FULL" },
        purchase: {
          provider: "google",
          transactionId: prior.transactionId,
          originalTransactionId: prior.originalTransactionId,
          tokenHash: prior.tokenHash,
          accountKey: null,
          sku: prior.sku,
          kind: prior.kind,
          status: "revoked",
          environment: prior.environment,
          quantity: prior.quantity,
          currency: prior.currency,
          priceMilliunits: prior.priceMilliunits,
          purchasedAt: prior.purchasedAt,
          expiresAt: prior.expiresAt,
          observedAt: new Date(
            Math.max(clock().getTime(), prior.observedAt.getTime() + 1),
          ),
          permanentlyRevoked: true,
        },
      });
      return { matched: true };
    },
    async recordNotification(input: {
      actor: Actor;
      audit: AuditContext;
      provider: StoreProvider;
      eventId: string;
      type: string;
    }) {
      manager(input.actor);
      if (!validRef(input.eventId) || !validRef(input.type))
        throw new DomainError(
          "INVALID_NAME",
          "Store notification identifiers are invalid.",
        );
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const created = await ports.store.recordNotification({
          provider: input.provider,
          eventId: input.eventId,
          type: input.type,
          purchaseId: null,
          occurredAt: at,
        });
        if (created) {
          await ports.audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.storeNotificationReceived,
            outcome: "succeeded",
            resource: {
              type: "store-notification",
              id: `${input.provider}:${input.eventId}`,
            },
            context: input.audit,
            changes: {
              provider: input.provider,
              type: input.type,
              purchaseId: null,
            },
          });
          await ports.events.append(
            fact(
              [
                "VOIDED_PARTIAL",
                "VOIDED_OLDER_ORDER",
                "VOIDED_UNKNOWN_ORDER",
                "PENDING_REFUND_REVIEW",
              ].includes(input.type)
                ? "financial.store-notification.review_required"
                : "financial.store-notification.received",
              at,
              { provider: input.provider, type: input.type, purchaseId: null },
            ),
          );
        }
        return { created };
      });
    },
    async mapProduct(input: {
      actor: Actor;
      audit: AuditContext;
      provider: StoreProvider;
      sku: string;
      priceId: string;
      active?: boolean;
    }) {
      manager(input.actor);
      if (!validRef(input.sku) || !/^[0-9a-f-]{36}$/i.test(input.priceId))
        throw new DomainError(
          "INVALID_NAME",
          "Store SKU or price ID is invalid.",
        );
      return deps.transactions.run(async (ports) => {
        const existing = await ports.store.findMapping(
          input.provider,
          input.sku,
        );
        if (existing && existing.priceId !== input.priceId)
          throw new DomainError(
            "FORBIDDEN",
            "A store SKU cannot be reassigned to a different price.",
          );
        if (existing && existing.active === (input.active ?? true))
          return existing;
        const price = await ports.billing.findPrice(input.priceId);
        if (
          !price ||
          ((input.active ?? true) &&
            (!price.active ||
              !price.productActive ||
              price.productRiskLevel === "blocked"))
        )
          throw new DomainError(
            "INVALID_NAME",
            "Store mapping requires an available price.",
          );
        if (
          price.frequency === "one_time" ||
          price.frequency === "day" ||
          price.frequency === "week" ||
          price.frequency === "month" ||
          price.frequency === "year"
        ) {
          const mapping = await ports.store.saveMapping({
            id: existing?.id ?? randomUUID(),
            provider: input.provider,
            sku: input.sku,
            priceId: input.priceId,
            active: input.active ?? true,
          });
          await ports.audit.append({
            occurredAt: clock(),
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.storeProductMapped,
            outcome: "succeeded",
            resource: { type: "store-product-mapping", id: mapping.id },
            context: input.audit,
            changes: {
              provider: mapping.provider,
              sku: mapping.sku,
              priceId: mapping.priceId,
              active: mapping.active,
            },
          });
          await ports.events.append(
            fact("financial.store-product.mapped", clock(), {
              mappingId: mapping.id,
              provider: mapping.provider,
              sku: mapping.sku,
              priceId: mapping.priceId,
              active: mapping.active,
            }),
          );
          return mapping;
        }
        throw new DomainError(
          "INVALID_NAME",
          "Unsupported store price frequency.",
        );
      });
    },
    async listPurchases(input: {
      actor: Actor;
      userId: string;
      cursor?: { createdAt: Date; id: string };
      limit?: number;
    }) {
      if (
        (input.actor.kind === "user"
          ? input.actor.userId
          : input.actor.onBehalfOf) !== input.userId
      )
        throw new DomainError(
          "FORBIDDEN",
          "Purchase history belongs to another user.",
        );
      const limit = input.limit ?? 25;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 101 ||
        (input.cursor !== undefined &&
          (!/^[0-9a-f-]{36}$/i.test(input.cursor.id) ||
            !Number.isFinite(input.cursor.createdAt.getTime())))
      )
        throw new DomainError(
          "INVALID_NAME",
          "Purchase history pagination is invalid.",
        );
      const account = await deps.transactions.run((ports) =>
        ports.financial.ensureAccount(input.userId),
      );
      return deps.repository.listForAccount(
        account.id,
        input.cursor ?? null,
        limit,
      );
    },
    async sync(input: {
      actor: Actor;
      audit: AuditContext;
      purchase: VerifiedStorePurchase;
      userId?: string;
      notification?: { eventId: string; type: string };
    }) {
      validate(input.purchase);
      if (input.userId) {
        if (
          (input.actor.kind === "user"
            ? input.actor.userId
            : input.actor.onBehalfOf) !== input.userId
        )
          throw new DomainError(
            "FORBIDDEN",
            "Purchase claim belongs to another user.",
          );
      } else manager(input.actor);
      if (
        input.notification &&
        (!validRef(input.notification.eventId) ||
          !validRef(input.notification.type))
      )
        throw new DomainError(
          "INVALID_NAME",
          "Store notification identifiers are invalid.",
        );
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const verified = input.purchase;
        const voided = await ports.store.findVoid(
          verified.provider,
          verified.transactionId,
        );
        if (voided && voided.tokenHash !== verified.tokenHash)
          throw new DomainError(
            "FORBIDDEN",
            "Store transaction does not match its recorded void.",
          );
        const prior = await ports.store.findByTransaction(
          verified.provider,
          verified.transactionId,
        );
        const mapping = await ports.store.findMapping(
          verified.provider,
          verified.sku,
        );
        if (!mapping || (!mapping.active && !prior))
          throw new DomainError(
            "INVALID_NAME",
            "Store SKU has no active local price mapping.",
          );
        const price = await ports.billing.findPrice(mapping.priceId);
        if (
          !price ||
          (!prior &&
            (!price.active ||
              !price.productActive ||
              price.productRiskLevel === "blocked")) ||
          (verified.kind === "one_time") !== (price.frequency === "one_time")
        )
          throw new DomainError(
            "INVALID_NAME",
            "Store purchase does not match an available local price.",
          );
        const related =
          prior ??
          (verified.tokenHash
            ? await ports.store.findByTokenHash(
                verified.provider,
                verified.tokenHash,
              )
            : null) ??
          (await ports.store.findByOriginal(
            verified.provider,
            verified.originalTransactionId,
          ));
        const boundAccount = verified.accountKey
          ? await ports.financial.findAccountByKey(verified.accountKey)
          : null;
        const claimedAccount = input.userId
          ? await ports.financial.ensureAccount(input.userId)
          : null;
        if (
          verified.accountKey &&
          claimedAccount &&
          (!boundAccount || boundAccount.id !== claimedAccount.id)
        )
          throw new DomainError(
            "FORBIDDEN",
            "Store account token is not bound to this user.",
          );
        const accountId = boundAccount?.id ?? related?.accountId ?? null;
        if (
          (boundAccount &&
            related?.accountId &&
            boundAccount.id !== related.accountId) ||
          (claimedAccount &&
            related?.accountId &&
            claimedAccount.id !== related.accountId) ||
          (prior &&
            (prior.mappingId !== mapping.id ||
              prior.sku !== verified.sku ||
              prior.kind !== verified.kind ||
              prior.environment !== verified.environment))
        )
          throw new DomainError(
            "FORBIDDEN",
            "Store transaction is already associated with another purchase or account.",
          );
        if (claimedAccount && accountId !== claimedAccount.id)
          throw new DomainError(
            "FORBIDDEN",
            "Store purchase has no matching account binding.",
          );
        // Unknown accounts remain unclaimed. A notification alone never assigns a purchase to a user.
        const effectiveStatus =
          verified.status === "active" &&
          verified.kind === "subscription" &&
          verified.expiresAt &&
          verified.expiresAt <= at
            ? "expired"
            : verified.status;
        const row: StorePurchase = {
          ...verified,
          status: voided
            ? "revoked"
            : prior?.permanentlyRevoked &&
                effectiveStatus === "active" &&
                !verified.reinstatement
              ? "revoked"
              : effectiveStatus,
          permanentlyRevoked: voided
            ? true
            : verified.reinstatement
              ? false
              : Boolean(
                  prior?.permanentlyRevoked || verified.permanentlyRevoked,
                ),
          id: prior?.id ?? randomUUID(),
          accountId,
          mappingId: mapping.id,
          priceId: mapping.priceId,
          createdAt: prior?.createdAt ?? at,
        };
        const saved = await ports.store.savePurchase(row);
        if (input.notification) {
          const fresh = await ports.store.recordNotification({
            provider: verified.provider,
            eventId: input.notification.eventId,
            type: input.notification.type,
            purchaseId: saved.purchase.id,
            occurredAt: verified.observedAt,
          });
          if (fresh) {
            await ports.audit.append({
              occurredAt: at,
              companyId: null,
              actor: input.actor,
              action: AUDIT_ACTION.storeNotificationReceived,
              outcome: "succeeded",
              resource: {
                type: "store-notification",
                id: `${verified.provider}:${input.notification.eventId}`,
              },
              context: input.audit,
              changes: {
                provider: verified.provider,
                type: input.notification.type,
                purchaseId: saved.purchase.id,
              },
            });
            await ports.events.append(
              fact("financial.store-notification.received", at, {
                provider: verified.provider,
                type: input.notification.type,
                purchaseId: saved.purchase.id,
              }),
            );
            if (
              input.notification.type === "DID_FAIL_TO_RENEW" ||
              ["SUBSCRIPTION_5", "SUBSCRIPTION_6"].includes(
                input.notification.type,
              )
            )
              await ports.events.append(
                fact("financial.store-subscription.billing_failed", at, {
                  provider: verified.provider,
                  purchaseId: saved.purchase.id,
                }),
              );
            if (
              input.notification.type === "DID_RENEW" ||
              input.notification.type === "SUBSCRIPTION_2"
            )
              await ports.events.append(
                fact("financial.store-subscription.renewed", at, {
                  provider: verified.provider,
                  purchaseId: saved.purchase.id,
                }),
              );
          }
        }
        if (saved.changed) {
          await ports.audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.storePurchaseSynced,
            outcome: "succeeded",
            resource: { type: "store-purchase", id: saved.purchase.id },
            context: input.audit,
            changes: {
              provider: verified.provider,
              sku: verified.sku,
              status: saved.purchase.status,
              accountBound: accountId !== null,
            },
          });
          await ports.events.append(
            fact("financial.store-purchase.synced", at, {
              purchaseId: saved.purchase.id,
              provider: verified.provider,
              sku: verified.sku,
              status: saved.purchase.status,
            }),
          );
          if (saved.purchase.status !== "pending")
            await ports.events.append(
              fact(`financial.store-purchase.${saved.purchase.status}`, at, {
                purchaseId: saved.purchase.id,
                provider: verified.provider,
                sku: verified.sku,
              }),
            );
        }
        let granted = 0;
        let revoked = 0;
        if (
          saved.purchase.accountId &&
          saved.purchase.status === "active" &&
          (saved.purchase.expiresAt === null || saved.purchase.expiresAt > at)
        ) {
          const existingGrants = await ports.store.listGrants(
            saved.purchase.id,
          );
          const extending =
            prior?.expiresAt &&
            saved.purchase.expiresAt &&
            saved.purchase.expiresAt > prior.expiresAt &&
            saved.changed;
          const restoring =
            existingGrants.length > 0 &&
            existingGrants.every((grant) => grant.revokedAt) &&
            (verified.reinstatement ||
              prior?.status === "suspended" ||
              prior?.status === "expired");
          if (existingGrants.length === 0 || restoring || extending) {
            for (const item of await ports.financial.listPriceEntitlements(
              mapping.priceId,
            )) {
              const quantity =
                item.quantity === null
                  ? null
                  : item.quantity * BigInt(saved.purchase.quantity);
              if (quantity !== null && quantity > 9_223_372_036_854_775_807n)
                throw new DomainError(
                  "INVALID_NAME",
                  "Store entitlement quantity exceeds supported range.",
                );
              const entitlement = await ports.financial.grantEntitlement({
                accountId: saved.purchase.accountId,
                key: item.entitlementKey,
                quantity,
                startsAt: restoring
                  ? at
                  : extending
                    ? prior!.expiresAt!
                    : (saved.purchase.purchasedAt ?? at),
                endsAt: saved.purchase.expiresAt,
                revokedAt: null,
                productId: price.productId,
                priceId: price.id,
                storePurchaseId: saved.purchase.id,
              });
              granted++;
              await ports.audit.append({
                occurredAt: at,
                companyId: null,
                actor: input.actor,
                action: AUDIT_ACTION.entitlementGranted,
                outcome: "succeeded",
                resource: { type: "entitlement", id: entitlement.id },
                context: input.audit,
                changes: {
                  key: entitlement.key,
                  storePurchaseId: saved.purchase.id,
                },
              });
              await ports.events.append(
                fact("financial.entitlement.granted", at, {
                  entitlementId: entitlement.id,
                  key: entitlement.key,
                  storePurchaseId: saved.purchase.id,
                }),
              );
            }
          }
        } else if (
          ["revoked", "expired", "suspended"].includes(saved.purchase.status)
        ) {
          for (const grant of await ports.store.listGrants(saved.purchase.id))
            if (!grant.revokedAt) {
              await ports.financial.revokeEntitlement(grant.id, at);
              revoked++;
              await ports.audit.append({
                occurredAt: at,
                companyId: null,
                actor: input.actor,
                action: AUDIT_ACTION.entitlementRevoked,
                outcome: "succeeded",
                resource: { type: "entitlement", id: grant.id },
                context: input.audit,
                changes: { storePurchaseId: saved.purchase.id },
              });
              await ports.events.append(
                fact("financial.entitlement.revoked", at, {
                  entitlementId: grant.id,
                  storePurchaseId: saved.purchase.id,
                }),
              );
            }
        }
        return {
          purchase: saved.purchase,
          created: saved.created,
          granted,
          revoked,
        };
      });
    },
  };
}
