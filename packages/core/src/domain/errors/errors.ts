// Every error the business logic can raise is a DomainError with a stable, machine-readable code.
// Adapters (the CLI today, a web API tomorrow) translate these codes; they never parse messages.
export type DomainErrorCode =
  | "INVALID_COUNTRY_CODE"
  | "INVALID_REGISTRY_CODE"
  | "INVALID_NAME"
  | "USER_NOT_FOUND"
  | "USER_ALREADY_EXISTS"
  | "COMPANY_NOT_FOUND"
  | "COMPANY_ALREADY_EXISTS"
  | "FORBIDDEN"
  | "PAYMENT_REQUIRED"
  | "API_ACCESS_BLOCKED"
  | "INVALID_TIMESTAMP"
  | "INVALID_TIME_ZONE"
  | "INVALID_LIFE_LOG"
  | "INVALID_LIFE_LOG_QUERY";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
}
