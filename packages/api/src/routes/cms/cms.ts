import type { FastifyInstance, FastifyReply } from "fastify";
import type { EvaluationContext } from "@life-optimizer/feature-flags";
import type {
  CmsComponent,
  CmsIdentity,
  CmsOperation,
  CmsService,
  CmsTargetKind,
} from "@life-optimizer/cms";
import {
  requirePermissions,
  type ApiAuthenticator,
  type ApiPrincipal,
} from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";
import { PageRequestError } from "../../pagination.js";
import { ApiDependencyUnavailableError } from "../../availability.js";

const cmsKey = {
  type: "string",
  pattern: "^[a-z0-9][a-z0-9._/-]{0,127}$",
  maxLength: 128,
  description:
    "Stable lowercase page or screen key; slash-separated keys are allowed.",
  examples: ["home", "policies/privacy"],
} as const;
const locale = {
  type: "string",
  minLength: 2,
  maxLength: 35,
  pattern: "^[A-Za-z0-9-]+$",
  description: "BCP 47 language tag, such as en, en-TT, or es-419.",
  examples: ["en-TT"],
} as const;
const kind = {
  enum: ["page", "screen"],
  description:
    "Whether clients render the content as a browser page or application screen.",
} as const;
const routeParams = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: { kind },
} as const;
const releaseParams = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "releaseId"],
  properties: {
    kind,
    releaseId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-z0-9][a-z0-9._-]{0,127}$",
      description: "Stable lowercase release identifier.",
    },
  },
} as const;
const identityQuery = {
  type: "object",
  additionalProperties: false,
  required: ["key", "lang"],
  properties: { key: cmsKey, lang: locale },
} as const;
const readQuery = {
  type: "object",
  additionalProperties: false,
  required: ["key"],
  properties: { key: cmsKey, lang: locale },
} as const;
const jsonValue = {
  description:
    "Bounded JSON value interpreted only by allow-listed client renderers.",
} as const;
const flagPolicy = {
  description:
    "Feature policy. Supports flag, all, any, and not policies; nested policies are validated at the API boundary.",
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  maxProperties: 3,
  properties: {
    kind: { enum: ["flag", "all", "any", "not"] },
    flagKey: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-z0-9][a-z0-9_.-]{0,127}$",
    },
    variants: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 128 },
    },
    policies: { type: "array", minItems: 1, maxItems: 20, items: {} },
    policy: { type: "object" },
  },
} as const;
const component = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "parentId", "position", "props"],
  properties: {
    id: { ...cmsKey, description: "Stable component identifier." },
    type: { ...cmsKey, description: "Allow-listed client renderer key." },
    parentId: {
      anyOf: [cmsKey, { type: "null" }],
      description: "Parent component ID, or null for a root component.",
    },
    position: {
      type: "integer",
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
      description: "Stable ordering value among siblings.",
    },
    props: {
      type: "object",
      maxProperties: 200,
      additionalProperties: jsonValue,
      description: "Renderer-specific bounded JSON properties.",
      examples: [
        { text: "Welcome", styleToken: "heading.large" },
        {
          label: "Continue",
          action: { type: "navigate", target: "profile/setup" },
        },
      ],
    },
    variants: {
      type: "object",
      maxProperties: 30,
      additionalProperties: {
        type: "object",
        maxProperties: 200,
        additionalProperties: jsonValue,
      },
      description: "Optional platform or breakpoint property overrides.",
      examples: [{ mobile: { size: "full-width" } }],
    },
    gate: flagPolicy,
  },
} as const;
const fields = {
  type: "object",
  maxProperties: 200,
  additionalProperties: jsonValue,
  description:
    "Document-level bounded JSON map. Swagger's additionalProp1 label is a placeholder; replace it with a meaningful field name such as analyticsName or campaign.",
  examples: [{ analyticsName: "onboarding_welcome", campaign: "november" }],
} as const;
const documentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "identity",
    "revision",
    "createdAt",
    "updatedAt",
    "deleted",
    "fields",
    "components",
  ],
  properties: {
    schemaVersion: { const: 1 },
    identity: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "key", "locale"],
      properties: { kind, key: cmsKey, locale },
    },
    revision: { type: "string", minLength: 64, maxLength: 64 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    deleted: { type: "boolean" },
    fields,
    components: { type: "array", maxItems: 500, items: component },
  },
} as const;
const publicationSchema = {
  ...documentSchema,
  required: [
    "schemaVersion",
    "identity",
    "revision",
    "createdAt",
    "updatedAt",
    "fields",
    "components",
    "releaseId",
    "publishAt",
    "publishedAt",
  ],
  properties: {
    schemaVersion: documentSchema.properties.schemaVersion,
    identity: documentSchema.properties.identity,
    revision: documentSchema.properties.revision,
    createdAt: documentSchema.properties.createdAt,
    updatedAt: documentSchema.properties.updatedAt,
    fields: documentSchema.properties.fields,
    components: documentSchema.properties.components,
    releaseId: { type: "string", minLength: 1, maxLength: 128 },
    publishAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    publishedAt: { type: "string", format: "date-time" },
    cacheUntil: { type: "string", format: "date-time" },
  },
} as const;

