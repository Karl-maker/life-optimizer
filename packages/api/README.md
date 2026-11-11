# `@edu-service/api`

The API adapter is the composition boundary for external consumers. JSON is the normal request/response format: Fastify automatically parses `application/json` request bodies and serializes JSON replies. It uses Fastify's JSON Schema route contracts as the source of truth: a developer declares request parameters, body, headers, response bodies, response headers, tags, permissions, and OpenAPI links once; Fastify validates/serializes that contract and `@fastify/swagger` publishes it at `/openapi.json`. Interactive Swagger documentation is at `/docs`.

It deliberately does **not** contain learning rules, database access, API-key storage, or provider credentials. Inject core use cases, health checks, and an `ApiAuthenticator` from the composition service.

## Add a documented JSON endpoint (declare it once)

Create the application once at the composition boundary, then add a Fastify route. `defineJsonRoute` is the one declaration that powers both runtime behavior and documentation—do not maintain a separate OpenAPI YAML file.

```ts
import {
  createApiServer,
  defineJsonRoute,
  requirePermissions,
} from "@edu-service/api";

const authenticator = {
  async authenticate({ apiKey, bearerToken }) {
    // Hash/verify against your identity adapter; never log or retain the secret.
    return apiKey === process.env.PARTNER_API_KEY || bearerToken
      ? { id: "partner_123", kind: "api-key", permissions: ["companies:read"] }
      : null;
  },
};

const app = await createApiServer({
  serviceName: "Edu Service",
  allowedOrigins: ["https://app.example.com"],
});

app.post(
  "/companies",
  {
    preHandler: requirePermissions(authenticator, ["companies:write"]),
    schema: defineJsonRoute({
      summary: "Create a company",
      description:
        "Creates a company owned by the authenticated principal and returns its canonical identifier.",
      tags: ["Companies"],
      operationId: "createCompany",
      permissions: ["companies:write"],
      body: {
        type: "object",
        additionalProperties: false,
        required: ["name", "country"],
        properties: {
          name: {
            type: "string",
            minLength: 1,
            description: "Customer-facing company name.",
          },
          country: {
            type: "string",
            pattern: "^[A-Z]{2}$",
            description: "ISO 3166-1 alpha-2 registration country.",
          },
        },
      },
      response: {
        201: {
          description: "Created company",
          type: "object",
          required: ["id", "name"],
          properties: { id: { type: "string" }, name: { type: "string" } },
          headers: {
            location: {
              type: "string",
              description: "Canonical URL of the new company",
            },
          },
        },
        422: {
          description: "A domain rule rejected the command",
          $ref: "Problem",
        },
      },
    }),
  },
  async (request, reply) => {
    const company = await core.companies.add({
      ...request.body,
      actor: actorFrom(request.apiPrincipal!),
      audit: auditContext(request),
    });
    return reply
      .code(201)
      .header("location", `/companies/${company.id}`)
      .send(company);
  },
);
```

When the server starts, this one route is visible in Swagger at `/docs` and in `GET /openapi.json`, including its JSON body, `201` response, `Location`/`X-Request-ID` headers, documented standard `400`/`500` failures, required permission, and custom `422` problem. Every operation and top-level request property must explain its behavior rather than relying on its name alone. Define `params`, `querystring`, or `headers` in the same object when needed. Add a `links` object to a response schema when a result points consumers to another operation, following OpenAPI Link Object syntax.

Use an API key in `X-API-Key` or a bearer token in `Authorization: Bearer <token>`. OpenAPI security arrays are intentionally empty because API-key and HTTP bearer schemes do not define OAuth scopes; the generated `x-required-permissions` extension lists the application permissions enforced by `requirePermissions`. Tenancy and resource ownership must still be checked by the core use case. The adapter returns `application/problem+json` errors containing a stable code and `requestId`; it never sends a raw exception to the caller.

## Streaming and SOAP

Use `registerSseRoute` for server-to-client event streams, normally backed by the typed `@edu-service/events` broker after authorization. It sets `text/event-stream`, disables buffering/caching, writes an `X-Request-Id`, and exposes an explicit `closed` promise. WebSocket routes use Fastify's `websocket: true` route option after the bundled WebSocket plugin is registered; authenticate during the HTTP upgrade and close sockets on shutdown. Both transports are documented as protocol endpoints, but OpenAPI does not model their message frames—publish a concise message schema next to the route or add AsyncAPI when event contracts become public.

