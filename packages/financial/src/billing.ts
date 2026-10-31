import { randomBytes, randomUUID } from "node:crypto";
import {
  AUDIT_ACTION,
  DomainError,
  type Actor,
  type AuditContext,
  type AuditLog,
  type EventOutbox,
  type OperationLog,
} from "@edu-service/core";
import type {
  BillingFrequency,
  Entitlement,
  FinancialRepository,
  PaymentProviderEvent,
  Price,
  Product,
  RiskLevel,
} from "./index.js";

const MAX = 9_223_372_036_854_775_807n;
export interface BillingPrice extends Price {
  productName: string;
  productActive: boolean;
  productRiskLevel: RiskLevel;
}
export interface BillingCoupon {
  id: string;
  code: string;
  percentOff: number | null;
  amountOffMinor: bigint | null;
  currency: string | null;
  productId: string | null;
  maxRedemptions: number | null;
  redeemBy: Date | null;
  active: boolean;
}
export interface InvoiceLineSnapshot {
  id: string;
  invoiceId: string;
  productId: string;
  priceId: string;
  description: string;
  quantity: bigint;
  unitAmountMinor: bigint;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxRateBps: number;
  taxMinor: bigint;
  totalMinor: bigint;
  serviceStartsAt: Date | null;
  serviceEndsAt: Date | null;
}
export interface BillingInvoice {
  id: string;
  accountId: string;
  idempotencyKey: string | null;
  currency: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  status: string;
  provider: string | null;
  providerReference: string | null;
  subscriptionId: string | null;
  dueAt: Date | null;
  issuedAt: Date | null;
  paidAt: Date | null;
  lines: readonly InvoiceLineSnapshot[];
}
export interface BillingPayment {
  id: string;
  invoiceId: string;
  provider: string;
  providerReference: string;
  amountMinor: bigint;
  currency: string;
  status: string;
  occurredAt: Date;
}
export interface BillingRefund {
  id: string;
  paymentId: string;
  provider: string;
  providerReference: string;
  amountMinor: bigint;
  status: string;
  occurredAt: Date;
}
export interface BillingSubscription {
  id: string;
  accountId: string;
  productId: string;
  priceId: string;
  provider: string | null;
  providerReference: string | null;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodStartsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
}
export interface DunningSchedule {
  delaysSeconds: readonly number[];
  graceSeconds: number;
}

