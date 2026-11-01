import type { FastifyError, FastifyInstance } from "fastify";
import { AuthenticationError, DomainError } from "@edu-service/core";
import {
  ApiAccessBlockedError,
  ApiAuthenticationError,
  ApiAuthorizationError,
  ApiOriginBlockedError,
} from "./auth.js";
import { PageRequestError } from "./pagination.js";
import { UnsafeInputError } from "./input-safety.js";
import { SoapFaultError, soapFaultXml } from "./soap.js";

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  requestId: string;
  errors?: readonly { path: string; message: string }[];
}

interface ValidationIssue {
  instancePath: string;
  schemaPath: string;
  message?: string;
}
type ErrorWithValidation = FastifyError & {
  validation?: readonly ValidationIssue[];
};

export function registerProblemErrors(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof SoapFaultError) {
      reply
        .code(error.statusCode)
        .type("text/xml; charset=utf-8")
        .header("x-request-id", request.id)
        .send(soapFaultXml(error, request.id));
      return;
    }
    const problem = toProblem(error, request.id);
    reply
      .code(problem.status)
      .type("application/problem+json")
      .header("x-request-id", request.id)
      .send(problem);
  });
}

function toProblem(error: FastifyError | Error, requestId: string): Problem {
  const validation = (error as ErrorWithValidation).validation;
  if (validation)
    return {
      type: "/problems/validation",
      title: "Request validation failed",
      status: 400,
      code: "VALIDATION_ERROR",
      detail: "Correct the invalid request fields and try again.",
      requestId,
      errors: validation.map((entry) => ({
        path: `${entry.instancePath || entry.schemaPath}`,
        message: entry.message ?? "Invalid value.",
      })),
    };
  if (error instanceof DomainError)
    return {
      type: `/problems/${error.code.toLowerCase().replaceAll("_", "-")}`,
      title: error.message,
      status:
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "PAYMENT_REQUIRED"
            ? 402
            : error.code.endsWith("NOT_FOUND")
              ? 404
              : 422,
      code: error.code,
      requestId,
    };
  if (error instanceof AuthenticationError || isAuthenticationError(error))
    return {
      type: "/problems/authentication",
      title: error.message,
      status:
        error.code === "INVALID_AUTH_INPUT"
          ? 400
          : error.code === "REAUTHENTICATION_REQUIRED"
            ? 403
            : error.code === "INVALID_POLICY_VERSION"
              ? 422
              : error.code === "ACCOUNT_UNAVAILABLE"
                ? 409
                : 401,
      code: error.code,
      requestId,
    };
  if (
    error instanceof ApiAuthenticationError ||
    error instanceof ApiAuthorizationError ||
    error instanceof ApiAccessBlockedError ||
    error instanceof ApiOriginBlockedError
  )
    return {
      type:
        error instanceof ApiAuthenticationError
          ? "/problems/unauthorized"
          : error instanceof ApiAccessBlockedError
            ? "/problems/access-blocked"
            : error instanceof ApiOriginBlockedError
              ? "/problems/origin-blocked"
              : "/problems/forbidden",
      title: error.message,
      status: error.statusCode,
      code:
        error instanceof ApiAuthenticationError
          ? "UNAUTHORIZED"
          : error instanceof ApiAccessBlockedError
            ? "API_ACCESS_BLOCKED"
            : error instanceof ApiOriginBlockedError
              ? "ORIGIN_BLOCKED"
              : "FORBIDDEN",
      ...((error instanceof ApiAccessBlockedError ||
        error instanceof ApiOriginBlockedError) &&
      error.supportReference !== undefined
        ? {
            detail: `Contact support and provide reference ${error.supportReference}.`,
          }
        : {}),
      requestId,
    };
  if (error instanceof PageRequestError || error instanceof UnsafeInputError)
    return {
      type: "/problems/validation",
      title: "Request validation failed",
      status: 400,
      code: "VALIDATION_ERROR",
      detail: error.message,
      requestId,
    };
  const status =
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
      ? error.statusCode
      : 500;
  return {
    type: status === 500 ? "/problems/internal" : "/problems/request",
    title: status === 500 ? "Internal server error" : error.message,
    status,
    code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
    ...(status === 500 ? {} : { detail: error.message }),
    requestId,
  };
}

function isAuthenticationError(error: Error): error is AuthenticationError {
  return (
    "code" in error &&
    typeof error.code === "string" &&
    [
      "INVALID_CREDENTIALS",
      "ACCOUNT_UNAVAILABLE",
      "INVALID_OR_EXPIRED_TOKEN",
      "REAUTHENTICATION_REQUIRED",
      "INVALID_POLICY_VERSION",
      "INVALID_AUTH_INPUT",
    ].includes(error.code)
  );
}
