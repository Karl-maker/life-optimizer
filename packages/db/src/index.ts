import type {
  AiCatalogTransactionRunner,
  ModelCatalogRepository,
} from "@life-optimizer/ai";
import type {
  PatronRepository,
  PatronTransactionRunner,
} from "@life-optimizer/patron";
import type { EmailRepository } from "@life-optimizer/email";
import type { NotificationRepository } from "@life-optimizer/notifications";
import type { SmsRepository } from "@life-optimizer/sms";
import type {
  FinancialRepository,
  FinancialTransactionRunner,
  BillingRepository,
  BillingTransactionRunner,
  PowerTranzSaleRepository,
  StorePurchaseRepository,
  StorePurchaseTransactionRunner,
  FinancialReportingRepository,
} from "@life-optimizer/financial";
import type {
  CompanyRepository,
  AuthStore,
  ApiAccessPolicyReader,
  OperationLog,
  UserRepository,
  AuthorizationRepository,
  AuthorizationTransactionRunner,
  AdminDataRepository,
  LifeLogRepository,
} from "@life-optimizer/core";
import { createPrismaClient } from "./client.js";
import { PrismaCompanyRepository } from "./repositories/prisma-company-repository.js";
import { PrismaUserRepository } from "./repositories/prisma-user-repository.js";
import { PrismaTransactionRunner } from "./transactions/prisma-transaction-runner.js";
import { PrismaAiModelRepository } from "./repositories/prisma-ai-model-repository.js";
import { PrismaAiCatalogTransactionRunner } from "./transactions/prisma-ai-catalog-transaction-runner.js";
import { PrismaPatronRepository } from "./repositories/prisma-patron-repository.js";
import { PrismaPatronTransactionRunner } from "./transactions/prisma-patron-transaction-runner.js";
import { PrismaApiAccessPolicyReader } from "./repositories/prisma-api-access-policy-reader.js";
import { PrismaEmailRepository } from "./repositories/prisma-email-repository.js";
import { PrismaNotificationRepository } from "./repositories/prisma-notification-repository.js";
import { PrismaSmsRepository } from "./repositories/prisma-sms-repository.js";
import { PrismaFinancialRepository } from "./repositories/prisma-financial-repository.js";
import { PrismaFinancialTransactionRunner } from "./transactions/prisma-financial-transaction-runner.js";
import { PrismaBillingRepository } from "./repositories/prisma-billing-repository.js";
import { PrismaBillingTransactionRunner } from "./transactions/prisma-billing-transaction-runner.js";
import { PrismaPowerTranzSaleRepository } from "./repositories/prisma-powertranz-sale-repository.js";
import { PrismaStorePurchaseRepository } from "./repositories/prisma-store-purchase-repository.js";
import { PrismaStorePurchaseTransactionRunner } from "./transactions/prisma-store-purchase-transaction-runner.js";
import { PrismaAuthStore } from "./repositories/prisma-auth-store.js";
import { PrismaAuthorizationRepository } from "./repositories/prisma-authorization-repository.js";
import { PrismaAuthorizationTransactionRunner } from "./transactions/prisma-authorization-transaction-runner.js";
import { PrismaAdminDataRepository } from "./repositories/prisma-admin-data-repository.js";
import { PrismaFinancialReportingRepository } from "./repositories/prisma-financial-reporting-repository.js";
import type {
  ExposureRecorder,
  FeatureFlagChangeAudit,
  FeatureFlagRepository,
} from "@life-optimizer/feature-flags";
import { PrismaFeatureFlagRepository } from "./repositories/prisma-feature-flag-repository.js";
import { PrismaFeatureFlagAudit } from "./audit/prisma-feature-flag-audit.js";
import { PrismaFeatureFlagExposureRecorder } from "./repositories/prisma-feature-flag-exposure-recorder.js";
import { PrismaAuditLog } from "./audit/prisma-audit-log.js";
import { PrismaLifeLogRepository } from "./repositories/prisma-life-log-repository.js";

export { PrismaAuthStore } from "./repositories/prisma-auth-store.js";