export interface CmsRoutesOptions {
  service?: CmsService;
  authenticator: ApiAuthenticator;
  /** Ordered locale fallbacks used after the requested locale and its base language. */
  defaultLocales?: readonly string[];
  /** Resolves trusted server-side audience data; request query/body values must never be forwarded. */
  resolveFlagAttributes?: (input: {
    principal: ApiPrincipal;
    requestId: string;
  }) => Promise<EvaluationContext["attributes"]>;
}

export function registerCmsRoutes(
  app: FastifyInstance,
  options: CmsRoutesOptions,
): void {
  const service =
    options.service ??
    (new Proxy(
      {},
      {
        get: () => () => {
          throw new ApiDependencyUnavailableError("CMS storage");
        },
      },
    ) as CmsService);
  const defaults = normalizeLocales(options.defaultLocales ?? ["en"]);
  const userAuth = requirePermissions(options.authenticator, ["user"]);
  const readAuth = requirePermissions(options.authenticator, ["cms:read"]);
  const writeAuth = requirePermissions(options.authenticator, ["cms:write"]);
  const publishAuth = requirePermissions(options.authenticator, [
    "cms:publish",
  ]);
  const deleteAuth = requirePermissions(options.authenticator, ["cms:delete"]);

  app.get(
    "/cms/documents/:kind",
    {
      schema: defineJsonRoute({
        summary: "Get published CMS content",
        description:
          "Resolves the active publication for the requested language, then its base language and configured defaults. Feature-gated components use each flag's configured default for the authenticated user.",
        tags: ["CMS"],
        operationId: "getCmsContent",
        permissions: ["user"],
        params: routeParams,
        querystring: readQuery,
        problemResponses: [404, 503],
        response: {
          200: {
            description:
              "Resolved localized and feature-filtered CMS publication",
            ...publicationSchema,
            headers: {
              etag: {
                type: "string",
                description:
                  "Validator derived from the immutable release and draft revision.",
              },
            },
          },
        },
      }),
      preHandler: userAuth,
    },
    async (request, reply) => {
      const params = request.params as { kind: CmsTargetKind };
      const query = request.query as { key: string; lang?: string };
      const principal = request.apiPrincipal!;
      const attributes = options.resolveFlagAttributes
        ? await options.resolveFlagAttributes({
            principal,
            requestId: request.id,
          })
        : {};
      const result = await service.resolve({
        kind: params.kind,
        key: query.key,
        locales: localeFallbacks(query.lang, defaults),
        evaluationContext: {
          targetingKey: principal.id,
          attributes,
          correlationId: request.id,
        },
      });
      if (!result) return notFound(reply, request.id);
      reply.header("etag", `\"${result.releaseId}:${result.revision}\"`);
      // The response may vary per user because feature flags can filter components.
      reply.header("cache-control", "private, no-store");
      return result;
    },
  );

  app.get(
    "/admin/cms/documents/:kind",
    {
      schema: defineJsonRoute({
        summary: "Get a CMS draft",
        description:
          "Returns the current auditable draft for one exact kind, key, and language without applying publication scheduling or feature filters.",
        tags: ["Admin CMS"],
        operationId: "getCmsDraft",
        permissions: ["cms:read"],
        params: routeParams,
        querystring: identityQuery,
        problemResponses: [404, 503],
        response: {
          200: { description: "Current CMS draft", ...documentSchema },
        },
      }),
      preHandler: readAuth,
    },
    async (request, reply) =>
      (await service.getDraft(identity(request))) ??
      notFound(reply, request.id),
  );

  app.post(
    "/admin/cms/documents",
    {
      schema: defineJsonRoute({
        summary: "Create a CMS draft",
        description:
          "Creates one localized page or screen draft. Publishing remains an explicit, separately authorized action.",
        tags: ["Admin CMS"],
        operationId: "createCmsDraft",
        permissions: ["cms:write"],
        problemResponses: [409, 422, 503],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "key", "lang"],
          properties: {
            kind,
            key: cmsKey,
            lang: locale,
            fields: {
              ...fields,
              description: "Initial document-level JSON fields.",
            },
            components: {
              type: "array",
              maxItems: 500,
              items: component,
              description: "Initial bounded component tree.",
            },
          },
        },
        response: {
          201: { description: "Created CMS draft", ...documentSchema },
        },
      }),
      preHandler: writeAuth,
    },
    async (request, reply) => {
      const body = request.body as {
        kind: CmsTargetKind;
        key: string;
        lang: string;
        fields?: Record<string, never>;
        components?: readonly CmsComponent[];
      };
      assertComponentGates(body.components ?? []);
      if (
        await service.getDraft({
          kind: body.kind,
          key: body.key,
          locale: body.lang,
        })
      )
        throw new CmsRouteError(409, "CMS document already exists.");
      const created = await service.create({
        identity: { kind: body.kind, key: body.key, locale: body.lang },
        context: context(request.apiPrincipal!.id, request.id),
        ...(body.fields === undefined ? {} : { fields: body.fields }),
        ...(body.components === undefined
          ? {}
          : { components: body.components }),
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    "/admin/cms/documents/:kind",
    {
      schema: defineJsonRoute({
        summary: "Edit a CMS draft",
        description:
          "Appends a bounded, actor-attributed operation batch to an existing localized draft.",
        tags: ["Admin CMS"],
        operationId: "editCmsDraft",
        permissions: ["cms:write"],
        params: routeParams,
        querystring: identityQuery,
        problemResponses: [404, 422, 503],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["operations"],
          properties: {
            operations: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              description:
                "Ordered CMS field, component, delete, or restore operations.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind"],
                maxProperties: 3,
                properties: {
                  kind: {
                    enum: [
                      "set-field",
                      "remove-field",
                      "upsert-component",
                      "remove-component",
                    ],
                  },
                  field: { type: "string", minLength: 1, maxLength: 128 },
                  value: jsonValue,
                  component,
                  componentId: cmsKey,
                },
              },
            },
          },
        },
        response: {
          200: { description: "Updated CMS draft", ...documentSchema },
        },
      }),
      preHandler: writeAuth,
    },
    async (request) => {
      const cmsIdentity = identity(request);
      await requireDraft(service, cmsIdentity);
      const operations = (
        request.body as { operations: readonly CmsOperation[] }
      ).operations;
      assertComponentGates(
        operations.flatMap((operation) =>
          operation.kind === "upsert-component" ? [operation.component] : [],
        ),
      );
      return service.edit({
        identity: cmsIdentity,
        context: context(request.apiPrincipal!.id, request.id),
        operations,
      });
    },
  );

  app.delete(
    "/admin/cms/documents/:kind/releases/:releaseId",
    {
      schema: defineJsonRoute({
        summary: "Unpublish a CMS release",
        description:
          "Removes one published projection without deleting its auditable draft or any other scheduled release.",
        tags: ["Admin CMS"],
        operationId: "unpublishCmsRelease",
        permissions: ["cms:publish"],
        problemResponses: [503],
        params: releaseParams,
        querystring: identityQuery,
        response: {
          204: { description: "CMS release unpublished", type: "null" },
        },
      }),
      preHandler: publishAuth,
    },
    async (request, reply) => {
      const params = request.params as {
        kind: CmsTargetKind;
        releaseId: string;
      };
      await service.unpublish(identity(request), params.releaseId);
      return reply.code(204).send();
    },
  );

  app.post(
    "/admin/cms/documents/:kind/releases",
    {
      schema: defineJsonRoute({
        summary: "Publish a CMS draft",
        description:
          "Materializes the current draft as an independently scheduled release; omitted dates publish immediately without expiry.",
        tags: ["Admin CMS"],
        operationId: "publishCmsDraft",
        permissions: ["cms:publish"],
        params: routeParams,
        querystring: identityQuery,
        problemResponses: [404, 422, 503],
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            releaseId: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              pattern: "^[a-z0-9][a-z0-9._-]{0,127}$",
              description: "Optional stable lowercase release identifier.",
            },
            publishAt: {
              type: "string",
              format: "date-time",
              description:
                "Optional instant when this release becomes eligible.",
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              description:
                "Optional exclusive instant when this release stops being eligible.",
            },
          },
        },
        response: {
          201: { description: "Published CMS release", ...publicationSchema },
        },
      }),
      preHandler: publishAuth,
    },
    async (request, reply) => {
      const body = request.body as {
        releaseId?: string;
        publishAt?: string;
        expiresAt?: string;
      };
      const cmsIdentity = identity(request);
      await requireDraft(service, cmsIdentity);
      const published = await service.publish({
        identity: cmsIdentity,
        ...(body.releaseId === undefined ? {} : { releaseId: body.releaseId }),
        ...(body.publishAt === undefined
          ? {}
          : { publishAt: new Date(body.publishAt) }),
        ...(body.expiresAt === undefined
          ? {}
          : { expiresAt: new Date(body.expiresAt) }),
      });
      return reply.code(201).send(published);
    },
  );

  app.delete(
    "/admin/cms/documents/:kind",
    {
      schema: defineJsonRoute({
        summary: "Delete a CMS draft",
        description:
          "Appends a tombstone to the draft audit history. Existing releases remain until explicitly unpublished.",
        tags: ["Admin CMS"],
        operationId: "deleteCmsDraft",
        permissions: ["cms:delete"],
        params: routeParams,
        querystring: identityQuery,
        problemResponses: [404, 503],
        response: {
          200: { description: "Deleted CMS draft", ...documentSchema },
        },
      }),
      preHandler: deleteAuth,
    },
    async (request) => {
      const cmsIdentity = identity(request);
      await requireDraft(service, cmsIdentity);
      return service.delete(
        cmsIdentity,
        context(request.apiPrincipal!.id, request.id),
      );
    },
  );

  app.post(
    "/admin/cms/documents/:kind/restore",
    {
      schema: defineJsonRoute({
        summary: "Restore a CMS draft",
        description:
          "Appends an attributed restore operation to a tombstoned localized draft.",
        tags: ["Admin CMS"],
        operationId: "restoreCmsDraft",
        permissions: ["cms:delete"],
        params: routeParams,
        querystring: identityQuery,
        problemResponses: [404, 503],
        response: {
          200: { description: "Restored CMS draft", ...documentSchema },
        },
      }),
      preHandler: deleteAuth,
    },
    async (request) => {
      const cmsIdentity = identity(request);
      await requireDraft(service, cmsIdentity);
      return service.restore(
        cmsIdentity,
        context(request.apiPrincipal!.id, request.id),
      );
    },
  );
}

