import type { FastifyInstance } from "fastify";
import type { Actor, AuditContext } from "@life-optimizer/core";
import {
  createPatronService,
  type PatronConfiguration,
  type PatronTier,
  type PatronUserProfile,
} from "@life-optimizer/patron";
import {
  requirePermissions,
  type ApiAuthenticator,
  type ApiPrincipal,
} from "../../auth.js";
import { createPage, parsePageRequest, sendPage } from "../../pagination.js";
import { defineJsonRoute } from "../../contracts.js";

type PatronService = ReturnType<typeof createPatronService>;
const credits = {
  type: "string",
  pattern: "^-?[0-9]+$",
  description: "Decimal integer Patron credits; not a monetary amount.",
} as const;
const positiveCredits = {
  type: "string",
  pattern: "^[1-9][0-9]{0,18}$",
  description:
    "Positive Patron credits as a decimal integer string, bounded to signed 64-bit storage.",
} as const;
const tierPercentages = {
  type: "object",
  additionalProperties: false,
  required: ["T0", "T1", "T2", "T3"],
  description: "Exact shares for all Patron tiers; values must total 1.",
  properties: {
    T0: { type: "number", minimum: 0, maximum: 1 },
    T1: { type: "number", minimum: 0, maximum: 1 },
    T2: { type: "number", minimum: 0, maximum: 1 },
    T3: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;
const tierCredits = {
  type: "object",
  additionalProperties: false,
  required: ["T0", "T1", "T2", "T3"],
  description: "Positive monthly credit allowance for each Patron tier.",
  properties: {
    T0: positiveCredits,
    T1: positiveCredits,
    T2: positiveCredits,
    T3: positiveCredits,
  },
} as const;
const tierBand = {
  type: "object",
  additionalProperties: false,
  required: ["min", "max"],
  properties: {
    min: { type: "integer", minimum: 0, maximum: 1000 },
    max: { type: "integer", minimum: 0, maximum: 1000 },
  },
} as const;
const taskClass = {
  type: "object",
  additionalProperties: false,
  required: [
    "qualitySensitivity",
    "estimatedCredits",
    "maxInputTokens",
    "maxOutputTokens",
  ],
  properties: {
    qualitySensitivity: {
      enum: ["low", "medium", "high"],
      description:
        "How strongly answer quality should resist budget degradation.",
    },
    estimatedCredits: positiveCredits,
    maxInputTokens: {
      type: "integer",
      minimum: 1,
      maximum: 10_000_000,
      description: "Maximum input tokens allowed for this task class.",
    },
    maxOutputTokens: {
      type: "integer",
      minimum: 1,
      maximum: 1_000_000,
      description: "Maximum output tokens allowed for this task class.",
    },
  },
} as const;
const patronConfigurationInput = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "creditMicrousd",
    "flatMode",
    "budget",
    "scoring",
    "monthlyAllowances",
    "taskClasses",
    "planFloors",
  ],
  properties: {
    version: {
      type: "integer",
      minimum: 1,
      maximum: 2_147_483_647,
      description:
        "Caller-managed configuration revision; increment after each change.",
    },
    creditMicrousd: {
      type: "integer",
      minimum: 1,
      maximum: 1_000_000_000,
      description: "Micro-USD represented by one Patron credit.",
    },
    flatMode: {
      type: "boolean",
      description:
        "Emergency switch that serves Standard treatment for every tier.",
    },
    budget: {
      type: "object",
      additionalProperties: false,
      required: [
        "period",
        "ceilingCredits",
        "safetyBufferBps",
        "promoReserveBps",
        "poolShares",
      ],
      description: "Global Patron budget and tier-pool allocation.",
      properties: {
        period: {
          const: "monthly",
          description: "Budget accounting period; currently monthly only.",
        },
        ceilingCredits: positiveCredits,
        safetyBufferBps: {
          type: "integer",
          minimum: 0,
          maximum: 5000,
          description: "Unallocated safety buffer in basis points.",
        },
        promoReserveBps: {
          type: "integer",
          minimum: 0,
          maximum: 5000,
          description: "Promotional reserve in basis points.",
        },
        poolShares: tierPercentages,
      },
    },
    scoring: {
      type: "object",
      additionalProperties: false,
      required: ["weights", "halfLifeDays", "tierBands", "demotionGraceDays"],
      description: "Value-scoring weights, decay, and tier boundaries.",
      properties: {
        weights: {
          type: "object",
          additionalProperties: false,
          required: [
            "revenue",
            "reliability",
            "costEfficiency",
            "advocacy",
            "participation",
            "engagement",
            "tenure",
          ],
          description: "Scoring component shares; values must total 1.",
          properties: Object.fromEntries(
            [
              "revenue",
              "reliability",
              "costEfficiency",
              "advocacy",
              "participation",
              "engagement",
              "tenure",
            ].map((name) => [name, { type: "number", minimum: 0, maximum: 1 }]),
          ),
        },
        halfLifeDays: {
          type: "integer",
          minimum: 1,
          maximum: 3650,
          description:
            "Days over which historical value signals decay by half.",
        },
        tierBands: {
          type: "object",
          additionalProperties: false,
          required: ["T0", "T1", "T2", "T3"],
          description: "Inclusive value-score range assigned to each tier.",
          properties: {
            T0: tierBand,
            T1: tierBand,
            T2: tierBand,
            T3: tierBand,
          },
        },
        demotionGraceDays: {
          type: "integer",
          minimum: 0,
          maximum: 3650,
          description:
            "Grace period before a lower calculated tier is applied.",
        },
      },
    },
    monthlyAllowances: tierCredits,
    taskClasses: {
      type: "object",
      minProperties: 1,
      maxProperties: 100,
      propertyNames: { pattern: "^[a-z][a-z0-9_.-]{1,95}$" },
      additionalProperties: taskClass,
      description:
        "Map from your stable task-class name to its limits. Swagger's additionalProp1 label is only a placeholder key: replace it with a real name such as final_answer or summary.",
      examples: [
        {
          final_answer: {
            qualitySensitivity: "high",
            estimatedCredits: "8",
            maxInputTokens: 16000,
            maxOutputTokens: 2000,
          },
        },
      ],
    },
    planFloors: {
      type: "object",
      maxProperties: 100,
      propertyNames: { pattern: "^[a-z][a-z0-9_.-]{1,95}$" },
      additionalProperties: { enum: ["T0", "T1", "T2", "T3"] },
      description:
        "Map from your stable plan key to its minimum tier. Swagger's additionalProp1 label is a placeholder; replace it with a real plan name. Use an empty object when no plan floors apply.",
      examples: [{ free: "T0", pro: "T2" }],
    },
  },
} as const;
const patronConfigurationSchema = {
  ...patronConfigurationInput,
  required: [...patronConfigurationInput.required, "key", "updatedAt"],
  properties: {
    key: { const: "default", description: "Active Patron configuration key." },
    ...patronConfigurationInput.properties,
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const profileSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "userId",
    "valueScore",
    "potentialScore",
    "tier",
    "provisional",
    "periodStart",
    "periodEnd",
    "allowanceRemainingCredits",
    "updatedAt",
  ],
  properties: {
    userId: { type: "string", format: "uuid" },
    valueScore: { type: "integer", minimum: 0, maximum: 1000 },
    potentialScore: { type: "integer", minimum: 0, maximum: 100 },
    tier: { enum: ["T0", "T1", "T2", "T3"] },
    provisional: { type: "boolean" },
    periodStart: { type: "string", format: "date-time" },
    periodEnd: { type: "string", format: "date-time" },
    allowanceRemainingCredits: credits,
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const creditEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "userId",
    "amountCredits",
    "kind",
    "situationKey",
    "description",
    "idempotencyKey",
    "occurredAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    userId: { type: "string", format: "uuid" },
    amountCredits: credits,
    kind: { enum: ["grant", "spend", "adjustment"] },
    situationKey: { anyOf: [{ type: "string" }, { type: "null" }] },
    description: { type: "string" },
    idempotencyKey: { type: "string" },
    occurredAt: { type: "string", format: "date-time" },
  },
} as const;
const explanationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["profile", "creditBalance", "recentCredits"],
  properties: {
    profile: profileSchema,
    creditBalance: credits,
    recentCredits: { type: "array", items: creditEntrySchema },
  },
} as const;
const userParams = {
  type: "object",
  additionalProperties: false,
  required: ["userId"],
  properties: { userId: { type: "string", format: "uuid" } },
} as const;

