import type { FastifyInstance } from "fastify";
import type { Actor, AuditContext } from "@edu-service/core";
import {
  createPatronService,
  type PatronTier,
  type PatronUserProfile,
} from "@edu-service/patron";
import {
  requirePermissions,
  type ApiAuthenticator,
  type ApiPrincipal,
} from "../../auth.js";
import { createPage, parsePageRequest, sendPage } from "../../pagination.js";
import { defineJsonRoute } from "../../contracts.js";

type PatronService = ReturnType<typeof createPatronService>;
const object = { type: "object", additionalProperties: true } as const;
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
        tags: ["Patron"],
        operationId: "getMyPatron",
        permissions: ["user"],
        response: { 200: { description: "Patron explanation", ...object } },
      }),
      preHandler: user,
    },
    async (request) =>
      json(await options.service.explain(request.apiPrincipal!.id)),
  );
  app.get(
    "/admin/patrons",
    {
      schema: defineJsonRoute({
        summary: "List and search Patron profiles",
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
        response: { 200: { description: "Patron page", ...object } },
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
        tags: ["Admin patrons"],
        operationId: "getPatron",
        permissions: ["financial:manage"],
        params: userParams,
        response: { 200: { description: "Patron details", ...object } },
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
            valueScore: { type: "integer", minimum: 0, maximum: 1000 },
            potentialScore: { type: "integer", minimum: 0, maximum: 100 },
            tier: { enum: ["T0", "T1", "T2", "T3"] },
            provisional: { type: "boolean" },
            periodStart: { type: "string", format: "date-time" },
            periodEnd: { type: "string", format: "date-time" },
            allowanceRemainingCredits: {
              type: "string",
              pattern: "^[1-9][0-9]*$",
            },
          },
        },
        response: { 200: { description: "Saved profile", ...object } },
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
        tags: ["Admin patrons"],
        operationId: "adjustPatronCredits",
        permissions: ["financial:manage"],
        params: userParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["amountCredits", "description", "idempotencyKey"],
          properties: {
            amountCredits: { type: "string", pattern: "^-?[1-9][0-9]*$" },
            description: { type: "string", minLength: 1, maxLength: 240 },
            idempotencyKey: { type: "string", minLength: 1, maxLength: 180 },
            situationKey: { type: "string", maxLength: 96 },
          },
        },
        response: { 201: { description: "Credit ledger entry", ...object } },
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
