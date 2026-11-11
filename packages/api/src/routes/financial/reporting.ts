import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  FinancialReportingService,
  FinancialViewer,
} from "@edu-service/financial";
import type { Actor } from "@edu-service/core";
import {
  requirePermissions,
  type ApiAuthenticator,
  type ApiPrincipal,
} from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";
import {
  createPage,
  decodeCursor,
  encodeCursor,
  parsePageRequest,
  sendPage,
} from "../../pagination.js";

const money = {
  type: "string",
  pattern: "^-?[0-9]+$",
  description:
    "Decimal integer amount in the associated currency's minor unit.",
} as const;
const pageProperties = (item: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: ["data", "pagination", "links"],
  properties: {
    data: { type: "array", items: item },
    pagination: {
      type: "object",
      additionalProperties: false,
      required: ["limit"],
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100 },
        nextCursor: {
          type: "string",
          maxLength: 512,
          description: "Opaque cursor; do not parse or construct it.",
        },
      },
    },
    links: {
      type: "object",
      additionalProperties: false,
      required: ["self"],
      properties: {
        self: { type: "string" },
        next: {
          type: "string",
          description: "Next-page URL when another page exists.",
        },
      },
    },
  },
});
const priceSchema = {
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
    id: { type: "string", format: "uuid" },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    unitAmountMinor: money,
    frequency: { enum: ["one_time", "day", "week", "month", "year"] },
    intervalCount: { type: "integer", minimum: 1 },
    trialDays: { type: "integer", minimum: 0 },
  },
} as const;
const productSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "key", "name", "createdAt", "prices"],
  properties: {
    id: { type: "string", format: "uuid" },
    key: { type: "string" },
    name: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    prices: { type: "array", items: priceSchema },
  },
} as const;
const paymentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "invoiceId",
    "provider",
    "amountMinor",
    "currency",
    "status",
    "occurredAt",
    "refundedAmountMinor",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    invoiceId: { type: "string", format: "uuid" },
    provider: { type: "string" },
    amountMinor: money,
    currency: { type: "string" },
    status: { type: "string" },
    occurredAt: { type: "string", format: "date-time" },
    refundedAmountMinor: money,
  },
} as const;

