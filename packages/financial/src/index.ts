import { createHmac, timingSafeEqual } from "node:crypto";
import { PowerTranzAdapter } from "./powertranz.js";
export {
  PowerTranzAdapter,
  PowerTranzProtocolError,
  PowerTranzAuthenticationError,
  type PowerTranzHostedSession,
  type PowerTranzResult,
} from "./powertranz.js";
export {
  createPowerTranzCheckout,
  InvalidPowerTranzCallbackError,
  type PowerTranzSaleRepository,
  type PowerTranzPendingSale,
} from "./powertranz-checkout.js";
export {
  createBillingService,
  type BillingRepository,
  type BillingTransactionRunner,
  type BillingInvoice,
  type BillingPrice,
  type BillingCoupon,
  type BillingPayment,
  type BillingRefund,
  type BillingSubscription,
  type InvoiceLineSnapshot,
} from "./billing.js";
import {
  AUDIT_ACTION,
  DomainError,
  type Actor,
  type AuditContext,
  type AuditLog,
  type EventOutbox,
  type OperationLog,
} from "@edu-service/core";

/** ISO 4217 values are stored in uppercase; monetary values are integer minor units, never floats. */
export interface Money {
  currency: string;
  amountMinor: bigint;
}
export type BillingFrequency = "one_time" | "day" | "week" | "month" | "year";
export type RiskLevel = "low" | "standard" | "high" | "blocked";
export type EntitlementUnit =
  "boolean" | "request" | "token" | "byte" | "seat" | "minute" | "custom";
/** Window boundaries use UTC. Calendar windows reset at their named UTC boundary; rolling is elapsed time. */
export type UsageResetStrategy =
  "never" | "calendar_day" | "calendar_week" | "calendar_month" | "rolling";
export interface Product {
  id: string;
  key: string;
  name: string;
  active: boolean;
  riskLevel: RiskLevel;
}
export interface Price {
  id: string;
  productId: string;
  currency: string;
  unitAmountMinor: bigint;
  frequency: BillingFrequency;
  intervalCount: number;
  trialDays: number;
  active: boolean;
}
export interface EntitlementDefinition {
  key: string;
  description: string;
  unit: EntitlementUnit;
  resetStrategy: UsageResetStrategy;
  resetIntervalSeconds: number | null;
}
export interface PriceEntitlement {
  priceId: string;
  entitlementKey: string;
  quantity: bigint | null;
}
export interface FinancialAccount {
  id: string;
  userId: string;
}
export interface Entitlement {
  id: string;
  accountId: string;
  key: string;
  quantity: bigint | null;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
  productId: string | null;
  priceId: string | null;
  invoiceId?: string | null;
}
export interface UsageRecord {
  id: string;
  accountId: string;
  entitlementKey: string;
  quantity: bigint;
  idempotencyKey: string;
  occurredAt: Date;
  reversalOfId?: string | null;
}
export interface WalletEntry {
  id: string;
  accountId: string;
  currency: string;
  amountMinor: bigint;
  type: "credit" | "debit" | "adjustment";
  idempotencyKey: string;
  occurredAt: Date;
}
/** Display metadata from a PCI-compliant provider. `tokenReference` is a provider token, never a PAN or CVC. */
export interface PaymentMethodToken {
  id: string;
  accountId: string;
  provider: string;
  tokenReference: string;
  brand: string | null;
  last4: string | null;
  expiresMonth: number | null;
  expiresYear: number | null;
  revokedAt: Date | null;
  createdAt: Date;
}
export type PaymentMethodView = Omit<PaymentMethodToken, "tokenReference">;
export interface PaymentProviderEvent {
  provider: string;
  eventId: string;
  type: string;
  occurredAt: Date;
  accountKey?: string;
  payloadReference: string;
  objectId?: string;
  objectStatus?: string;
  paymentStatus?: string;
  amountMinor?: bigint;
  currency?: string;
  paymentReference?: string;
  providerCustomerId?: string;
}

/** Persistence is provider-neutral: no PAN, CVC, card address, or provider secret enters this API. */
export interface FinancialRepository {
  ensureAccount(userId: string): Promise<FinancialAccount>;
  findAccountByKey(key: string): Promise<FinancialAccount | null>;
  bindAccountKey(accountId: string, key: string): Promise<boolean>;
  removeAccountKey(accountId: string, key: string): Promise<boolean>;
  findAccountById(id: string): Promise<FinancialAccount | null>;
  registerEntitlementDefinition(
    definition: EntitlementDefinition,
  ): Promise<EntitlementDefinition>;
  findEntitlementDefinition(key: string): Promise<EntitlementDefinition | null>;
  listPriceEntitlements(priceId: string): Promise<readonly PriceEntitlement[]>;
  /** Only returns an offer if exactly one active, unblocked price grants the key. */
  findSolePurchaseOption(
    entitlementKey: string,
  ): Promise<{ productId: string; priceId: string } | null>;
  grantEntitlement(input: Omit<Entitlement, "id">): Promise<Entitlement>;
  findEntitlementById(id: string): Promise<Entitlement | null>;
  revokeEntitlement(id: string, at: Date): Promise<Entitlement>;
  findUsableEntitlement(
    accountId: string,
    key: string,
    at: Date,
  ): Promise<Entitlement | null>;
  /** Sum all active grants; null means at least one active unlimited grant. */
  entitlementQuantity(
    accountId: string,
    key: string,
    at: Date,
  ): Promise<bigint | null>;
  usageTotal(
    accountId: string,
    entitlementKey: string,
    since: Date | null,
  ): Promise<bigint>;
  findUsageByKey(idempotencyKey: string): Promise<UsageRecord | null>;
  findUsageById(id: string): Promise<UsageRecord | null>;
  usageReversedTotal(id: string): Promise<bigint>;
  recordUsage(
    input: Omit<UsageRecord, "id">,
  ): Promise<{ record: UsageRecord; created: boolean }>;
  walletBalance(accountId: string, currency: string): Promise<bigint>;
  findWalletEntryByKey(idempotencyKey: string): Promise<WalletEntry | null>;
  addWalletEntry(
    input: Omit<WalletEntry, "id">,
  ): Promise<{ entry: WalletEntry; created: boolean }>;
  savePaymentMethod(
    input: Omit<PaymentMethodToken, "id" | "createdAt" | "revokedAt">,
  ): Promise<PaymentMethodToken>;
  findPaymentMethod(
    accountId: string,
    id: string,
  ): Promise<PaymentMethodToken | null>;
  listPaymentMethods(accountId: string): Promise<readonly PaymentMethodToken[]>;
  updatePaymentMethod(
    accountId: string,
    id: string,
    metadata: Pick<
      PaymentMethodToken,
      "brand" | "last4" | "expiresMonth" | "expiresYear"
    >,
  ): Promise<PaymentMethodToken | null>;
  revokePaymentMethod(id: string, at: Date): Promise<PaymentMethodToken>;
  recordProviderEvent(event: PaymentProviderEvent): Promise<boolean>;
  syncInvoiceStatus(
    provider: string,
    reference: string,
    status: string,
    occurredAt: Date,
  ): Promise<{ id: string; accountId: string } | null>;
  syncSubscriptionStatus(
    provider: string,
    reference: string,
    status: string,
    occurredAt: Date,
  ): Promise<{ id: string; accountId: string } | null>;
}
export interface FinancialTransactionRunner {
  run<T>(
    work: (ports: {
      financial: FinancialRepository;
      audit: AuditLog;
      events: EventOutbox;
    }) => Promise<T>,
  ): Promise<T>;
}

