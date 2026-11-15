import { randomUUID } from "node:crypto";
import { DomainError } from "@life-optimizer/core";
import type { PrismaClient } from "../generated/client.js";
import type {
  Entitlement,
  EntitlementDefinition,
  FinancialAccount,
  FinancialRepository,
  PaymentMethodToken,
  PaymentProviderEvent,
  UsageRecord,
  WalletEntry,
} from "@life-optimizer/financial";

type Client = Pick<
  PrismaClient,
  | "financialAccount"
  | "financialAccountKey"
  | "entitlementDefinition"
  | "priceEntitlement"
  | "entitlement"
  | "usageRecord"
  | "walletEntry"
  | "paymentMethodToken"
  | "paymentProviderEvent"
  | "invoice"
  | "subscription"
>;
const account = (row: { id: string; userId: string }): FinancialAccount => ({
  id: row.id,
  userId: row.userId,
});
const entitlement = (row: {
  id: string;
  accountId: string;
  key: string;
  quantity: bigint | null;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
  productId: string | null;
  priceId: string | null;
}): Entitlement => row;
const usage = (row: {
  id: string;
  accountId: string;
  entitlementKey: string;
  quantity: bigint;
  idempotencyKey: string;
  occurredAt: Date;
  reversalOfId: string | null;
}): UsageRecord => row;
const wallet = (row: {
  id: string;
  accountId: string;
  currency: string;
  amountMinor: bigint;
  type: string;
  idempotencyKey: string;
  occurredAt: Date;
}): WalletEntry => ({ ...row, type: row.type as WalletEntry["type"] });
const paymentMethod = (row: PaymentMethodToken): PaymentMethodToken => row;