function identity(request: { params: unknown; query: unknown }): CmsIdentity {
  const params = request.params as { kind: CmsTargetKind };
  const query = request.query as { key: string; lang: string };
  return { kind: params.kind, key: query.key, locale: query.lang };
}

function context(actorId: string, correlationId: string) {
  return { actorId, correlationId };
}

function normalizeLocales(values: readonly string[]): string[] {
  if (values.length === 0 || values.length > 10)
    throw new Error(
      "CMS defaultLocales must contain between 1 and 10 locales.",
    );
  try {
    return [
      ...new Set(values.flatMap((value) => Intl.getCanonicalLocales(value))),
    ];
  } catch {
    throw new Error(
      "CMS defaultLocales must contain valid BCP 47 language tags.",
    );
  }
}

function localeFallbacks(
  requested: string | undefined,
  defaults: readonly string[],
) {
  let requestedLocales: string[] = [];
  if (requested !== undefined) {
    try {
      requestedLocales = Intl.getCanonicalLocales(requested);
    } catch {
      throw new PageRequestError("lang must be a valid BCP 47 language tag.");
    }
  }
  const base = requestedLocales[0]?.split("-")[0];
  return [
    ...new Set([
      ...requestedLocales,
      ...(base === undefined ? [] : [base]),
      ...defaults,
    ]),
  ];
}

