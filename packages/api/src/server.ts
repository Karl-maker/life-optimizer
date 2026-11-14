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
import type {
  Actor,
  AdminDataService,
  AuditContext,
  AuthorizationService,
} from "@edu-service/core";
import type {
  PaymentProviderSync,
  FinancialReportingService,
  WebhookVerifier,
} from "@edu-service/financial";
import { registerStripeWebhookRoute } from "./routes/financial/stripe-webhook.js";
import { registerPowerTranzCallbackRoute } from "./routes/financial/powertranz-callback.js";
import { registerStorePurchaseRoutes } from "./routes/financial/store-purchases.js";
import { registerEmailUnsubscribeRoute } from "./routes/email/unsubscribe.js";
import type { EmailService } from "@edu-service/email";
import type { EmailUnsubscribeTokens } from "./email-unsubscribe.js";
import type {
  AppleStoreAdapter,
  GooglePlayAdapter,
  StorePurchase,
  VerifiedStorePurchase,
} from "@edu-service/financial";
import type { ApiAuthenticator } from "./auth.js";
import {
  registerAuthenticationRoutes,
  type AuthRoutesOptions,
} from "./routes/auth/auth.js";
import { registerPermissionManagementRoutes } from "./routes/admin/permissions.js";
import { registerAdminResourceRoutes } from "./routes/admin/resources.js";
import { registerFinancialReportingRoutes } from "./routes/financial/reporting.js";
import type { FeatureFlagManagementService } from "@edu-service/feature-flags";
import { registerFeatureFlagRoutes } from "./routes/feature-flags/feature-flags.js";
import type { NotificationInboxService } from "@edu-service/notifications";
import { registerNotificationRoutes } from "./routes/notifications/notifications.js";
import { registerPatronRoutes } from "./routes/patrons/patrons.js";
import { registerCommerceRoutes } from "./routes/financial/commerce.js";
import { registerUploadRoutes } from "./routes/storage/uploads.js";
import type { createPatronService } from "@edu-service/patron";
import type {
  createBillingService,
  createFinancialService,
  BillingInvoice,
  PaymentProvider,
} from "@edu-service/financial";
import type { ObjectStore } from "@edu-service/storage";
import { registerCmsRoutes, type CmsRoutesOptions } from "./routes/cms/cms.js";

declare module "fastify" {
  interface FastifyRequest {
    apiPrincipal?: ApiPrincipal;
  }
}

const dependencyHealthSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["name", "status"],
    properties: {
      name: { type: "string", description: "Support-safe dependency name." },
      status: { enum: ["ok", "failed"] },
    },
  },
} as const;
const readinessSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "timestamp", "dependencies"],
  properties: {
    status: { enum: ["ok", "degraded"] },
    timestamp: { type: "string", format: "date-time" },
    dependencies: dependencyHealthSchema,
  },
} as const;
const healthSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "timestamp",
    "uptimeSeconds",
    "process",
    "host",
    "dependencies",
  ],
  properties: {
    status: { enum: ["ok", "degraded"] },
    timestamp: { type: "string", format: "date-time" },
    uptimeSeconds: { type: "integer", minimum: 0 },
    process: {
      type: "object",
      additionalProperties: false,
      required: ["pid", "memoryRssBytes", "heapUsedBytes"],
      properties: {
        pid: { type: "integer", minimum: 1 },
        memoryRssBytes: { type: "integer", minimum: 0 },
        heapUsedBytes: { type: "integer", minimum: 0 },
      },
    },
    host: {
      type: "object",
      additionalProperties: false,
      required: [
        "cpuCount",
        "loadAverage",
        "totalMemoryBytes",
        "freeMemoryBytes",
      ],
      properties: {
        cpuCount: { type: "integer", minimum: 1 },
        loadAverage: {
          type: "array",
          items: { type: "number" },
          minItems: 3,
          maxItems: 3,
        },
        totalMemoryBytes: { type: "integer", minimum: 0 },
        freeMemoryBytes: { type: "integer", minimum: 0 },
      },
    },
    dependencies: dependencyHealthSchema,
  },
} as const;

