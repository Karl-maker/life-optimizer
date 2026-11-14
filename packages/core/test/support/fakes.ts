import { InMemoryCompanyRepository } from "./in-memory/in-memory-company-repository.js";
import { InMemoryAuditLog } from "./in-memory/in-memory-audit-log.js";
import { InMemoryTransactionRunner } from "./in-memory/in-memory-transaction-runner.js";
import { InMemoryUserRepository } from "./in-memory/in-memory-user-repository.js";
import { InMemoryEventOutbox } from "./in-memory/in-memory-event-outbox.js";
import { InMemoryLifeLogRepository } from "./in-memory/in-memory-life-log-repository.js";

export const NOW = new Date("2026-10-24T09:00:00Z");

/**
 * Everything a use case can depend on, freshly built.
 * Call it inside each test (or a beforeEach): nothing is shared, so tests cannot affect each other.
 */
export function createFakes() {
  const users = new InMemoryUserRepository();
  const companies = new InMemoryCompanyRepository();
  const audit = new InMemoryAuditLog();
  const events = new InMemoryEventOutbox();
  const lifeLogs = new InMemoryLifeLogRepository();
  return {
    users,
    companies,
    audit,
    events,
    lifeLogs,
    transactions: new InMemoryTransactionRunner({
      users,
      companies,
      audit,
      events,
      lifeLogs,
    }),
    clock: () => NOW,
  };
}
