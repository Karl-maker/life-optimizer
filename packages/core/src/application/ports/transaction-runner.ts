import type { AuditLog } from "./audit-log.js";
import type { CompanyRepository } from "./company-repository.js";
import type { UserRepository } from "./user-repository.js";
import type { EventOutbox } from "./event-outbox.js";

/** The transaction-scoped dependencies a mutating use case may use. */
export interface TransactionPorts {
  users: UserRepository;
  companies: CompanyRepository;
  audit: AuditLog;
  events: EventOutbox;
}

/**
 * Makes a business write and its audit event atomic without letting core depend
 * on a database transaction implementation.
 */
export interface TransactionRunner {
  run<T>(work: (ports: TransactionPorts) => Promise<T>): Promise<T>;
}
