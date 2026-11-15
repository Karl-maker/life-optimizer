import type { AiCatalogTransactionRunner } from "@life-optimizer/ai";
import type { PrismaClient } from "../generated/client.js";
import { PrismaAuditLog } from "../audit/prisma-audit-log.js";
import { PrismaAiModelRepository } from "../repositories/prisma-ai-model-repository.js";

/** Binds catalog writes and the core audit port to the same PostgreSQL transaction. */
export class PrismaAiCatalogTransactionRunner implements AiCatalogTransactionRunner {
  constructor(private readonly prisma: PrismaClient) {}
  async run<T>(
    work: Parameters<AiCatalogTransactionRunner["run"]>[0],
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) =>
      work({
        models: new PrismaAiModelRepository(tx),
        audit: new PrismaAuditLog(tx),
      }),
    ) as Promise<T>;
  }
}
