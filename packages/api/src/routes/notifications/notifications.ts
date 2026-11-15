import type { FastifyInstance } from "fastify";
import type { NotificationInboxService } from "@life-optimizer/notifications";
import { requirePermissions, type ApiAuthenticator } from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";
import {
  createPage,
  decodeCursor,
  encodeCursor,
  PageRequestError,
  parsePageRequest,
  sendPage,
} from "../../pagination.js";

const nullableDateTime = {
  anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
} as const;
const stringMap = {
  type: "object",
  description:
    "Application metadata. Values are bounded strings; no credentials or secrets are returned.",
  additionalProperties: { type: "string", maxLength: 1024 },
} as const;
const notificationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "userId",
    "title",
    "body",
    "data",
    "status",
    "readAt",
    "dismissedAt",
    "scheduledAt",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid", description: "Notification ID." },
    userId: { type: "string", format: "uuid", description: "Owning user ID." },
    title: { type: "string", maxLength: 200 },
    body: { type: "string", maxLength: 2000 },
    data: stringMap,
    status: {
      enum: ["unread", "read", "dismissed", "scheduled"],
      description: "Current inbox state.",
    },
    readAt: nullableDateTime,
    dismissedAt: nullableDateTime,
    scheduledAt: nullableDateTime,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const preferencesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["userId", "emailEnabled", "inAppEnabled", "pushEnabled", "topics"],
  properties: {
    userId: { type: "string", format: "uuid" },
    emailEnabled: { type: "boolean" },
    inAppEnabled: { type: "boolean" },
    pushEnabled: { type: "boolean" },
    topics: {
      type: "object",
      description: "Per-topic opt-in state keyed by application topic.",
      additionalProperties: { type: "boolean" },
    },
    updatedAt: {
      type: "string",
      format: "date-time",
      description:
        "Last persisted update time; absent for default preferences.",
    },
  },
} as const;
const configurationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "adapterId",
    "fallbackConfigurationIds",
    "rateLimitMax",
    "rateLimitWindowSeconds",
    "active",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", description: "Non-secret configuration identifier." },
    adapterId: { enum: ["fcm", "aws-sns", "web-push"] },
    fallbackConfigurationIds: { type: "array", items: { type: "string" } },
    rateLimitMax: { type: "integer", minimum: 1 },
    rateLimitWindowSeconds: { type: "integer", minimum: 1 },
    active: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const idParams = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