const event = (
  type: string,
  occurredAt: Date,
  payload: Record<string, string | number | boolean | null>,
) => ({ topic: "financial", type, version: 1 as const, occurredAt, payload });
const assertKey = (key: string, label = "key") => {
  if (!/^[a-z][a-z0-9_.-]{1,95}$/.test(key))
    throw new DomainError(
      "INVALID_NAME",
      `${label} must be a stable lowercase catalog key.`,
    );
};
const assertQuantity = (quantity: bigint) => {
  if (quantity <= 0n || quantity > 9_223_372_036_854_775_807n)
    throw new DomainError(
      "INVALID_NAME",
      "Quantity must be a positive signed 64-bit integer.",
    );
};
function paymentMethodView(value: PaymentMethodToken): PaymentMethodView {
  const { tokenReference: _tokenReference, ...view } = value;
  return view;
}
function assertPaymentMethodMetadata(value: {
  brand?: string | null;
  last4?: string | null;
  expiresMonth?: number | null;
  expiresYear?: number | null;
}): void {
  if (value.brand != null && !/^[a-z0-9_-]{1,32}$/.test(value.brand))
    throw new DomainError("INVALID_NAME", "Payment brand is invalid.");
  if (value.last4 != null && !/^\d{4}$/.test(value.last4))
    throw new DomainError(
      "INVALID_NAME",
      "last4 must contain exactly four digits.",
    );
  if (
    value.expiresMonth != null &&
    (!Number.isInteger(value.expiresMonth) ||
      value.expiresMonth < 1 ||
      value.expiresMonth > 12)
  )
    throw new DomainError(
      "INVALID_NAME",
      "Expiry month must be between 1 and 12.",
    );
  if (
    value.expiresYear != null &&
    (!Number.isInteger(value.expiresYear) ||
      value.expiresYear < 2000 ||
      value.expiresYear > 2200)
  )
    throw new DomainError("INVALID_NAME", "Expiry year is invalid.");
}
function assertOwnAccount(actor: Actor, userId: string): void {
  if ((actor.kind === "user" ? actor.userId : actor.onBehalfOf) !== userId)
    throw new DomainError(
      "FORBIDDEN",
      "The actor cannot change another user's financial account.",
    );
}
function assertFinancialManager(actor: Actor): void {
  if (actor.kind !== "agent" || !actor.permissions.includes("financial:manage"))
    throw new DomainError(
      "FORBIDDEN",
      "A trusted financial manager is required.",
    );
}
/** Maps provider vocabulary to stable, provider-neutral events; retain the provider event separately for reconciliation. */
export function financialEventForProviderEvent(type: string): string {
  return (
    (
      {
        "invoice.finalized": "financial.invoice.finalized",
        "invoice.payment_failed": "financial.dunning.payment_failed",
        "invoice.payment_action_required": "financial.dunning.action_required",
        "invoice.payment_succeeded": "financial.dunning.payment_succeeded",
        "invoice.paid": "financial.invoice.paid",
        "checkout.session.completed": "financial.invoice.paid",
        "checkout.session.async_payment_succeeded": "financial.invoice.paid",
        "checkout.session.async_payment_failed":
          "financial.dunning.payment_failed",
        "invoice.overdue": "financial.dunning.overdue",
        "invoice.marked_uncollectible": "financial.invoice.uncollectible",
        "invoice.voided": "financial.invoice.voided",
        "customer.subscription.updated": "financial.subscription.updated",
        "customer.subscription.created": "financial.subscription.updated",
        "customer.subscription.deleted": "financial.subscription.canceled",
        "customer.subscription.trial_will_end":
          "financial.subscription.trial_ending",
        "payment_method.attached": "financial.payment_method.attached",
        "payment_method.detached": "financial.payment_method.detached",
        "charge.refunded": "financial.payment.refunded",
        "charge.dispute.created": "financial.payment.disputed",
      } as Record<string, string>
    )[type] ?? "financial.provider-event.applied"
  );
}
function providerTransition(
  value: PaymentProviderEvent,
): { resource: "invoice" | "subscription"; status: string } | null {
  if (value.provider !== "stripe") return null;
  switch (value.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return value.objectStatus &&
        [
          "trialing",
          "active",
          "past_due",
          "unpaid",
          "paused",
          "canceled",
          "incomplete",
          "incomplete_expired",
        ].includes(value.objectStatus)
        ? { resource: "subscription", status: value.objectStatus }
        : null;
    case "customer.subscription.deleted":
      return { resource: "subscription", status: "canceled" };
    default:
      return null;
  }
}
function usageWindowStart(
  definition: EntitlementDefinition,
  at: Date,
): Date | null {
  if (definition.resetStrategy === "never") return null;
  if (definition.resetStrategy === "rolling")
    return new Date(
      at.getTime() - (definition.resetIntervalSeconds ?? 0) * 1_000,
    );
  const start = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  if (definition.resetStrategy === "calendar_week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (definition.resetStrategy === "calendar_month") start.setUTCDate(1);
  return start;
}

export function createFinancialService(deps: {
  repository: FinancialRepository;
  transactions: FinancialTransactionRunner;
  clock?: () => Date;
  operationLog?: OperationLog;
}) {
  const clock = deps.clock ?? (() => new Date());
  const log = (
    name: string,
    attributes: Record<string, string | number | boolean | null>,
    correlationId?: string,
  ) => deps.operationLog?.info(name, attributes, correlationId);
  return {
    async ensureAccount(userId: string) {
      return deps.repository.ensureAccount(userId);
    },
    async findAccountByKey(key: string) {
      return deps.repository.findAccountByKey(key);
    },
    async bindAccountKey(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      key: string;
    }) {
      assertOwnAccount(input.actor, input.userId);
      assertFinancialManager(input.actor);
      if (!/^[A-Za-z0-9._:-]{4,128}$/.test(input.key))
        throw new DomainError(
          "INVALID_NAME",
          "Financial account key is invalid.",
        );
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const account = await financial.ensureAccount(input.userId);
        const created = await financial.bindAccountKey(account.id, input.key);
        if (created) {
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.financialAccountKeyBound,
            outcome: "succeeded",
            resource: { type: "financial-account", id: account.id },
            context: input.audit,
            changes: { keyBound: true },
          });
          await events.append(
            event("financial.account-key.bound", at, { accountId: account.id }),
          );
        }
        return { created };
      });
    },
    async removeAccountKey(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      key: string;
    }) {
      assertOwnAccount(input.actor, input.userId);
      assertFinancialManager(input.actor);
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const account = await financial.ensureAccount(input.userId);
        const removed = await financial.removeAccountKey(account.id, input.key);
        if (removed) {
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.financialAccountKeyRemoved,
            outcome: "succeeded",
            resource: { type: "financial-account", id: account.id },
            context: input.audit,
            changes: { keyRemoved: true },
          });
          await events.append(
            event("financial.account-key.removed", at, {
              accountId: account.id,
            }),
          );
        }
        return { removed };
      });
    },
    async listPaymentMethods(input: { actor: Actor; userId: string }) {
      assertOwnAccount(input.actor, input.userId);
      const account = await deps.repository.ensureAccount(input.userId);
      return (await deps.repository.listPaymentMethods(account.id)).map(
        paymentMethodView,
      );
    },
    async getPaymentMethod(input: {
      actor: Actor;
      userId: string;
      id: string;
    }) {
      assertOwnAccount(input.actor, input.userId);
      const account = await deps.repository.ensureAccount(input.userId);
      const value = await deps.repository.findPaymentMethod(
        account.id,
        input.id,
      );
      return value ? paymentMethodView(value) : null;
    },
    async registerEntitlementDefinition(definition: EntitlementDefinition) {
      assertKey(definition.key, "Entitlement key");
      if (
        definition.resetStrategy === "rolling" &&
        (definition.resetIntervalSeconds === null ||
          !Number.isInteger(definition.resetIntervalSeconds) ||
          definition.resetIntervalSeconds < 60)
      )
        throw new DomainError(
          "INVALID_NAME",
          "A rolling reset requires an interval of at least 60 seconds.",
        );
      if (
        definition.resetStrategy !== "rolling" &&
        definition.resetIntervalSeconds !== null
      )
        throw new DomainError(
          "INVALID_NAME",
          "Only rolling resets may define resetIntervalSeconds.",
        );
      return deps.repository.registerEntitlementDefinition(definition);
    },
    async grant(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      key: string;
      quantity?: bigint;
      productId?: string;
      priceId?: string;
      startsAt?: Date;
      endsAt?: Date;
    }) {
      assertOwnAccount(input.actor, input.userId);
      assertFinancialManager(input.actor);
      assertKey(input.key, "Entitlement key");
      if (input.quantity !== undefined) assertQuantity(input.quantity);
      const at = clock();
      const value = await deps.transactions.run(
        async ({ financial, audit, events }) => {
          const definition = await financial.findEntitlementDefinition(
            input.key,
          );
          if (!definition)
            throw new DomainError(
              "INVALID_NAME",
              `Unknown entitlement key ${input.key}.`,
            );
          const account = await financial.ensureAccount(input.userId);
          const granted = await financial.grantEntitlement({
            accountId: account.id,
            key: definition.key,
            quantity: input.quantity ?? null,
            startsAt: input.startsAt ?? at,
            endsAt: input.endsAt ?? null,
            revokedAt: null,
            productId: input.productId ?? null,
            priceId: input.priceId ?? null,
          });
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.entitlementGranted,
            outcome: "succeeded",
            resource: { type: "entitlement", id: granted.id },
            context: input.audit,
            changes: {
              key: granted.key,
              hasQuantity: granted.quantity !== null,
            },
          });
          await events.append(
            event("financial.entitlement.granted", at, {
              accountId: account.id,
              entitlementId: granted.id,
              key: granted.key,
            }),
          );
          return granted;
        },
      );
      log(
        "financial.entitlement.granted",
        { entitlementId: value.id, key: value.key },
        input.audit.correlationId,
      );
      return value;
    },
    async revoke(input: {
      actor: Actor;
      audit: AuditContext;
      entitlementId: string;
    }) {
      assertFinancialManager(input.actor);
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const existing = await financial.findEntitlementById(
          input.entitlementId,
        );
        if (!existing)
          throw new DomainError("USER_NOT_FOUND", "Entitlement not found.");
        const account = await financial.findAccountById(existing.accountId);
        if (!account)
          throw new DomainError(
            "USER_NOT_FOUND",
            "Financial account not found.",
          );
        assertOwnAccount(input.actor, account.userId);
        if (existing.revokedAt) return existing;
        const revoked = await financial.revokeEntitlement(
          input.entitlementId,
          at,
        );
        await audit.append({
          occurredAt: at,
          companyId: null,
          actor: input.actor,
          action: AUDIT_ACTION.entitlementRevoked,
          outcome: "succeeded",
          resource: { type: "entitlement", id: revoked.id },
          context: input.audit,
          changes: { key: revoked.key },
        });
        await events.append(
          event("financial.entitlement.revoked", at, {
            entitlementId: revoked.id,
            key: revoked.key,
          }),
        );
        return revoked;
      });
    },
    async recordUsage(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      entitlementKey: string;
      quantity: bigint;
      idempotencyKey: string;
    }) {
      assertOwnAccount(input.actor, input.userId);
      assertKey(input.entitlementKey, "Entitlement key");
      assertQuantity(input.quantity);
      if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200)
        throw new DomainError(
          "INVALID_NAME",
          "Usage idempotency key must be 8-200 characters.",
        );
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const account = await financial.ensureAccount(input.userId);
        const entitlement = await financial.findUsableEntitlement(
          account.id,
          input.entitlementKey,
          at,
        );
        const previous = await financial.findUsageByKey(input.idempotencyKey);
        if (previous) {
          if (
            previous.accountId !== account.id ||
            previous.entitlementKey !== input.entitlementKey ||
            previous.quantity !== input.quantity
          )
            throw new DomainError(
              "INVALID_NAME",
              "Idempotency key was already used for different usage.",
            );
          return previous;
        }
        if (!entitlement) {
          const offer = await financial.findSolePurchaseOption(
            input.entitlementKey,
          );
          throw new DomainError(
            "PAYMENT_REQUIRED",
            `An active ${input.entitlementKey} entitlement is required.`,
            { entitlementKey: input.entitlementKey, ...(offer ?? {}) },
          );
        }
        const definition = await financial.findEntitlementDefinition(
          input.entitlementKey,
        );
        if (!definition)
          throw new DomainError("INVALID_NAME", "Unknown entitlement key.");
        const allowance = await financial.entitlementQuantity(
          account.id,
          input.entitlementKey,
          at,
        );
        if (
          allowance !== null &&
          (await financial.usageTotal(
            account.id,
            input.entitlementKey,
            usageWindowStart(definition, at),
          )) +
            input.quantity >
            allowance
        ) {
          const offer = await financial.findSolePurchaseOption(
            input.entitlementKey,
          );
          throw new DomainError(
            "PAYMENT_REQUIRED",
            `The ${input.entitlementKey} allowance is exhausted.`,
            { entitlementKey: input.entitlementKey, ...(offer ?? {}) },
          );
        }
        const recorded = await financial.recordUsage({
          accountId: account.id,
          entitlementKey: input.entitlementKey,
          quantity: input.quantity,
          idempotencyKey: input.idempotencyKey,
          occurredAt: at,
        });
        if (recorded.created) {
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.usageRecorded,
            outcome: "succeeded",
            resource: { type: "usage", id: recorded.record.id },
            context: input.audit,
            changes: { key: input.entitlementKey },
          });
          await events.append(
            event("financial.usage.recorded", at, {
              accountId: account.id,
              usageId: recorded.record.id,
              key: input.entitlementKey,
            }),
          );
        }
        return recorded.record;
      });
    },
    async reverseUsage(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      originalUsageId: string;
      quantity: bigint;
      idempotencyKey: string;
    }) {
      assertOwnAccount(input.actor, input.userId);
      assertFinancialManager(input.actor);
      assertQuantity(input.quantity);
      if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200)
        throw new DomainError(
          "INVALID_NAME",
          "Usage idempotency key must be 8-200 characters.",
        );
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const account = await financial.ensureAccount(input.userId);
        const original = await financial.findUsageById(input.originalUsageId);
        if (
          !original ||
          original.accountId !== account.id ||
          original.quantity <= 0n
        )
          throw new DomainError(
            "USER_NOT_FOUND",
            "Original usage record not found.",
          );
        const previous = await financial.findUsageByKey(input.idempotencyKey);
        if (previous) {
          if (
            previous.accountId !== account.id ||
            previous.reversalOfId !== original.id ||
            previous.quantity !== -input.quantity
          )
            throw new DomainError(
              "INVALID_NAME",
              "Idempotency key was already used for different usage.",
            );
          return previous;
        }
        if (
          (await financial.usageReversedTotal(original.id)) + input.quantity >
          original.quantity
        )
          throw new DomainError(
            "INVALID_NAME",
            "Usage reversal exceeds the original quantity.",
          );
        const recorded = await financial.recordUsage({
          accountId: account.id,
          entitlementKey: original.entitlementKey,
          quantity: -input.quantity,
          idempotencyKey: input.idempotencyKey,
          occurredAt: original.occurredAt,
          reversalOfId: original.id,
        });
        if (recorded.created) {
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.usageReversed,
            outcome: "succeeded",
            resource: { type: "usage", id: recorded.record.id },
            context: input.audit,
            changes: {
              originalUsageId: original.id,
              key: original.entitlementKey,
            },
          });
          await events.append(
            event("financial.usage.reversed", at, {
              accountId: account.id,
              usageId: recorded.record.id,
              originalUsageId: original.id,
              key: original.entitlementKey,
            }),
          );
        }
        return recorded.record;
      });
    },
    /** Grants every catalogued entitlement attached to a price. Each price can therefore define different limits and reset policies. */
    async grantForPrice(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      priceId: string;
      productId: string;
      startsAt?: Date;
      endsAt?: Date;
    }) {
      assertOwnAccount(input.actor, input.userId);
      assertFinancialManager(input.actor);
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const mappings = await financial.listPriceEntitlements(input.priceId);
        if (mappings.length === 0)
          throw new DomainError(
            "INVALID_NAME",
            "The selected price has no entitlement mapping.",
          );
        const account = await financial.ensureAccount(input.userId);
        const grants: Entitlement[] = [];
        for (const mapping of mappings) {
          const definition = await financial.findEntitlementDefinition(
            mapping.entitlementKey,
          );
          if (!definition)
            throw new DomainError(
              "INVALID_NAME",
              "Price references an unknown entitlement key.",
            );
          if (mapping.quantity !== null) assertQuantity(mapping.quantity);
          const granted = await financial.grantEntitlement({
            accountId: account.id,
            key: definition.key,
            quantity: mapping.quantity,
            startsAt: input.startsAt ?? at,
            endsAt: input.endsAt ?? null,
            revokedAt: null,
            productId: input.productId,
            priceId: input.priceId,
          });
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action: AUDIT_ACTION.entitlementGranted,
            outcome: "succeeded",
            resource: { type: "entitlement", id: granted.id },
            context: input.audit,
            changes: {
              key: granted.key,
              hasQuantity: granted.quantity !== null,
            },
          });
          await events.append(
            event("financial.entitlement.granted", at, {
              accountId: account.id,
              entitlementId: granted.id,
              key: granted.key,
            }),
          );
          grants.push(granted);
        }
        return grants;
      });
    },
    async adjustWallet(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      currency: string;
      amountMinor: bigint;
      type: WalletEntry["type"];
      idempotencyKey: string;
    }) {
      assertOwnAccount(input.actor, input.userId);
      if (input.type !== "debit") assertFinancialManager(input.actor);
      if (!/^[A-Z]{3}$/.test(input.currency))
        throw new DomainError(
          "INVALID_NAME",
          "Currency must be an ISO 4217 uppercase code.",
        );
      if (input.amountMinor === 0n)
        throw new DomainError(
          "INVALID_NAME",
          "Wallet adjustment must be non-zero.",
        );
      if (
        input.amountMinor > 9_223_372_036_854_775_807n ||
        input.amountMinor < -9_223_372_036_854_775_807n
      )
        throw new DomainError(
          "INVALID_NAME",
          "Wallet amount exceeds the supported range.",
        );
      if (
        (input.type === "credit" && input.amountMinor < 0n) ||
        (input.type === "debit" && input.amountMinor > 0n)
      )
        throw new DomainError(
          "INVALID_NAME",
          "Wallet entry sign does not match its type.",
        );
      if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200)
        throw new DomainError(
          "INVALID_NAME",
          "Wallet idempotency key must be 8-200 characters.",
        );
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const account = await financial.ensureAccount(input.userId);
        const previous = await financial.findWalletEntryByKey(
          input.idempotencyKey,
        );
        if (previous) {
          if (
            previous.accountId !== account.id ||
            previous.currency !== input.currency ||
            previous.amountMinor !== input.amountMinor ||
            previous.type !== input.type
          )
            throw new DomainError(
              "INVALID_NAME",
              "Idempotency key was already used for a different wallet entry.",
            );
          return previous;
        }
        const current = await financial.walletBalance(
          account.id,
          input.currency,
        );
        if (current + input.amountMinor < 0n)
          throw new DomainError(
            "PAYMENT_REQUIRED",
            "Insufficient wallet credit.",
            { currency: input.currency },
          );
        const entry = await financial.addWalletEntry({
          accountId: account.id,
          currency: input.currency,
          amountMinor: input.amountMinor,
          type: input.type,
          idempotencyKey: input.idempotencyKey,
          occurredAt: at,
        });
        if (entry.created) {
          const action =
            input.type === "debit"
              ? AUDIT_ACTION.walletDebited
              : AUDIT_ACTION.walletCredited;
          await audit.append({
            occurredAt: at,
            companyId: null,
            actor: input.actor,
            action,
            outcome: "succeeded",
            resource: { type: "wallet-entry", id: entry.entry.id },
            context: input.audit,
            changes: { currency: input.currency, type: input.type },
          });
          await events.append(
            event(
              input.type === "debit"
                ? "financial.wallet.debited"
                : "financial.wallet.credited",
              at,
              {
                accountId: account.id,
                walletEntryId: entry.entry.id,
                currency: input.currency,
              },
            ),
          );
        }
        return entry.entry;
      });
    },
    async registerPaymentMethod(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      provider: string;
      tokenReference: string;
      brand?: string;
      last4?: string;
      expiresMonth?: number;
      expiresYear?: number;
    }) {
      assertOwnAccount(input.actor, input.userId);
      assertFinancialManager(input.actor);
      if (!/^[a-z][a-z0-9_-]{1,63}$/.test(input.provider))
        throw new DomainError(
          "INVALID_NAME",
          "Payment provider ID is invalid.",
        );
      if (input.tokenReference.length < 1 || input.tokenReference.length > 255)
        throw new DomainError(
          "INVALID_NAME",
          "Payment token reference must be 1-255 characters.",
        );
      if (
        input.provider === "stripe" &&
        !/^pm_[A-Za-z0-9]{3,252}$/.test(input.tokenReference)
      )
        throw new DomainError(
          "INVALID_NAME",
          "Stripe payment method reference is invalid.",
        );
      if (/^\d{13,19}$/.test(input.tokenReference))
        throw new DomainError(
          "INVALID_NAME",
          "A card number cannot be used as a token reference.",
        );
      assertPaymentMethodMetadata(input);
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const account = await financial.ensureAccount(input.userId);
        const paymentMethod = await financial.savePaymentMethod({
          accountId: account.id,
          provider: input.provider,
          tokenReference: input.tokenReference,
          brand: input.brand ?? null,
          last4: input.last4 ?? null,
          expiresMonth: input.expiresMonth ?? null,
          expiresYear: input.expiresYear ?? null,
        });
        await audit.append({
          occurredAt: at,
          companyId: null,
          actor: input.actor,
          action: AUDIT_ACTION.paymentMethodRegistered,
          outcome: "succeeded",
          resource: { type: "payment-method", id: paymentMethod.id },
          context: input.audit,
          changes: {
            provider: paymentMethod.provider,
            hasExpiry: paymentMethod.expiresYear !== null,
          },
        });
        await events.append(
          event("financial.payment-method.registered", at, {
            accountId: account.id,
            paymentMethodId: paymentMethod.id,
            provider: paymentMethod.provider,
          }),
        );
        return paymentMethodView(paymentMethod);
      });
    },
    async updatePaymentMethod(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      paymentMethodId: string;
      brand?: string | null;
      last4?: string | null;
      expiresMonth?: number | null;
      expiresYear?: number | null;
    }) {
      assertOwnAccount(input.actor, input.userId);
      assertFinancialManager(input.actor);
      assertPaymentMethodMetadata(input);
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const account = await financial.ensureAccount(input.userId);
        const current = await financial.findPaymentMethod(
          account.id,
          input.paymentMethodId,
        );
        if (!current || current.revokedAt)
          throw new DomainError(
            "USER_NOT_FOUND",
            "Active payment method not found.",
          );
        const metadata = {
          brand: input.brand === undefined ? current.brand : input.brand,
          last4: input.last4 === undefined ? current.last4 : input.last4,
          expiresMonth:
            input.expiresMonth === undefined
              ? current.expiresMonth
              : input.expiresMonth,
          expiresYear:
            input.expiresYear === undefined
              ? current.expiresYear
              : input.expiresYear,
        };
        const updated = await financial.updatePaymentMethod(
          account.id,
          current.id,
          metadata,
        );
        if (!updated)
          throw new DomainError(
            "USER_NOT_FOUND",
            "Active payment method not found.",
          );
        await audit.append({
          occurredAt: at,
          companyId: null,
          actor: input.actor,
          action: AUDIT_ACTION.paymentMethodUpdated,
          outcome: "succeeded",
          resource: { type: "payment-method", id: updated.id },
          context: input.audit,
          changes: { provider: updated.provider },
        });
        await events.append(
          event("financial.payment-method.updated", at, {
            paymentMethodId: updated.id,
            provider: updated.provider,
          }),
        );
        return paymentMethodView(updated);
      });
    },
    async revokePaymentMethod(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      paymentMethodId: string;
    }) {
      assertOwnAccount(input.actor, input.userId);
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const account = await financial.ensureAccount(input.userId);
        const existing = await financial.findPaymentMethod(
          account.id,
          input.paymentMethodId,
        );
        if (!existing)
          throw new DomainError("USER_NOT_FOUND", "Payment method not found.");
        if (existing.revokedAt) return paymentMethodView(existing);
        const paymentMethod = await financial.revokePaymentMethod(
          input.paymentMethodId,
          at,
        );
        await audit.append({
          occurredAt: at,
          companyId: null,
          actor: input.actor,
          action: AUDIT_ACTION.paymentMethodRevoked,
          outcome: "succeeded",
          resource: { type: "payment-method", id: paymentMethod.id },
          context: input.audit,
          changes: { provider: paymentMethod.provider },
        });
        await events.append(
          event("financial.payment-method.revoked", at, {
            paymentMethodId: paymentMethod.id,
            provider: paymentMethod.provider,
          }),
        );
        return paymentMethodView(paymentMethod);
      });
    },
    async applyProviderEvent(input: {
      actor: Actor;
      audit: AuditContext;
      event: PaymentProviderEvent;
    }) {
      const at = clock();
      return deps.transactions.run(async ({ financial, audit, events }) => {
        const created = await financial.recordProviderEvent(input.event);
        if (!created) return { created: false };
        const transition = providerTransition(input.event);
        const changed =
          transition && input.event.objectId
            ? transition.resource === "invoice"
              ? await financial.syncInvoiceStatus(
                  input.event.provider,
                  input.event.objectId,
                  transition.status,
                  input.event.occurredAt,
                )
              : await financial.syncSubscriptionStatus(
                  input.event.provider,
                  input.event.objectId,
                  transition.status,
                  input.event.occurredAt,
                )
            : null;
        await audit.append({
          occurredAt: at,
          companyId: null,
          actor: input.actor,
          action: AUDIT_ACTION.providerEventApplied,
          outcome: "succeeded",
          resource: {
            type: "provider-event",
            id: `${input.event.provider}:${input.event.eventId}`,
          },
          context: input.audit,
          changes: {
            provider: input.event.provider,
            type: input.event.type,
            appliedToLocalState: changed !== null,
          },
        });
        const type = changed
          ? financialEventForProviderEvent(input.event.type)
          : "financial.provider-event.applied";
        await events.append(
          event(type, at, {
            provider: input.event.provider,
            eventId: input.event.eventId,
            type: input.event.type,
          }),
        );
        return { created: true };
      });
    },
  };
}

