import type { FastifyReply, FastifyRequest } from "fastify";
import {
  AuthenticationError,
  type ApiAccessAuthorizer as CoreApiAccessAuthorizer,
  type AuthenticationService,
  type AuthRequestContext,
} from "@edu-service/core";

export interface ApiPrincipal {
  /** Stable external integration or user identifier; never a raw API key. */
  id: string;
  permissions: readonly string[];
  kind: "api-key" | "bearer" | "service";
}

/** Implement at composition time; the API package never stores credentials. */
export interface ApiAuthenticator {
  authenticate(input: {
    apiKey?: string;
    bearerToken?: string;
    requestId: string;
    context: AuthRequestContext;
  }): Promise<ApiPrincipal | null>;
}

export interface ApiKeyVerifier {
  verify(apiKey: string, requestId: string): Promise<ApiPrincipal | null>;
}

/** Combines revocable user bearer sessions with deployment-owned third-party API keys. */
export function createCompositeApiAuthenticator(options: {
  sessions: AuthenticationService;
  apiKeys?: ApiKeyVerifier;
  /** Resolves persisted RBAC grants after the revocable session is verified. */
  permissionsForUser?: (userId: string) => Promise<readonly string[]>;
}): ApiAuthenticator {
  return {
    async authenticate(input) {
      // Ambiguous credentials are rejected instead of choosing one silently.
      if (input.apiKey && input.bearerToken) return null;
      if (input.apiKey)
        return options.apiKeys?.verify(input.apiKey, input.requestId) ?? null;
      if (!input.bearerToken) return null;
      try {
        const session = await options.sessions.authenticate(
          input.bearerToken,
          input.context,
        );
        const persisted = options.permissionsForUser
          ? await options.permissionsForUser(session.profile.userId)
          : [];
        return {
          id: session.profile.userId,
          kind: "bearer",
          permissions: [...new Set([...session.permissions, ...persisted])],
        };
      } catch (error) {
        if (
          error instanceof AuthenticationError ||
          hasAuthenticationCode(error)
        )
          return null;
        throw error;
      }
    },
  };
}
export type ApiAccessAuthorizer = CoreApiAccessAuthorizer;

export class ApiAuthenticationError extends Error {
  readonly statusCode = 401;
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "ApiAuthenticationError";
  }
}

export class ApiAuthorizationError extends Error {
  readonly statusCode = 403;
  constructor(message = "The caller lacks the required permission.") {
    super(message);
    this.name = "ApiAuthorizationError";
  }
}
export class ApiAccessBlockedError extends Error {
  readonly statusCode = 403;
  constructor(readonly supportReference?: string) {
    super(
      "This integration is not permitted to use this endpoint. Contact support with the request ID.",
    );
    this.name = "ApiAccessBlockedError";
  }
}
export class ApiOriginBlockedError extends Error {
  readonly statusCode = 403;
  constructor(readonly supportReference?: string) {
    super(
      "This browser origin is not permitted. Contact support with the request ID.",
    );
    this.name = "ApiOriginBlockedError";
  }
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1];
}

export function requirePermissions(
  authenticator: ApiAuthenticator,
  required: readonly string[],
  options: {
    accessAuthorizer?: ApiAccessAuthorizer;
    requireAllowlist?: boolean;
  } = {},
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers["x-api-key"];
    const token = bearerToken(request.headers.authorization);
    const principal = await authenticator.authenticate({
      ...(typeof apiKey === "string" ? { apiKey } : {}),
      ...(token === undefined ? {} : { bearerToken: token }),
      requestId: request.id,
      context: {
        correlationId: request.id,
        ipAddress: request.ip,
        platform: parsePlatform(request.headers["x-client-platform"]),
        ...(typeof request.headers["user-agent"] === "string"
          ? { userAgent: request.headers["user-agent"] }
          : {}),
        ...(typeof request.headers["x-device-id"] === "string"
          ? { deviceId: request.headers["x-device-id"].slice(0, 200) }
          : {}),
      },
    });
    if (principal === null) {
      reply.header("www-authenticate", 'Bearer realm="edu-service", ApiKey');
      throw new ApiAuthenticationError();
    }
    if (
      !required.every((permission) =>
        principal.permissions.includes(permission),
      )
    )
      throw new ApiAuthorizationError();
    if (options.accessAuthorizer) {
      const access = await options.accessAuthorizer.evaluate({
        principalId: principal.id,
        endpoint:
          request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "/",
      });
      if (
        access.outcome === "blocked" ||
        (options.requireAllowlist && access.outcome !== "allowed")
      )
        throw new ApiAccessBlockedError(
          access.outcome === "blocked" ? access.supportReference : undefined,
        );
    }
    request.apiPrincipal = principal;
  };
}

function parsePlatform(
  value: string | string[] | undefined,
): AuthRequestContext["platform"] {
  return value === "ios" ||
    value === "android" ||
    value === "cli" ||
    value === "other"
    ? value
    : "browser";
}

function hasAuthenticationCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    [
      "INVALID_CREDENTIALS",
      "ACCOUNT_UNAVAILABLE",
      "INVALID_OR_EXPIRED_TOKEN",
      "REAUTHENTICATION_REQUIRED",
    ].includes(error.code)
  );
}