export function registerNotificationRoutes(
  app: FastifyInstance,
  options: {
    service: NotificationInboxService;
    authenticator: ApiAuthenticator;
  },
): void {
  const user = requirePermissions(options.authenticator, ["user"]);
  const admin = requirePermissions(options.authenticator, [
    "notifications:manage",
  ]);
  app.get(
    "/notifications",
    {
      schema: defineJsonRoute({
        summary: "List my notifications",
        description:
          "Returns visible, non-dismissed inbox items newest first. limit defaults to 25 (maximum 100); cursor is the opaque nextCursor from the preceding page. Scheduled items are hidden until their scheduled time.",
        tags: ["Notifications"],
        operationId: "listMyNotifications",
        permissions: ["user"],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: {
              type: "string",
              pattern: "^[0-9]{1,3}$",
              description: "Page size from 1 to 100; defaults to 25.",
              examples: ["25"],
            },
            cursor: {
              type: "string",
              maxLength: 512,
              description:
                "Opaque keyset cursor returned as pagination.nextCursor; do not parse or construct it.",
            },
          },
        },
        response: {
          200: {
            description: "Notification page",
            type: "object",
            additionalProperties: false,
            required: ["data", "pagination", "links"],
            properties: {
              data: { type: "array", items: notificationSchema },
              pagination: {
                type: "object",
                additionalProperties: false,
                required: ["limit"],
                properties: {
                  limit: { type: "integer", minimum: 1, maximum: 100 },
                  nextCursor: { type: "string", maxLength: 512 },
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
          },
        },
      }),
      preHandler: user,
    },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const page = parsePageRequest(query);
      const decoded = page.cursor ? decodeCursor(page.cursor) : undefined;
      const rows = await options.service.list(
        request.apiPrincipal!.id,
        page.limit,
        decoded ? notificationCursor(decoded) : undefined,
      );
      const next = rows.length > page.limit ? rows[page.limit - 1] : undefined;
      return sendPage(
        reply,
        createPage(request, {
          data: rows.slice(0, page.limit),
          limit: page.limit,
          ...(next
            ? {
                nextCursor: encodeCursor({
                  createdAt: next.createdAt.toISOString(),
                  id: next.id,
                }),
              }
            : {}),
        }),
      );
    },
  );
  app.get(
    "/notifications/unread-count",
    {
      schema: defineJsonRoute({
        summary: "Get my unread notification count",
        description:
          "Counts visible, non-dismissed inbox items currently in the unread state for the authenticated user.",
        tags: ["Notifications"],
        operationId: "getMyUnreadNotificationCount",
        permissions: ["user"],
        response: {
          200: {
            description: "Unread count",
            type: "object",
            additionalProperties: false,
            required: ["count"],
            properties: { count: { type: "integer" } },
          },
        },
      }),
      preHandler: user,
    },
    async (request) => ({
      count: await options.service.unreadCount(request.apiPrincipal!.id),
    }),
  );
  app.get(
    "/notifications/:id",
    {
      schema: defineJsonRoute({
        summary: "Get one of my notifications",
        description:
          "Returns one notification owned by the authenticated user. Another user's notification is never disclosed.",
        tags: ["Notifications"],
        operationId: "getMyNotification",
        permissions: ["user"],
        problemResponses: [404],
        params: idParams,
        response: {
          200: { description: "Notification", ...notificationSchema },
        },
      }),
      preHandler: user,
    },
    async (request, reply) =>
      (await options.service.get(
        request.apiPrincipal!.id,
        (request.params as { id: string }).id,
      )) ??
      reply.code(404).send({
        type: "/problems/not-found",
        title: "Notification not found",
        status: 404,
        code: "NOT_FOUND",
        requestId: request.id,
      }),
  );
  app.patch(
    "/notifications/:id/read",
    {
      schema: defineJsonRoute({
        summary: "Mark my notification read or unread",
        description:
          "Sets the read state of one owned, non-dismissed notification and updates readAt. Returns not found when the item is absent, dismissed, or not owned by the caller.",
        tags: ["Notifications"],
        operationId: "setMyNotificationReadState",
        permissions: ["user"],
        problemResponses: [404],
        params: idParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["read"],
          properties: {
            read: {
              type: "boolean",
              description: "true marks read; false restores the unread state.",
            },
          },
        },
        response: {
          200: { description: "Updated notification", ...notificationSchema },
        },
      }),
      preHandler: user,
    },
    async (request, reply) =>
      (await options.service.setRead(
        request.apiPrincipal!.id,
        (request.params as { id: string }).id,
        (request.body as { read: boolean }).read,
      )) ??
      reply.code(404).send({
        type: "/problems/not-found",
        title: "Notification not found",
        status: 404,
        code: "NOT_FOUND",
        requestId: request.id,
      }),
  );
  app.post(
    "/notifications/read-all",
    {
      schema: defineJsonRoute({
        summary: "Mark all my notifications read",
        description:
          "Marks every visible unread notification owned by the authenticated user as read and returns the number changed.",
        tags: ["Notifications"],
        operationId: "markAllMyNotificationsRead",
        permissions: ["user"],
        response: {
          200: {
            description: "Updated count",
            type: "object",
            additionalProperties: false,
            required: ["updated"],
            properties: { updated: { type: "integer" } },
          },
        },
      }),
      preHandler: user,
    },
    async (request) => ({
      updated: await options.service.markAllRead(request.apiPrincipal!.id),
    }),
  );
  app.delete(
    "/notifications/:id",
    {
      schema: defineJsonRoute({
        summary: "Dismiss my notification",
        description:
          "Dismisses an owned notification so it no longer appears in the inbox. The operation is idempotent and does not expose ownership.",
        tags: ["Notifications"],
        operationId: "dismissMyNotification",
        permissions: ["user"],
        params: idParams,
        response: { 204: { description: "Dismissed", type: "null" } },
      }),
      preHandler: user,
    },
    async (request, reply) => {
      await options.service.dismiss(
        request.apiPrincipal!.id,
        (request.params as { id: string }).id,
      );
      return reply.code(204).send();
    },
  );
  app.get(
    "/notification-preferences",
    {
      schema: defineJsonRoute({
        summary: "Get my notification preferences",
        description:
          "Returns the authenticated user's channel and topic preferences. New users receive the documented all-channels-enabled defaults.",
        tags: ["Notifications"],
        operationId: "getMyNotificationPreferences",
        permissions: ["user"],
        response: { 200: { description: "Preferences", ...preferencesSchema } },
      }),
      preHandler: user,
    },
    async (request) =>
      (await options.service.preferences(request.apiPrincipal!.id)) ?? {
        userId: request.apiPrincipal!.id,
        emailEnabled: true,
        inAppEnabled: true,
        pushEnabled: true,
        topics: {},
      },
  );
  app.put(
    "/notification-preferences",
    {
      schema: defineJsonRoute({
        summary: "Replace my notification preferences",
        description:
          "Replaces all channel and topic preferences for the authenticated user. Omitted topic keys are removed.",
        tags: ["Notifications"],
        operationId: "updateMyNotificationPreferences",
        permissions: ["user"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["emailEnabled", "inAppEnabled", "pushEnabled", "topics"],
          properties: {
            emailEnabled: {
              type: "boolean",
              description: "Allow eligible email notifications.",
            },
            inAppEnabled: {
              type: "boolean",
              description: "Allow in-app inbox notifications.",
            },
            pushEnabled: {
              type: "boolean",
              description: "Allow eligible device push notifications.",
            },
            topics: {
              type: "object",
              description:
                "Complete per-topic opt-in map; omitted previous keys are removed.",
              additionalProperties: { type: "boolean" },
            },
          },
        },
        response: { 200: { description: "Preferences", ...preferencesSchema } },
      }),
      preHandler: user,
    },
    async (request) =>
      options.service.savePreferences({
        userId: request.apiPrincipal!.id,
        ...(request.body as {
          emailEnabled: boolean;
          inAppEnabled: boolean;
          pushEnabled: boolean;
          topics: Record<string, boolean>;
        }),
      }),
  );
  app.get(
    "/admin/notification-configurations",
    {
      schema: defineJsonRoute({
        summary: "List actual push notification configuration",
        description:
          "Returns enabled adapters, fallback order, and delivery rate/retry limits without provider credentials.",
        tags: ["Admin notifications"],
        operationId: "listNotificationConfigurations",
        permissions: ["notifications:manage"],
        response: {
          200: {
            description: "Safe configuration",
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: {
              data: { type: "array", items: configurationSchema },
            },
          },
        },
      }),
      preHandler: admin,
    },
    async () => ({ data: await options.service.configurations() }),
  );
  app.post(
    "/admin/notifications",
    {
      schema: defineJsonRoute({
        summary: "Create notifications for users",
        description:
          "Creates durable in-app notifications for an explicit bounded audience. A future scheduledAt keeps an item hidden until that time; this operation does not send email, push, or other external-channel delivery.",
        tags: ["Admin notifications"],
        operationId: "createNotifications",
        permissions: ["notifications:manage"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userIds", "title", "body"],
          properties: {
            userIds: {
              type: "array",
              description:
                "Explicit recipient IDs. The current endpoint does not expand segments or an all-users audience.",
              minItems: 1,
              maxItems: 1000,
              uniqueItems: true,
              items: { type: "string", format: "uuid" },
            },
            title: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description: "Inbox title shown to each recipient.",
            },
            body: {
              type: "string",
              minLength: 1,
              maxLength: 2000,
              description: "Inbox message body shown to each recipient.",
            },
            data: stringMap,
            scheduledAt: {
              type: "string",
              format: "date-time",
              description:
                "Optional activation time. Future items remain scheduled and hidden; this endpoint does not itself run a scheduler.",
            },
          },
        },
        response: {
          201: {
            description: "Created notifications",
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: {
              data: { type: "array", items: notificationSchema },
            },
          },
        },
      }),
      preHandler: admin,
    },
    async (request, reply) => {
      const body = request.body as {
        userIds: string[];
        title: string;
        body: string;
        data?: Record<string, string>;
        scheduledAt?: string;
      };
      const data = await Promise.all(
        body.userIds.map((userId) =>
          options.service.create({
            userId,
            title: body.title,
            body: body.body,
            data: body.data ?? {},
            scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
          }),
        ),
      );
      return reply.code(201).send({ data });
    },
  );
}

function notificationCursor(value: Record<string, string | number>) {
  const createdAt = new Date(String(value.createdAt));
  const id = String(value.id);
  if (
    Number.isNaN(createdAt.getTime()) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new PageRequestError("cursor is invalid or expired.");
  return { createdAt, id };
}
