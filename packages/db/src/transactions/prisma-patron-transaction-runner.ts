import type { PatronTransactionRunner } from "@life-optimizer/patron";
import { Prisma, type PrismaClient } from "../generated/client.js";
import { PrismaAuditLog } from "../audit/prisma-audit-log.js";
import { PrismaEventOutbox } from "../events/prisma-event-outbox.js";
import { PrismaPatronRepository } from "../repositories/prisma-patron-repository.js";

/** Keeps Patron credit ledger changes, outbox facts and audit events atomic. */
export class PrismaPatronTransactionRunner implements PatronTransactionRunner {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(
    work: Parameters<PatronTransactionRunner["run"]>[0],
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return (await this.prisma.$transaction(
          (tx) =>
            work({
              patron: new PrismaPatronRepository(tx),
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
    throw new Error("Patron transaction retry limit exceeded.");
  }
}