export function registerPatronRoutes(
  app: FastifyInstance,
  options: { service: PatronService; authenticator: ApiAuthenticator },
): void {
  const user = requirePermissions(options.authenticator, ["user"]);
  const admin = requirePermissions(options.authenticator, ["financial:manage"]);
  app.get(
    "/me/patron",
    {
      schema: defineJsonRoute({
        summary: "Get my Patron profile and credit history",
        description:
          "Returns the authenticated user's Patron tier explanation, current allowance, and bounded credit history. Monetary values are not represented as Patron credits.",
        tags: ["Patron"],
        operationId: "getMyPatron",
        permissions: ["user"],
        response: {
          200: { description: "Patron explanation", ...explanationSchema },
        },
      }),
      preHandler: user,
    },
    async (request) =>
      json(await options.service.explain(request.apiPrincipal!.id)),
  );
  app.get(
    "/admin/patrons/configuration",
    {
      schema: defineJsonRoute({
        summary: "Get the Patron configuration",
        description:
          "Returns the stored default Patron budget, scoring, allowance, task-class, and plan-floor configuration. Before the first save, this returns the safe built-in defaults.",
        tags: ["Admin patrons"],
        operationId: "getPatronConfiguration",
        permissions: ["financial:manage"],
        response: {
          200: {
            description: "Effective Patron configuration",
            ...patronConfigurationSchema,
          },
        },
      }),
      preHandler: admin,
    },
    async () => json(await options.service.configuration()),
  );
  app.put(
    "/admin/patrons/configuration",
    {
      schema: defineJsonRoute({
        summary: "Replace the Patron configuration",
        description:
          "Validates and replaces the complete default Patron configuration. Percentage maps must total 1, credit values use decimal strings, and version should be incremented for each administrative change.",
        tags: ["Admin patrons"],
        operationId: "updatePatronConfiguration",
        permissions: ["financial:manage"],
        problemResponses: [422],
        body: patronConfigurationInput,
        response: {
          200: {
            description: "Saved Patron configuration",
            ...patronConfigurationSchema,
          },
        },
      }),
      preHandler: admin,
    },
    async (request) => {
      const body = request.body as SerializedPatronConfiguration;
      return json(
        await options.service.configure({
          actor: agent(request.apiPrincipal!, request.apiPrincipal!.id),
          audit: audit(request.id),
          config: deserializeConfiguration(body),
        }),
      );
    },
  );
  app.get(
    "/admin/patrons",
    {
      schema: defineJsonRoute({
        summary: "List and search Patron profiles",
        description:
          "Returns a cursor-paginated administrative list. Optional tier and text filters are applied before the stable user-ID cursor.",
        tags: ["Admin patrons"],
        operationId: "listPatrons",
        permissions: ["financial:manage"],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "string", pattern: "^[0-9]{1,3}$" },
            cursor: { type: "string", format: "uuid" },
            tier: { enum: ["T0", "T1", "T2", "T3"] },
            search: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
        response: {
          200: {
            description: "Patron page",
            type: "object",
            additionalProperties: false,
            required: ["data", "pagination", "links"],
            properties: {
              data: { type: "array", items: profileSchema },
              pagination: {
                type: "object",
                additionalProperties: false,
                required: ["limit"],
                properties: {
                  limit: { type: "integer", minimum: 1, maximum: 100 },
                  nextCursor: { type: "string", format: "uuid" },
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
      preHandler: admin,
    },
    async (request, reply) => {
      const query = request.query as Record<string, unknown> & {
        cursor?: string;
        tier?: PatronTier;
        search?: string;
      };
      const page = parsePageRequest(query);
      const rows = await options.service.listProfiles({
        limit: page.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.tier ? { tier: query.tier } : {}),
        ...(query.search ? { search: query.search } : {}),
      });
      return sendPage(
        reply,
        createPage(request, {
          data: rows.slice(0, page.limit).map(json),
          limit: page.limit,
          ...(rows.length > page.limit
            ? { nextCursor: rows[page.limit - 1]!.userId }
            : {}),
        }),
      );
    },
  );
  app.get(
    "/admin/patrons/:userId",
    {
      schema: defineJsonRoute({
        summary: "Get Patron details and associated credits",
        description:
          "Returns one user's Patron profile, tier explanation, current allowance, and credit ledger details.",
        tags: ["Admin patrons"],
        operationId: "getPatron",
        permissions: ["financial:manage"],
        params: userParams,
        response: {
          200: { description: "Patron details", ...explanationSchema },
        },
      }),
      preHandler: admin,
    },
    async (request) =>
      json(
        await options.service.explain(
          (request.params as { userId: string }).userId,
        ),
      ),
  );
  app.put(
    "/admin/patrons/:userId",
    {
      schema: defineJsonRoute({
        summary: "Create or update a Patron profile",
        description:
          "Upserts the complete Patron scoring period and remaining credit allowance for one user. Credit amounts are decimal integer strings to preserve precision.",
        tags: ["Admin patrons"],
        operationId: "upsertPatron",
        permissions: ["financial:manage"],
        params: userParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "valueScore",
            "potentialScore",
            "tier",
            "provisional",
            "periodStart",
            "periodEnd",
            "allowanceRemainingCredits",
          ],
          properties: {
            valueScore: {
              type: "integer",
              minimum: 0,
              maximum: 1000,
              description: "Current realized-value score.",
            },
            potentialScore: {
              type: "integer",
              minimum: 0,
              maximum: 100,
              description: "Forward-looking potential score.",
            },
            tier: {
              enum: ["T0", "T1", "T2", "T3"],
              description: "Assigned Patron tier for this scoring period.",
            },
            provisional: {
              type: "boolean",
              description: "Whether the tier remains provisional.",
            },
            periodStart: {
              type: "string",
              format: "date-time",
              description: "Inclusive scoring-period start in UTC.",
            },
            periodEnd: {
              type: "string",
              format: "date-time",
              description: "Scoring-period end in UTC.",
            },
            allowanceRemainingCredits: {
              type: "string",
              pattern: "^[1-9][0-9]*$",
              description:
                "Positive remaining Patron allowance as a decimal integer string.",
            },
          },
        },
        response: { 200: { description: "Saved profile", ...profileSchema } },
      }),
      preHandler: admin,
    },
    async (request) => {
      const userId = (request.params as { userId: string }).userId;
      const body = request.body as Omit<
        PatronUserProfile,
        | "userId"
        | "updatedAt"
        | "periodStart"
        | "periodEnd"
        | "allowanceRemainingCredits"
      > & {
        periodStart: string;
        periodEnd: string;
        allowanceRemainingCredits: string;
      };
      return json(
        await options.service.saveProfile({
          actor: agent(request.apiPrincipal!, userId),
          audit: audit(request.id),
          profile: {
            ...body,
            userId,
            periodStart: new Date(body.periodStart),
            periodEnd: new Date(body.periodEnd),
            allowanceRemainingCredits: BigInt(body.allowanceRemainingCredits),
            updatedAt: new Date(),
          },
        }),
      );
    },
  );
  app.post(
    "/admin/patrons/:userId/credits",
    {
      schema: defineJsonRoute({
        summary: "Adjust Patron credits",
        description:
          "Adds a positive amount or subtracts a negative amount from the user's Patron credit ledger. idempotencyKey prevents the same adjustment from being applied twice.",
        tags: ["Admin patrons"],
        operationId: "adjustPatronCredits",
        permissions: ["financial:manage"],
        params: userParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["amountCredits", "description", "idempotencyKey"],
          properties: {
            amountCredits: {
              type: "string",
              pattern: "^-?[1-9][0-9]*$",
              description:
                "Non-zero signed decimal integer; positive grants and negative subtracts.",
            },
            description: {
              type: "string",
              minLength: 1,
              maxLength: 240,
              description: "Support-safe reason recorded in the credit ledger.",
            },
            idempotencyKey: {
              type: "string",
              minLength: 1,
              maxLength: 180,
              description:
                "Stable key preventing duplicate application of this logical adjustment.",
            },
            situationKey: {
              type: "string",
              maxLength: 96,
              description: "Optional stable business situation identifier.",
            },
          },
        },
        response: {
          201: { description: "Credit ledger entry", ...creditEntrySchema },
        },
      }),
      preHandler: admin,
    },
    async (request, reply) => {
      const userId = (request.params as { userId: string }).userId;
      const body = request.body as {
        amountCredits: string;
        description: string;
        idempotencyKey: string;
        situationKey?: string;
      };
      const amount = BigInt(body.amountCredits);
      const common = {
        actor: agent(request.apiPrincipal!, userId),
        audit: audit(request.id),
        userId,
        amountCredits: amount < 0n ? -amount : amount,
        description: body.description,
        idempotencyKey: body.idempotencyKey,
        ...(body.situationKey ? { situationKey: body.situationKey } : {}),
      };
      const entry =
        amount < 0n
          ? await options.service.subtractCredits(common)
          : await options.service.addCredits(common);
      return reply.code(201).send(json(entry));
    },
  );
}

type SerializedPatronConfiguration = Omit<
  PatronConfiguration,
  "key" | "updatedAt" | "budget" | "monthlyAllowances" | "taskClasses"
> & {
  budget: Omit<PatronConfiguration["budget"], "ceilingCredits"> & {
    ceilingCredits: string;
  };
  monthlyAllowances: Record<PatronTier, string>;
  taskClasses: Record<
    string,
    Omit<PatronConfiguration["taskClasses"][string], "estimatedCredits"> & {
      estimatedCredits: string;
    }
  >;
};

function deserializeConfiguration(
  body: SerializedPatronConfiguration,
): PatronConfiguration {
  return {
    ...body,
    key: "default",
    budget: {
      ...body.budget,
      ceilingCredits: BigInt(body.budget.ceilingCredits),
    },
    monthlyAllowances: Object.fromEntries(
      Object.entries(body.monthlyAllowances).map(([tier, value]) => [
        tier,
        BigInt(value),
      ]),
    ) as Record<PatronTier, bigint>,
    taskClasses: Object.fromEntries(
      Object.entries(body.taskClasses).map(([key, value]) => [
        key,
        { ...value, estimatedCredits: BigInt(value.estimatedCredits) },
      ]),
    ),
    updatedAt: new Date(),
  };
}

const audit = (correlationId: string): AuditContext => ({
  correlationId,
  source: "api",
  actorSource: "service",
});
const agent = (principal: ApiPrincipal, userId: string): Actor => ({
  kind: "agent",
  agentId: `api:${principal.id}`,
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
