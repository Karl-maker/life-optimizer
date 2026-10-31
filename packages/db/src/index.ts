import type {
  AiCatalogTransactionRunner,
  ModelCatalogRepository,
} from "@edu-service/ai";
import type { EmailRepository } from "@edu-service/email";
import type { NotificationRepository } from "@edu-service/notifications";
import type { SmsRepository } from "@edu-service/sms";
import type {
  FinancialRepository,
  FinancialTransactionRunner,
} from "@edu-service/financial";
import type {
  CompanyRepository,
  ApiAccessPolicyReader,
  OperationLog,
  UserRepository,
} from "@edu-service/core";
import { createPrismaClient } from "./client.js";
import { PrismaCompanyRepository } from "./repositories/prisma-company-repository.js";
import { PrismaUserRepository } from "./repositories/prisma-user-repository.js";
import { PrismaTransactionRunner } from "./transactions/prisma-transaction-runner.js";
import { PrismaAiModelRepository } from "./repositories/prisma-ai-model-repository.js";
import { PrismaAiCatalogTransactionRunner } from "./transactions/prisma-ai-catalog-transaction-runner.js";
import { PrismaApiAccessPolicyReader } from "./repositories/prisma-api-access-policy-reader.js";
import { PrismaEmailRepository } from "./repositories/prisma-email-repository.js";
import { PrismaNotificationRepository } from "./repositories/prisma-notification-repository.js";
import { PrismaSmsRepository } from "./repositories/prisma-sms-repository.js";
import { PrismaFinancialRepository } from "./repositories/prisma-financial-repository.js";
import { PrismaFinancialTransactionRunner } from "./transactions/prisma-financial-transaction-runner.js";

export interface Database {
  /** Ready to hand to createCore(). */
  readonly users: UserRepository;
  readonly companies: CompanyRepository;
  readonly transactions: import("@edu-service/core").TransactionRunner;
  /** Ready to hand to createAiCatalog(). */
  readonly aiModels: ModelCatalogRepository;
  readonly aiCatalogTransactions: AiCatalogTransactionRunner;
  /** Provider-neutral financial catalog, entitlement, usage and wallet persistence. */
  readonly financial: FinancialRepository;
  readonly financialTransactions: FinancialTransactionRunner;
  /** Ready to hand to createEmailService(). */
  readonly emails: EmailRepository;
  readonly sms: SmsRepository;
  readonly notifications: NotificationRepository;
  /** Evaluates external API allow/block policy without exposing Prisma. */
  readonly apiAccessPolicies: ApiAccessPolicyReader;
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
    aiModels: new PrismaAiModelRepository(prisma),
    aiCatalogTransactions: new PrismaAiCatalogTransactionRunner(prisma),
    financial: new PrismaFinancialRepository(prisma),
    financialTransactions: new PrismaFinancialTransactionRunner(prisma),
    emails: new PrismaEmailRepository(prisma),
    sms: new PrismaSmsRepository(prisma),
    notifications: new PrismaNotificationRepository(prisma),
    apiAccessPolicies: new PrismaApiAccessPolicyReader(prisma),
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
