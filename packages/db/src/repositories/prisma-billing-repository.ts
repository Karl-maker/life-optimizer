import { randomUUID } from "node:crypto";
import { DomainError } from "@edu-service/core";
import type {
  BillingCoupon,
  BillingInvoice,
  BillingPayment,
  BillingPrice,
  BillingRefund,
  BillingRepository,
  BillingSubscription,
  Price,
  Product,
  Entitlement,
} from "@edu-service/financial";
import type { PrismaClient } from "../generated/client.js";

type Client = Pick<
  PrismaClient,
  | "product"
  | "price"
  | "priceEntitlement"
  | "coupon"
  | "couponRedemption"
  | "invoice"
  | "paymentRecord"
  | "refundRecord"
  | "creditNote"
  | "subscription"
  | "subscriptionRenewal"
  | "dunningAttempt"
  | "financialAccount"
  | "paymentMethodToken"
  | "entitlement"
>;
const product = (row: {
  id: string;
  key: string;
  name: string;
  active: boolean;
  riskLevel: string;
}): Product => ({ ...row, riskLevel: row.riskLevel as Product["riskLevel"] });
const price = (row: {
  id: string;
  productId: string;
  currency: string;
  unitAmountMinor: bigint;
  frequency: string;
  intervalCount: number;
  trialDays: number;
  active: boolean;
}): Price => ({ ...row, frequency: row.frequency as Price["frequency"] });
const coupon = (row: BillingCoupon): BillingCoupon => row;
const payment = (row: BillingPayment): BillingPayment => row;
const refund = (row: BillingRefund): BillingRefund => row;
const subscription = (row: BillingSubscription): BillingSubscription => row;
type InvoiceRow = NonNullable<
  Awaited<ReturnType<PrismaClient["invoice"]["findUnique"]>>
>;
function invoice(
  row: InvoiceRow & { lines: BillingInvoice["lines"] },
): BillingInvoice {
  return {
    id: row.id,
    accountId: row.accountId,
    idempotencyKey: row.idempotencyKey,
    currency: row.currency,
    subtotalMinor: row.subtotalMinor,
    discountMinor: row.discountMinor,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
    status: row.status,
    provider: row.provider,
    providerReference: row.providerReference,
    subscriptionId: row.subscriptionId,
    dueAt: row.dueAt,
    issuedAt: row.issuedAt,
    paidAt: row.paidAt,
    lines: row.lines,
  };
}

