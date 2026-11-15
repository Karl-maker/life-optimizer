import type { BillingTransactionRunner } from "@life-optimizer/financial";
import { Prisma, type PrismaClient } from "../generated/client.js";
import { PrismaAuditLog } from "../audit/prisma-audit-log.js";
import { PrismaEventOutbox } from "../events/prisma-event-outbox.js";
import { PrismaFinancialRepository } from "../repositories/prisma-financial-repository.js";
import { PrismaBillingRepository } from "../repositories/prisma-billing-repository.js";

export class PrismaBillingTransactionRunner implements BillingTransactionRunner {
  constructor(private readonly prisma: PrismaClient) {}
  async run<T>(
    work: Parameters<BillingTransactionRunner["run"]>[0],
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return (await this.prisma.$transaction(
          (tx) =>
            work({
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
    throw new Error("Billing transaction retry limit exceeded.");
  }
}