export interface ApiServerOptions {
  serviceName?: string;
  version?: string;
  buildId?: string;
  publicBaseUrl?: string;
  allowedOrigins?: readonly string[];
  /** Origins that should receive a support-safe 403 rather than CORS access. */
  blockedOrigins?: readonly string[];
  blockedOriginSupportReference?: string;
  healthChecks?: readonly HealthCheck[];
  rateLimit?: { max: number; timeWindow: string };
  authentication?: AuthRoutesOptions;
  authorization?: {
    service: AuthorizationService;
    authenticator: ApiAuthenticator;
  };
  adminData?: {
    service: AdminDataService;
    authenticator: ApiAuthenticator;
  };
  financialReporting?: {
    service: FinancialReportingService;
    authenticator: ApiAuthenticator;
  };
  featureFlags?: {
    service: FeatureFlagManagementService;
    authenticator: ApiAuthenticator;
  };
  cms?: CmsRoutesOptions;
  notifications?: {
    service: NotificationInboxService;
    authenticator: ApiAuthenticator;
  };
  patrons?: {
    service: ReturnType<typeof createPatronService>;
    authenticator: ApiAuthenticator;
  };
  commerce?: {
    billing: ReturnType<typeof createBillingService>;
    financial: ReturnType<typeof createFinancialService>;
    reporting: FinancialReportingService;
    findInvoice(id: string): Promise<BillingInvoice | null>;
    findAccountById(id: string): Promise<{ userId: string } | null>;
    authenticator: ApiAuthenticator;
    providers: readonly PaymentProvider[];
  };
  uploads?: { store?: ObjectStore; authenticator: ApiAuthenticator };
  emailUnsubscribe?: { email: EmailService; tokens: EmailUnsubscribeTokens };
  /** Max decoded request body size; default is deliberately small for public APIs. */
  bodyLimit?: number;
  /** Best-effort, body-free operational telemetry. */
  telemetry?: Telemetry;
  stripeWebhook?: {
    verifier?: WebhookVerifier;
    actor: Actor;
    sync: PaymentProviderSync;
  };
  powerTranzCallback?: {
    checkout?: {
      complete(request: {
        audit: AuditContext;
        browserResult: unknown;
      }): Promise<{ status: "completed" | "declined" | "processing" }>;
    };
  };
  storePurchases?: {
    service: {
      voidGoogleOrder(input: {
        actor: Actor;
        audit: AuditContext;
        eventId: string;
        orderId: string;
        tokenHash: string;
      }): Promise<{ matched: boolean }>;
      sync(input: {
        actor: Actor;
        audit: AuditContext;
        purchase: VerifiedStorePurchase;
        userId?: string;
        notification?: { eventId: string; type: string };
      }): Promise<{
        purchase: StorePurchase;
        created: boolean;
        granted: number;
        revoked: number;
      }>;
      recordNotification(input: {
        actor: Actor;
        audit: AuditContext;
        provider: "apple" | "google";
        eventId: string;
        type: string;
      }): Promise<{ created: boolean }>;
      listPurchases(input: {
        actor: Actor;
        userId: string;
        cursor?: { createdAt: Date; id: string };
        limit?: number;
      }): Promise<readonly StorePurchase[]>;
    };
    apple?: AppleStoreAdapter;
    google?: GooglePlayAdapter;
    authenticator: ApiAuthenticator;
    resolveUserId: (principal: ApiPrincipal) => string | null;
    webhookActor: Actor;
  };
}

/**
 * API composition root. Core use cases and concrete credentials are injected by
 * the application service; this package owns only protocol, validation and docs.
 */
