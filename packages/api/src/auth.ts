import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiAccessAuthorizer as CoreApiAccessAuthorizer } from "@edu-service/core";

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
  }): Promise<ApiPrincipal | null>;
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