export interface BillingRepository {
  createProduct(input: {
    id: string;
    key: string;
    name: string;
    riskLevel: RiskLevel;
  }): Promise<Product>;
  updateProduct(
    id: string,
    input: { name?: string; active?: boolean; riskLevel?: RiskLevel },
  ): Promise<Product | null>;
  createPrice(
    input: Price,
    mappings: readonly { key: string; quantity: bigint | null }[],
  ): Promise<Price>;
  findPrice(id: string): Promise<BillingPrice | null>;
  retirePrice(id: string): Promise<Price | null>;
  createCoupon(input: BillingCoupon): Promise<BillingCoupon>;
  findCoupon(code: string): Promise<BillingCoupon | null>;
  countCouponRedemptions(couponId: string): Promise<number>;
  findInvoiceByKey(key: string): Promise<BillingInvoice | null>;
  findInvoice(id: string): Promise<BillingInvoice | null>;
  findInvoiceByProviderReference(
    provider: string,
    reference: string,
  ): Promise<BillingInvoice | null>;
  createInvoice(
    input: BillingInvoice,
    couponRedemption: {
      couponId: string;
      amountMinor: bigint;
      redeemedAt: Date;
    } | null,
  ): Promise<BillingInvoice>;
  bindInvoiceProvider(
    invoiceId: string,
    provider: string,
    reference: string,
  ): Promise<BillingInvoice | null>;
  recordPayment(
    input: BillingPayment,
  ): Promise<{ payment: BillingPayment; created: boolean }>;
  paidTotal(invoiceId: string): Promise<bigint>;
  markInvoicePaid(invoiceId: string, at: Date): Promise<boolean>;
  findPayment(id: string): Promise<BillingPayment | null>;
  findPaymentByProviderReference(
    provider: string,
    reference: string,
  ): Promise<BillingPayment | null>;
  refundedTotal(paymentId: string): Promise<bigint>;
  refundedTotalForInvoice(invoiceId: string): Promise<bigint>;
  findRefundByProviderReference(
    provider: string,
    reference: string,
  ): Promise<BillingRefund | null>;
  recordRefund(
    input: BillingRefund,
    creditNote: { id: string; invoiceId: string; reason: string },
  ): Promise<{ refund: BillingRefund; created: boolean }>;
  createSubscription(input: BillingSubscription): Promise<BillingSubscription>;
  findSubscription(id: string): Promise<BillingSubscription | null>;
  hasHadTrial(accountId: string, productId: string): Promise<boolean>;
  updateSubscription(
    id: string,
    update: Partial<
      Pick<
        BillingSubscription,
        | "status"
        | "currentPeriodStartsAt"
        | "currentPeriodEndsAt"
        | "cancelAtPeriodEnd"
        | "canceledAt"
      >
    >,
  ): Promise<BillingSubscription>;
  recordRenewal(
    subscriptionId: string,
    invoiceId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<boolean>;
  recordDunning(input: {
    id: string;
    invoiceId: string;
    attemptNumber: number;
    status: string;
    failureCategory: string;
    providerFailureCode: string | null;
    requiresCustomerAction: boolean;
    nextAttemptAt: Date | null;
    providerEventId: string;
  }): Promise<boolean>;
  countDunningAttempts(invoiceId: string): Promise<number>;
  findDunningByProviderEventId(providerEventId: string): Promise<{
    invoiceId: string;
    attemptNumber: number;
    status: string;
    nextAttemptAt: Date | null;
  } | null>;
  setDefaultPaymentMethod(
    accountId: string,
    methodId: string | null,
  ): Promise<void>;
  markPaymentMethodDetached(
    accountId: string,
    methodId: string,
    at: Date,
  ): Promise<boolean>;
  findPaymentMethodByProviderReference(
    provider: string,
    reference: string,
  ): Promise<{ id: string; accountId: string } | null>;
  listEntitlementsForInvoice(
    invoiceId: string,
  ): Promise<readonly Entitlement[]>;
}
export interface BillingTransactionRunner {
  run<T>(
    work: (ports: {
      billing: BillingRepository;
      financial: FinancialRepository;
      audit: AuditLog;
      events: EventOutbox;
    }) => Promise<T>,
  ): Promise<T>;
}

function manager(actor: Actor, userId?: string): void {
  if (
    actor.kind !== "agent" ||
    !actor.permissions.includes("financial:manage") ||
    (userId !== undefined && actor.onBehalfOf !== userId)
  )
    throw new DomainError(
      "FORBIDDEN",
      "A trusted financial manager for this account is required.",
    );
}
function positive(value: bigint, label: string): void {
  if (value <= 0n || value > MAX)
    throw new DomainError(
      "INVALID_NAME",
      `${label} must be a positive signed 64-bit integer.`,
    );
}
function currency(value: string): void {
  if (!/^[A-Z]{3}$/.test(value))
    throw new DomainError(
      "INVALID_NAME",
      "Currency must be an uppercase ISO 4217 code.",
    );
}
function reference(value: string): void {
  if (!/^[A-Za-z0-9._:-]{4,200}$/.test(value))
    throw new DomainError("INVALID_NAME", "Billing reference is invalid.");
}
function provider(value: string): void {
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(value))
    throw new DomainError("INVALID_NAME", "Payment provider is invalid.");
}
function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
function roundBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps) + 5_000n) / 10_000n;
}
function nextPeriodEnd(
  start: Date,
  frequency: BillingFrequency,
  count: number,
): Date {
  const end = new Date(start);
  if (frequency === "day") end.setUTCDate(end.getUTCDate() + count);
  else if (frequency === "week") end.setUTCDate(end.getUTCDate() + count * 7);
  else if (frequency === "month" || frequency === "year") {
    const months = count * (frequency === "year" ? 12 : 1);
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + months);
    const last = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
    ).getUTCDate();
    end.setUTCDate(Math.min(day, last));
  } else
    throw new DomainError("INVALID_NAME", "A recurring price is required.");
  if (!Number.isFinite(end.getTime()) || end <= start)
    throw new DomainError(
      "INVALID_NAME",
      "Subscription period cannot be advanced.",
    );
  return end;
}
function financialEvent(
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

export function createBillingService(deps: {
  repository: BillingRepository;
  transactions: BillingTransactionRunner;
  clock?: () => Date;
  operationLog?: OperationLog;
}) {
  const clock = deps.clock ?? (() => new Date());
  async function auditAndEvent(
    ports: { audit: AuditLog; events: EventOutbox },
    input: { actor: Actor; audit: AuditContext },
    type: keyof typeof AUDIT_ACTION,
    resource: {
      type:
        | "product"
        | "price"
        | "coupon"
        | "invoice"
        | "payment"
        | "refund"
        | "credit-note"
        | "subscription"
        | "dunning-attempt"
        | "payment-method";
      id: string;
    },
    payload: Record<string, string | number | boolean | null>,
    at: Date,
  ) {
    const action = AUDIT_ACTION[type];
    await ports.audit.append({
      occurredAt: at,
      companyId: null,
      actor: input.actor,
      action,
      outcome: "succeeded",
      resource,
      context: input.audit,
      changes: { ...payload },
    });
    await ports.events.append(financialEvent(action, at, payload));
  }
  async function fulfillInvoice(
    ports: {
      billing: BillingRepository;
      financial: FinancialRepository;
      audit: AuditLog;
      events: EventOutbox;
    },
    input: { actor: Actor; audit: AuditContext },
    invoice: BillingInvoice,
    at: Date,
  ): Promise<boolean> {
    if (!(await ports.billing.markInvoicePaid(invoice.id, at))) return false;
    await auditAndEvent(
      ports,
      input,
      "invoicePaid",
      { type: "invoice", id: invoice.id },
      { invoiceId: invoice.id, accountId: invoice.accountId },
      at,
    );
    if (invoice.subscriptionId) {
      const subscription = await ports.billing.findSubscription(
        invoice.subscriptionId,
      );
      const period = invoice.lines[0];
      if (
        !subscription ||
        subscription.accountId !== invoice.accountId ||
        !period?.serviceStartsAt ||
        !period.serviceEndsAt
      )
        throw new DomainError(
          "INVALID_NAME",
          "Subscription invoice has no valid service period.",
        );
      const renewed = await ports.billing.recordRenewal(
        subscription.id,
        invoice.id,
        period.serviceStartsAt,
        period.serviceEndsAt,
      );
      if (renewed) {
        await ports.billing.updateSubscription(subscription.id, {
          status: "active",
          currentPeriodStartsAt: period.serviceStartsAt,
          currentPeriodEndsAt: period.serviceEndsAt,
        });
        await auditAndEvent(
          ports,
          input,
          "subscriptionRenewed",
          { type: "subscription", id: subscription.id },
          { subscriptionId: subscription.id, invoiceId: invoice.id },
          at,
        );
      }
    }
    for (const line of invoice.lines)
      for (const mapping of await ports.financial.listPriceEntitlements(
        line.priceId,
      )) {
        const quantity =
          mapping.quantity === null ? null : mapping.quantity * line.quantity;
        if (quantity !== null && quantity > MAX)
          throw new DomainError(
            "INVALID_NAME",
            "Fulfillment quantity exceeds the supported range.",
          );
        const granted = await ports.financial.grantEntitlement({
          accountId: invoice.accountId,
          key: mapping.entitlementKey,
          quantity,
          startsAt: line.serviceStartsAt ?? at,
          endsAt: line.serviceEndsAt,
          revokedAt: null,
          productId: line.productId,
          priceId: line.priceId,
          invoiceId: invoice.id,
        });
        await ports.audit.append({
          occurredAt: at,
          companyId: null,
          actor: input.actor,
          action: AUDIT_ACTION.entitlementGranted,
          outcome: "succeeded",
          resource: { type: "entitlement", id: granted.id },
          context: input.audit,
          changes: { key: granted.key, invoiceId: invoice.id },
        });
        await ports.events.append(
          financialEvent("financial.entitlement.granted", at, {
            accountId: invoice.accountId,
            entitlementId: granted.id,
            key: granted.key,
          }),
        );
      }
    await ports.events.append(
      financialEvent("financial.fulfillment.completed", at, {
        invoiceId: invoice.id,
        accountId: invoice.accountId,
      }),
    );
    return true;
  }
  const api = {
    async createProduct(input: {
      actor: Actor;
      audit: AuditContext;
      key: string;
      name: string;
      riskLevel: RiskLevel;
    }) {
      manager(input.actor);
      if (
        !/^[a-z][a-z0-9_.-]{1,95}$/.test(input.key) ||
        input.name.length < 1 ||
        input.name.length > 200 ||
        !["low", "standard", "high", "blocked"].includes(input.riskLevel)
      )
        throw new DomainError("INVALID_NAME", "Product fields are invalid.");
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const product = await ports.billing.createProduct({
          id: randomUUID(),
          key: input.key,
          name: input.name,
          riskLevel: input.riskLevel,
        });
        await auditAndEvent(
          ports,
          input,
          "productCreated",
          { type: "product", id: product.id },
          { productId: product.id },
          at,
        );
        return product;
      });
    },
    async updateProduct(input: {
      actor: Actor;
      audit: AuditContext;
      id: string;
      name?: string;
      active?: boolean;
      riskLevel?: RiskLevel;
    }) {
      manager(input.actor);
      if (
        (input.name !== undefined &&
          (input.name.length < 1 || input.name.length > 200)) ||
        (input.riskLevel !== undefined &&
          !["low", "standard", "high", "blocked"].includes(input.riskLevel))
      )
        throw new DomainError("INVALID_NAME", "Product fields are invalid.");
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const product = await ports.billing.updateProduct(input.id, {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.active === undefined ? {} : { active: input.active }),
          ...(input.riskLevel === undefined
            ? {}
            : { riskLevel: input.riskLevel }),
        });
        if (!product)
          throw new DomainError("USER_NOT_FOUND", "Product not found.");
        await auditAndEvent(
          ports,
          input,
          "productUpdated",
          { type: "product", id: product.id },
          { productId: product.id, active: product.active },
          at,
        );
        return product;
      });
    },
    async createPrice(input: {
      actor: Actor;
      audit: AuditContext;
      productId: string;
      currency: string;
      unitAmountMinor: bigint;
      frequency: BillingFrequency;
      intervalCount: number;
      trialDays: number;
      entitlements: readonly { key: string; quantity: bigint | null }[];
    }) {
      manager(input.actor);
      currency(input.currency);
      if (
        input.unitAmountMinor < 0n ||
        input.unitAmountMinor > MAX ||
        !["one_time", "day", "week", "month", "year"].includes(
          input.frequency,
        ) ||
        !Number.isInteger(input.intervalCount) ||
        input.intervalCount < 1 ||
        !Number.isInteger(input.trialDays) ||
        input.trialDays < 0 ||
        input.trialDays > 365 ||
        (input.frequency === "one_time" && input.trialDays !== 0) ||
        input.entitlements.length < 1 ||
        input.entitlements.length > 100
      )
        throw new DomainError("INVALID_NAME", "Price fields are invalid.");
      const keys = new Set<string>();
      for (const mapping of input.entitlements) {
        if (
          !/^[a-z][a-z0-9_.-]{1,95}$/.test(mapping.key) ||
          keys.has(mapping.key)
        )
          throw new DomainError(
            "INVALID_NAME",
            "Price entitlement key is invalid or duplicated.",
          );
        keys.add(mapping.key);
        if (mapping.quantity !== null)
          positive(mapping.quantity, "Entitlement quantity");
      }
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const price = await ports.billing.createPrice(
          {
            id: randomUUID(),
            productId: input.productId,
            currency: input.currency,
            unitAmountMinor: input.unitAmountMinor,
            frequency: input.frequency,
            intervalCount: input.intervalCount,
            trialDays: input.trialDays,
            active: true,
          },
          input.entitlements,
        );
        await auditAndEvent(
          ports,
          input,
          "priceCreated",
          { type: "price", id: price.id },
          { priceId: price.id, productId: price.productId },
          at,
        );
        return price;
      });
    },
    async retirePrice(input: {
      actor: Actor;
      audit: AuditContext;
      priceId: string;
    }) {
      manager(input.actor);
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const price = await ports.billing.retirePrice(input.priceId);
        if (!price) throw new DomainError("USER_NOT_FOUND", "Price not found.");
        await auditAndEvent(
          ports,
          input,
          "priceRetired",
          { type: "price", id: price.id },
          { priceId: price.id },
          at,
        );
        return price;
      });
    },
    async createCoupon(input: {
      actor: Actor;
      audit: AuditContext;
      code?: string;
      percentOff?: number;
      amountOffMinor?: bigint;
      currency?: string;
      productId?: string;
      maxRedemptions?: number;
      redeemBy?: Date;
    }) {
      manager(input.actor);
      const code = (
        input.code ?? randomBytes(12).toString("base64url")
      ).toUpperCase();
      if (
        !/^[A-Z0-9_-]{8,64}$/.test(code) ||
        (input.percentOff === undefined) ===
          (input.amountOffMinor === undefined)
      )
        throw new DomainError(
          "INVALID_NAME",
          "Coupon code or discount is invalid.",
        );
      if (
        input.percentOff !== undefined &&
        (!Number.isInteger(input.percentOff) ||
          input.percentOff < 1 ||
          input.percentOff > 100 ||
          input.currency !== undefined)
      )
        throw new DomainError("INVALID_NAME", "Coupon percentage is invalid.");
      if (input.amountOffMinor !== undefined) {
        positive(input.amountOffMinor, "Coupon amount");
        if (!input.currency)
          throw new DomainError(
            "INVALID_NAME",
            "Fixed coupon requires a currency.",
          );
        currency(input.currency);
      }
      if (
        (input.maxRedemptions !== undefined &&
          (!Number.isInteger(input.maxRedemptions) ||
            input.maxRedemptions < 1)) ||
        (input.redeemBy !== undefined && !validDate(input.redeemBy))
      )
        throw new DomainError(
          "INVALID_NAME",
          "Coupon timeline or redemption limit is invalid.",
        );
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const coupon = await ports.billing.createCoupon({
          id: randomUUID(),
          code,
          percentOff: input.percentOff ?? null,
          amountOffMinor: input.amountOffMinor ?? null,
          currency: input.currency ?? null,
          productId: input.productId ?? null,
          maxRedemptions: input.maxRedemptions ?? null,
          redeemBy: input.redeemBy ?? null,
          active: true,
        });
        await auditAndEvent(
          ports,
          input,
          "couponCreated",
          { type: "coupon", id: coupon.id },
          { couponId: coupon.id },
          at,
        );
        return coupon;
      });
    },
    async issueInvoice(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      idempotencyKey: string;
      lines: readonly {
        priceId: string;
        quantity: bigint;
        taxRateBps: number;
        serviceStartsAt?: Date;
        serviceEndsAt?: Date;
      }[];
      couponCode?: string;
      dueAt?: Date;
      subscriptionId?: string;
    }) {
      manager(input.actor, input.userId);
      reference(input.idempotencyKey);
      if (
        input.lines.length < 1 ||
        input.lines.length > 100 ||
        (input.couponCode !== undefined &&
          !/^[A-Za-z0-9_-]{8,64}$/.test(input.couponCode)) ||
        (input.dueAt !== undefined && !validDate(input.dueAt))
      )
        throw new DomainError("INVALID_NAME", "Invoice fields are invalid.");
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        const prior = await ports.billing.findInvoiceByKey(
          input.idempotencyKey,
        );
        if (prior) {
          if (prior.accountId !== account.id)
            throw new DomainError(
              "FORBIDDEN",
              "Invoice key belongs to another account.",
            );
          return prior;
        }
        if (input.subscriptionId) {
          const subscription = await ports.billing.findSubscription(
            input.subscriptionId,
          );
          if (
            !subscription ||
            subscription.accountId !== account.id ||
            subscription.cancelAtPeriodEnd ||
            subscription.status === "canceled" ||
            input.lines.some((line) => line.priceId !== subscription.priceId)
          )
            throw new DomainError(
              "INVALID_NAME",
              "Invoice subscription and price do not match.",
            );
        }
        let invoiceCurrency: string | null = null;
        const prices: BillingPrice[] = [];
        let subtotal = 0n;
        for (const line of input.lines) {
          positive(line.quantity, "Invoice quantity");
          if (
            !Number.isInteger(line.taxRateBps) ||
            line.taxRateBps < 0 ||
            line.taxRateBps > 10_000 ||
            (line.serviceStartsAt !== undefined &&
              !validDate(line.serviceStartsAt)) ||
            (line.serviceEndsAt !== undefined &&
              !validDate(line.serviceEndsAt)) ||
            (line.serviceStartsAt &&
              line.serviceEndsAt &&
              line.serviceEndsAt <= line.serviceStartsAt)
          )
            throw new DomainError(
              "INVALID_NAME",
              "Invoice line tax or period is invalid.",
            );
          const price = await ports.billing.findPrice(line.priceId);
          if (
            !price ||
            !price.active ||
            !price.productActive ||
            price.productRiskLevel === "blocked"
          )
            throw new DomainError(
              "INVALID_NAME",
              "Invoice references an unavailable price.",
            );
          if (invoiceCurrency && invoiceCurrency !== price.currency)
            throw new DomainError(
              "INVALID_NAME",
              "Invoice lines must use one currency.",
            );
          invoiceCurrency = price.currency;
          prices.push(price);
          subtotal += price.unitAmountMinor * line.quantity;
          if (subtotal > MAX)
            throw new DomainError(
              "INVALID_NAME",
              "Invoice amount exceeds the supported range.",
            );
        }
        const currencyCode = invoiceCurrency!;
        let coupon: BillingCoupon | null = null;
        let discount = 0n;
        if (input.couponCode) {
          coupon = await ports.billing.findCoupon(
            input.couponCode.toUpperCase(),
          );
          if (
            !coupon ||
            !coupon.active ||
            (coupon.redeemBy && coupon.redeemBy < at) ||
            (coupon.currency && coupon.currency !== currencyCode) ||
            (coupon.maxRedemptions !== null &&
              (await ports.billing.countCouponRedemptions(coupon.id)) >=
                coupon.maxRedemptions)
          )
            throw new DomainError("INVALID_NAME", "Coupon is unavailable.");
          const eligible = input.lines.reduce(
            (sum, line, index) =>
              sum +
              (coupon!.productId === null ||
              coupon!.productId === prices[index]!.productId
                ? prices[index]!.unitAmountMinor * line.quantity
                : 0n),
            0n,
          );
          if (eligible === 0n)
            throw new DomainError(
              "INVALID_NAME",
              "Coupon does not apply to these products.",
            );
          discount =
            coupon.percentOff !== null
              ? roundBps(eligible, coupon.percentOff * 100)
              : coupon.amountOffMinor! < eligible
                ? coupon.amountOffMinor!
                : eligible;
          if (discount === 0n)
            throw new DomainError(
              "INVALID_NAME",
              "Coupon produces no discount for this invoice.",
            );
        }
        const id = randomUUID();
        const lineSnapshots: InvoiceLineSnapshot[] = [];
        let remainingDiscount = discount;
        let remainingEligible = input.lines.reduce(
          (sum, line, index) =>
            sum +
            (coupon?.productId == null ||
            coupon.productId === prices[index]!.productId
              ? prices[index]!.unitAmountMinor * line.quantity
              : 0n),
          0n,
        );
        for (const [index, line] of input.lines.entries()) {
          const price = prices[index]!;
          const lineSubtotal = price.unitAmountMinor * line.quantity;
          const isEligible =
            coupon === null ||
            coupon.productId === null ||
            coupon.productId === price.productId;
          const lineDiscount =
            coupon && isEligible && remainingEligible > 0n
              ? remainingEligible === lineSubtotal
                ? remainingDiscount
                : (remainingDiscount * lineSubtotal) / remainingEligible
              : 0n;
          remainingDiscount -= lineDiscount;
          if (isEligible) remainingEligible -= lineSubtotal;
          const tax = roundBps(lineSubtotal - lineDiscount, line.taxRateBps);
          lineSnapshots.push({
            id: randomUUID(),
            invoiceId: id,
            productId: price.productId,
            priceId: price.id,
            description: price.productName,
            quantity: line.quantity,
            unitAmountMinor: price.unitAmountMinor,
            subtotalMinor: lineSubtotal,
            discountMinor: lineDiscount,
            taxRateBps: line.taxRateBps,
            taxMinor: tax,
            totalMinor: lineSubtotal - lineDiscount + tax,
            serviceStartsAt: line.serviceStartsAt ?? null,
            serviceEndsAt: line.serviceEndsAt ?? null,
          });
        }
        const taxMinor = lineSnapshots.reduce(
          (sum, line) => sum + line.taxMinor,
          0n,
        );
        const total = subtotal - discount + taxMinor;
        if (total > MAX)
          throw new DomainError(
            "INVALID_NAME",
            "Invoice total exceeds the supported range.",
          );
        const invoice = await ports.billing.createInvoice(
          {
            id,
            accountId: account.id,
            idempotencyKey: input.idempotencyKey,
            currency: currencyCode,
            subtotalMinor: subtotal,
            discountMinor: discount,
            taxMinor,
            totalMinor: total,
            status: "open",
            provider: null,
            providerReference: null,
            subscriptionId: input.subscriptionId ?? null,
            dueAt: input.dueAt ?? null,
            issuedAt: at,
            paidAt: null,
            lines: lineSnapshots,
          },
          coupon
            ? { couponId: coupon.id, amountMinor: discount, redeemedAt: at }
            : null,
        );
        await auditAndEvent(
          ports,
          input,
          "invoiceIssued",
          { type: "invoice", id },
          { invoiceId: id, accountId: account.id },
          at,
        );
        if (coupon)
          await auditAndEvent(
            ports,
            input,
            "couponRedeemed",
            { type: "coupon", id: coupon.id },
            { couponId: coupon.id, invoiceId: id },
            at,
          );
        if (invoice.totalMinor === 0n)
          await fulfillInvoice(ports, input, invoice, at);
        return invoice;
      });
    },
    async bindInvoiceProvider(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      invoiceId: string;
      provider: string;
      providerReference: string;
    }) {
      manager(input.actor, input.userId);
      provider(input.provider);
      reference(input.providerReference);
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        const invoice = await ports.billing.findInvoice(input.invoiceId);
        if (
          !invoice ||
          invoice.accountId !== account.id ||
          invoice.status !== "open" ||
          invoice.provider !== null
        )
          throw new DomainError(
            "USER_NOT_FOUND",
            "Unbound open invoice not found.",
          );
        const bound = await ports.billing.bindInvoiceProvider(
          invoice.id,
          input.provider,
          input.providerReference,
        );
        if (!bound)
          throw new DomainError(
            "INVALID_NAME",
            "Invoice provider binding failed.",
          );
        await auditAndEvent(
          ports,
          input,
          "invoiceProviderBound",
          { type: "invoice", id: invoice.id },
          { invoiceId: invoice.id, provider: input.provider },
          at,
        );
        return bound;
      });
    },
    async recordPayment(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      invoiceId: string;
      provider: string;
      providerReference: string;
      amountMinor: bigint;
      currency: string;
      occurredAt: Date;
    }) {
      manager(input.actor, input.userId);
      positive(input.amountMinor, "Payment amount");
      currency(input.currency);
      provider(input.provider);
      reference(input.providerReference);
      if (!validDate(input.occurredAt))
        throw new DomainError("INVALID_NAME", "Payment timestamp is invalid.");
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        const invoice = await ports.billing.findInvoice(input.invoiceId);
        if (
          !invoice ||
          invoice.accountId !== account.id ||
          !["open", "paid"].includes(invoice.status) ||
          invoice.currency !== input.currency ||
          invoice.provider !== input.provider ||
          !invoice.providerReference ||
          invoice.totalMinor === 0n
        )
          throw new DomainError(
            "INVALID_NAME",
            "Payment does not match a provider-bound invoice.",
          );
        const result = await ports.billing.recordPayment({
          id: randomUUID(),
          invoiceId: invoice.id,
          provider: input.provider,
          providerReference: input.providerReference,
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: "succeeded",
          occurredAt: input.occurredAt,
        });
        if (!result.created)
          return { payment: result.payment, fulfilled: false };
        const paid = await ports.billing.paidTotal(invoice.id);
        if (paid > invoice.totalMinor)
          throw new DomainError(
            "INVALID_NAME",
            "Payments exceed invoice total.",
          );
        await auditAndEvent(
          ports,
          input,
          "paymentRecorded",
          { type: "payment", id: result.payment.id },
          { paymentId: result.payment.id, invoiceId: invoice.id },
          at,
        );
        if (paid < invoice.totalMinor)
          return { payment: result.payment, fulfilled: false };
        const fulfilled = await fulfillInvoice(ports, input, invoice, at);
        return { payment: result.payment, fulfilled };
      });
    },
    async applyProviderEvent(input: {
      actor: Actor;
      audit: AuditContext;
      event: PaymentProviderEvent;
      dunningSchedule?: DunningSchedule;
      revokeOnFullRefund?: boolean;
    }) {
      if (
        input.actor.kind !== "agent" ||
        !input.actor.permissions.includes("financial:manage")
      )
        throw new DomainError(
          "FORBIDDEN",
          "A trusted provider sync agent is required.",
        );
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const created = await ports.financial.recordProviderEvent(input.event);
        if (!created) return { created: false, fulfilled: false };
        let fulfilled = false;
        let applied = false;
        const event = input.event;
        const invoice =
          event.provider === "stripe" && event.objectId
            ? await ports.billing.findInvoiceByProviderReference(
                "stripe",
                event.objectId,
              )
            : null;
        const checkoutEvent = event.type.startsWith("checkout.session.");
        if (
          invoice &&
          [
            "checkout.session.completed",
            "checkout.session.async_payment_succeeded",
            "invoice.paid",
            "invoice.payment_succeeded",
          ].includes(event.type) &&
          (!checkoutEvent || event.paymentStatus === "paid") &&
          event.amountMinor !== undefined &&
          event.currency &&
          event.paymentReference
        ) {
          if (event.currency !== invoice.currency || event.amountMinor <= 0n)
            throw new DomainError(
              "INVALID_NAME",
              "Stripe payment currency or amount is invalid.",
            );
          if (event.amountMinor !== invoice.totalMinor)
            throw new DomainError(
              "INVALID_NAME",
              "Stripe payment amount does not match invoice total.",
            );
          const result = await ports.billing.recordPayment({
            id: randomUUID(),
            invoiceId: invoice.id,
            provider: "stripe",
            providerReference: event.paymentReference,
            amountMinor: event.amountMinor,
            currency: event.currency,
            status: "succeeded",
            occurredAt: event.occurredAt,
          });
          applied = true;
          if (result.created)
            await auditAndEvent(
              ports,
              input,
              "paymentRecorded",
              { type: "payment", id: result.payment.id },
              { paymentId: result.payment.id, invoiceId: invoice.id },
              at,
            );
          const paid = await ports.billing.paidTotal(invoice.id);
          if (paid > invoice.totalMinor)
            throw new DomainError(
              "INVALID_NAME",
              "Stripe payments exceed invoice total.",
            );
          if (paid === invoice.totalMinor)
            fulfilled = await fulfillInvoice(
              ports,
              input,
              invoice,
              event.occurredAt,
            );
        }
        if (
          event.provider === "stripe" &&
          event.type === "refund.updated" &&
          event.objectStatus === "succeeded" &&
          event.objectId &&
          event.paymentReference &&
          event.amountMinor !== undefined &&
          event.currency
        ) {
          const payment = await ports.billing.findPaymentByProviderReference(
            "stripe",
            event.paymentReference,
          );
          const paidInvoice = payment
            ? await ports.billing.findInvoice(payment.invoiceId)
            : null;
          if (payment && paidInvoice) {
            if (
              payment.status !== "succeeded" ||
              event.currency !== payment.currency ||
              event.amountMinor <= 0n ||
              event.amountMinor > payment.amountMinor
            )
              throw new DomainError(
                "INVALID_NAME",
                "Stripe refund does not match the payment.",
              );
            const prior = await ports.billing.findRefundByProviderReference(
              "stripe",
              event.objectId,
            );
            if (
              prior &&
              (prior.paymentId !== payment.id ||
                prior.amountMinor !== event.amountMinor)
            )
              throw new DomainError(
                "INVALID_NAME",
                "Stripe refund reference conflicts with another payment.",
              );
            if (!prior) {
              if (
                (await ports.billing.refundedTotal(payment.id)) +
                  event.amountMinor >
                payment.amountMinor
              )
                throw new DomainError(
                  "INVALID_NAME",
                  "Stripe refund exceeds the payment amount.",
                );
              const creditNoteId = randomUUID();
              const result = await ports.billing.recordRefund(
                {
                  id: randomUUID(),
                  paymentId: payment.id,
                  provider: "stripe",
                  providerReference: event.objectId,
                  amountMinor: event.amountMinor,
                  status: "succeeded",
                  occurredAt: event.occurredAt,
                },
                {
                  id: creditNoteId,
                  invoiceId: paidInvoice.id,
                  reason: "Provider-confirmed refund",
                },
              );
              if (result.created) {
                await auditAndEvent(
                  ports,
                  input,
                  "refundRecorded",
                  { type: "refund", id: result.refund.id },
                  { refundId: result.refund.id, paymentId: payment.id },
                  at,
                );
                await auditAndEvent(
                  ports,
                  input,
                  "creditNoteIssued",
                  { type: "credit-note", id: creditNoteId },
                  { creditNoteId, invoiceId: paidInvoice.id },
                  at,
                );
              }
            }
            applied = true;
            if (
              input.revokeOnFullRefund &&
              (await ports.billing.refundedTotalForInvoice(paidInvoice.id)) >=
                paidInvoice.totalMinor
            ) {
              for (const grant of await ports.billing.listEntitlementsForInvoice(
                paidInvoice.id,
              ))
                if (!grant.revokedAt) {
                  const revoked = await ports.financial.revokeEntitlement(
                    grant.id,
                    at,
                  );
                  await ports.audit.append({
                    occurredAt: at,
                    companyId: null,
                    actor: input.actor,
                    action: AUDIT_ACTION.entitlementRevoked,
                    outcome: "succeeded",
                    resource: { type: "entitlement", id: revoked.id },
                    context: input.audit,
                    changes: { key: revoked.key, invoiceId: paidInvoice.id },
                  });
                  await ports.events.append(
                    financialEvent("financial.entitlement.revoked", at, {
                      entitlementId: revoked.id,
                      key: revoked.key,
                    }),
                  );
                }
            }
          }
        }
        if (
          event.provider === "stripe" &&
          event.type === "payment_method.detached" &&
          event.objectId
        ) {
          const method =
            await ports.billing.findPaymentMethodByProviderReference(
              "stripe",
              event.objectId,
            );
          if (
            method &&
            (await ports.billing.markPaymentMethodDetached(
              method.accountId,
              method.id,
              at,
            ))
          ) {
            applied = true;
            await auditAndEvent(
              ports,
              input,
              "paymentMethodDetached",
              { type: "payment-method", id: method.id },
              { accountId: method.accountId, paymentMethodId: method.id },
              at,
            );
          }
        }
        if (
          invoice &&
          [
            "invoice.payment_failed",
            "invoice.payment_action_required",
            "checkout.session.async_payment_failed",
          ].includes(event.type) &&
          invoice.status === "open"
        ) {
          const attemptNumber =
            (await ports.billing.countDunningAttempts(invoice.id)) + 1;
          const schedule = input.dunningSchedule ?? {
            delaysSeconds: [],
            graceSeconds: 0,
          };
          const actionRequired =
            event.type === "invoice.payment_action_required";
          const exhausted =
            !actionRequired && attemptNumber > schedule.delaysSeconds.length;
          const nextAttemptAt =
            exhausted || actionRequired
              ? null
              : new Date(
                  at.getTime() +
                    schedule.delaysSeconds[attemptNumber - 1]! * 1000,
                );
          const recorded = await ports.billing.recordDunning({
            id: randomUUID(),
            invoiceId: invoice.id,
            attemptNumber,
            status: exhausted
              ? "exhausted"
              : actionRequired
                ? "action_required"
                : "scheduled",
            failureCategory: "payment_failed",
            providerFailureCode: null,
            requiresCustomerAction: actionRequired,
            nextAttemptAt,
            providerEventId: event.eventId,
          });
          applied = recorded;
          if (recorded)
            await auditAndEvent(
              ports,
              input,
              exhausted
                ? "dunningExhausted"
                : actionRequired
                  ? "dunningActionRequired"
                  : "dunningPaymentFailed",
              { type: "dunning-attempt", id: `${invoice.id}:${attemptNumber}` },
              { invoiceId: invoice.id, attemptNumber },
              at,
            );
        }
        await ports.audit.append({
          occurredAt: at,
          companyId: null,
          actor: input.actor,
          action: AUDIT_ACTION.providerEventApplied,
          outcome: "succeeded",
          resource: {
            type: "provider-event",
            id: `${event.provider}:${event.eventId}`,
          },
          context: input.audit,
          changes: {
            provider: event.provider,
            type: event.type,
            appliedToLocalState: applied,
          },
        });
        await ports.events.append(
          financialEvent("financial.provider-event.applied", at, {
            provider: event.provider,
            eventId: event.eventId,
            type: event.type,
          }),
        );
        return { created: true, fulfilled };
      });
    },
    async recordRefund(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      paymentId: string;
      providerReference: string;
      amountMinor: bigint;
      reason: string;
      revokeAccess: boolean;
      occurredAt: Date;
    }) {
      manager(input.actor, input.userId);
      positive(input.amountMinor, "Refund amount");
      reference(input.providerReference);
      if (
        input.reason.length < 3 ||
        input.reason.length > 200 ||
        !validDate(input.occurredAt)
      )
        throw new DomainError(
          "INVALID_NAME",
          "Refund reason or timestamp is invalid.",
        );
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        const payment = await ports.billing.findPayment(input.paymentId);
        const invoice =
          payment && (await ports.billing.findInvoice(payment.invoiceId));
        if (
          !payment ||
          !invoice ||
          invoice.accountId !== account.id ||
          payment.status !== "succeeded"
        )
          throw new DomainError(
            "USER_NOT_FOUND",
            "Paid invoice payment not found.",
          );
        const prior = await ports.billing.findRefundByProviderReference(
          payment.provider,
          input.providerReference,
        );
        if (prior) {
          if (
            prior.paymentId !== payment.id ||
            prior.amountMinor !== input.amountMinor
          )
            throw new DomainError(
              "INVALID_NAME",
              "Refund reference conflicts with another refund.",
            );
          return prior;
        }
        if (
          (await ports.billing.refundedTotal(payment.id)) + input.amountMinor >
          payment.amountMinor
        )
          throw new DomainError(
            "INVALID_NAME",
            "Refund exceeds the payment amount.",
          );
        const creditNoteId = randomUUID();
        const result = await ports.billing.recordRefund(
          {
            id: randomUUID(),
            paymentId: payment.id,
            provider: payment.provider,
            providerReference: input.providerReference,
            amountMinor: input.amountMinor,
            status: "succeeded",
            occurredAt: input.occurredAt,
          },
          { id: creditNoteId, invoiceId: invoice.id, reason: input.reason },
        );
        if (!result.created) return result.refund;
        await auditAndEvent(
          ports,
          input,
          "refundRecorded",
          { type: "refund", id: result.refund.id },
          { refundId: result.refund.id, paymentId: payment.id },
          at,
        );
        await auditAndEvent(
          ports,
          input,
          "creditNoteIssued",
          { type: "credit-note", id: creditNoteId },
          { creditNoteId, invoiceId: invoice.id },
          at,
        );
        if (
          input.revokeAccess &&
          (await ports.billing.refundedTotalForInvoice(invoice.id)) >=
            invoice.totalMinor
        )
          for (const grant of await ports.billing.listEntitlementsForInvoice(
            invoice.id,
          ))
            if (!grant.revokedAt) {
              const revoked = await ports.financial.revokeEntitlement(
                grant.id,
                at,
              );
              await ports.audit.append({
                occurredAt: at,
                companyId: null,
                actor: input.actor,
                action: AUDIT_ACTION.entitlementRevoked,
                outcome: "succeeded",
                resource: { type: "entitlement", id: revoked.id },
                context: input.audit,
                changes: { key: revoked.key, invoiceId: invoice.id },
              });
              await ports.events.append(
                financialEvent("financial.entitlement.revoked", at, {
                  entitlementId: revoked.id,
                  key: revoked.key,
                }),
              );
            }
        return result.refund;
      });
    },
    async startSubscription(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      priceId: string;
      provider?: string;
      providerReference?: string;
    }) {
      manager(input.actor, input.userId);
      if (
        (input.provider === undefined) !==
        (input.providerReference === undefined)
      )
        throw new DomainError(
          "INVALID_NAME",
          "Subscription provider and reference must be supplied together.",
        );
      if (input.provider) provider(input.provider);
      if (input.providerReference) reference(input.providerReference);
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        const price = await ports.billing.findPrice(input.priceId);
        if (
          !price ||
          !price.active ||
          !price.productActive ||
          price.productRiskLevel === "blocked" ||
          price.frequency === "one_time"
        )
          throw new DomainError(
            "INVALID_NAME",
            "An active recurring price is required.",
          );
        const trialEndsAt =
          price.trialDays > 0 &&
          !(await ports.billing.hasHadTrial(account.id, price.productId))
            ? new Date(at.getTime() + price.trialDays * 86_400_000)
            : null;
        const subscription = await ports.billing.createSubscription({
          id: randomUUID(),
          accountId: account.id,
          productId: price.productId,
          priceId: price.id,
          provider: input.provider ?? null,
          providerReference: input.providerReference ?? null,
          status: trialEndsAt ? "trialing" : "incomplete",
          trialEndsAt,
          currentPeriodStartsAt: trialEndsAt ? at : null,
          currentPeriodEndsAt: trialEndsAt,
          cancelAtPeriodEnd: false,
          canceledAt: null,
        });
        await auditAndEvent(
          ports,
          input,
          "subscriptionCreated",
          { type: "subscription", id: subscription.id },
          { subscriptionId: subscription.id, accountId: account.id },
          at,
        );
        if (trialEndsAt) {
          for (const mapping of await ports.financial.listPriceEntitlements(
            price.id,
          )) {
            const granted = await ports.financial.grantEntitlement({
              accountId: account.id,
              key: mapping.entitlementKey,
              quantity: mapping.quantity,
              startsAt: at,
              endsAt: trialEndsAt,
              revokedAt: null,
              productId: price.productId,
              priceId: price.id,
              invoiceId: null,
            });
            await ports.audit.append({
              occurredAt: at,
              companyId: null,
              actor: input.actor,
              action: AUDIT_ACTION.entitlementGranted,
              outcome: "succeeded",
              resource: { type: "entitlement", id: granted.id },
              context: input.audit,
              changes: { key: granted.key, trial: true },
            });
            await ports.events.append(
              financialEvent("financial.entitlement.granted", at, {
                accountId: account.id,
                entitlementId: granted.id,
                key: granted.key,
              }),
            );
          }
          await auditAndEvent(
            ports,
            input,
            "subscriptionTrialStarted",
            { type: "subscription", id: subscription.id },
            { subscriptionId: subscription.id },
            at,
          );
        }
        return subscription;
      });
    },
    async cancelSubscription(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      subscriptionId: string;
    }) {
      manager(input.actor, input.userId);
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        const sub = await ports.billing.findSubscription(input.subscriptionId);
        if (!sub || sub.accountId !== account.id)
          throw new DomainError("USER_NOT_FOUND", "Subscription not found.");
        if (sub.cancelAtPeriodEnd || sub.status === "canceled") return sub;
        const updated = await ports.billing.updateSubscription(sub.id, {
          cancelAtPeriodEnd: true,
        });
        await auditAndEvent(
          ports,
          input,
          "subscriptionCancellationScheduled",
          { type: "subscription", id: sub.id },
          { subscriptionId: sub.id },
          at,
        );
        return updated;
      });
    },
    async finishSubscription(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      subscriptionId: string;
    }) {
      manager(input.actor, input.userId);
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        const sub = await ports.billing.findSubscription(input.subscriptionId);
        if (!sub || sub.accountId !== account.id)
          throw new DomainError("USER_NOT_FOUND", "Subscription not found.");
        if (sub.status === "canceled") return sub;
        if (
          !sub.cancelAtPeriodEnd ||
          !sub.currentPeriodEndsAt ||
          sub.currentPeriodEndsAt > at
        )
          throw new DomainError(
            "INVALID_NAME",
            "Subscription has not reached its scheduled cancellation time.",
          );
        const updated = await ports.billing.updateSubscription(sub.id, {
          status: "canceled",
          canceledAt: at,
        });
        await auditAndEvent(
          ports,
          input,
          "subscriptionCanceled",
          { type: "subscription", id: sub.id },
          { subscriptionId: sub.id },
          at,
        );
        return updated;
      });
    },
    async recordDunningFailure(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      invoiceId: string;
      providerEventId: string;
      failureCategory: string;
      providerFailureCode?: string;
      requiresCustomerAction: boolean;
      schedule: DunningSchedule;
    }) {
      manager(input.actor, input.userId);
      reference(input.providerEventId);
      if (
        !/^[a-z_]{2,40}$/.test(input.failureCategory) ||
        (input.providerFailureCode &&
          !/^[A-Za-z0-9_:-]{1,40}$/.test(input.providerFailureCode)) ||
        input.schedule.delaysSeconds.length > 20 ||
        input.schedule.delaysSeconds.some(
          (delay) => !Number.isInteger(delay) || delay < 0 || delay > 2_592_000,
        ) ||
        !Number.isInteger(input.schedule.graceSeconds) ||
        input.schedule.graceSeconds < 0 ||
        input.schedule.graceSeconds > 2_592_000
      )
        throw new DomainError(
          "INVALID_NAME",
          "Dunning policy or failure code is invalid.",
        );
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        const invoice = await ports.billing.findInvoice(input.invoiceId);
        if (
          !invoice ||
          invoice.accountId !== account.id ||
          invoice.status !== "open"
        )
          throw new DomainError("USER_NOT_FOUND", "Open invoice not found.");
        const prior = await ports.billing.findDunningByProviderEventId(
          input.providerEventId,
        );
        if (prior) {
          if (prior.invoiceId !== invoice.id)
            throw new DomainError(
              "INVALID_NAME",
              "Dunning event belongs to another invoice.",
            );
          return { ...prior, created: false };
        }
        const attemptNumber =
          (await ports.billing.countDunningAttempts(invoice.id)) + 1;
        const exhausted =
          !input.requiresCustomerAction &&
          attemptNumber > input.schedule.delaysSeconds.length;
        const nextAttemptAt =
          exhausted || input.requiresCustomerAction
            ? null
            : new Date(
                at.getTime() +
                  input.schedule.delaysSeconds[attemptNumber - 1]! * 1000,
              );
        const status = exhausted
          ? "exhausted"
          : input.requiresCustomerAction
            ? "action_required"
            : "scheduled";
        const created = await ports.billing.recordDunning({
          id: randomUUID(),
          invoiceId: invoice.id,
          attemptNumber,
          status,
          failureCategory: input.failureCategory,
          providerFailureCode: input.providerFailureCode ?? null,
          requiresCustomerAction: input.requiresCustomerAction,
          nextAttemptAt,
          providerEventId: input.providerEventId,
        });
        if (created)
          await auditAndEvent(
            ports,
            input,
            exhausted
              ? "dunningExhausted"
              : input.requiresCustomerAction
                ? "dunningActionRequired"
                : "dunningPaymentFailed",
            { type: "dunning-attempt", id: `${invoice.id}:${attemptNumber}` },
            { invoiceId: invoice.id, attemptNumber },
            at,
          );
        return { attemptNumber, status, nextAttemptAt, created };
      });
    },
    async setDefaultPaymentMethod(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      paymentMethodId: string | null;
    }) {
      manager(input.actor, input.userId);
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        if (input.paymentMethodId) {
          const method = await ports.financial.findPaymentMethod(
            account.id,
            input.paymentMethodId,
          );
          if (!method || method.revokedAt)
            throw new DomainError(
              "USER_NOT_FOUND",
              "Active payment method not found.",
            );
        }
        await ports.billing.setDefaultPaymentMethod(
          account.id,
          input.paymentMethodId,
        );
        await auditAndEvent(
          ports,
          input,
          "paymentMethodDefaultChanged",
          { type: "payment-method", id: input.paymentMethodId ?? account.id },
          { accountId: account.id, paymentMethodId: input.paymentMethodId },
          at,
        );
      });
    },
    async markPaymentMethodDetached(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      paymentMethodId: string;
    }) {
      manager(input.actor, input.userId);
      const at = clock();
      return deps.transactions.run(async (ports) => {
        const account = await ports.financial.ensureAccount(input.userId);
        const changed = await ports.billing.markPaymentMethodDetached(
          account.id,
          input.paymentMethodId,
          at,
        );
        if (changed)
          await auditAndEvent(
            ports,
            input,
            "paymentMethodDetached",
            { type: "payment-method", id: input.paymentMethodId },
            { accountId: account.id, paymentMethodId: input.paymentMethodId },
            at,
          );
        return { changed };
      });
    },
  };
  return {
    ...api,
    async issueRenewalInvoice(input: {
      actor: Actor;
      audit: AuditContext;
      userId: string;
      subscriptionId: string;
      taxRateBps: number;
      couponCode?: string;
      dueAt?: Date;
    }) {
      manager(input.actor, input.userId);
      const subscription = await deps.repository.findSubscription(
        input.subscriptionId,
      );
      if (
        !subscription ||
        subscription.status === "canceled" ||
        subscription.cancelAtPeriodEnd
      )
        throw new DomainError(
          "USER_NOT_FOUND",
          "Renewable subscription not found.",
        );
      const start =
        subscription.currentPeriodEndsAt ?? subscription.trialEndsAt;
      if (!start || start > clock())
        throw new DomainError(
          "INVALID_NAME",
          "Subscription renewal is not due.",
        );
      const price = await deps.repository.findPrice(subscription.priceId);
      if (
        !price ||
        !price.active ||
        !price.productActive ||
        price.productRiskLevel === "blocked" ||
        price.frequency === "one_time"
      )
        throw new DomainError("INVALID_NAME", "Renewal price is not active.");
      const end = nextPeriodEnd(start, price.frequency, price.intervalCount);
      return api.issueInvoice({
        actor: input.actor,
        audit: input.audit,
        userId: input.userId,
        subscriptionId: subscription.id,
        idempotencyKey: `renewal:${subscription.id}:${start.toISOString()}`,
        lines: [
          {
            priceId: price.id,
            quantity: 1n,
            taxRateBps: input.taxRateBps,
            serviceStartsAt: start,
            serviceEndsAt: end,
          },
        ],
        ...(input.couponCode ? { couponCode: input.couponCode } : {}),
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      });
    },
  };
}
