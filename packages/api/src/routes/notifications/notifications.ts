import type { FastifyInstance } from "fastify";
import type { NotificationInboxService } from "@edu-service/notifications";
import { requirePermissions, type ApiAuthenticator } from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";
import { createPage, parsePageRequest, sendPage } from "../../pagination.js";

const object = { type: "object", additionalProperties: true } as const;
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
        tags: ["Notifications"],
        operationId: "listMyNotifications",
        permissions: ["user"],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "string", pattern: "^[0-9]{1,3}$" },
            before: { type: "string", format: "date-time" },
          },
        },
        response: { 200: { description: "Notification page", ...object } },
      }),
      preHandler: user,
    },
    async (request, reply) => {
      const query = request.query as Record<string, unknown> & {
        before?: string;
      };
      const page = parsePageRequest(query);
      const rows = await options.service.list(
        request.apiPrincipal!.id,
        page.limit,
        query.before ? new Date(query.before) : undefined,
      );
      return sendPage(
        reply,
        createPage(request, {
          data: rows.slice(0, page.limit),
          limit: page.limit,
        }),
      );
    },
  );
  app.get(
    "/notifications/unread-count",
    {
      schema: defineJsonRoute({
        summary: "Get my unread notification count",
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
        tags: ["Notifications"],
        operationId: "getMyNotification",
        permissions: ["user"],
        params: idParams,
        response: { 200: { description: "Notification", ...object } },
      }),
      preHandler: user,
    },
    async (request, reply) =>
      (await options.service.get(
        request.apiPrincipal!.id,
        (request.params as { id: string }).id,
      )) ??
      reply
        .code(404)
        .send({
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
        tags: ["Notifications"],
        operationId: "setMyNotificationReadState",
        permissions: ["user"],
        params: idParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["read"],
          properties: { read: { type: "boolean" } },
        },
        response: { 200: { description: "Updated notification", ...object } },
      }),
      preHandler: user,
    },
    async (request) =>
      options.service.setRead(
        request.apiPrincipal!.id,
        (request.params as { id: string }).id,
        (request.body as { read: boolean }).read,
      ),
  );
  app.post(
    "/notifications/read-all",
    {
      schema: defineJsonRoute({
        summary: "Mark all my notifications read",
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
        tags: ["Notifications"],
        operationId: "getMyNotificationPreferences",
        permissions: ["user"],
        response: { 200: { description: "Preferences", ...object } },
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
        tags: ["Notifications"],
        operationId: "updateMyNotificationPreferences",
        permissions: ["user"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["emailEnabled", "inAppEnabled", "pushEnabled", "topics"],
          properties: {
            emailEnabled: { type: "boolean" },
            inAppEnabled: { type: "boolean" },
            pushEnabled: { type: "boolean" },
            topics: {
              type: "object",
              additionalProperties: { type: "boolean" },
            },
          },
        },
        response: { 200: { description: "Preferences", ...object } },
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
            properties: { data: { type: "array", items: object } },
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
          "Creates durable in-app notifications for an explicit bounded audience; scheduled notifications remain hidden until a worker activates them.",
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
              minItems: 1,
              maxItems: 1000,
              uniqueItems: true,
              items: { type: "string", format: "uuid" },
            },
            title: { type: "string", minLength: 1, maxLength: 200 },
            body: { type: "string", minLength: 1, maxLength: 2000 },
            data: {
              type: "object",
              additionalProperties: { type: "string", maxLength: 1024 },
            },
            scheduledAt: { type: "string", format: "date-time" },
          },
        },
        response: {
          201: {
            description: "Created notifications",
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: { data: { type: "array", items: object } },
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
