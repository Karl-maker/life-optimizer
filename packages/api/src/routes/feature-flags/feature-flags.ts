import type { FastifyInstance, FastifyReply } from "fastify";
import {
  flagEnabled,
  type FeatureFlagManagementService,
  type FlagDefinition,
} from "@life-optimizer/feature-flags";
import { requirePermissions, type ApiAuthenticator } from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";

const key = {
  type: "string",
  pattern: "^[a-z0-9][a-z0-9_.-]{0,127}$",
  description: "Stable lowercase key.",
  examples: ["checkout.new-flow"],
} as const;
const params = {
  type: "object",
  additionalProperties: false,
  required: ["key"],
  properties: { key },
} as const;
const jsonValue = {
  description:
    "JSON configuration value: null, boolean, number, string, array, or object.",
} as const;
const condition = {
  type: "object",
  description:
    "Targeting expression. kind is attribute, all, any, not, or custom. Attribute expressions use attribute plus operator and the matching value/values/domains/blocks field. all/any use conditions; not uses condition; custom uses name and parameters. Nesting is limited to eight levels.",
  additionalProperties: true,
  required: ["kind"],
  properties: {
    kind: { enum: ["attribute", "all", "any", "not", "custom"] },
    attribute: { type: "string", maxLength: 128 },
    operator: {
      enum: [
        "equals",
        "not_equals",
        "one_of",
        "not_one_of",
        "contains",
        "email_domain",
        "cidr",
      ],
    },
    value: jsonValue,
    values: { type: "array", minItems: 1, maxItems: 100, items: jsonValue },
    domains: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string" },
    },
    includeSubdomains: { type: "boolean" },
    blocks: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string" },
    },
    conditions: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: { type: "object" },
    },
    condition: { type: "object" },
    name: key,
    parameters: { type: "object", additionalProperties: jsonValue },
  },
} as const;
const serve = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "variant"],
      properties: { kind: { const: "variant" }, variant: key },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "allocations", "salt"],
      properties: {
        kind: { const: "rollout" },
        allocations: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          description:
            "Unique variant allocations. Total basis points may not exceed 10,000; unallocated buckets fall through to later rules/default.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["variant", "basisPoints"],
            properties: {
              variant: key,
              basisPoints: { type: "integer", minimum: 1, maximum: 10000 },
            },
          },
        },
        salt: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          description:
            "Stable rollout salt. Changing it intentionally reshuffles deterministic assignments.",
        },
      },
    },
  ],
} as const;
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
    schemaVersion: {
      const: 1,
      description: "Feature flag document schema version.",
    },
    key,
    version: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Caller-managed immutable configuration revision recorded with evaluations.",
    },
    enabled: { type: "boolean", description: "Global evaluation switch." },
    offVariant: {
      ...key,
      description: "Existing variant served while disabled.",
    },
    defaultVariant: {
      ...key,
      description: "Existing variant served when no rule matches.",
    },
    variants: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      description: "Unique variant keys and their JSON configuration values.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value"],
        properties: { key, value: jsonValue },
      },
    },
    rules: {
      type: "array",
      maxItems: 100,
      description:
        "Ordered rules; the first matching rule that serves a value wins.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "when", "serve"],
        properties: {
          id: key,
          description: { type: "string", maxLength: 500 },
          when: condition,
          serve,
        },
      },
    },
  },
} as const;
const decision = {
  type: "object",
  additionalProperties: false,
  required: [
    "flagKey",
    "flagVersion",
    "targetingKey",
    "variant",
    "value",
    "reason",
    "assignmentId",
    "evaluationId",
    "enabled",
  ],
  properties: {
    flagKey: key,
    flagVersion: { type: "string" },
    targetingKey: {
      type: "string",
      description: "Authenticated subject used for deterministic assignment.",
    },
    variant: key,
    value: jsonValue,
    reason: { enum: ["disabled", "rule_match", "default"] },
    matchedRuleId: { type: "string" },
    bucket: { type: "integer", minimum: 0, maximum: 9999 },
    assignmentId: {
      type: "string",
      description: "Stable assignment fingerprint.",
    },
    evaluationId: { type: "string", format: "uuid" },
    enabled: {
      type: "boolean",
      description:
        "Convenience interpretation: boolean values are used directly; otherwise variants other than off are enabled.",
    },
  },
} as const;
const override = {
  type: "object",
  additionalProperties: false,
  required: ["flagKey", "userId", "enabled", "variantKey"],
  properties: {
    flagKey: key,
    userId: { type: "string", format: "uuid" },
    enabled: { type: "boolean" },
    variantKey: { anyOf: [key, { type: "null" }] },
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
            properties: { data: { type: "array", items: decision } },
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
        problemResponses: [404],
        params,
        response: {
          200: { description: "Effective flag decision", ...decision },
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
        problemResponses: [404],
        params,
        response: {
          200: { description: "Effective flag decision", ...decision },
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
        description:
          "Returns persisted definitions, including variants and targeting rules, for authorized administrators. These are definitions rather than user evaluations.",
        tags: ["Admin feature flags"],
        operationId: "listFeatureFlags",
        permissions: ["feature-flags:read"],
        response: {
          200: {
            description: "Definitions",
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: { data: { type: "array", items: definition } },
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
        description:
          "Returns the persisted administrative definition for the supplied key, including its version, variants, and ordered rules.",
        tags: ["Admin feature flags"],
        operationId: "getFeatureFlag",
        permissions: ["feature-flags:read"],
        params,
        problemResponses: [404],
        response: { 200: { description: "Definition", ...definition } },
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
        description:
          "Validates and creates a complete flag definition. Variant references, rollout allocations, and rule structure must be internally consistent.",
        tags: ["Admin feature flags"],
        operationId: "createFeatureFlag",
        permissions: ["feature-flags:manage"],
        body: definition,
        response: { 201: { description: "Created definition", ...definition } },
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
        description:
          "Replaces the complete flag definition. The body key must exactly match the route key and the supplied version identifies the new configuration revision.",
        tags: ["Admin feature flags"],
        operationId: "updateFeatureFlag",
        permissions: ["feature-flags:manage"],
        params,
        body: definition,
        response: { 200: { description: "Updated definition", ...definition } },
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
        description:
          "Changes only the global enabled state. A disabled flag evaluates to its off variant even when targeting rules would otherwise match.",
        tags: ["Admin feature flags"],
        operationId: "setFeatureFlagStatus",
        permissions: ["feature-flags:manage"],
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["enabled"],
          properties: {
            enabled: {
              type: "boolean",
              description: "New global enabled state.",
            },
          },
        },
        response: { 200: { description: "Updated definition", ...definition } },
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
        description:
          "Deletes the persisted definition. Clients must treat subsequent evaluations of this key as not found.",
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
            enabled: {
              type: "boolean",
              description:
                "Whether this user receives an enabled variant or the off variant.",
            },
            variantKey: {
              description:
                "Specific existing variant when enabled; null uses the flag default.",
              anyOf: [key, { type: "null" }],
            },
          },
        },
        response: { 200: { description: "Saved override", ...override } },
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
