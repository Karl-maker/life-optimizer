import { randomUUID } from "node:crypto";
import { DomainError } from "@life-optimizer/core";
import type {
  StoreProductMapping,
  StorePurchase,
  StorePurchaseRepository,
} from "@life-optimizer/financial";
import type { PrismaClient } from "../generated/client.js";

type Client = Pick<
  PrismaClient,
  | "storeProductMapping"
  | "storePurchase"
  | "storeNotification"
  | "storeVoid"
  | "entitlement"
>;
const purchase = (row: {
  id: string;
  provider: string;
  transactionId: string;
  originalTransactionId: string;
  tokenHash: string | null;
  accountId: string | null;
  mappingId: string;
  mapping: { priceId: string };
  sku: string;
  kind: string;
  status: string;
  environment: string;
  permanentlyRevoked: boolean;
  quantity: number;
  currency: string | null;
  priceMilliunits: bigint | null;
  purchasedAt: Date | null;
  expiresAt: Date | null;
  observedAt: Date;
  createdAt: Date;
}): StorePurchase => ({
  id: row.id,
  provider: row.provider as StorePurchase["provider"],
  transactionId: row.transactionId,
  originalTransactionId: row.originalTransactionId,
  tokenHash: row.tokenHash,
  accountId: row.accountId,
  mappingId: row.mappingId,
  priceId: row.mapping.priceId,
  sku: row.sku,
  kind: row.kind as StorePurchase["kind"],
  status: row.status as StorePurchase["status"],
  environment: row.environment as StorePurchase["environment"],
  permanentlyRevoked: row.permanentlyRevoked,
  quantity: row.quantity,
  currency: row.currency,
  priceMilliunits: row.priceMilliunits,
  purchasedAt: row.purchasedAt,
  expiresAt: row.expiresAt,
  observedAt: row.observedAt,
  createdAt: row.createdAt,
});