export async function createApiServer(
  options: ApiServerOptions = {},
): Promise<FastifyInstance> {
  const serviceName = options.serviceName ?? "Life Optimizer";
  const version = options.version ?? "0.1.0";
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
    credentials: options.authentication !== undefined,
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
        title: `${serviceName} API`,
        version,
        description:
          "Generated from the same schemas that validate requests and serialize responses. Authenticate with either an opaque bearer token or an API key when an operation shows a security requirement. The x-required-permissions extension lists the application permissions enforced by that operation. Collection endpoints use bounded cursor pagination. Errors use application/problem+json and include X-Request-ID for support correlation. In Swagger examples, additionalProp1, additionalProp2, and similar names are placeholders for keys in a documented map: replace them with the real key described by that field; do not send the literal placeholder unless it is genuinely your key.",
      },
      tags: [
        {
          name: "Operations",
          description: "Liveness, readiness, and release identity.",
        },
        {
          name: "Authentication",
          description: "Account, session, OAuth, and device workflows.",
        },
        { name: "Compliance", description: "Consent receipt workflows." },
        {
          name: "Feature flags",
          description:
            "Effective feature configuration for the authenticated user.",
        },
        {
          name: "Admin feature flags",
          description:
            "Administrative flag definitions and per-user overrides.",
        },
        ...(options.cms
          ? [
              {
                name: "CMS",
                description:
                  "Localized, feature-aware published pages and screens.",
              },
              {
                name: "Admin CMS",
                description: "Draft editing and scheduled CMS publication.",
              },
            ]
          : []),
        {
          name: "Notifications",
          description:
            "Authenticated notification inbox and delivery preferences.",
        },
        {
          name: "Admin notifications",
          description:
            "Administrative notification configuration and creation.",
        },
        { name: "Catalog", description: "Public product and price discovery." },
        {
          name: "Admin products",
          description:
            "Administrative product, price, and entitlement mapping changes.",
        },
        {
          name: "Payments",
          description:
            "Payment initiation, status, refunds, and provider callbacks.",
        },
        {
          name: "Admin payments",
          description:
            "Trusted administrative payment corrections and refunds.",
        },
        {
          name: "Admin finance",
          description: "Restricted payment and revenue reporting.",
        },
        ...(options.stripeWebhook ||
        options.powerTranzCallback ||
        options.storePurchases
          ? [
              {
                name: "Financial webhooks",
                description:
                  "Provider-authenticated callbacks and browser-mediated payment returns.",
              },
            ]
          : []),
        ...(options.storePurchases
          ? [
              {
                name: "Store purchases",
                description:
                  "Verified Apple and Google purchase claims and history.",
              },
            ]
          : []),
        {
          name: "Patron",
          description: "Authenticated Patron profile and credit history.",
        },
        {
          name: "Admin patrons",
          description:
            "Administrative Patron profiles and credit ledger changes.",
        },
        {
          name: "Admin permissions",
          description:
            "Administrative permissions, roles, and role assignments.",
        },
        {
          name: "Admin data",
          description: "Redacted administrative resource browsing.",
        },
        ...(options.uploads
          ? [
              {
                name: "Storage",
                description: "User-scoped direct-upload workflows.",
              },
            ]
          : []),
        { name: "Email", description: "Public email preference callbacks." },
      ],
      ...(options.publicBaseUrl === undefined
        ? {}
        : { servers: [{ url: options.publicBaseUrl }] }),
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "Opaque",
          },
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
    if (!reply.hasHeader("cache-control"))
      reply.header("cache-control", "no-store");
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
            ...healthSchema,
          },
          503: {
            description: "Degraded server; see dependency statuses",
            ...healthSchema,
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
  app.get(
    "/health/live",
    {
      schema: defineJsonRoute({
        summary: "Read process liveness",
        description:
          "A lightweight process-only probe. Dependency failures do not make a live process fail this check.",
        tags: ["Operations"],
        operationId: "getLiveness",
        response: {
          200: {
            description: "Live process",
            type: "object",
            additionalProperties: false,
            required: ["status", "timestamp", "uptimeSeconds"],
            properties: {
              status: { const: "ok" },
              timestamp: { type: "string", format: "date-time" },
              uptimeSeconds: { type: "integer", minimum: 0 },
            },
          },
        },
      }),
      config: { rateLimit: false },
    },
    async () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    }),
  );
  app.get(
    "/health/ready",
    {
      schema: defineJsonRoute({
        summary: "Read service readiness",
        description:
          "Checks dependencies required to serve requests and returns only support-safe dependency names and statuses.",
        tags: ["Operations"],
        operationId: "getReadiness",
        response: {
          200: {
            description: "Service is ready",
            ...readinessSchema,
          },
          503: {
            description: "A required dependency is unavailable",
            ...readinessSchema,
          },
        },
      }),
      config: { rateLimit: false },
    },
    async (_request, reply) => {
      const snapshot = await readHealth(options.healthChecks);
      return reply.code(snapshot.status === "ok" ? 200 : 503).send({
        status: snapshot.status,
        timestamp: snapshot.timestamp,
        dependencies: snapshot.dependencies,
      });
    },
  );
  app.get(
    "/version",
    {
      schema: defineJsonRoute({
        summary: "Read application version",
        description:
          "Returns non-sensitive release identity for deployment verification and support.",
        tags: ["Operations"],
        operationId: "getVersion",
        response: {
          200: {
            description: "Application release identity",
            type: "object",
            additionalProperties: false,
            required: ["service", "version"],
            properties: {
              service: { type: "string" },
              version: { type: "string" },
              buildId: { type: "string" },
            },
            headers: {
              "cache-control": {
                type: "string",
                description:
                  "Public bounded cache policy for immutable release metadata.",
              },
            },
          },
        },
      }),
      config: { rateLimit: false },
    },
    async (_request, reply) => {
      reply.header("cache-control", "public, max-age=300");
      return {
        service: serviceName,
        version,
        ...(options.buildId === undefined ? {} : { buildId: options.buildId }),
      };
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
  if (options.storePurchases)
    await registerStorePurchaseRoutes({ app, ...options.storePurchases });
  if (options.authentication)
    registerAuthenticationRoutes(app, options.authentication);
  if (options.authorization)
    registerPermissionManagementRoutes(app, options.authorization);
  if (options.adminData) registerAdminResourceRoutes(app, options.adminData);
  if (options.financialReporting)
    registerFinancialReportingRoutes(app, options.financialReporting);
  if (options.featureFlags)
    registerFeatureFlagRoutes(app, options.featureFlags);
  if (options.cms) registerCmsRoutes(app, options.cms);
  if (options.notifications)
    registerNotificationRoutes(app, options.notifications);
  if (options.patrons) registerPatronRoutes(app, options.patrons);
  if (options.commerce) registerCommerceRoutes(app, options.commerce);
  if (options.uploads) registerUploadRoutes(app, options.uploads);
  if (options.emailUnsubscribe)
    registerEmailUnsubscribeRoute({ app, ...options.emailUnsubscribe });
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
  buildId?: string;
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
  const buildId = environment.EDU_API_BUILD_ID?.trim();
  if (buildId !== undefined && buildId.length > 160)
    throw new Error("EDU_API_BUILD_ID must be at most 160 characters.");
  return {
    host,
    port,
    ...(buildId === undefined || buildId === "" ? {} : { buildId }),
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
