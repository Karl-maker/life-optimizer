import type { AuthorizationTransactionRunner } from "@life-optimizer/core";
import type { PrismaClient } from "../generated/client.js";
import { PrismaAuditLog } from "../audit/prisma-audit-log.js";
import { PrismaAuthorizationRepository } from "../repositories/prisma-authorization-repository.js";

export class PrismaAuthorizationTransactionRunner implements AuthorizationTransactionRunner {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(
    work: Parameters<AuthorizationTransactionRunner["run"]>[0],
  ): Promise<T> {
    return this.prisma.$transaction((tx) =>
      work({
        authorization: new PrismaAuthorizationRepository(tx),
        audit: new PrismaAuditLog(tx),
      }),
    ) as Promise<T>;
  }
}