export function registerFinancialReportingRoutes(
  app: FastifyInstance,
  options: {
    service: FinancialReportingService;
    authenticator: ApiAuthenticator;
  },
): void {
  app.get(
    "/catalog/products",
    {
      schema: defineJsonRoute({
        summary: "List public products and active prices",
        description:
          "Returns active, non-blocked products. The owning catalog write use cases invalidate this short-lived public representation after commit.",
        tags: ["Catalog"],
        operationId: "listPublicProducts",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "string", pattern: "^[0-9]{1,3}$" },
            cursor: { type: "string", maxLength: 512 },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
          },
        },
        response: {
          200: {
            description: "Active product catalogue",
            ...pageProperties(productSchema),
            headers: {
              link: { type: "string", description: "RFC 8288 next-page link." },
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
      const query = request.query as Record<string, unknown> & {
        currency?: string;
      };
      const pageRequest = parsePageRequest(query);
      const decoded = pageRequest.cursor
        ? decodeCursor(pageRequest.cursor)
        : undefined;
      const rows = await options.service.listCatalog({
        limit: pageRequest.limit,
        ...(decoded === undefined ? {} : { cursor: catalogCursor(decoded) }),
        ...(query.currency === undefined ? {} : { currency: query.currency }),
      });
      const data = rows.slice(0, pageRequest.limit).map((product) => ({
        ...product,
        createdAt: product.createdAt.toISOString(),
        prices: product.prices.map((price) => ({
          ...price,
          unitAmountMinor: price.unitAmountMinor.toString(),
        })),
      }));
      const next =
        rows.length > pageRequest.limit
          ? rows[pageRequest.limit - 1]
          : undefined;
      reply.header(
        "cache-control",
        "public, max-age=60, stale-while-revalidate=300",
      );
      return sendPage(
        reply,
        createPage(request, {
          data,
          limit: pageRequest.limit,
          ...(next === undefined
            ? {}
            : {
                nextCursor: encodeCursor({
                  createdAt: next.createdAt.toISOString(),
                  id: next.id,
                }),
              }),
        }),
      );
    },
  );

  app.get(
    "/me/payments",
    {
      schema: defineJsonRoute({
        summary: "List my payment history",
        description:
          "Returns only payments belonging to the authenticated account; provider token material is never included.",
        tags: ["Payments"],
        operationId: "listMyPayments",
        permissions: ["user"],
        querystring: historyQuerySchema,
        response: {
          200: {
            description: "Authenticated payment history",
            ...pageProperties(paymentSchema),
          },
        },
      }),
      preHandler: requirePermissions(options.authenticator, ["user"]),
    },
    (request, reply) =>
      paymentHistory(request, reply, options, request.apiPrincipal!.id),
  );

  app.get(
    "/admin/users/:userId/payments",
    {
      schema: defineJsonRoute({
        summary: "List a user's payment history",
        description:
          "Returns a cursor-paginated payment history for the specified user. This administrative view remains no-store and excludes provider credentials or raw payment details.",
        tags: ["Admin finance"],
        operationId: "listAdminUserPayments",
        permissions: ["payments:read"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: { userId: { type: "string", format: "uuid" } },
        },
        querystring: historyQuerySchema,
        response: {
          200: {
            description: "User payment history",
            ...pageProperties(paymentSchema),
          },
        },
      }),
      preHandler: requirePermissions(options.authenticator, ["payments:read"]),
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      return paymentHistory(request, reply, options, userId);
    },
  );

  app.get(
    "/admin/finance/revenue",
    {
      schema: defineJsonRoute({
        summary: "Read revenue and refund totals",
        description:
          "Aggregates succeeded payments and refunds using integer minor units, grouped by currency and provider.",
        tags: ["Admin finance"],
        operationId: "getAdminRevenueSummary",
        permissions: ["finance:read"],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            provider: { type: "string", maxLength: 40 },
            status: { type: "string", maxLength: 40 },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
          },
        },
        response: {
          200: {
            description: "Revenue summary by currency",
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "currency",
                    "grossAmountMinor",
                    "refundedAmountMinor",
                    "netAmountMinor",
                    "paymentCount",
                    "refundCount",
                    "byProvider",
                  ],
                  properties: {
                    currency: { type: "string", pattern: "^[A-Z]{3}$" },
                    grossAmountMinor: money,
                    refundedAmountMinor: money,
                    netAmountMinor: money,
                    paymentCount: { type: "integer", minimum: 0 },
                    refundCount: { type: "integer", minimum: 0 },
                    byProvider: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: [
                          "provider",
                          "grossAmountMinor",
                          "paymentCount",
                        ],
                        properties: {
                          provider: { type: "string" },
                          grossAmountMinor: money,
                          paymentCount: { type: "integer", minimum: 0 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      preHandler: requirePermissions(options.authenticator, ["finance:read"]),
    },
    async (request) => {
      const query = request.query as {
        from?: string;
        to?: string;
        provider?: string;
        status?: string;
        currency?: string;
      };
      const data = await options.service.revenueSummary(
        viewer(request.apiPrincipal!),
        {
          ...(query.from === undefined ? {} : { from: new Date(query.from) }),
          ...(query.to === undefined ? {} : { to: new Date(query.to) }),
          ...(query.provider === undefined ? {} : { provider: query.provider }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.currency === undefined ? {} : { currency: query.currency }),
        },
      );
      return {
        data: data.map((value) => ({
          ...value,
          grossAmountMinor: value.grossAmountMinor.toString(),
          refundedAmountMinor: value.refundedAmountMinor.toString(),
          netAmountMinor: value.netAmountMinor.toString(),
          byProvider: value.byProvider.map((provider) => ({
            ...provider,
            grossAmountMinor: provider.grossAmountMinor.toString(),
          })),
        })),
      };
    },
  );
}

const historyQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^[0-9]{1,3}$" },
    cursor: { type: "string", maxLength: 512 },
    provider: { type: "string", maxLength: 40 },
    status: { type: "string", maxLength: 40 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
  },
} as const;

async function paymentHistory(
  request: FastifyRequest,
  reply: FastifyReply,
  options: {
    service: FinancialReportingService;
    authenticator: ApiAuthenticator;
  },
  userId: string,
) {
  const query = request.query as Record<string, unknown> & {
    provider?: string;
    status?: string;
    currency?: string;
  };
  const pageRequest = parsePageRequest(query);
  const decoded = pageRequest.cursor
    ? decodeCursor(pageRequest.cursor)
    : undefined;
  const rows = await options.service.listPaymentHistory(
    viewer(request.apiPrincipal!),
    {
      userId,
      limit: pageRequest.limit,
      ...(decoded === undefined ? {} : { cursor: paymentCursor(decoded) }),
      ...(query.provider === undefined ? {} : { provider: query.provider }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.currency === undefined ? {} : { currency: query.currency }),
    },
  );
  const data = rows.slice(0, pageRequest.limit).map((payment) => ({
    ...payment,
    occurredAt: payment.occurredAt.toISOString(),
    amountMinor: payment.amountMinor.toString(),
    refundedAmountMinor: payment.refundedAmountMinor.toString(),
  }));
  const next =
    rows.length > pageRequest.limit ? rows[pageRequest.limit - 1] : undefined;
  return sendPage(
    reply,
    createPage(request, {
      data,
      limit: pageRequest.limit,
      ...(next === undefined
        ? {}
        : {
            nextCursor: encodeCursor({
              occurredAt: next.occurredAt.toISOString(),
              id: next.id,
            }),
          }),
    }),
  );
}

function viewer(principal: ApiPrincipal): FinancialViewer {
  const actor: Actor = { kind: "user", userId: principal.id };
  return { actor, permissions: principal.permissions };
}

function catalogCursor(value: Record<string, string | number>) {
  return { createdAt: new Date(String(value.createdAt)), id: String(value.id) };
}

function paymentCursor(value: Record<string, string | number>) {
  return {
    occurredAt: new Date(String(value.occurredAt)),
    id: String(value.id),
  };
}
