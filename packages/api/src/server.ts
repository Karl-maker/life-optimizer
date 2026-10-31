import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { ApiOriginBlockedError, type ApiPrincipal } from "./auth.js";
import { defineJsonRoute, PROBLEM_SCHEMA } from "./contracts.js";
import { registerProblemErrors } from "./errors.js";
import { readHealth, type HealthCheck } from "./health.js";
import { assertSafeInput } from "./input-safety.js";
import type { Telemetry } from "@edu-service/observability";
import type { Actor, AuditContext } from "@edu-service/core";
import type {
  PaymentProviderSync,
  WebhookVerifier,
} from "@edu-service/financial";
import { registerStripeWebhookRoute } from "./routes/financial/stripe-webhook.js";
import { registerPowerTranzCallbackRoute } from "./routes/financial/powertranz-callback.js";

declare module "fastify" {
  interface FastifyRequest {
    apiPrincipal?: ApiPrincipal;
  }
}

export interface ApiServerOptions {
  serviceName?: string;
  version?: string;
  publicBaseUrl?: string;
  allowedOrigins?: readonly string[];
  /** Origins that should receive a support-safe 403 rather than CORS access. */
  blockedOrigins?: readonly string[];
  blockedOriginSupportReference?: string;
  healthChecks?: readonly HealthCheck[];
  rateLimit?: { max: number; timeWindow: string };
  /** Max decoded request body size; default is deliberately small for public APIs. */
  bodyLimit?: number;
  /** Best-effort, body-free operational telemetry. */
  telemetry?: Telemetry;
  stripeWebhook?: {
    verifier: WebhookVerifier;
    actor: Actor;
    sync: PaymentProviderSync;
  };
  powerTranzCallback?: {
    checkout: {
      complete(request: {
        audit: AuditContext;
        browserResult: unknown;
      }): Promise<{ status: "completed" | "declined" | "processing" }>;
    };
  };
}

/**
 * API composition root. Core use cases and concrete credentials are injected by
 * the application service; this package owns only protocol, validation and docs.
 */
export async function createApiServer(
  options: ApiServerOptions = {},
): Promise<FastifyInstance> {
  const allowedOrigins = options.allowedOrigins ?? [];
  const blockedOrigins = options.blockedOrigins ?? [];
  validateOrigins(allowedOrigins, "allowedOrigins");
  validateOrigins(blockedOrigins, "blockedOrigins");
  const app = Fastify({
    logger: false,
    bodyLimit: options.bodyLimit ?? 1_048_576,
    genReqId: () => randomUUID(),
    requestIdHeader: "x-request-id",
  });
  app.addSchema(PROBLEM_SCHEMA);
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(cors, {
    origin: allowedOrigins.length === 0 ? false : [...allowedOrigins],
    credentials: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: options.rateLimit?.max ?? 100,
    timeWindow: options.rateLimit?.timeWindow ?? "1 minute",
    keyGenerator: (request) => request.ip,
  });
  await app.register(websocket);
  app.addContentTypeParser(
    ["application/soap+xml", "text/xml"],
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.1",
      info: {
        title: `${options.serviceName ?? "Edu Service"} API`,
        version: options.version ?? "0.1.0",
        description:
          "HTTP, SSE, WebSocket and SOAP transport contracts for external integrators.",
      },
      ...(options.publicBaseUrl === undefined
        ? {}
        : { servers: [{ url: options.publicBaseUrl }] }),
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
          BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });
  registerProblemErrors(app);
  app.addHook("onRequest", async (request) => {
    const origin = request.headers.origin;
    if (origin && blockedOrigins.includes(origin)) {
      throw new ApiOriginBlockedError(options.blockedOriginSupportReference);
    }
  });
  app.addHook("preValidation", async (request) => {
    assertSafeInput(request.body);
  });
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header(
      "cache-control",
      reply.statusCode >= 400 ? "no-store" : "no-store",
    );
  });
  app.addHook("onResponse", async (request, reply) => {
    options.telemetry?.info(
      "api.request.completed",
      {
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      request.id,
    );
  });
  app.get(
    "/openapi.json",
    { schema: { hide: true }, config: { rateLimit: false } },
    async () => app.swagger(),
  );
  app.get(
    "/health",
    {
      schema: defineJsonRoute({
        summary: "Read server health",
        description:
          "Reports process/host resource usage and dependency checks. This endpoint intentionally exposes no secrets or connection details.",
        tags: ["Operations"],
        operationId: "getHealth",
        response: {
          200: {
            description: "Healthy server",
            type: "object",
            additionalProperties: true,
          },
          503: {
            description: "Degraded server; see dependency statuses",
            type: "object",
            additionalProperties: true,
          },
        },
      }),
      config: { rateLimit: false },
    },
    async (_request, reply) => {
      const snapshot = await readHealth(options.healthChecks);
      return reply.code(snapshot.status === "ok" ? 200 : 503).send(snapshot);
    },
  );
  if (options.stripeWebhook) {
    await registerStripeWebhookRoute({ app, ...options.stripeWebhook });
  }
  if (options.powerTranzCallback)
    await registerPowerTranzCallbackRoute({
      app,
      ...options.powerTranzCallback,
    });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).type("application/problem+json").send({
      type: "/problems/not-found",
      title: "Route not found",
      status: 404,
      code: "NOT_FOUND",
      requestId: request.id,
    }),
  );
  return app;
}

/** Validates listener configuration at the adapter boundary. */
export function readApiConfiguration(environment: NodeJS.ProcessEnv): {
  host: string;
  port: number;
  allowedOrigins?: string[];
  blockedOrigins?: string[];
  blockedOriginSupportReference?: string;
} {
  const host = environment.EDU_API_HOST?.trim() || "127.0.0.1";
  const portRaw = environment.EDU_API_PORT?.trim() || "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("EDU_API_PORT must be an integer between 1 and 65535.");
  const origins = environment.EDU_API_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const blockedOrigins = environment.EDU_API_BLOCKED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins?.some((origin) => !URL.canParse(origin)))
    throw new Error("EDU_API_ALLOWED_ORIGINS must contain absolute URLs.");
  if (blockedOrigins?.some((origin) => !URL.canParse(origin)))
    throw new Error("EDU_API_BLOCKED_ORIGINS must contain absolute URLs.");
  const supportReference =
    environment.EDU_API_BLOCKED_ORIGIN_SUPPORT_REFERENCE?.trim();
  if (supportReference !== undefined && supportReference.length > 120)
    throw new Error(
      "EDU_API_BLOCKED_ORIGIN_SUPPORT_REFERENCE must be at most 120 characters.",
    );
  return {
    host,
    port,
    ...(origins === undefined ? {} : { allowedOrigins: origins }),
    ...(blockedOrigins === undefined ? {} : { blockedOrigins }),
    ...(supportReference === undefined || supportReference === ""
      ? {}
      : { blockedOriginSupportReference: supportReference }),
  };
}

function validateOrigins(origins: readonly string[], name: string): void {
  for (const origin of origins) {
    if (!URL.canParse(origin))
      throw new Error(`${name} must contain absolute URLs.`);
    if (origin === "*")
      throw new Error(`${name} cannot contain wildcard origins.`);
  }
}
