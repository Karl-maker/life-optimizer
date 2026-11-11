import type { FastifyInstance, FastifyReply } from "fastify";
import {
  flagEnabled,
  type FeatureFlagManagementService,
  type FlagDefinition,
} from "@edu-service/feature-flags";
import { requirePermissions, type ApiAuthenticator } from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";

const key = { type: "string", pattern: "^[a-z][a-z0-9_.-]{1,127}$" } as const;
const params = {
  type: "object",
  additionalProperties: false,
  required: ["key"],
  properties: { key },
} as const;
const object = { type: "object", additionalProperties: true } as const;
const definition = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "key",
    "version",
    "enabled",
    "offVariant",
    "defaultVariant",
    "variants",
    "rules",
  ],
  properties: {
    schemaVersion: { const: 1 },
    key,
    version: { type: "string", minLength: 1, maxLength: 128 },
    enabled: { type: "boolean" },
    offVariant: key,
    defaultVariant: key,
    variants: { type: "array", minItems: 1, maxItems: 100, items: object },
    rules: { type: "array", maxItems: 100, items: object },
  },
} as const;

export function registerFeatureFlagRoutes(
  app: FastifyInstance,
  options: {
    service: FeatureFlagManagementService;
    authenticator: ApiAuthenticator;
  },
): void {
  const userAuth = requirePermissions(options.authenticator, ["user"]);
  const readAuth = requirePermissions(options.authenticator, [
    "feature-flags:read",
  ]);
  const manageAuth = requirePermissions(options.authenticator, [
    "feature-flags:manage",
  ]);

  app.get(
    "/feature-flags",
    {
      schema: defineJsonRoute({
        summary: "List my effective feature flags",
        description:
          "Evaluates every flag for the authenticated user. User overrides take precedence, followed by disabled status, first matching targeting rule, rollout, and the default variant.",
        tags: ["Feature flags"],
        operationId: "listMyFeatureFlags",
        permissions: ["user"],
        response: {
          200: {
            description: "Effective flags",
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: { data: { type: "array", items: object } },
          },
        },
      }),
      preHandler: userAuth,
    },
    async (request) => ({
      data: (
        await options.service.evaluateAll({
          targetingKey: request.apiPrincipal!.id,
          attributes: {},
          correlationId: request.id,
        })
      ).map(view),
    }),
  );

  app.get(
    "/feature-flags/:key",
    {
      schema: defineJsonRoute({
        summary: "Get a feature flag value for me",
        description:
          "Returns the effective variant and typed configuration value for the authenticated user. The subject cannot be supplied by the client.",
        tags: ["Feature flags"],
        operationId: "getMyFeatureFlag",
        permissions: ["user"],
        params,
        response: {
          200: { description: "Effective flag decision", ...object },
        },
      }),
      preHandler: userAuth,
    },
    async (request, reply) => {
      const flagKey = (request.params as { key: string }).key;
      if (!(await options.service.get(flagKey)))
        return featureFlagNotFound(reply, request.id);
      return view(
        await options.service.evaluate(flagKey, {
          targetingKey: request.apiPrincipal!.id,
          attributes: {},
          correlationId: request.id,
        }),
      );
    },
  );

  app.get(
    "/feature-flags/:key/check",
    {
      schema: defineJsonRoute({
        summary: "Check a feature flag for me",
        description:
          "Returns the effective variant, JSON value, evaluation reason, and a convenience enabled boolean for the authenticated user.",
        tags: ["Feature flags"],
        operationId: "checkMyFeatureFlag",
        permissions: ["user"],
        params,
        response: {
          200: { description: "Effective flag decision", ...object },
        },
      }),
      preHandler: userAuth,
    },
    async (request, reply) => {
      const flagKey = (request.params as { key: string }).key;
      if (!(await options.service.get(flagKey)))
        return featureFlagNotFound(reply, request.id);
      return view(
        await options.service.evaluate(flagKey, {
          targetingKey: request.apiPrincipal!.id,
          attributes: {},
          correlationId: request.id,
        }),
      );
    },
  );

  app.get(
    "/admin/feature-flags",
    {
      schema: defineJsonRoute({
        summary: "List feature flag definitions",
        tags: ["Admin feature flags"],
        operationId: "listFeatureFlags",
        permissions: ["feature-flags:read"],
        response: {
          200: {
            description: "Definitions",
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: { data: { type: "array", items: object } },
          },
        },
      }),
      preHandler: readAuth,
    },
    async () => ({ data: await options.service.list() }),
  );

  app.get(
    "/admin/feature-flags/:key",
    {
      schema: defineJsonRoute({
        summary: "Get a feature flag definition",
        tags: ["Admin feature flags"],
        operationId: "getFeatureFlag",
        permissions: ["feature-flags:read"],
        params,
        response: { 200: { description: "Definition", ...object } },
      }),
      preHandler: readAuth,
    },
    async (request, reply) =>
      (await options.service.get((request.params as { key: string }).key)) ??
      reply.code(404).send({
        type: "/problems/not-found",
        title: "Feature flag not found",
        status: 404,
        code: "NOT_FOUND",
        requestId: request.id,
      }),
  );

  app.post(
    "/admin/feature-flags",
    {
      schema: defineJsonRoute({
        summary: "Create a feature flag",
        tags: ["Admin feature flags"],
        operationId: "createFeatureFlag",
        permissions: ["feature-flags:manage"],
        body: definition,
        response: { 201: { description: "Created definition", ...object } },
      }),
      preHandler: manageAuth,
    },
    async (request, reply) =>
      reply.code(201).send(
        await options.service.save({
          flag: request.body as FlagDefinition,
          actorId: request.apiPrincipal!.id,
          correlationId: request.id,
        }),
      ),
  );

  app.put(
    "/admin/feature-flags/:key",
    {
      schema: defineJsonRoute({
        summary: "Replace a feature flag",
        tags: ["Admin feature flags"],
        operationId: "updateFeatureFlag",
        permissions: ["feature-flags:manage"],
        params,
        body: definition,
        response: { 200: { description: "Updated definition", ...object } },
      }),
      preHandler: manageAuth,
    },
    async (request) => {
      const routeKey = (request.params as { key: string }).key;
      const flag = request.body as FlagDefinition;
      if (flag.key !== routeKey)
        throw new Error("Feature flag body key must match the route key.");
      return options.service.save({
        flag,
        actorId: request.apiPrincipal!.id,
        correlationId: request.id,
      });
    },
  );

  app.patch(
    "/admin/feature-flags/:key/status",
    {
      schema: defineJsonRoute({
        summary: "Enable or disable a feature flag",
        tags: ["Admin feature flags"],
        operationId: "setFeatureFlagStatus",
        permissions: ["feature-flags:manage"],
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["enabled"],
          properties: { enabled: { type: "boolean" } },
        },
        response: { 200: { description: "Updated definition", ...object } },
      }),
      preHandler: manageAuth,
    },
    async (request) => {
      const routeKey = (request.params as { key: string }).key;
      const current = await options.service.get(routeKey);
      if (!current) throw new Error("Unknown feature flag.");
      return options.service.save({
        flag: {
          ...current,
          enabled: (request.body as { enabled: boolean }).enabled,
        },
        actorId: request.apiPrincipal!.id,
        correlationId: request.id,
      });
    },
  );

  app.delete(
    "/admin/feature-flags/:key",
    {
      schema: defineJsonRoute({
        summary: "Delete a feature flag",
        tags: ["Admin feature flags"],
        operationId: "deleteFeatureFlag",
        permissions: ["feature-flags:manage"],
        params,
        response: { 204: { description: "Deleted", type: "null" } },
      }),
      preHandler: manageAuth,
    },
    async (request, reply) => {
      await options.service.remove({
        key: (request.params as { key: string }).key,
        actorId: request.apiPrincipal!.id,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.put(
    "/admin/feature-flags/:key/users/:userId",
    {
      schema: defineJsonRoute({
        summary: "Set a user's feature flag override",
        description:
          "An explicit disabled override serves the off variant. An enabled override serves its selected variant or the flag default.",
        tags: ["Admin feature flags"],
        operationId: "setFeatureFlagUserOverride",
        permissions: ["feature-flags:manage"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["key", "userId"],
          properties: { key, userId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["enabled"],
          properties: {
            enabled: { type: "boolean" },
            variantKey: { anyOf: [key, { type: "null" }] },
          },
        },
        response: { 200: { description: "Saved override", ...object } },
      }),
      preHandler: manageAuth,
    },
    async (request) => {
      const p = request.params as { key: string; userId: string };
      const body = request.body as {
        enabled: boolean;
        variantKey?: string | null;
      };
      return options.service.setOverride({
        flagKey: p.key,
        userId: p.userId,
        enabled: body.enabled,
        variantKey: body.variantKey ?? null,
        actorId: request.apiPrincipal!.id,
        correlationId: request.id,
      });
    },
  );

  app.delete(
    "/admin/feature-flags/:key/users/:userId",
    {
      schema: defineJsonRoute({
        summary: "Remove a user's feature flag override",
        description:
          "Returns the user to normal global and targeting-rule evaluation for this flag.",
        tags: ["Admin feature flags"],
        operationId: "deleteFeatureFlagUserOverride",
        permissions: ["feature-flags:manage"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["key", "userId"],
          properties: { key, userId: { type: "string", format: "uuid" } },
        },
        response: { 204: { description: "Override removed", type: "null" } },
      }),
      preHandler: manageAuth,
    },
    async (request, reply) => {
      const p = request.params as { key: string; userId: string };
      await options.service.removeOverride({
        key: p.key,
        userId: p.userId,
        actorId: request.apiPrincipal!.id,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );
}

function view(
  decision: Awaited<ReturnType<FeatureFlagManagementService["evaluate"]>>,
) {
  return { ...decision, enabled: flagEnabled(decision) };
}

function featureFlagNotFound(reply: FastifyReply, requestId: string) {
  return reply.code(404).send({
    type: "/problems/not-found",
    title: "Feature flag not found",
    status: 404,
    code: "NOT_FOUND",
    requestId,
  });
}