export interface Database {
  /** Ready to hand to createCore(). */
  readonly users: UserRepository;
  readonly companies: CompanyRepository;
  readonly lifeLogs: LifeLogRepository;
  readonly transactions: import("@life-optimizer/core").TransactionRunner;
  /** Ready to hand to createAiCatalog(). */
  readonly aiModels: ModelCatalogRepository;
  readonly aiCatalogTransactions: AiCatalogTransactionRunner;
  /** Ready to hand to createPatronService(). */
  readonly patron: PatronRepository;
  readonly patronTransactions: PatronTransactionRunner;
  /** Provider-neutral financial catalog, entitlement, usage and wallet persistence. */
  readonly financial: FinancialRepository;
  readonly financialTransactions: FinancialTransactionRunner;
  readonly billing: BillingRepository;
  readonly billingTransactions: BillingTransactionRunner;
  readonly powerTranzSales: PowerTranzSaleRepository;
  readonly storePurchases: StorePurchaseRepository;
  readonly storePurchaseTransactions: StorePurchaseTransactionRunner;
  /** Ready to hand to createEmailService(). */
  readonly emails: EmailRepository;
  readonly sms: SmsRepository;
  readonly notifications: NotificationRepository;
  /** Evaluates external API allow/block policy without exposing Prisma. */
  readonly apiAccessPolicies: ApiAccessPolicyReader;
  /** Authentication credentials, sessions, challenges, login history, devices and consent receipts. */
  readonly authentication: AuthStore;
  /** Persisted application roles and their audited assignments. */
  readonly authorization: AuthorizationRepository;
  readonly authorizationTransactions: AuthorizationTransactionRunner;
  readonly adminData: AdminDataRepository;
  readonly financialReporting: FinancialReportingRepository;
  readonly featureFlags: FeatureFlagRepository;
  readonly featureFlagAudit: FeatureFlagChangeAudit;
  readonly featureFlagExposures: ExposureRecorder;
  readonly auditLog: import("@life-optimizer/core").AuditLog;
  /** Cheap connectivity check, for `life-optimizer doctor` and health pages. */
  ping(): Promise<void>;
  /** Releases the connection pool. Call once when the process is done. */
  close(): Promise<void>;
}

/**
 * The single entry point to the data. Nothing outside this package imports Prisma:
 * callers receive repositories that speak the language of @life-optimizer/core.
 */
export function createDatabase(options: {
  connectionString: string;
  operationLog?: OperationLog;
}): Database {
  const prisma = createPrismaClient(options.connectionString);

  return {
    users: new PrismaUserRepository(prisma),
    companies: new PrismaCompanyRepository(prisma),
    lifeLogs: new PrismaLifeLogRepository(prisma),
    transactions: new PrismaTransactionRunner(prisma),
    aiModels: new PrismaAiModelRepository(prisma),
    aiCatalogTransactions: new PrismaAiCatalogTransactionRunner(prisma),
    patron: new PrismaPatronRepository(prisma),
    patronTransactions: new PrismaPatronTransactionRunner(prisma),
    financial: new PrismaFinancialRepository(prisma),
    financialTransactions: new PrismaFinancialTransactionRunner(prisma),
    billing: new PrismaBillingRepository(prisma),
    billingTransactions: new PrismaBillingTransactionRunner(prisma),
    powerTranzSales: new PrismaPowerTranzSaleRepository(prisma),
    storePurchases: new PrismaStorePurchaseRepository(prisma),
    storePurchaseTransactions: new PrismaStorePurchaseTransactionRunner(prisma),
    emails: new PrismaEmailRepository(prisma),
    sms: new PrismaSmsRepository(prisma),
    notifications: new PrismaNotificationRepository(prisma),
    apiAccessPolicies: new PrismaApiAccessPolicyReader(prisma),
    authentication: new PrismaAuthStore(prisma),
    authorization: new PrismaAuthorizationRepository(prisma),
    authorizationTransactions: new PrismaAuthorizationTransactionRunner(prisma),
    adminData: new PrismaAdminDataRepository(prisma),
    financialReporting: new PrismaFinancialReportingRepository(prisma),
    featureFlags: new PrismaFeatureFlagRepository(prisma),
    featureFlagAudit: new PrismaFeatureFlagAudit(prisma),
    featureFlagExposures: new PrismaFeatureFlagExposureRecorder(prisma),
    auditLog: new PrismaAuditLog(prisma),
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
