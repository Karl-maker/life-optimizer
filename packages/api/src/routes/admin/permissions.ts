import type { FastifyInstance } from "fastify";
import {
  isPermission,
  type Actor,
  type AuthorizationPrincipal,
  type AuthorizationService,
} from "@life-optimizer/core";
import {
  requirePermissions,
  type ApiAuthenticator,
  type ApiPrincipal,
} from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";

const string = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const permissionArray = {
  type: "array",
  description: "Complete set of declared application permission keys.",
  maxItems: 100,
  uniqueItems: true,
  items: string(100),
} as const;
const roleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "description", "system", "permissions"],
  properties: {
    id: string(64),
    name: string(100),
    description: string(500),
    system: { type: "boolean" },
    permissions: permissionArray,
  },
} as const;
const assignmentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["userId", "roleId", "grantedByUserId", "createdAt"],
  properties: {
    userId: { type: "string", format: "uuid" },
    roleId: string(64),
    grantedByUserId: { type: "string", format: "uuid" },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

export function registerPermissionManagementRoutes(
  app: FastifyInstance,
  options: {
    service: AuthorizationService;
    authenticator: ApiAuthenticator;
  },
): void {
  app.get(
    "/admin/permissions",
    {
      schema: defineJsonRoute({
        summary: "List assignable permissions",
        description:
          "Returns the bounded permission catalogue understood by core. Root access does not create undeclared permissions.",
        tags: ["Admin permissions"],
        operationId: "listAdminPermissions",
        permissions: ["permissions:read"],
        response: {
          200: {
            description: "Permission catalogue",
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: { data: permissionArray },
          },
        },
      }),
      preHandler: requirePermissions(options.authenticator, [
        "permissions:read",
      ]),
    },
    async () => ({ data: options.service.listPermissions() }),
  );

  app.get(
    "/admin/roles",
    {
      schema: defineJsonRoute({
        summary: "List authorization roles",
        description:
          "Returns every persisted role and its current permission set. Requires authorization administration access.",
        tags: ["Admin permissions"],
        operationId: "listAdminRoles",
        permissions: ["permissions:read"],
        response: {
          200: {
            description: "Roles and their permissions",
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: { data: { type: "array", items: roleSchema } },
          },
        },
      }),
      preHandler: requirePermissions(options.authenticator, [
        "permissions:read",
      ]),
    },
    async (request) => ({
      data: await options.service.listRoles(principal(request.apiPrincipal!)),
    }),
  );

  app.post(
    "/admin/roles",
    {
      schema: defineJsonRoute({
        summary: "Create an authorization role",
        description:
          "Creates a named role with the supplied assignable permissions. Role IDs are stable identifiers used by assignments.",
        tags: ["Admin permissions"],
        operationId: "createAdminRole",
        permissions: ["permissions:manage"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "description", "permissions"],
          properties: {
            id: {
              type: "string",
              pattern: "^[a-z][a-z0-9-]{1,63}$",
              description: "Stable lowercase role identifier.",
            },
            name: { ...string(100), description: "Human-readable role name." },
            description: {
              ...string(500),
              description: "Support-safe explanation of the role's purpose.",
            },
            permissions: permissionArray,
          },
        },
        response: { 201: { description: "Created role", ...roleSchema } },
      }),
      preHandler: requirePermissions(options.authenticator, [
        "permissions:manage",
      ]),
    },
    async (request, reply) => {
      const body = request.body as {
        id: string;
        name: string;
        description: string;
        permissions: string[];
      };
      const role = await options.service.createRole(
        principal(request.apiPrincipal!),
        {
          ...body,
          context: {
            correlationId: request.id,
            source: "api",
            actorSource: "session",
          },
        },
      );
      return reply.code(201).send(role);
    },
  );

  app.put(
    "/admin/roles/:roleId/permissions",
    {
      schema: defineJsonRoute({
        summary: "Replace a role permission set",
        description:
          "Replaces the complete permission set for an existing role; omitted permissions are removed from that role.",
        tags: ["Admin permissions"],
        operationId: "replaceAdminRolePermissions",
        permissions: ["permissions:manage"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["roleId"],
          properties: {
            roleId: {
              ...string(64),
              description: "Existing role identifier to assign.",
            },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["permissions"],
          properties: { permissions: permissionArray },
        },
        response: { 200: { description: "Updated role", ...roleSchema } },
      }),
      preHandler: requirePermissions(options.authenticator, [
        "permissions:manage",
      ]),
    },
    async (request) => {
      const { roleId } = request.params as { roleId: string };
      const { permissions } = request.body as { permissions: string[] };
      return options.service.replaceRolePermissions(
        principal(request.apiPrincipal!),
        {
          roleId,
          permissions,
          context: {
            correlationId: request.id,
            source: "api",
            actorSource: "session",
          },
        },
      );
    },
  );

  app.post(
    "/admin/users/:userId/roles",
    {
      schema: defineJsonRoute({
        summary: "Grant a role to a user",
        description:
          "Assigns an existing role to the identified user. Repeating an existing assignment is handled idempotently by the authorization service.",
        tags: ["Admin permissions"],
        operationId: "grantAdminUserRole",
        permissions: ["permissions:manage"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: { userId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["roleId"],
          properties: {
            roleId: {
              ...string(64),
              description: "Existing role identifier to assign.",
            },
          },
        },
        response: {
          201: { description: "Role assignment", ...assignmentSchema },
        },
      }),
      preHandler: requirePermissions(options.authenticator, [
        "permissions:manage",
      ]),
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const { roleId } = request.body as { roleId: string };
      const result = await options.service.assignRole(
        principal(request.apiPrincipal!),
        {
          userId,
          roleId,
          context: {
            correlationId: request.id,
            source: "api",
            actorSource: "session",
          },
        },
      );
      return reply.code(201).send(result);
    },
  );

  app.delete(
    "/admin/users/:userId/roles/:roleId",
    {
      schema: defineJsonRoute({
        summary: "Revoke a role from a user",
        description:
          "Removes one role assignment from the identified user without deleting the role or other assignments.",
        tags: ["Admin permissions"],
        operationId: "revokeAdminUserRole",
        permissions: ["permissions:manage"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["userId", "roleId"],
          properties: {
            userId: { type: "string", format: "uuid" },
            roleId: {
              ...string(64),
              description: "Existing role identifier to assign.",
            },
          },
        },
        response: {
          204: { description: "Role assignment removed", type: "null" },
        },
      }),
      preHandler: requirePermissions(options.authenticator, [
        "permissions:manage",
      ]),
    },
    async (request, reply) => {
      const { userId, roleId } = request.params as {
        userId: string;
        roleId: string;
      };
      await options.service.revokeRole(principal(request.apiPrincipal!), {
        userId,
        roleId,
        context: {
          correlationId: request.id,
          source: "api",
          actorSource: "session",
        },
      });
      return reply.code(204).send();
    },
  );
}

function principal(value: ApiPrincipal): AuthorizationPrincipal {
  const permissions = value.permissions.filter(isPermission);
  const actor: Actor = { kind: "user", userId: value.id };
  return { actor, permissions };
}
