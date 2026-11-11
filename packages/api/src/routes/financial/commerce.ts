import type { FastifyInstance } from "fastify";
import type { Actor, AuditContext } from "@edu-service/core";
import {
  createBillingService,
  createFinancialService,
  type BillingInvoice,
  type FinancialReportingService,
  type PaymentProvider,
} from "@edu-service/financial";
import {
  requirePermissions,
  type ApiAuthenticator,
  type ApiPrincipal,
} from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";

type Billing = ReturnType<typeof createBillingService>;
type Financial = ReturnType<typeof createFinancialService>;
const object = { type: "object", additionalProperties: true } as const;
const uuid = { type: "string", format: "uuid" } as const;

export function registerCommerceRoutes(
  app: FastifyInstance,
  options: {
    billing: Billing;
    financial: Financial;
    reporting: FinancialReportingService;
    findInvoice(id: string): Promise<BillingInvoice | null>;
    findAccountById(id: string): Promise<{ userId: string } | null>;
    authenticator: ApiAuthenticator;
    providers: readonly PaymentProvider[];
  },
): void {
  const user = requirePermissions(options.authenticator, ["user"]);
  const products = requirePermissions(options.authenticator, [
    "products:write",
  ]);
  const refunds = requirePermissions(options.authenticator, [
    "payments:refund",
  ]);
  app.get(
    "/products/:id",
    {
      schema: defineJsonRoute({
        summary: "Get an available product and current prices",
        tags: ["Catalog"],
        operationId: "getPublicProduct",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: uuid },
        },
        response: {
          200: {
            description: "Product",
            ...object,
            headers: {
              "cache-control": {
                type: "string",
                description: "Short-lived shared catalogue cache policy.",
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const product = await options.reporting.getCatalogProduct(id);
      if (!product)
        return reply.code(404).send({
          type: "/problems/not-found",
          title: "Product not found",
          status: 404,
          code: "NOT_FOUND",
          requestId: request.id,
        });
      reply.header(
        "cache-control",
        "public, max-age=60, stale-while-revalidate=300",
      );
      return json(product);
    },
  );
  app.post(
    "/admin/products",
    {
      schema: defineJsonRoute({
        summary: "Create a product",
        tags: ["Admin products"],
        operationId: "createProduct",
        permissions: ["products:write"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "name", "riskLevel"],
          properties: {
            key: { type: "string", pattern: "^[a-z][a-z0-9_.-]{1,95}$" },
            name: { type: "string", minLength: 1, maxLength: 200 },
            riskLevel: { enum: ["low", "standard", "high", "blocked"] },
          },
        },
        response: { 201: { description: "Product", ...object } },
      }),
      preHandler: products,
    },
    async (request, reply) =>
      reply.code(201).send(
        await options.billing.createProduct({
          ...(request.body as {
            key: string;
            name: string;
            riskLevel: "low" | "standard" | "high" | "blocked";
          }),
          actor: adminAgent(request.apiPrincipal!),
          audit: audit(request.id),
        }),
      ),
  );
  app.patch(
    "/admin/products/:id",
    {
      schema: defineJsonRoute({
        summary: "Update or archive a product",
        tags: ["Admin products"],
        operationId: "updateProduct",
        permissions: ["products:write"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            active: { type: "boolean" },
            riskLevel: { enum: ["low", "standard", "high", "blocked"] },
          },
        },
        response: { 200: { description: "Product", ...object } },
      }),
      preHandler: products,
    },
    async (request) =>
      options.billing.updateProduct({
        ...(request.body as {
          name?: string;
          active?: boolean;
          riskLevel?: "low" | "standard" | "high" | "blocked";
        }),
        id: (request.params as { id: string }).id,
        actor: adminAgent(request.apiPrincipal!),
        audit: audit(request.id),
      }),
  );
  app.post(
    "/admin/products/:id/prices",
    {
      schema: defineJsonRoute({
        summary: "Create an immutable product price and entitlement mapping",
        tags: ["Admin products"],
        operationId: "createProductPrice",
        permissions: ["products:write"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "currency",
            "unitAmountMinor",
            "frequency",
            "intervalCount",
            "trialDays",
            "entitlements",
          ],
          properties: {
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            unitAmountMinor: { type: "string", pattern: "^[0-9]+$" },
            frequency: { enum: ["one_time", "day", "week", "month", "year"] },
            intervalCount: { type: "integer", minimum: 1 },
            trialDays: { type: "integer", minimum: 0, maximum: 365 },
            entitlements: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "quantity"],
                properties: {
                  key: { type: "string" },
                  quantity: {
                    anyOf: [
                      { type: "string", pattern: "^[1-9][0-9]*$" },
                      { type: "null" },
                    ],
                  },
                },
              },
            },
          },
        },
        response: { 201: { description: "Price", ...object } },
      }),
      preHandler: products,
    },
    async (request, reply) => {
      const body = request.body as {
        currency: string;
        unitAmountMinor: string;
        frequency: "one_time" | "day" | "week" | "month" | "year";
        intervalCount: number;
        trialDays: number;
        entitlements: { key: string; quantity: string | null }[];
      };
      return reply.code(201).send(
        json(
          await options.billing.createPrice({
            actor: adminAgent(request.apiPrincipal!),
            audit: audit(request.id),
            productId: (request.params as { id: string }).id,
            currency: body.currency,
            unitAmountMinor: BigInt(body.unitAmountMinor),
            frequency: body.frequency,
            intervalCount: body.intervalCount,
            trialDays: body.trialDays,
            entitlements: body.entitlements.map((item) => ({
              key: item.key,
              quantity: item.quantity === null ? null : BigInt(item.quantity),
            })),
          }),
        ),
      );
    },
  );
  app.delete(
    "/admin/prices/:id",
    {
      schema: defineJsonRoute({
        summary: "Retire a price",
        tags: ["Admin products"],
        operationId: "retirePrice",
        permissions: ["products:write"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: uuid },
        },
        response: { 200: { description: "Retired price", ...object } },
      }),
      preHandler: products,
    },
    async (request) =>
      options.billing.retirePrice({
        actor: adminAgent(request.apiPrincipal!),
        audit: audit(request.id),
        priceId: (request.params as { id: string }).id,
      }),
  );
  app.post(
    "/payments",
    {
      schema: defineJsonRoute({
        summary: "Initiate a product payment",
        description:
          "The server resolves the active price, calculates totals, creates an idempotent invoice, and starts checkout. Client-submitted prices are never accepted.",
        tags: ["Payments"],
        operationId: "createPayment",
        permissions: ["user"],
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: {
            "idempotency-key": { type: "string", minLength: 8, maxLength: 200 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["priceId", "provider", "successUrl", "cancelUrl"],
          properties: {
            priceId: uuid,
            provider: { type: "string", maxLength: 40 },
            quantity: { type: "string", pattern: "^[1-9][0-9]*$" },
            couponCode: { type: "string", minLength: 8, maxLength: 64 },
            successUrl: { type: "string", format: "uri" },
            cancelUrl: { type: "string", format: "uri" },
          },
        },
        response: {
          201: {
            description: "Pending transaction and provider next action",
            ...object,
          },
        },
      }),
      preHandler: user,
    },
    async (request, reply) => {
      const principal = request.apiPrincipal!;
      const body = request.body as {
        priceId: string;
        provider: string;
        quantity?: string;
        couponCode?: string;
        successUrl: string;
        cancelUrl: string;
      };
      const key = String(request.headers["idempotency-key"]);
      const actor = userAgent(principal);
      const invoice = await options.billing.issueInvoice({
        actor,
        audit: audit(request.id),
        userId: principal.id,
        idempotencyKey: key,
        lines: [
          {
            priceId: body.priceId,
            quantity: BigInt(body.quantity ?? "1"),
            taxRateBps: 0,
          },
        ],
        ...(body.couponCode ? { couponCode: body.couponCode } : {}),
      });
      if (invoice.totalMinor === 0n)
        return reply.code(201).send({
          invoice: json(invoice),
          status: "succeeded",
          nextAction: null,
        });
      const provider = options.providers.find(
        (item) => item.id === body.provider,
      );
      if (!provider)
        return reply.code(422).send({
          type: "/problems/provider-unavailable",
          title: "Payment provider unavailable",
          status: 422,
          code: "PROVIDER_UNAVAILABLE",
          requestId: request.id,
        });
      await options.financial.bindAccountKey({
        actor,
        audit: audit(request.id),
        userId: principal.id,
        key: principal.id,
      });
      const checkout = await provider.createOneOffCheckout({
        amount: { currency: invoice.currency, amountMinor: invoice.totalMinor },
        accountKey: principal.id,
        idempotencyKey: key,
        description: `Edu Service invoice ${invoice.id}`,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
      });
      if (
        invoice.provider &&
        (invoice.provider !== provider.id ||
          invoice.providerReference !== checkout.providerReference)
      )
        throw new Error(
          "Idempotency key resolved to a different provider checkout.",
        );
      const bound = invoice.provider
        ? invoice
        : await options.billing.bindInvoiceProvider({
            actor,
            audit: audit(request.id),
            userId: principal.id,
            invoiceId: invoice.id,
            provider: provider.id,
            providerReference: checkout.providerReference,
          });
      return reply.code(201).send({
        invoice: json(bound),
        status: "pending",
        nextAction: { type: "redirect", url: checkout.checkoutUrl },
      });
    },
  );
  app.get(
    "/payments/:id",
    {
      schema: defineJsonRoute({
        summary: "Get my payment transaction status",
        tags: ["Payments"],
        operationId: "getPayment",
        permissions: ["user"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: uuid },
        },
        response: {
          200: { description: "Invoice-backed transaction", ...object },
        },
      }),
      preHandler: user,
    },
    async (request, reply) => {
      const invoice = await options.findInvoice(
        (request.params as { id: string }).id,
      );
      const account = invoice
        ? await options.findAccountById(invoice.accountId)
        : null;
      if (!invoice || account?.userId !== request.apiPrincipal!.id)
        return reply.code(404).send({
          type: "/problems/not-found",
          title: "Payment not found",
          status: 404,
          code: "NOT_FOUND",
          requestId: request.id,
        });
      return json(invoice);
    },
  );
  app.post(
    "/admin/payments/:paymentId/refunds",
    {
      schema: defineJsonRoute({
        summary: "Record a provider-confirmed refund",
        tags: ["Admin payments"],
        operationId: "recordPaymentRefund",
        permissions: ["payments:refund"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["paymentId"],
          properties: { paymentId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "userId",
            "providerReference",
            "amountMinor",
            "reason",
            "revokeAccess",
          ],
          properties: {
            userId: uuid,
            providerReference: { type: "string", minLength: 4, maxLength: 200 },
            amountMinor: { type: "string", pattern: "^[1-9][0-9]*$" },
            reason: { type: "string", minLength: 3, maxLength: 200 },
            revokeAccess: { type: "boolean" },
          },
        },
        response: { 201: { description: "Refund", ...object } },
      }),
      preHandler: refunds,
    },
    async (request, reply) => {
      const body = request.body as {
        userId: string;
        providerReference: string;
        amountMinor: string;
        reason: string;
        revokeAccess: boolean;
      };
      return reply.code(201).send(
        json(
          await options.billing.recordRefund({
            actor: adminAgent(request.apiPrincipal!, body.userId),
            audit: audit(request.id),
            userId: body.userId,
            paymentId: (request.params as { paymentId: string }).paymentId,
            providerReference: body.providerReference,
            amountMinor: BigInt(body.amountMinor),
            reason: body.reason,
            revokeAccess: body.revokeAccess,
            occurredAt: new Date(),
          }),
        ),
      );
    },
  );
}

const audit = (correlationId: string): AuditContext => ({
  correlationId,
  source: "api",
  actorSource: "service",
});
const userAgent = (p: ApiPrincipal): Actor => ({
  kind: "agent",
  agentId: "api:payments",
  onBehalfOf: p.id,
  permissions: ["financial:manage", "financial:purchase"],
});
const adminAgent = (p: ApiPrincipal, userId = p.id): Actor => ({
  kind: "agent",
  agentId: `api:${p.id}`,
  onBehalfOf: userId,
  permissions: ["financial:manage"],
});
function json<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}