For a legacy SOAP operation, declare an OpenAPI request body with `application/soap+xml` (or `text/xml`) and call `parseSoapEnvelope` in the handler. SOAP remains a transport adaptation; translate its body to a core command and translate domain failures to a SOAP fault. Do not expose SOAP and JSON at the same endpoint unless their response media types are explicitly modeled.

## Operational and security defaults

- `/health/live` is a lightweight process probe. `/health/ready` checks required dependencies and returns `503` with support-safe names/statuses when traffic should stop. `/health` retains the detailed readiness snapshot for compatibility, and `/version` returns non-sensitive release/build identity.
- `/docs` and `/openapi.json` publish generated API documentation. Pin a released OpenAPI document in consumer SDK pipelines rather than silently breaking a public contract.
- Supported CMS, Storage, financial-webhook, and mobile-store operations remain registered even when their deployment adapter is not configured, so the generated contract stays discoverable. Calling an unavailable integration returns a documented `503`; configure the corresponding CMS store, object store, payment provider, or app-store provider to activate it.
- Helmet security headers, no-store response caching, disabled-by-default CORS, request IDs, 100-request/minute IP rate limiting, typed request validation, and problem responses are enabled by default. Configure browser origins with `EDU_API_ALLOWED_ORIGINS`; direct server-to-server clients do not need CORS.
- Add cacheable `GET` behavior only intentionally: override `Cache-Control`, include validators such as `ETag`, and document both response headers in the route schema. Never cache personalized or authorization-dependent output in a shared cache.

## Collections, access policy, logging, and route layout

Place a route under `src/routes/<resource>/` with its schema and tests. Collection endpoints use `parsePageRequest(request.query)`, a stable database tuple cursor encoded with `encodeCursor`, and `createPage`/`sendPage`. The body is always `{ data, pagination, links }`; a following page is available both as `links.next` and an RFC 8288 `Link: rel="next"` header. This avoids unstable offset pages as new records are inserted. Keep the cursor opaque and cap `limit` at 100.

`createApiServer` rejects prototype-pollution keys/deep request bodies before handlers, limits bodies to 1 MiB by default, and uses schema validation for JSON/XML shape. Never "sanitize" a value into a different business value: validate at the edge, use core parsers, and use parameterized repository calls. It emits body-free `api.request.completed` operational telemetry with only method, route pattern, status, duration, and request ID; credentials, headers, query values, and payloads never enter telemetry.

Use exact `allowedOrigins` only for browser CORS and `blockedOrigins` when a browser origin must receive a support-safe `ORIGIN_BLOCKED` problem. This is not a server-to-server access control. Third-party principals are evaluated by the core `ApiAccessPolicyReader`, implemented by PostgreSQL `api_access_policies`: each record has a principal ID, concrete endpoint or `*`, allow/deny effect, operator reason, optional support reference, and expiry. Deny wins. Pass `createApiAccessAuthorizer(database.apiAccessPolicies)` to `requirePermissions`; use `requireAllowlist: true` for endpoints that should reject principals without an explicit allow policy. The public error exposes only its request ID and optional support reference—not the stored operator reason.

At startup, `readApiConfiguration` reads optional `EDU_API_ALLOWED_ORIGINS`, `EDU_API_BLOCKED_ORIGINS`, and `EDU_API_BLOCKED_ORIGIN_SUPPORT_REFERENCE`; see [`.env.example`](./.env.example). Keep origin lists non-secret and exact. API credentials are intentionally not configuration for this package: verify and hash them in the injected identity adapter.

Review caching for every `GET`. Use cache only for public, stable, non-personal data; document `Cache-Control`/`ETag` in the response schema and invalidate the cache after the owning transaction succeeds. Reads scoped by a principal, company, or authorization decision must default to `no-store`.

The design follows Fastify's route-schema/OpenAPI generator and plugin encapsulation model, the OpenAPI Link Object for response-to-endpoint relationships, and Fastify's documented WebSocket route integration. See [Fastify Swagger](https://github.com/fastify/fastify-swagger), [Fastify WebSocket](https://github.com/fastify/fastify-websocket), and the [OpenAPI specification](https://spec.openapis.org/).