export interface PaymentProvider {
  readonly id: string;
  createOneOffCheckout(input: {
    amount: Money;
    accountKey: string;
    idempotencyKey: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ providerReference: string; checkoutUrl: string }>;
}
export interface WebhookVerifier {
  verify(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }): PaymentProviderEvent;
}
/** Verified, provider-neutral event application. The implementation owns deduplication and local effects. */
export interface PaymentProviderSync {
  applyProviderEvent(input: {
    actor: Actor;
    audit: AuditContext;
    event: PaymentProviderEvent;
  }): Promise<{ created: boolean }>;
}
export class InvalidWebhookError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("Invalid payment provider notification.");
    this.name = "InvalidWebhookError";
  }
}
/** A tiny SDK-free Stripe adapter; callers use Stripe Checkout so card fields never traverse this service. */
export class StripeAdapter implements PaymentProvider, WebhookVerifier {
  readonly id = "stripe";
  constructor(
    private readonly config: {
      secretKey: string;
      webhookSecret: string;
      fetch?: typeof globalThis.fetch;
      clock?: () => Date;
    },
  ) {}
  async createOneOffCheckout(input: {
    amount: Money;
    accountKey: string;
    idempotencyKey: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    if (
      !/^[A-Z]{3}$/.test(input.amount.currency) ||
      input.amount.amountMinor <= 0n ||
      input.amount.amountMinor > 99_999_999n
    )
      throw new DomainError(
        "INVALID_NAME",
        "Stripe checkout amount or currency is invalid.",
      );
    if (
      !/^[A-Za-z0-9._:-]{4,128}$/.test(input.accountKey) ||
      input.idempotencyKey.length < 8 ||
      input.idempotencyKey.length > 200 ||
      input.description.length < 1 ||
      input.description.length > 250
    )
      throw new DomainError(
        "INVALID_NAME",
        "Stripe checkout reference or description is invalid.",
      );
    for (const url of [input.successUrl, input.cancelUrl]) {
      if (!URL.canParse(url) || new URL(url).protocol !== "https:")
        throw new DomainError(
          "INVALID_NAME",
          "Stripe return URLs must be absolute HTTPS URLs.",
        );
    }
    const response = await (this.config.fetch ?? fetch)(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": input.idempotencyKey,
        },
        body: new URLSearchParams({
          mode: "payment",
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          "line_items[0][price_data][currency]":
            input.amount.currency.toLowerCase(),
          "line_items[0][price_data][unit_amount]":
            input.amount.amountMinor.toString(),
          "line_items[0][price_data][product_data][name]": input.description,
          "line_items[0][quantity]": "1",
          client_reference_id: input.accountKey,
        }),
      },
    );
    if (!response.ok) throw new Error("Stripe checkout creation failed.");
    const body = (await response.json()) as { id?: string; url?: string };
    if (!body.id || !body.url)
      throw new Error("Stripe returned an incomplete checkout session.");
    return { providerReference: body.id, checkoutUrl: body.url };
  }
  private async stripeRequest(
    path: string,
    method: "GET" | "POST",
    body?: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const response = await (this.config.fetch ?? fetch)(
      `https://api.stripe.com/v1/${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${this.config.secretKey}`,
          ...(body
            ? { "content-type": "application/x-www-form-urlencoded" }
            : {}),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("Stripe request failed.");
    const raw = await response.text();
    if (raw.length > 65_536) throw new Error("Stripe response is too large.");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("Stripe returned invalid JSON.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Stripe returned an invalid object.");
    return value as Record<string, unknown>;
  }
  async refundPayment(input: {
    paymentIntentId: string;
    amountMinor: bigint;
    currency: string;
    idempotencyKey: string;
    reason: "duplicate" | "fraudulent" | "requested_by_customer";
  }) {
    if (
      !/^pi_[A-Za-z0-9]{4,200}$/.test(input.paymentIntentId) ||
      input.amountMinor <= 0n ||
      input.amountMinor > 99_999_999n ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      !/^[A-Za-z0-9._:-]{8,200}$/.test(input.idempotencyKey)
    )
      throw new DomainError(
        "INVALID_NAME",
        "Stripe refund fields are invalid.",
      );
    const value = await this.stripeRequest(
      "refunds",
      "POST",
      new URLSearchParams({
        payment_intent: input.paymentIntentId,
        amount: input.amountMinor.toString(),
        reason: input.reason,
      }),
      input.idempotencyKey,
    );
    if (
      typeof value.id !== "string" ||
      !/^re_[A-Za-z0-9]{4,200}$/.test(value.id) ||
      value.payment_intent !== input.paymentIntentId ||
      value.amount !== Number(input.amountMinor) ||
      value.currency !== input.currency.toLowerCase() ||
      !["succeeded", "pending", "failed", "canceled"].includes(
        String(value.status),
      )
    )
      throw new Error("Stripe refund response did not match the request.");
    return {
      providerReference: value.id,
      status: value.status as "succeeded" | "pending" | "failed" | "canceled",
    };
  }
  async detachPaymentMethod(input: {
    customerId: string;
    paymentMethodId: string;
  }) {
    if (
      !/^cus_[A-Za-z0-9]{4,200}$/.test(input.customerId) ||
      !/^pm_[A-Za-z0-9]{4,200}$/.test(input.paymentMethodId)
    )
      throw new DomainError(
        "INVALID_NAME",
        "Stripe customer or payment method ID is invalid.",
      );
    const existing = await this.stripeRequest(
      `payment_methods/${input.paymentMethodId}`,
      "GET",
    );
    if (
      existing.id !== input.paymentMethodId ||
      existing.customer !== input.customerId
    )
      throw new DomainError(
        "FORBIDDEN",
        "Payment method does not belong to this Stripe customer.",
      );
    const result = await this.stripeRequest(
      `payment_methods/${input.paymentMethodId}/detach`,
      "POST",
    );
    if (result.id !== input.paymentMethodId || result.customer !== null)
      throw new Error("Stripe did not confirm payment method detachment.");
    return { providerReference: input.paymentMethodId };
  }
  async setDefaultPaymentMethod(input: {
    customerId: string;
    paymentMethodId: string;
  }) {
    if (
      !/^cus_[A-Za-z0-9]{4,200}$/.test(input.customerId) ||
      !/^pm_[A-Za-z0-9]{4,200}$/.test(input.paymentMethodId)
    )
      throw new DomainError(
        "INVALID_NAME",
        "Stripe customer or payment method ID is invalid.",
      );
    const existing = await this.stripeRequest(
      `payment_methods/${input.paymentMethodId}`,
      "GET",
    );
    if (
      existing.id !== input.paymentMethodId ||
      existing.customer !== input.customerId
    )
      throw new DomainError(
        "FORBIDDEN",
        "Payment method does not belong to this Stripe customer.",
      );
    const result = await this.stripeRequest(
      `customers/${input.customerId}`,
      "POST",
      new URLSearchParams({
        "invoice_settings[default_payment_method]": input.paymentMethodId,
      }),
    );
    const settings = result.invoice_settings;
    if (
      result.id !== input.customerId ||
      !settings ||
      typeof settings !== "object" ||
      Array.isArray(settings) ||
      (settings as Record<string, unknown>).default_payment_method !==
        input.paymentMethodId
    )
      throw new Error("Stripe did not confirm default payment method.");
    return {
      customerId: input.customerId,
      providerReference: input.paymentMethodId,
    };
  }
  verify(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }): PaymentProviderEvent {
    const header = input.headers["stripe-signature"];
    if (typeof header !== "string" || input.rawBody.length > 65_536)
      throw new InvalidWebhookError();
    const values = header.split(",").map((part) => part.trim());
    const timestampText = values
      .find((part) => part.startsWith("t="))
      ?.slice(2);
    const signatures = values
      .filter((part) => part.startsWith("v1="))
      .map((part) => part.slice(3));
    if (
      !timestampText ||
      !/^\d{1,12}$/.test(timestampText) ||
      signatures.length === 0
    )
      throw new InvalidWebhookError();
    const timestamp = Number(timestampText);
    const nowSeconds = Math.floor(
      (this.config.clock?.() ?? new Date()).getTime() / 1000,
    );
    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(nowSeconds - timestamp) > 300
    )
      throw new InvalidWebhookError();
    const digest = createHmac("sha256", this.config.webhookSecret)
      .update(`${timestampText}.${input.rawBody}`)
      .digest();
    if (
      !signatures.some(
        (value) =>
          /^[a-f0-9]{64}$/i.test(value) &&
          timingSafeEqual(digest, Buffer.from(value, "hex")),
      )
    )
      throw new InvalidWebhookError();
    let body: unknown;
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      throw new InvalidWebhookError();
    }
    if (!body || typeof body !== "object") throw new InvalidWebhookError();
    const record = body as Record<string, unknown>;
    const data = record.data as
      { object?: Record<string, unknown> } | undefined;
    const object = data?.object;
    if (
      typeof record.id !== "string" ||
      !/^evt_[a-zA-Z0-9]{4,128}$/.test(record.id) ||
      typeof record.type !== "string" ||
      !/^[a-z_.]{3,120}$/.test(record.type) ||
      typeof record.created !== "number" ||
      !Number.isSafeInteger(record.created) ||
      !object ||
      typeof object !== "object"
    )
      throw new InvalidWebhookError();
    const objectId = object.id;
    const accountKey = object.client_reference_id;
    const customer = object.customer;
    const status = object.status ?? object.payment_status;
    const paymentStatus = object.payment_status;
    const amountMinor =
      record.type === "refund.updated"
        ? object.amount
        : (object.amount_total ?? object.amount_paid);
    const currencyCode = object.currency;
    const paymentReference = object.payment_intent;
    return {
      provider: this.id,
      eventId: record.id,
      type: record.type,
      occurredAt: new Date(record.created * 1_000),
      payloadReference: record.id,
      ...(typeof objectId === "string" && objectId.length <= 255
        ? { objectId }
        : {}),
      ...(typeof accountKey === "string" && accountKey.length <= 255
        ? { accountKey }
        : {}),
      ...(typeof customer === "string" && customer.length <= 255
        ? { providerCustomerId: customer }
        : {}),
      ...(typeof status === "string" && status.length <= 40
        ? { objectStatus: status }
        : {}),
      ...(typeof paymentStatus === "string" && paymentStatus.length <= 40
        ? { paymentStatus }
        : {}),
      ...(typeof amountMinor === "number" &&
      Number.isSafeInteger(amountMinor) &&
      amountMinor >= 0
        ? { amountMinor: BigInt(amountMinor) }
        : {}),
      ...(typeof currencyCode === "string" && /^[a-z]{3}$/.test(currencyCode)
        ? { currency: currencyCode.toUpperCase() }
        : {}),
      ...(typeof paymentReference === "string" &&
      /^pi_[A-Za-z0-9]{4,200}$/.test(paymentReference)
        ? { paymentReference }
        : {}),
    };
  }
}
export function readFinancialConfiguration(
  environment: NodeJS.ProcessEnv,
  operationLog?: OperationLog,
) {
  const stripeKey = environment.EDU_STRIPE_SECRET_KEY?.trim();
  const stripeWebhookSecret = environment.EDU_STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripeKey || !stripeWebhookSecret)
    operationLog?.error("financial.provider.unavailable", {
      provider: "stripe",
      reason: "missing_configuration",
    });
  const powerTranzFields = [
    environment.EDU_POWERTRANZ_BASE_URL,
    environment.EDU_POWERTRANZ_MERCHANT_ID,
    environment.EDU_POWERTRANZ_MERCHANT_PASSWORD,
    environment.EDU_POWERTRANZ_PAGE_SET,
    environment.EDU_POWERTRANZ_PAGE_NAME,
    environment.EDU_POWERTRANZ_CURRENCY,
    environment.EDU_POWERTRANZ_CURRENCY_CODE,
    environment.EDU_POWERTRANZ_CURRENCY_EXPONENT,
  ];
  const powerTranzConfigured = powerTranzFields.every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (!powerTranzConfigured)
    operationLog?.error("financial.provider.unavailable", {
      provider: "powertranz",
      reason: "missing_configuration",
    });
  return {
    stripe:
      stripeKey && stripeWebhookSecret
        ? new StripeAdapter({
            secretKey: stripeKey,
            webhookSecret: stripeWebhookSecret,
          })
        : null,
    powertranz: powerTranzConfigured
      ? new PowerTranzAdapter({
          baseUrl: environment.EDU_POWERTRANZ_BASE_URL!.trim(),
          merchantId: environment.EDU_POWERTRANZ_MERCHANT_ID!.trim(),
          merchantPassword:
            environment.EDU_POWERTRANZ_MERCHANT_PASSWORD!.trim(),
          pageSet: environment.EDU_POWERTRANZ_PAGE_SET!.trim(),
          pageName: environment.EDU_POWERTRANZ_PAGE_NAME!.trim(),
          currency: environment.EDU_POWERTRANZ_CURRENCY!.trim(),
          numericCurrencyCode: environment.EDU_POWERTRANZ_CURRENCY_CODE!.trim(),
          currencyExponent: Number(
            environment.EDU_POWERTRANZ_CURRENCY_EXPONENT,
          ),
        })
      : null,
  };
}
