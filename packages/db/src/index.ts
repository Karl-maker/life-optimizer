import type {
  CompanyRepository,
  OperationLog,
  UserRepository,
} from "@edu-service/core";
import { createPrismaClient } from "./client.js";
import { PrismaCompanyRepository } from "./repositories/prisma-company-repository.js";
import { PrismaUserRepository } from "./repositories/prisma-user-repository.js";
import { PrismaTransactionRunner } from "./transactions/prisma-transaction-runner.js";

export interface Database {
  /** Ready to hand to createCore(). */
  readonly users: UserRepository;
  readonly companies: CompanyRepository;
  readonly transactions: import("@edu-service/core").TransactionRunner;
  /** Cheap connectivity check, for `edu-service doctor` and health pages. */
  ping(): Promise<void>;
  /** Releases the connection pool. Call once when the process is done. */
  close(): Promise<void>;
}

/**
 * The single entry point to the data. Nothing outside this package imports Prisma:
 * callers receive repositories that speak the language of @edu-service/core.
 */
export function createDatabase(options: {
  connectionString: string;
  operationLog?: OperationLog;
}): Database {
  const prisma = createPrismaClient(options.connectionString);

  return {
    users: new PrismaUserRepository(prisma),
    companies: new PrismaCompanyRepository(prisma),
    transactions: new PrismaTransactionRunner(prisma),
    async ping() {
      try {
        await prisma.$queryRaw`SELECT 1`;
        options.operationLog?.info("database.ping.succeeded");
      } catch (error) {
        options.operationLog?.error("database.ping.failed");
        throw error;
      }
    },
    async close() {
      await prisma.$disconnect();
    },
  };
}
