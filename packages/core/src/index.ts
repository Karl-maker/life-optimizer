// The public surface of @life-optimizer/core. Anything not exported here is private.
export { createCore } from "./application/create-core.js";
export type { Core, CoreDeps } from "./application/create-core.js";

export type {
  CompanyRepository,
  CompanyRef,
} from "./application/ports/company-repository.js";
export type { UserRepository } from "./application/ports/user-repository.js";
export {
  ROOT_ADMIN_ROLE_ID,
  type AuthorizationRepository,
  type AuthorizationRole,
  type AuthorizationTransactionRunner,
  type UserRoleAssignment,
} from "./application/ports/authorization-repository.js";
export {
  createAuthorizationService,
  type AuthorizationPrincipal,
  type AuthorizationService,
} from "./application/authorization/authorization-service.js";
export {
  ADMIN_RESOURCES,
  createAdminDataService,
  type AdminDataRepository,
  type AdminDataService,
  type AdminFilter,
  type AdminMutationPolicy,
  type AdminResourceDescriptor,
} from "./application/admin/admin-data.js";
export type { AuditLog } from "./application/ports/audit-log.js";
export type { EventOutbox } from "./application/ports/event-outbox.js";
export {
  AUTH_EVENT,
  DOMAIN_EVENT,
  type DomainEvent,
} from "./application/events/domain-event.js";
export type { OperationLog } from "./application/ports/operation-log.js";
export type {
  CacheStore,
  CacheStoreWriteOptions,
  CacheStoreWriteResult,
} from "./application/ports/cache-store.js";
export type {
  TransactionPorts,
  TransactionRunner,
} from "./application/ports/transaction-runner.js";
export {
  AUDIT_ACTION,
  type AuditAction,
  type AuditChanges,
  type AuditContext,
  type AuditEventDraft,
  type AuditOutcome,
} from "./application/audit/audit-event.js";

export type { Company, NewCompany } from "./domain/company/index.js";
export type { User, NewUser } from "./domain/user/index.js";
export {
  LIFE_LOG_CATEGORIES,
  LIFE_LOG_LIMITS,
  LIFE_LOG_TYPES,
  normalizeLifeLogText,
  parseLifeLogTimestamp,
  parseLifeLogType,
  parseTimeZone,
  type LifeLog,
  type LifeLogCategory,
  type LifeLogTimestamp,
  type LifeLogType,
  type NewLifeLog,
} from "./domain/life-log/index.js";
export type {
  LifeLogRepository,
  LifeLogQuery,
} from "./application/ports/life-log-repository.js";
export type {
  LifeLogDraft,
  AddLifeLogsInput,
  UpdateAgentLifeLogInput,
} from "./application/life-logs/life-logs.js";
export {
  ISO_3166_1_ALPHA_2_CODES,
  parseCountryCode,
  type CountryCode,
} from "./domain/country-code/index.js";
export { DomainError, type DomainErrorCode } from "./domain/errors/index.js";
export type { Actor } from "./domain/actor/index.js";
export {
  ALL_PERMISSIONS,
  PERMISSIONS,
  createPermission,
  isPermission,
  parsePermission,
  type Permission,
  type PermissionAction,
  type PermissionResource,
} from "./domain/permissions/index.js";
export type {
  AuthProfile,
  AuthRequestContext,
  AuthSession,
  ClientPlatform,
  LoginAuditRecord,
  LoginProvider,
  RiskLevel,
  UserRole,
} from "./domain/auth/index.js";
export { createAuthenticationService } from "./application/auth/create-authentication-service.js";
export { createDisposableEmailPolicy } from "./application/auth/disposable-email-policy.js";
export {
  AuthenticationError,
  type AccountDeletionCallback,
  type AuthAccount,
  type AuthChallenge,
  type AuthenticationService,
  type AuthStore,
  type ConsentReceiptInput,
  type IdentityPresenceIndex,
  type IssuedSecret,
  type PasswordHasher,
  type RegisteredDevice,
  type SecretCodec,
  type StoredSession,
  type VerificationDelivery,
  type DisposableEmailPolicy,
  type VerifiedOAuthIdentity,
  type AuthenticationRiskAssessor,
  type SecurityNotification,
  type CompliancePolicyReader,
} from "./application/auth/authentication-service.js";
export type {
  ApiAccessDecision,
  ApiAccessPolicyReader,
} from "./application/ports/api-access-policy-reader.js";
export {
  createApiAccessAuthorizer,
  type ApiAccessAuthorizer,
} from "./application/api-access/create-api-access-authorizer.js";
