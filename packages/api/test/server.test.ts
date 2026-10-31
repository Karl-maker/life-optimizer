import { describe, expect, it } from "vitest";
import {
  createApiServer,
  createPage,
  decodeCursor,
  encodeCursor,
  parsePageRequest,
  requirePermissions,
  sendPage,
  parseSoapEnvelope,
  readApiConfiguration,
  SoapFaultError,
} from "../src/index.js";

describe("API server", () => {
  it("serves an operational health response, OpenAPI document, and security headers", async () => {
    const app = await createApiServer({
      serviceName: "Test API",
      version: "1.2.3",
    });
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.headers["x-request-id"]).toBeTruthy();
    expect(health.headers["cache-control"]).toBe("no-store");
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.json()).toMatchObject({
      status: "ok",
      process: { pid: process.pid },
      host: { cpuCount: expect.any(Number) },
    });
    const specification = await app.inject({
      method: "GET",
      url: "/openapi.json",
    });
    expect(specification.statusCode).toBe(200);
    expect(specification.json()).toMatchObject({
      openapi: "3.1.1",
      info: { title: "Test API API", version: "1.2.3" },
      paths: { "/health": expect.any(Object) },
    });
    await app.close();
  });

  it("reports failed dependencies without leaking their failure details", async () => {
    const app = await createApiServer({
      healthChecks: [
        {
          name: "database",
          check: async () => {
            throw new Error("postgresql://secret@host");
          },
        },
      ],
    });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "degraded",
      dependencies: [{ name: "database", status: "failed" }],
    });
    expect(response.body).not.toContain("secret");
    await app.close();
  });

  it("returns RFC 9457-style problem details for malformed requests and unknown routes", async () => {
    const app = await createApiServer();
    const response = await app.inject({ method: "GET", url: "/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.json()).toMatchObject({
      code: "NOT_FOUND",
      requestId: expect.any(String),
    });
    await app.close();
  });

  it("enforces an endpoint deny policy without exposing its operator reason", async () => {
    const app = await createApiServer();
    app.get(
      "/v1/private",
      {
        preHandler: requirePermissions(
          {
            async authenticate() {
              return {
                id: "partner-1",
                kind: "api-key",
                permissions: ["companies:read"],
              };
            },
          },
          ["companies:read"],
          {
            accessAuthorizer: {
              async evaluate() {
                return { outcome: "blocked", supportReference: "SUP-42" };
              },
            },
          },
        ),
      },
      async () => ({ ok: true }),
    );
    const response = await app.inject({
      method: "GET",
      url: "/v1/private",
      headers: { "x-api-key": "not-logged" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "API_ACCESS_BLOCKED",
      detail: "Contact support and provide reference SUP-42.",
    });
    expect(response.body).not.toContain("operator");
    await app.close();
  });
});

describe("transport helpers", () => {
  it("parses SOAP bodies and rejects malformed envelopes", () => {
    expect(
      parseSoapEnvelope(
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><Ping/></soap:Body></soap:Envelope>',
      ),
    ).toEqual({ Ping: "" });
    expect(() => parseSoapEnvelope("<root />")).toThrow(SoapFaultError);
  });

  it("validates listener configuration without enabling CORS by default", () => {
    expect(readApiConfiguration({})).toEqual({ host: "127.0.0.1", port: 3000 });
    expect(() => readApiConfiguration({ EDU_API_PORT: "0" })).toThrow(
      "EDU_API_PORT",
    );
    expect(
      readApiConfiguration({
        EDU_API_ALLOWED_ORIGINS:
          "https://app.example.test, https://admin.example.test",
      }),
    ).toMatchObject({
      allowedOrigins: [
        "https://app.example.test",
        "https://admin.example.test",
      ],
    });
    expect(
      readApiConfiguration({
        EDU_API_BLOCKED_ORIGINS: "https://blocked.example.test",
        EDU_API_BLOCKED_ORIGIN_SUPPORT_REFERENCE: "SUP-42",
      }),
    ).toMatchObject({
      blockedOrigins: ["https://blocked.example.test"],
      blockedOriginSupportReference: "SUP-42",
    });
  });

  it("uses bounded opaque cursors and a uniform collection envelope", async () => {
    const cursor = encodeCursor({
      createdAt: "2026-10-31T00:00:00.000Z",
      id: "company-1",
    });
    expect(decodeCursor(cursor)).toEqual({
      createdAt: "2026-10-31T00:00:00.000Z",
      id: "company-1",
    });
    expect(parsePageRequest({ limit: "10", cursor })).toEqual({
      limit: 10,
      cursor,
    });
    expect(() => parsePageRequest({ limit: "101" })).toThrow("limit");
    const app = await createApiServer();
    app.get("/v1/items", async (request, reply) =>
      sendPage(
        reply,
        createPage(request, {
          data: [{ id: "item-1" }],
          limit: 10,
          nextCursor: cursor,
        }),
      ),
    );
    const response = await app.inject({
      method: "GET",
      url: "/v1/items?limit=10",
    });
    expect(response.headers.link).toContain('rel="next"');
    expect(response.json()).toMatchObject({
      data: [{ id: "item-1" }],
      pagination: { limit: 10, nextCursor: cursor },
      links: { self: "/v1/items?limit=10" },
    });
    await app.close();
  });
});