export class PrismaStorePurchaseRepository implements StorePurchaseRepository {
  constructor(private readonly db: Client) {}
  async findVoid(provider: StorePurchase["provider"], transactionId: string) {
    return this.db.storeVoid.findUnique({
      where: { provider_transactionId: { provider, transactionId } },
      select: { tokenHash: true },
    });
  }
  async recordVoid(input: {
    provider: StorePurchase["provider"];
    transactionId: string;
    tokenHash: string;
    eventId: string;
    occurredAt: Date;
  }) {
    const result = await this.db.storeVoid.createMany({
      data: [{ id: randomUUID(), ...input }],
      skipDuplicates: true,
    });
    const current = await this.findVoid(input.provider, input.transactionId);
    if (current?.tokenHash !== input.tokenHash)
      throw new DomainError(
        "FORBIDDEN",
        "Store void token does not match the recorded order.",
      );
    return result.count === 1;
  }
  async findMapping(provider: StoreProductMapping["provider"], sku: string) {
    const row = await this.db.storeProductMapping.findUnique({
      where: { provider_sku: { provider, sku } },
    });
    return row
      ? { ...row, provider: row.provider as StoreProductMapping["provider"] }
      : null;
  }
  async saveMapping(input: StoreProductMapping) {
    const row = await this.db.storeProductMapping.upsert({
      where: { provider_sku: { provider: input.provider, sku: input.sku } },
      create: input,
      update: { active: input.active },
    });
    return {
      ...row,
      provider: row.provider as StoreProductMapping["provider"],
    };
  }
  async findByTransaction(
    provider: StorePurchase["provider"],
    transactionId: string,
  ) {
    const row = await this.db.storePurchase.findUnique({
      where: { provider_transactionId: { provider, transactionId } },
      include: { mapping: { select: { priceId: true } } },
    });
    return row ? purchase(row) : null;
  }
  async findByOriginal(
    provider: StorePurchase["provider"],
    originalId: string,
  ) {
    const row = await this.db.storePurchase.findFirst({
      where: {
        provider,
        originalTransactionId: originalId,
        accountId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      include: { mapping: { select: { priceId: true } } },
    });
    return row ? purchase(row) : null;
  }
  async findByTokenHash(
    provider: StorePurchase["provider"],
    tokenHash: string,
  ) {
    const row = await this.db.storePurchase.findFirst({
      where: { provider, tokenHash, accountId: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { mapping: { select: { priceId: true } } },
    });
    return row ? purchase(row) : null;
  }
  async savePurchase(input: StorePurchase) {
    const existing = await this.findByTransaction(
      input.provider,
      input.transactionId,
    );
    if (!existing) {
      const result = await this.db.storePurchase.createMany({
        data: [
          {
            id: input.id,
            provider: input.provider,
            transactionId: input.transactionId,
            originalTransactionId: input.originalTransactionId,
            tokenHash: input.tokenHash,
            accountId: input.accountId,
            mappingId: input.mappingId,
            sku: input.sku,
            kind: input.kind,
            status: input.status,
            environment: input.environment,
            permanentlyRevoked: input.permanentlyRevoked,
            quantity: input.quantity,
            currency: input.currency,
            priceMilliunits: input.priceMilliunits,
            purchasedAt: input.purchasedAt,
            expiresAt: input.expiresAt,
            observedAt: input.observedAt,
            createdAt: input.createdAt,
          },
        ],
        skipDuplicates: true,
      });
      if (result.count)
        return {
          purchase: (await this.findByTransaction(
            input.provider,
            input.transactionId,
          ))!,
          changed: true,
          created: true,
        };
    }
    const current = (await this.findByTransaction(
      input.provider,
      input.transactionId,
    ))!;
    if (
      (current.accountId && current.accountId !== input.accountId) ||
      current.mappingId !== input.mappingId ||
      current.sku !== input.sku ||
      current.kind !== input.kind ||
      current.environment !== input.environment
    )
      throw new DomainError(
        "FORBIDDEN",
        "Store purchase association cannot change.",
      );
    if (current.observedAt > input.observedAt)
      return { purchase: current, changed: false, created: false };
    const changed =
      current.status !== input.status ||
      current.permanentlyRevoked !== input.permanentlyRevoked ||
      current.accountId !== input.accountId ||
      current.expiresAt?.getTime() !== input.expiresAt?.getTime() ||
      current.quantity !== input.quantity;
    if (changed || current.observedAt < input.observedAt) {
      await this.db.storePurchase.update({
        where: { id: current.id },
        data: {
          status: input.status,
          permanentlyRevoked: input.permanentlyRevoked,
          accountId: input.accountId,
          tokenHash: input.tokenHash,
          quantity: input.quantity,
          currency: input.currency,
          priceMilliunits: input.priceMilliunits,
          purchasedAt: input.purchasedAt,
          expiresAt: input.expiresAt,
          observedAt: input.observedAt,
        },
      });
    }
    return {
      purchase: (await this.findByTransaction(
        input.provider,
        input.transactionId,
      ))!,
      changed,
      created: false,
    };
  }
  listGrants(purchaseId: string) {
    return this.db.entitlement.findMany({
      where: { storePurchaseId: purchaseId },
      select: { id: true, revokedAt: true },
    });
  }
  async listForAccount(
    accountId: string,
    cursor: { createdAt: Date; id: string } | null,
    limit: number,
  ) {
    const rows = await this.db.storePurchase.findMany({
      where: {
        accountId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: { mapping: { select: { priceId: true } } },
    });
    return rows.map(purchase);
  }
  async recordNotification(input: {
    provider: StorePurchase["provider"];
    eventId: string;
    type: string;
    purchaseId: string | null;
    occurredAt: Date;
  }) {
    const result = await this.db.storeNotification.createMany({
      data: [{ id: randomUUID(), ...input }],
      skipDuplicates: true,
    });
    return result.count === 1;
  }
}