function notFound(reply: FastifyReply, requestId: string) {
  return reply.code(404).send({
    type: "/problems/not-found",
    title: "CMS content not found",
    status: 404,
    code: "NOT_FOUND",
    requestId,
  });
}

class CmsRouteError extends Error {
  constructor(
    readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "CmsRouteError";
  }
}

async function requireDraft(service: CmsService, cmsIdentity: CmsIdentity) {
  const draft = await service.getDraft(cmsIdentity);
  if (!draft) throw new CmsRouteError(404, "CMS content not found.");
  return draft;
}

function assertComponentGates(components: readonly CmsComponent[]) {
  for (const component of components)
    if (component.gate !== undefined) assertGate(component.gate, 0);
}

function assertGate(value: unknown, depth: number): void {
  if (
    depth > 8 ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("kind" in value)
  )
    throw new PageRequestError("CMS feature policy is invalid.");
  const policy = value as Record<string, unknown>;
  if (policy.kind === "flag") {
    assertExactKeys(policy, ["kind", "flagKey", "variants"]);
    if (
      typeof policy.flagKey !== "string" ||
      !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(policy.flagKey) ||
      !Array.isArray(policy.variants) ||
      policy.variants.length < 1 ||
      policy.variants.length > 100 ||
      policy.variants.some(
        (variant) =>
          typeof variant !== "string" ||
          !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(variant),
      )
    )
      throw new PageRequestError("CMS flag policy is invalid.");
    return;
  }
  if (policy.kind === "all" || policy.kind === "any") {
    assertExactKeys(policy, ["kind", "policies"]);
    if (
      !Array.isArray(policy.policies) ||
      policy.policies.length < 1 ||
      policy.policies.length > 20
    )
      throw new PageRequestError("CMS combined flag policy is invalid.");
    for (const child of policy.policies) assertGate(child, depth + 1);
    return;
  }
  if (policy.kind === "not") {
    assertExactKeys(policy, ["kind", "policy"]);
    assertGate(policy.policy, depth + 1);
    return;
  }
  throw new PageRequestError("CMS feature policy kind is invalid.");
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
) {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new PageRequestError("CMS feature policy has unexpected fields.");
}