export class PrismaBillingRepository implements BillingRepository {
  constructor(private readonly db: Client) {}
  async createProduct(input: {
    id: string;
    key: string;
    name: string;
    riskLevel: Product["riskLevel"];
  }) {
    return product(await this.db.product.create({ data: input }));
  }
  async updateProduct(
    id: string,
    input: {
      name?: string;
      active?: boolean;
      riskLevel?: Product["riskLevel"];
    },
  ) {
    const result = await this.db.product.updateMany({
      where: { id },
      data: input,
    });
    return result.count
      ? product(await this.db.product.findUniqueOrThrow({ where: { id } }))
      : null;
  }
  async createPrice(
    input: Price,
    mappings: readonly { key: string; quantity: bigint | null }[],
  ) {
    const row = await this.db.price.create({
      data: {
        ...input,
        entitlements: {
          create: mappings.map((mapping) => ({
            entitlementKey: mapping.key,
            quantity: mapping.quantity,
          })),
        },
      },
    });
    return price(row);
  }
  async findPrice(id: string): Promise<BillingPrice | null> {
    const row = await this.db.price.findUnique({
      where: { id },
      include: {
        product: { select: { name: true, active: true, riskLevel: true } },
      },
    });
    return row
      ? {
          ...price(row),
          productName: row.product.name,
          productActive: row.product.active,
          productRiskLevel: row.product.riskLevel as Product["riskLevel"],
        }
      : null;
  }
  async retirePrice(id: string) {
    const result = await this.db.price.updateMany({
      where: { id, active: true },
      data: { active: false },
    });
    return result.count
      ? price(await this.db.price.findUniqueOrThrow({ where: { id } }))
      : null;
  }
  async createCoupon(input: BillingCoupon) {
    return coupon(await this.db.coupon.create({ data: input }));
  }
  async findCoupon(code: string) {
    const row = await this.db.coupon.findUnique({ where: { code } });
    return row ? coupon(row) : null;
  }
  countCouponRedemptions(couponId: string) {
    return this.db.couponRedemption.count({ where: { couponId } });
  }
  private async getInvoice(
    where: { id: string } | { idempotencyKey: string },
  ): Promise<BillingInvoice | null> {
    const row = await this.db.invoice.findUnique({
      where,
      include: { lines: { orderBy: { id: "asc" } } },
    });
    return row ? invoice(row) : null;
  }
  findInvoiceByKey(key: string) {
    return this.getInvoice({ idempotencyKey: key });
  }
  findInvoice(id: string) {
    return this.getInvoice({ id });
  }
  async findInvoiceByProviderReference(provider: string, reference: string) {
    const row = await this.db.invoice.findUnique({
      where: {
        provider_providerReference: { provider, providerReference: reference },
      },
      include: { lines: { orderBy: { id: "asc" } } },
    });
    return row ? invoice(row) : null;
  }
  async createInvoice(
    input: BillingInvoice,
    redemption: {
      couponId: string;
      amountMinor: bigint;
      redeemedAt: Date;
    } | null,
  ) {
    await this.db.invoice.create({
      data: {
        id: input.id,
        accountId: input.accountId,
        idempotencyKey: input.idempotencyKey,
        currency: input.currency,
        subtotalMinor: input.subtotalMinor,
        discountMinor: input.discountMinor,
        taxMinor: input.taxMinor,
        totalMinor: input.totalMinor,
        status: input.status,
        provider: input.provider,
        providerReference: input.providerReference,
        subscriptionId: input.subscriptionId,
        dueAt: input.dueAt,
        issuedAt: input.issuedAt,
        paidAt: input.paidAt,
        lines: {
          create: input.lines.map((line) => ({
            id: line.id,
            productId: line.productId,
            priceId: line.priceId,
            description: line.description,
            quantity: line.quantity,
            unitAmountMinor: line.unitAmountMinor,
            subtotalMinor: line.subtotalMinor,
            discountMinor: line.discountMinor,
            taxRateBps: line.taxRateBps,
            taxMinor: line.taxMinor,
            totalMinor: line.totalMinor,
            serviceStartsAt: line.serviceStartsAt,
            serviceEndsAt: line.serviceEndsAt,
          })),
        },
        ...(redemption
          ? {
              couponRedemptions: {
                create: {
                  id: randomUUID(),
                  couponId: redemption.couponId,
                  accountId: input.accountId,
                  amountMinor: redemption.amountMinor,
                  redeemedAt: redemption.redeemedAt,
                },
              },
            }
          : {}),
      },
    });
    return (await this.findInvoice(input.id))!;
  }
  async bindInvoiceProvider(
    invoiceId: string,
    provider: string,
    reference: string,
  ) {
    const result = await this.db.invoice.updateMany({
      where: { id: invoiceId, status: "open", provider: null },
      data: { provider, providerReference: reference },
    });
    return result.count ? this.findInvoice(invoiceId) : null;
  }
  async recordPayment(input: BillingPayment) {
    const existing = await this.db.paymentRecord.findUnique({
      where: {
        provider_providerReference: {
          provider: input.provider,
          providerReference: input.providerReference,
        },
      },
    });
    if (existing) {
      if (
        existing.invoiceId !== input.invoiceId ||
        existing.amountMinor !== input.amountMinor ||
        existing.currency !== input.currency
      )
        throw new DomainError(
          "INVALID_NAME",
          "Payment reference conflicts with another payment.",
        );
      return { payment: payment(existing), created: false };
    }
    return {
      payment: payment(await this.db.paymentRecord.create({ data: input })),
      created: true,
    };
  }
  async paidTotal(invoiceId: string) {
    const row = await this.db.paymentRecord.aggregate({
      where: { invoiceId, status: "succeeded" },
      _sum: { amountMinor: true },
    });
    return row._sum.amountMinor ?? 0n;
  }
  async markInvoicePaid(invoiceId: string, at: Date) {
    return (
      (
        await this.db.invoice.updateMany({
          where: { id: invoiceId, status: "open" },
          data: { status: "paid", paidAt: at },
        })
      ).count === 1
    );
  }
  async findPayment(id: string) {
    const row = await this.db.paymentRecord.findUnique({ where: { id } });
    return row ? payment(row) : null;
  }
  async findPaymentByProviderReference(provider: string, reference: string) {
    const row = await this.db.paymentRecord.findUnique({
      where: {
        provider_providerReference: { provider, providerReference: reference },
      },
    });
    return row ? payment(row) : null;
  }
  async refundedTotal(paymentId: string) {
    const row = await this.db.refundRecord.aggregate({
      where: { paymentId, status: "succeeded" },
      _sum: { amountMinor: true },
    });
    return row._sum.amountMinor ?? 0n;
  }
  async refundedTotalForInvoice(invoiceId: string) {
    const row = await this.db.refundRecord.aggregate({
      where: { payment: { invoiceId }, status: "succeeded" },
      _sum: { amountMinor: true },
    });
    return row._sum.amountMinor ?? 0n;
  }
  async findRefundByProviderReference(provider: string, reference: string) {
    const row = await this.db.refundRecord.findUnique({
      where: {
        provider_providerReference: { provider, providerReference: reference },
      },
    });
    return row ? refund(row) : null;
  }
  async recordRefund(
    input: BillingRefund,
    note: { id: string; invoiceId: string; reason: string },
  ) {
    const existing = await this.findRefundByProviderReference(
      input.provider,
      input.providerReference,
    );
    if (existing) {
      if (
        existing.paymentId !== input.paymentId ||
        existing.amountMinor !== input.amountMinor
      )
        throw new DomainError(
          "INVALID_NAME",
          "Refund reference conflicts with another refund.",
        );
      return { refund: existing, created: false };
    }
    const row = await this.db.refundRecord.create({
      data: {
        ...input,
        creditNote: {
          create: {
            id: note.id,
            invoiceId: note.invoiceId,
            amountMinor: input.amountMinor,
            reason: note.reason,
            issuedAt: input.occurredAt,
          },
        },
      },
    });
    return { refund: refund(row), created: true };
  }
  async createSubscription(input: BillingSubscription) {
    return subscription(await this.db.subscription.create({ data: input }));
  }
  async findSubscription(id: string) {
    const row = await this.db.subscription.findUnique({ where: { id } });
    return row ? subscription(row) : null;
  }
  async hasHadTrial(accountId: string, productId: string) {
    return (
      (await this.db.subscription.count({
        where: { accountId, productId, trialEndsAt: { not: null } },
      })) > 0
    );
  }
  async updateSubscription(
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
  ) {
    return subscription(
      await this.db.subscription.update({ where: { id }, data: update }),
    );
  }
  async recordRenewal(
    subscriptionId: string,
    invoiceId: string,
    startsAt: Date,
    endsAt: Date,
  ) {
    const result = await this.db.subscriptionRenewal.createMany({
      data: [
        {
          id: randomUUID(),
          subscriptionId,
          invoiceId,
          periodStartsAt: startsAt,
          periodEndsAt: endsAt,
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }
  async recordDunning(input: {
    id: string;
    invoiceId: string;
    attemptNumber: number;
    status: string;
    failureCategory: string;
    providerFailureCode: string | null;
    requiresCustomerAction: boolean;
    nextAttemptAt: Date | null;
    providerEventId: string;
  }) {
    const result = await this.db.dunningAttempt.createMany({
      data: [input],
      skipDuplicates: true,
    });
    return result.count === 1;
  }
  countDunningAttempts(invoiceId: string) {
    return this.db.dunningAttempt.count({ where: { invoiceId } });
  }
  async findDunningByProviderEventId(providerEventId: string) {
    const row = await this.db.dunningAttempt.findUnique({
      where: { providerEventId },
    });
    return row
      ? {
          invoiceId: row.invoiceId,
          attemptNumber: row.attemptNumber,
          status: row.status,
          nextAttemptAt: row.nextAttemptAt,
        }
      : null;
  }
  async setDefaultPaymentMethod(accountId: string, methodId: string | null) {
    if (methodId) {
      const method = await this.db.paymentMethodToken.findFirst({
        where: {
          id: methodId,
          accountId,
          revokedAt: null,
          providerDetachedAt: null,
        },
      });
      if (!method)
        throw new DomainError(
          "USER_NOT_FOUND",
          "Active payment method not found.",
        );
    }
    await this.db.financialAccount.update({
      where: { id: accountId },
      data: { defaultPaymentMethodId: methodId },
    });
  }
  async markPaymentMethodDetached(
    accountId: string,
    methodId: string,
    at: Date,
  ) {
    const result = await this.db.paymentMethodToken.updateMany({
      where: { id: methodId, accountId, providerDetachedAt: null },
      data: { providerDetachedAt: at, revokedAt: at },
    });
    if (result.count)
      await this.db.financialAccount.updateMany({
        where: { id: accountId, defaultPaymentMethodId: methodId },
        data: { defaultPaymentMethodId: null },
      });
    return result.count === 1;
  }
  async findPaymentMethodByProviderReference(
    provider: string,
    reference: string,
  ) {
    return this.db.paymentMethodToken.findUnique({
      where: {
        provider_tokenReference: { provider, tokenReference: reference },
      },
      select: { id: true, accountId: true },
    });
  }
  async listEntitlementsForInvoice(
    invoiceId: string,
  ): Promise<readonly Entitlement[]> {
    return this.db.entitlement.findMany({ where: { invoiceId } });
  }
}
