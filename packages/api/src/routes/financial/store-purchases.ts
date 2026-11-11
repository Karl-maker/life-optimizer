import type { FastifyInstance } from "fastify";
import type { Actor, AuditContext } from "@edu-service/core";
import type { ApiAuthenticator, ApiPrincipal } from "../../auth.js";
import { ApiAuthenticationError, requirePermissions } from "../../auth.js";
import type {
  AppleStoreAdapter,
  GooglePlayAdapter,
  StorePurchase,
  VerifiedStorePurchase,
} from "@edu-service/financial";
import { defineJsonRoute } from "../../contracts.js";
import {
  createPage,
  decodeCursor,
  encodeCursor,
  PageRequestError,
  sendPage,
} from "../../pagination.js";

type StoreService = {
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
const audit = (requestId: string): AuditContext => ({
  correlationId: requestId,
  source: "api",
  actorSource: "service",
});
const claimResponse = {
  description: "Verified purchase state",
  type: "object",
  additionalProperties: false,
  required: ["purchaseId", "status", "granted", "revoked"],
  properties: {
    purchaseId: { type: "string", format: "uuid" },
    status: {
      type: "string",
      enum: ["pending", "active", "expired", "suspended", "revoked"],
    },
    granted: { type: "integer", minimum: 0 },
    revoked: { type: "integer", minimum: 0 },
  },
};
function publicPurchase(row: StorePurchase) {
  return {
    id: row.id,
    provider: row.provider,
    transactionId: row.transactionId,
    originalTransactionId: row.originalTransactionId,
    sku: row.sku,
    priceId: row.priceId,
    kind: row.kind,
    status: row.status,
    environment: row.environment,
    quantity: row.quantity,
    currency: row.currency,
    priceMilliunits: row.priceMilliunits?.toString() ?? null,
    purchasedAt: row.purchasedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}
function userId(
  principal: ApiPrincipal | undefined,
  resolve: (principal: ApiPrincipal) => string | null,
): string {
  if (!principal) throw new ApiAuthenticationError();
  const id = resolve(principal);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new ApiAuthenticationError();
  return id;
}
export async function registerStorePurchaseRoutes(input: {
  app: FastifyInstance;
  service: StoreService;
  apple?: AppleStoreAdapter;
  google?: GooglePlayAdapter;
  authenticator: ApiAuthenticator;
  resolveUserId: (principal: ApiPrincipal) => string | null;
  webhookActor: Actor;
}): Promise<void> {
  const auth = requirePermissions(input.authenticator, ["financial:purchase"]);
  if (input.apple) {
    input.app.post(
      "/webhooks/apple-app-store",
      {
        bodyLimit: 65_536,
        schema: defineJsonRoute({
          summary: "Receive an App Store Server Notification V2",
          tags: ["Financial webhooks"],
          operationId: "receiveAppleStoreNotification",
          description:
            "Verifies the Apple signedPayload and nested transaction JWS. Repeated notification UUIDs are deduplicated. No-store.",
          body: {
            type: "object",
            additionalProperties: false,
            required: ["signedPayload"],
            properties: {
              signedPayload: {
                type: "string",
                minLength: 100,
                maxLength: 65_536,
                description:
                  "Apple-signed App Store Server Notifications V2 JWS envelope.",
              },
            },
          },
          response: {
            200: {
              description: "Verified and recorded",
              type: "object",
              additionalProperties: false,
              required: ["received"],
              properties: { received: { type: "boolean" } },
            },
          },
        }),
      },
      async (request) => {
        const { signedPayload } = request.body as { signedPayload: string };
        const notification =
          await input.apple!.verifyNotification(signedPayload);
        if (notification.purchase)
          await input.service.sync({
            actor: input.webhookActor,
            audit: audit(request.id),
            purchase: notification.purchase,
            notification: {
              eventId: notification.eventId,
              type: notification.type,
            },
          });
        else
          await input.service.recordNotification({
            actor: input.webhookActor,
            audit: audit(request.id),
            provider: "apple",
            eventId: notification.eventId,
            type: notification.type,
          });
        return { received: true };
      },
    );
    input.app.post(
      "/store-purchases/apple/claim",
      {
        preHandler: auth,
        bodyLimit: 32_768,
        schema: defineJsonRoute({
          summary: "Verify and claim an Apple in-app transaction",
          tags: ["Store purchases"],
          operationId: "claimAppleStorePurchase",
          permissions: ["financial:purchase"],
          description:
            "Requires a bound appAccountToken. Refreshes a verified device transaction through the App Store Server API before granting access. No-store.",
          body: {
            type: "object",
            additionalProperties: false,
            required: ["signedTransaction"],
            properties: {
              signedTransaction: {
                type: "string",
                minLength: 100,
                maxLength: 32_768,
                description:
                  "StoreKit signed transaction JWS returned by the device. The server verifies and refreshes it before granting access.",
              },
            },
          },
          response: { 200: claimResponse },
        }),
      },
      async (request) => {
        const owner = userId(request.apiPrincipal, input.resolveUserId);
        const verified = await input.apple!.verifyClientTransaction(
          (request.body as { signedTransaction: string }).signedTransaction,
        );
        const result = await input.service.sync({
          actor: { kind: "user", userId: owner },
          audit: audit(request.id),
          userId: owner,
          purchase: verified,
        });
        return {
          purchaseId: result.purchase.id,
          status: result.purchase.status,
          granted: result.granted,
          revoked: result.revoked,
        };
      },
    );
  }
  if (input.google) {
    input.app.post(
      "/webhooks/google-play",
      {
        bodyLimit: 65_536,
        schema: defineJsonRoute({
          summary: "Receive an authenticated Google Play RTDN push",
          tags: ["Financial webhooks"],
          operationId: "receiveGooglePlayNotification",
          description:
            "Verifies the Pub/Sub OIDC JWT, checks its audience and service-account email, then queries the Play Developer API. No-store.",
          headers: {
            type: "object",
            additionalProperties: true,
            required: ["authorization"],
            properties: {
              authorization: {
                type: "string",
                minLength: 100,
                maxLength: 8200,
              },
            },
          },
          body: {
            type: "object",
            additionalProperties: false,
            required: ["message"],
            properties: {
              message: {
                type: "object",
                description:
                  "Google Cloud Pub/Sub push message. Its data is only a change signal and never sufficient to grant access.",
                additionalProperties: false,
                required: ["data"],
                properties: {
                  data: { type: "string", minLength: 4, maxLength: 65_536 },
                  messageId: { type: "string", minLength: 1, maxLength: 256 },
                  message_id: { type: "string", minLength: 1, maxLength: 256 },
                  publishTime: { type: "string", maxLength: 64 },
                  publish_time: { type: "string", maxLength: 64 },
                  orderingKey: { type: "string", maxLength: 256 },
                  attributes: {
                    type: "object",
                    maxProperties: 16,
                    additionalProperties: { type: "string", maxLength: 512 },
                  },
                },
              },
              subscription: {
                type: "string",
                maxLength: 512,
                description: "Pub/Sub subscription resource name.",
              },
              deliveryAttempt: {
                type: "integer",
                minimum: 1,
                maximum: 100000,
                description:
                  "Provider-reported delivery attempt when dead-letter retry tracking is enabled.",
              },
            },
          },
          response: {
            200: {
              description: "Verified and recorded",
              type: "object",
              additionalProperties: false,
              required: ["received"],
              properties: { received: { type: "boolean" } },
            },
          },
        }),
      },
      async (request) => {
        const notification = await input.google!.verifyNotification(
          request.headers.authorization,
          request.body,
        );
        if (notification.purchase) {
          const result = await input.service.sync({
            actor: input.webhookActor,
            audit: audit(request.id),
            purchase: notification.purchase,
            notification: {
              eventId: notification.eventId,
              type: notification.type,
            },
          });
          if (
            result.purchase.status === "active" &&
            result.purchase.accountId &&
            notification.purchaseToken
          )
            await input.google!.acknowledge(
              notification.purchase,
              notification.purchaseToken,
            );
        } else if (notification.voided)
          await input.service.voidGoogleOrder({
            actor: input.webhookActor,
            audit: audit(request.id),
            eventId: notification.eventId,
            orderId: notification.voided.orderId,
            tokenHash: notification.voided.tokenHash,
          });
        else
          await input.service.recordNotification({
            actor: input.webhookActor,
            audit: audit(request.id),
            provider: "google",
            eventId: notification.eventId,
            type: notification.type,
          });
        return { received: true };
      },
    );
    input.app.post(
      "/store-purchases/google/claim",
      {
        preHandler: auth,
        bodyLimit: 8192,
        schema: defineJsonRoute({
          summary: "Verify and claim a Google Play purchase",
          tags: ["Store purchases"],
          operationId: "claimGooglePlayPurchase",
          permissions: ["financial:purchase"],
          description:
            "Queries the Play Developer API for the purchase token. Only PURCHASED/active purchases with a bound obfuscated account ID grant access. No-store.",
          body: {
            type: "object",
            additionalProperties: false,
            required: ["purchaseToken", "kind"],
            properties: {
              purchaseToken: {
                type: "string",
                minLength: 4,
                maxLength: 4096,
                description:
                  "Opaque Play purchase token. It is verified server-to-server and stored only as a hash.",
              },
              kind: {
                type: "string",
                enum: ["one_time", "subscription"],
                description:
                  "Selects the matching Google Play Developer API verification flow.",
              },
            },
          },
          response: { 200: claimResponse },
        }),
      },
      async (request) => {
        const owner = userId(request.apiPrincipal, input.resolveUserId);
        const body = request.body as {
          purchaseToken: string;
          kind: "one_time" | "subscription";
        };
        const verified =
          body.kind === "one_time"
            ? await input.google!.verifyProductToken(body.purchaseToken)
            : await input.google!.verifySubscriptionToken(body.purchaseToken);
        const result = await input.service.sync({
          actor: { kind: "user", userId: owner },
          audit: audit(request.id),
          userId: owner,
          purchase: verified,
        });
        if (result.purchase.status === "active" && result.purchase.accountId)
          await input.google!.acknowledge(verified, body.purchaseToken);
        return {
          purchaseId: result.purchase.id,
          status: result.purchase.status,
          granted: result.granted,
          revoked: result.revoked,
        };
      },
    );
  }
  input.app.get(
    "/store-purchases",
    {
      preHandler: auth,
      schema: defineJsonRoute({
        summary: "List the authenticated user's verified store purchases",
        tags: ["Store purchases"],
        operationId: "listStorePurchases",
        permissions: ["financial:purchase"],
        description:
          "No-store. Returns bounded, cursor-paginated purchase snapshots without purchase tokens or raw provider payloads.",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", minLength: 1, maxLength: 512 },
          },
        },
        response: {
          200: {
            description: "Purchase history",
            type: "object",
            additionalProperties: false,
            required: ["data", "pagination", "links"],
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "provider",
                    "transactionId",
                    "originalTransactionId",
                    "sku",
                    "priceId",
                    "kind",
                    "status",
                    "environment",
                    "quantity",
                    "currency",
                    "priceMilliunits",
                    "purchasedAt",
                    "expiresAt",
                  ],
                  properties: {
                    id: { type: "string" },
                    provider: { type: "string" },
                    transactionId: { type: "string" },
                    originalTransactionId: { type: "string" },
                    sku: { type: "string" },
                    priceId: { type: "string" },
                    kind: { type: "string" },
                    status: { type: "string" },
                    environment: { type: "string" },
                    quantity: { type: "integer" },
                    currency: { type: ["string", "null"] },
                    priceMilliunits: { type: ["string", "null"] },
                    purchasedAt: { type: ["string", "null"] },
                    expiresAt: { type: ["string", "null"] },
                  },
                },
              },
              pagination: {
                type: "object",
                additionalProperties: false,
                required: ["limit"],
                properties: {
                  limit: { type: "integer" },
                  nextCursor: { type: "string" },
                },
              },
              links: {
                type: "object",
                additionalProperties: false,
                required: ["self"],
                properties: {
                  self: { type: "string" },
                  next: { type: "string" },
                },
              },
            },
            headers: {
              link: { type: "string", description: "Next page when present" },
              "cache-control": {
                type: "string",
                description: "Always no-store",
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const owner = userId(request.apiPrincipal, input.resolveUserId);
      const query = request.query as { limit?: number; cursor?: string };
      const fields = query.cursor ? decodeCursor(query.cursor) : undefined;
      const cursor =
        fields &&
        typeof fields.id === "string" &&
        typeof fields.createdAt === "string"
          ? { id: fields.id, createdAt: new Date(fields.createdAt) }
          : undefined;
      if (
        fields &&
        (!cursor ||
          !/^[0-9a-f-]{36}$/i.test(cursor.id) ||
          !Number.isFinite(cursor.createdAt.getTime()))
      )
        throw new PageRequestError("Purchase cursor is invalid.");
      const limit = query.limit ?? 25;
      const rows = await input.service.listPurchases({
        actor: { kind: "user", userId: owner },
        userId: owner,
        limit: limit + 1,
        ...(cursor ? { cursor } : {}),
      });
      const visible = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit
          ? encodeCursor({
              id: visible[visible.length - 1]!.id,
              createdAt: visible[visible.length - 1]!.createdAt.toISOString(),
            })
          : undefined;
      return sendPage(
        reply,
        createPage(request, {
          data: visible.map(publicPurchase),
          limit,
          ...(nextCursor ? { nextCursor } : {}),
        }),
      );
    },
  );
}
