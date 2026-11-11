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
const uuid = { type: "string", format: "uuid" } as const;
const bigint = {
  type: "string",
  pattern: "^-?[0-9]+$",
  description: "Decimal integer string; never a floating-point amount.",
} as const;
const nullableString = {
  anyOf: [{ type: "string" }, { type: "null" }],
} as const;
const nullableDate = {
  anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
} as const;
const productSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "key", "name", "active", "riskLevel"],
  properties: {
    id: uuid,
    key: { type: "string" },
    name: { type: "string" },
    active: { type: "boolean" },
    riskLevel: { enum: ["low", "standard", "high", "blocked"] },
  },
} as const;
const priceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "productId",
    "currency",
    "unitAmountMinor",
    "frequency",
    "intervalCount",
    "trialDays",
    "active",
  ],
  properties: {
    id: uuid,
    productId: uuid,
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    unitAmountMinor: bigint,
    frequency: { enum: ["one_time", "day", "week", "month", "year"] },
    intervalCount: { type: "integer", minimum: 1 },
    trialDays: { type: "integer", minimum: 0, maximum: 365 },
    active: { type: "boolean" },
  },
} as const;
const catalogPriceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "currency",
    "unitAmountMinor",
    "frequency",
    "intervalCount",
    "trialDays",
  ],
  properties: {
    id: uuid,
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    unitAmountMinor: bigint,
    frequency: { enum: ["one_time", "day", "week", "month", "year"] },
    intervalCount: { type: "integer", minimum: 1 },
    trialDays: { type: "integer", minimum: 0 },
  },
} as const;
const catalogProductSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "key", "name", "createdAt", "prices"],
  properties: {
    id: uuid,
    key: { type: "string" },
    name: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    prices: { type: "array", items: catalogPriceSchema },
  },
} as const;
const invoiceLineSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "invoiceId",
    "productId",
    "priceId",
    "description",
    "quantity",
    "unitAmountMinor",
    "subtotalMinor",
    "discountMinor",
    "taxRateBps",
    "taxMinor",
    "totalMinor",
    "serviceStartsAt",
    "serviceEndsAt",
  ],
  properties: {
    id: uuid,
    invoiceId: uuid,
    productId: uuid,
    priceId: uuid,
    description: { type: "string" },
    quantity: bigint,
    unitAmountMinor: bigint,
    subtotalMinor: bigint,
    discountMinor: bigint,
    taxRateBps: { type: "integer", minimum: 0 },
    taxMinor: bigint,
    totalMinor: bigint,
    serviceStartsAt: nullableDate,
    serviceEndsAt: nullableDate,
  },
} as const;
const invoiceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "accountId",
    "idempotencyKey",
    "currency",
    "subtotalMinor",
    "discountMinor",
    "taxMinor",
    "totalMinor",
    "status",
    "provider",
    "providerReference",
    "subscriptionId",
    "dueAt",
    "issuedAt",
    "paidAt",
    "lines",
  ],
  properties: {
    id: uuid,
    accountId: uuid,
    idempotencyKey: nullableString,
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    subtotalMinor: bigint,
    discountMinor: bigint,
    taxMinor: bigint,
    totalMinor: bigint,
    status: { type: "string" },
    provider: nullableString,
    providerReference: nullableString,
    subscriptionId: { anyOf: [uuid, { type: "null" }] },
    dueAt: nullableDate,
    issuedAt: nullableDate,
    paidAt: nullableDate,
    lines: { type: "array", items: invoiceLineSchema },
  },
} as const;
const refundSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "paymentId",
    "provider",
    "providerReference",
    "amountMinor",
    "status",
    "occurredAt",
  ],
  properties: {
    id: uuid,
    paymentId: uuid,
    provider: { type: "string" },
    providerReference: { type: "string" },
    amountMinor: bigint,
    status: { type: "string" },
    occurredAt: { type: "string", format: "date-time" },
  },
} as const;

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
        description:
          "Returns one active, non-blocked product and its active prices. Inactive, archived, blocked, or unpriced products are returned as not found.",
        tags: ["Catalog"],
        operationId: "getPublicProduct",
        problemResponses: [404],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: uuid },
        },
        response: {
          200: {
            description: "Product",
            ...catalogProductSchema,
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
        description:
          "Creates a product identity and initial risk classification. Prices and entitlement mappings are added separately.",
        tags: ["Admin products"],
        operationId: "createProduct",
        permissions: ["products:write"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "name", "riskLevel"],
          properties: {
            key: {
              type: "string",
              pattern: "^[a-z][a-z0-9_.-]{1,95}$",
              description: "Stable product key used by integrations.",
              examples: ["course.introduction"],
            },
            name: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description: "Customer-facing product name.",
            },
            riskLevel: {
              enum: ["low", "standard", "high", "blocked"],
              description:
                "Risk policy applied before sale; blocked products cannot be purchased.",
            },
          },
        },
        response: { 201: { description: "Product", ...productSchema } },
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
        description:
          "Updates mutable product metadata and availability. Setting active to false archives the product from the public catalogue without deleting financial history.",
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
            name: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description: "Replacement customer-facing name.",
            },
            active: {
              type: "boolean",
              description:
                "Whether the product remains available for new catalogue purchases.",
            },
            riskLevel: {
              enum: ["low", "standard", "high", "blocked"],
              description: "Replacement risk policy; blocked prevents sale.",
            },
          },
        },
        response: { 200: { description: "Product", ...productSchema } },
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
        description:
          "Creates a new price revision and the access grants fulfilled by that price. Existing prices are not edited; retire an obsolete price and create another.",
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
            currency: {
              type: "string",
              pattern: "^[A-Z]{3}$",
              description: "Uppercase ISO 4217 currency code.",
            },
            unitAmountMinor: {
              type: "string",
              pattern: "^[0-9]+$",
              description:
                "Non-negative amount in the currency's minor unit, encoded as a decimal integer string.",
            },
            frequency: {
              enum: ["one_time", "day", "week", "month", "year"],
              description:
                "one_time is not recurring; other values define a subscription interval.",
            },
            intervalCount: {
              type: "integer",
              minimum: 1,
              description: "Number of frequency units in one billing interval.",
            },
            trialDays: {
              type: "integer",
              minimum: 0,
              maximum: 365,
              description: "Trial length; use 0 for no trial.",
            },
            entitlements: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              description:
                "Access rights granted only after verified settlement of this price.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "quantity"],
                properties: {
                  key: {
                    type: "string",
                    description:
                      "Existing entitlement definition key granted after verified settlement.",
                  },
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
        response: { 201: { description: "Price", ...priceSchema } },
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
        description:
          "Marks the price inactive so new purchases cannot use it. Existing invoices, payments, subscriptions, and entitlements retain their historical reference.",
        tags: ["Admin products"],
        operationId: "retirePrice",
        permissions: ["products:write"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: uuid },
        },
        response: { 200: { description: "Retired price", ...priceSchema } },
      }),
      preHandler: products,
    },
    async (request) =>
      json(
        await options.billing.retirePrice({
          actor: adminAgent(request.apiPrincipal!),
          audit: audit(request.id),
          priceId: (request.params as { id: string }).id,
        }),
      ),
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
        problemResponses: [422],
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: {
            "idempotency-key": {
              type: "string",
              minLength: 8,
              maxLength: 200,
              description:
                "Stable key for one logical purchase attempt. Reuse only when safely retrying that same attempt.",
            },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["priceId", "provider", "successUrl", "cancelUrl"],
          properties: {
            priceId: {
              ...uuid,
              description: "Active server-managed price to purchase.",
            },
            provider: {
              type: "string",
              maxLength: 40,
              description:
                "Configured payment provider ID, for example stripe.",
            },
            quantity: {
              type: "string",
              pattern: "^[1-9][0-9]*$",
              default: "1",
              description: "Positive decimal integer string; defaults to 1.",
            },
            couponCode: {
              type: "string",
              minLength: 8,
              maxLength: 64,
              description: "Optional server-validated coupon code.",
            },
            successUrl: {
              type: "string",
              format: "uri",
              description:
                "HTTPS browser return URL after provider success. It is navigation only, not proof of payment.",
            },
            cancelUrl: {
              type: "string",
              format: "uri",
              description: "HTTPS browser return URL after cancellation.",
            },
          },
        },
        response: {
          201: {
            description: "Pending transaction and provider next action",
            type: "object",
            additionalProperties: false,
            required: ["invoice", "status", "nextAction"],
            properties: {
              invoice: invoiceSchema,
              status: { enum: ["pending", "succeeded"] },
              nextAction: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["type", "url"],
                    properties: {
                      type: { const: "redirect" },
                      url: { type: "string", format: "uri" },
                    },
                  },
                  { type: "null" },
                ],
              },
            },
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
        description:
          "Returns the authenticated user's invoice-backed payment state. A transaction owned by another user is returned as not found.",
        tags: ["Payments"],
        operationId: "getPayment",
        permissions: ["user"],
        problemResponses: [404],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: uuid },
        },
        response: {
          200: { description: "Invoice-backed transaction", ...invoiceSchema },
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
        description:
          "Records a refund only after the provider outcome has been verified by trusted server-side processing. This administrative operation must not use client-reported payment state.",
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
            userId: {
              ...uuid,
              description:
                "Owner of the payment and any access affected by revocation.",
            },
            providerReference: {
              type: "string",
              minLength: 4,
              maxLength: 200,
              description: "Verified provider refund identifier.",
            },
            amountMinor: {
              type: "string",
              pattern: "^[1-9][0-9]*$",
              description: "Positive refund amount in invoice minor units.",
            },
            reason: {
              type: "string",
              minLength: 3,
              maxLength: 200,
              description: "Support-safe audit reason.",
            },
            revokeAccess: {
              type: "boolean",
              description:
                "When true, a qualifying full refund also revokes access granted by the invoice.",
            },
          },
        },
        response: { 201: { description: "Refund", ...refundSchema } },
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
