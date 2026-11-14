import { DomainError, type DomainErrorCode } from "@edu-service/core";
import type { ErrorCode } from "./codes.js";
import { CliError } from "./cli-error.js";

// The ONLY place that knows how core's errors become CLI errors.
// Typing the table as Record<DomainErrorCode, ...> means adding a new domain error in core
// fails the build here until it is mapped.
const FROM_DOMAIN: Record<DomainErrorCode, ErrorCode> = {
  INVALID_COUNTRY_CODE: "USAGE",
  INVALID_REGISTRY_CODE: "USAGE",
  INVALID_NAME: "USAGE",
  USER_NOT_FOUND: "NOT_FOUND",
  COMPANY_NOT_FOUND: "NOT_FOUND",
  USER_ALREADY_EXISTS: "CONFLICT",
  COMPANY_ALREADY_EXISTS: "CONFLICT",
  FORBIDDEN: "FORBIDDEN",
  API_ACCESS_BLOCKED: "FORBIDDEN",
  PAYMENT_REQUIRED: "UNAVAILABLE",
  INVALID_TIMESTAMP: "USAGE",
  INVALID_TIME_ZONE: "USAGE",
  INVALID_LIFE_LOG: "USAGE",
  INVALID_LIFE_LOG_QUERY: "USAGE",
};

const HINTS: Partial<Record<DomainErrorCode, string>> = {
  INVALID_TIMESTAMP:
    "Use DD-MM-YYYY HH:mm[:ss], or ISO 8601 with an explicit UTC offset.",
  INVALID_TIME_ZONE: "Use an IANA timezone such as America/Port_of_Spain.",
  USER_NOT_FOUND: "Run `life-optimizer user list` to see the users.",
  COMPANY_NOT_FOUND:
    "The inherited company command surface is not exposed by Life Optimizer.",
  COMPANY_ALREADY_EXISTS:
    "The inherited company command surface is not exposed by Life Optimizer.",
};

export function mapError(error: unknown): CliError {
  if (error instanceof CliError) return error;

  if (error instanceof DomainError) {
    return new CliError({
      code: FROM_DOMAIN[error.code],
      message: error.message,
      hint: HINTS[error.code],
      details: { ...error.details, domainCode: error.code },
      cause: error,
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new CliError({
    code: "INTERNAL",
    message: `Unexpected error: ${message}`,
    hint: "Run again with --debug for details.",
    cause: error,
  });
}