export class PrismaFinancialRepository implements FinancialRepository {
  constructor(private readonly prisma: Client) {}
  async ensureAccount(userId: string) {
    const row = await this.prisma.financialAccount.upsert({
      where: { userId },
      create: { id: randomUUID(), userId },
      update: {},
      select: { id: true, userId: true },
    });
    return account(row);
  }
  async findAccountByKey(key: string) {
    const row = await this.prisma.financialAccountKey.findUnique({
      where: { key },
      select: { account: { select: { id: true, userId: true } } },
    });
    return row ? account(row.account) : null;
  }
  async bindAccountKey(accountId: string, key: string) {
    const result = await this.prisma.financialAccountKey.createMany({
      data: [{ id: randomUUID(), accountId, key }],
      skipDuplicates: true,
    });
    const current = await this.prisma.financialAccountKey.findUniqueOrThrow({
      where: { key },
      select: { accountId: true },
    });
    if (current.accountId !== accountId)
      throw new DomainError(
        "FORBIDDEN",
        "Financial account key belongs to another account.",
      );
    return result.count === 1;
  }
  async removeAccountKey(accountId: string, key: string) {
    const result = await this.prisma.financialAccountKey.deleteMany({
      where: { accountId, key },
    });
    return result.count === 1;
  }
  async findAccountById(id: string) {
    const row = await this.prisma.financialAccount.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    return row ? account(row) : null;
  }
  async registerEntitlementDefinition(definition: EntitlementDefinition) {
    const row = await this.prisma.entitlementDefinition.upsert({
      where: { key: definition.key },
      create: definition,
      update: {
        description: definition.description,
        unit: definition.unit,
        resetStrategy: definition.resetStrategy,
        resetIntervalSeconds: definition.resetIntervalSeconds,
      },
      select: {
        key: true,
        description: true,
        unit: true,
        resetStrategy: true,
        resetIntervalSeconds: true,
      },
    });
    return {
      ...row,
      unit: row.unit as EntitlementDefinition["unit"],
      resetStrategy:
        row.resetStrategy as EntitlementDefinition["resetStrategy"],
    };
  }
  async findEntitlementDefinition(key: string) {
    const row = await this.prisma.entitlementDefinition.findUnique({
      where: { key },
      select: {
        key: true,
        description: true,
        unit: true,
        resetStrategy: true,
        resetIntervalSeconds: true,
      },
    });
    return row
      ? {
          ...row,
          unit: row.unit as EntitlementDefinition["unit"],
          resetStrategy:
            row.resetStrategy as EntitlementDefinition["resetStrategy"],
        }
      : null;
  }
  async listPriceEntitlements(priceId: string) {
    return this.prisma.priceEntitlement.findMany({
      where: { priceId },
      select: { priceId: true, entitlementKey: true, quantity: true },
    });
  }
  async findSolePurchaseOption(entitlementKey: string) {
    const rows = await this.prisma.priceEntitlement.findMany({
      where: {
        entitlementKey,
        price: {
          active: true,
          product: { active: true, riskLevel: { not: "blocked" } },
        },
      },
      select: { priceId: true, price: { select: { productId: true } } },
      take: 2,
    });
    return rows.length === 1
      ? { productId: rows[0]!.price.productId, priceId: rows[0]!.priceId }
      : null;
  }
  async grantEntitlement(input: Omit<Entitlement, "id">) {
    return entitlement(
      await this.prisma.entitlement.create({
        data: { id: randomUUID(), ...input },
        select: {
          id: true,
          accountId: true,
          key: true,
          quantity: true,
          startsAt: true,
          endsAt: true,
          revokedAt: true,
          productId: true,
          priceId: true,
        },
      }),
    );
  }
  async findEntitlementById(id: string) {
    const row = await this.prisma.entitlement.findUnique({ where: { id } });
    return row ? entitlement(row) : null;
  }
  async revokeEntitlement(id: string, at: Date) {
    try {
      return entitlement(
        await this.prisma.entitlement.update({
          where: { id },
          data: { revokedAt: at },
          select: {
            id: true,
            accountId: true,
            key: true,
            quantity: true,
            startsAt: true,
            endsAt: true,
            revokedAt: true,
            productId: true,
            priceId: true,
          },
        }),
      );
    } catch {
      throw new DomainError("USER_NOT_FOUND", "Entitlement not found.");
    }
  }
  async findUsableEntitlement(accountId: string, key: string, at: Date) {
    const row = await this.prisma.entitlement.findFirst({
      where: {
        accountId,
        key,
        startsAt: { lte: at },
        revokedAt: null,
        OR: [{ endsAt: null }, { endsAt: { gt: at } }],
      },
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        accountId: true,
        key: true,
        quantity: true,
        startsAt: true,
        endsAt: true,
        revokedAt: true,
        productId: true,
        priceId: true,
      },
    });
    return row ? entitlement(row) : null;
  }
  async entitlementQuantity(accountId: string, key: string, at: Date) {
    const rows = await this.prisma.entitlement.findMany({
      where: {
        accountId,
        key,
        startsAt: { lte: at },
        revokedAt: null,
        OR: [{ endsAt: null }, { endsAt: { gt: at } }],
      },
      select: { quantity: true },
    });
    return rows.some((row) => row.quantity === null)
      ? null
      : rows.reduce((sum, row) => sum + (row.quantity ?? 0n), 0n);
  }
  async usageTotal(
    accountId: string,
    entitlementKey: string,
    since: Date | null,
  ) {
    const result = await this.prisma.usageRecord.aggregate({
      where: {
        accountId,
        entitlementKey,
        ...(since === null ? {} : { occurredAt: { gte: since } }),
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0n;
  }
  async findUsageByKey(idempotencyKey: string) {
    const row = await this.prisma.usageRecord.findUnique({
      where: { idempotencyKey },
    });
    return row ? usage(row) : null;
  }
  async findUsageById(id: string) {
    const row = await this.prisma.usageRecord.findUnique({ where: { id } });
    return row ? usage(row) : null;
  }
  async usageReversedTotal(id: string) {
    const result = await this.prisma.usageRecord.aggregate({
      where: { reversalOfId: id },
      _sum: { quantity: true },
    });
    return -(result._sum.quantity ?? 0n);
  }
  async recordUsage(input: Omit<UsageRecord, "id">) {
    const result = await this.prisma.usageRecord.createMany({
      data: [{ id: randomUUID(), ...input }],
      skipDuplicates: true,
    });
    const row = await this.prisma.usageRecord.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (
      row.accountId !== input.accountId ||
      row.entitlementKey !== input.entitlementKey ||
      row.quantity !== input.quantity ||
      row.reversalOfId !== (input.reversalOfId ?? null)
    )
      throw new DomainError(
        "INVALID_NAME",
        "Idempotency key was already used for different usage.",
      );
    return { record: usage(row), created: result.count === 1 };
  }
  async walletBalance(accountId: string, currency: string) {
    const result = await this.prisma.walletEntry.aggregate({
      where: { accountId, currency },
      _sum: { amountMinor: true },
    });
    return result._sum.amountMinor ?? 0n;
  }
  async findWalletEntryByKey(idempotencyKey: string) {
    const row = await this.prisma.walletEntry.findUnique({
      where: { idempotencyKey },
    });
    return row ? wallet(row) : null;
  }
  async addWalletEntry(input: Omit<WalletEntry, "id">) {
    const result = await this.prisma.walletEntry.createMany({
      data: [{ id: randomUUID(), ...input }],
      skipDuplicates: true,
    });
    const row = await this.prisma.walletEntry.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (
      row.accountId !== input.accountId ||
      row.currency !== input.currency ||
      row.amountMinor !== input.amountMinor ||
      row.type !== input.type
    )
      throw new DomainError(
        "INVALID_NAME",
        "Idempotency key was already used for a different wallet entry.",
      );
    return { entry: wallet(row), created: result.count === 1 };
  }
  async savePaymentMethod(
    input: Omit<PaymentMethodToken, "id" | "createdAt" | "revokedAt">,
  ) {
    const existing = await this.prisma.paymentMethodToken.findUnique({
      where: {
        provider_tokenReference: {
          provider: input.provider,
          tokenReference: input.tokenReference,
        },
      },
    });
    if (existing && existing.accountId !== input.accountId)
      throw new DomainError(
        "FORBIDDEN",
        "Payment method belongs to another account.",
      );
    if (existing?.revokedAt)
      throw new DomainError(
        "FORBIDDEN",
        "A revoked payment method cannot be restored.",
      );
    const row = await this.prisma.paymentMethodToken.upsert({
      where: {
        provider_tokenReference: {
          provider: input.provider,
          tokenReference: input.tokenReference,
        },
      },
      create: { id: randomUUID(), ...input },
      update: {
        brand: input.brand,
        last4: input.last4,
        expiresMonth: input.expiresMonth,
        expiresYear: input.expiresYear,
      },
      select: {
        id: true,
        accountId: true,
        provider: true,
        tokenReference: true,
        brand: true,
        last4: true,
        expiresMonth: true,
        expiresYear: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return paymentMethod(row);
  }
  async findPaymentMethod(accountId: string, id: string) {
    const row = await this.prisma.paymentMethodToken.findFirst({
      where: { accountId, id },
    });
    return row ? paymentMethod(row) : null;
  }
  async listPaymentMethods(accountId: string) {
    const rows = await this.prisma.paymentMethodToken.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(paymentMethod);
  }
  async updatePaymentMethod(
    accountId: string,
    id: string,
    metadata: Pick<
      PaymentMethodToken,
      "brand" | "last4" | "expiresMonth" | "expiresYear"
    >,
  ) {
    const result = await this.prisma.paymentMethodToken.updateMany({
      where: { id, accountId, revokedAt: null },
      data: metadata,
    });
    if (result.count === 0) return null;
    const row = await this.prisma.paymentMethodToken.findUniqueOrThrow({
      where: { id },
    });
    return paymentMethod(row);
  }
  async revokePaymentMethod(id: string, at: Date) {
    const row = await this.prisma.paymentMethodToken.update({
      where: { id },
      data: { revokedAt: at },
      select: {
        id: true,
        accountId: true,
        provider: true,
        tokenReference: true,
        brand: true,
        last4: true,
        expiresMonth: true,
        expiresYear: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return paymentMethod(row);
  }
  async recordProviderEvent(input: PaymentProviderEvent) {
    const result = await this.prisma.paymentProviderEvent.createMany({
      data: [
        {
          id: randomUUID(),
          provider: input.provider,
          eventId: input.eventId,
          type: input.type,
          occurredAt: input.occurredAt,
          payloadReference: input.payloadReference,
          accountKey: input.accountKey ?? null,
          objectId: input.objectId ?? null,
          objectStatus: input.objectStatus ?? null,
          paymentStatus: input.paymentStatus ?? null,
          providerCustomerId: input.providerCustomerId ?? null,
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }
  async syncInvoiceStatus(
    provider: string,
    reference: string,
    status: string,
    occurredAt: Date,
  ) {
    const result = await this.prisma.invoice.updateMany({
      where: {
        provider,
        providerReference: reference,
        OR: [
          { lastProviderEventAt: null },
          { lastProviderEventAt: { lt: occurredAt } },
        ],
      },
      data: { status, lastProviderEventAt: occurredAt },
    });
    if (result.count === 0) return null;
    const row = await this.prisma.invoice.findFirstOrThrow({
      where: { provider, providerReference: reference },
      select: { id: true, accountId: true },
    });
    return row;
  }
  async syncSubscriptionStatus(
    provider: string,
    reference: string,
    status: string,
    occurredAt: Date,
  ) {
    const result = await this.prisma.subscription.updateMany({
      where: {
        provider,
        providerReference: reference,
        OR: [
          { lastProviderEventAt: null },
          { lastProviderEventAt: { lt: occurredAt } },
        ],
      },
      data: { status, lastProviderEventAt: occurredAt },
    });
    if (result.count === 0) return null;
    const row = await this.prisma.subscription.findFirstOrThrow({
      where: { provider, providerReference: reference },
      select: { id: true, accountId: true },
    });
    return row;
  }
}
