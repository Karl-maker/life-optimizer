import type { StorePurchaseTransactionRunner } from "@edu-service/financial";
import { Prisma, type PrismaClient } from "../generated/client.js";
import { PrismaAuditLog } from "../audit/prisma-audit-log.js";
import { PrismaEventOutbox } from "../events/prisma-event-outbox.js";
import { PrismaFinancialRepository } from "../repositories/prisma-financial-repository.js";
import { PrismaBillingRepository } from "../repositories/prisma-billing-repository.js";
import { PrismaStorePurchaseRepository } from "../repositories/prisma-store-purchase-repository.js";

export class PrismaStorePurchaseTransactionRunner implements StorePurchaseTransactionRunner {
  constructor(private readonly prisma: PrismaClient) {}
  async run<T>(
    work: Parameters<StorePurchaseTransactionRunner["run"]>[0],
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return (await this.prisma.$transaction(
          (tx) =>
            work({
              store: new PrismaStorePurchaseRepository(tx),
              billing: new PrismaBillingRepository(tx),
              financial: new PrismaFinancialRepository(tx),
              audit: new PrismaAuditLog(tx),
              events: new PrismaEventOutbox(tx),
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )) as T;
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2034" ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("Store purchase transaction retry limit exceeded.");
  }
}
