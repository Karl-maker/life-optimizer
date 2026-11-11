import { describe, expect, it } from "vitest";
import { createApiServer, type ApiServerOptions } from "../src/index.js";

const principal = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "bearer" as const,
  permissions: ["root"],
};
const authenticator = { authenticate: async () => principal };
const asyncService = new Proxy({}, { get: () => async () => ({}) }) as never;

describe("generated OpenAPI contract", () => {
  it("fully describes every composed operation and its authorization contract", async () => {
    const app = await createApiServer(maximalOptions());
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    const document = response.json() as OpenApiDocument;
    const documentedTags = new Set(document.tags.map((tag) => tag.name));
    const operationIds = new Set<string>();
    const undocumentedRequestProperties: string[] = [];
    let operationCount = 0;

    for (const [path, item] of Object.entries(document.paths)) {
      expect(path.startsWith("/v1/"), path).toBe(false);
      for (const [method, operation] of Object.entries(item)) {
        if (!HTTP_METHODS.has(method)) continue;
        operationCount += 1;
        expect(
          operation.summary.length,
          `${method.toUpperCase()} ${path} summary`,
        ).toBeGreaterThan(5);
        expect(
          operation.description.length,
          `${method.toUpperCase()} ${path} description`,
        ).toBeGreaterThan(20);
        expect(
          operationIds.has(operation.operationId),
          operation.operationId,
        ).toBe(false);
        operationIds.add(operation.operationId);
        expect(
          operation.tags.length,
          `${method.toUpperCase()} ${path} tags`,
        ).toBeGreaterThan(0);
        for (const tag of operation.tags)
          expect(documentedTags.has(tag), tag).toBe(true);
        for (const [status, contract] of Object.entries(operation.responses)) {
          expect(
            contract.description.length,
            `${method.toUpperCase()} ${path} ${status}`,
          ).toBeGreaterThan(2);
          expect(contract.headers?.["x-request-id"]).toBeDefined();
          expect(contract.headers?.["cache-control"]).toBeDefined();
        }
        if (operation.security) {
          expect(operation["x-required-permissions"]?.length).toBeGreaterThan(
            0,
          );
          for (const requirement of operation.security)
            for (const scopes of Object.values(requirement))
              expect(scopes).toEqual([]);
        }
        for (const media of Object.values(
          operation.requestBody?.content ?? {},
        )) {
          for (const [name, property] of Object.entries(
            media.schema.properties ?? {},
          ))
            if (!property.description || property.description.length < 6)
              undocumentedRequestProperties.push(
                `${method.toUpperCase()} ${path}: ${name}`,
              );
        }
      }
    }

    expect(operationCount).toBeGreaterThan(50);
    expect(undocumentedRequestProperties).toEqual([]);
    await app.close();
  });
});

function maximalOptions(): ApiServerOptions {
  return {
    publicBaseUrl: "https://api.example.test",
    authentication: { service: asyncService, oauth: asyncService },
    authorization: { service: asyncService, authenticator },
    adminData: { service: asyncService, authenticator },
    financialReporting: { service: asyncService, authenticator },
    featureFlags: { service: asyncService, authenticator },
    notifications: { service: asyncService, authenticator },
    patrons: { service: asyncService, authenticator },
    commerce: {
      billing: asyncService,
      financial: asyncService,
      reporting: asyncService,
      findInvoice: async () => null,
      findAccountById: async () => null,
      authenticator,
      providers: [],
    },
    uploads: { store: asyncService, authenticator },
    emailUnsubscribe: { email: asyncService, tokens: asyncService },
    stripeWebhook: {
      verifier: asyncService,
      actor: { kind: "user", userId: principal.id },
      sync: asyncService,
    },
    powerTranzCallback: { checkout: asyncService },
    storePurchases: {
      service: asyncService,
      apple: asyncService,
      google: asyncService,
      authenticator,
      resolveUserId: ({ id }) => id,
      webhookActor: { kind: "user", userId: principal.id },
    },
  };
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
interface OpenApiOperation {
  summary: string;
  description: string;
  operationId: string;
  tags: string[];
  responses: Record<
    string,
    { description: string; headers?: Record<string, unknown> }
  >;
  security?: Record<string, string[]>[];
  requestBody?: {
    content: Record<
      string,
      { schema: { properties?: Record<string, { description?: string }> } }
    >;
  };
  "x-required-permissions"?: string[];
}
interface OpenApiDocument {
  tags: { name: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
}
