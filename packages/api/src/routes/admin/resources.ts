import type { FastifyInstance } from "fastify";
import type { AdminDataService, AdminFilter } from "@edu-service/core";
import { requirePermissions, type ApiAuthenticator } from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";
import {
  createPage,
  decodeCursor,
  encodeCursor,
  parsePageRequest,
  PageRequestError,
  sendPage,
} from "../../pagination.js";

const pageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["data", "pagination", "links"],
  properties: {
    data: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    pagination: { type: "object", additionalProperties: true },
    links: { type: "object", additionalProperties: true },
  },
} as const;

export function registerAdminResourceRoutes(
  app: FastifyInstance,
  options: { service: AdminDataService; authenticator: ApiAuthenticator },
): void {
  app.get(
    "/admin/resources",
    {
      schema: defineJsonRoute({
        summary: "List visible admin data resources",
        description:
          "Lists only resources allowed by the caller's permissions and states whether each resource is managed, domain-only, append-only, or read-only.",
        tags: ["Admin data"],
        operationId: "listAdminResources",
        permissions: ["admin:access"],
        response: {
          200: { description: "Visible admin resources", ...pageSchema },
        },
      }),
      preHandler: requirePermissions(options.authenticator, ["admin:access"]),
    },
    async (request, reply) =>
      sendPage(
        reply,
        createPage(request, {
          data: options.service.resources(request.apiPrincipal!.permissions),
          limit: 100,
        }),
      ),
  );

  app.get(
    "/admin/resources/:resource/records",
    {
      schema: defineJsonRoute({
        summary: "Browse an admin data resource",
        description:
          "Uses opaque keyset cursors. Sorting and filters are restricted to exposed scalar fields; secret and content fields are removed before serialization. Filter syntax is field:operation:value, separated by commas.",
        tags: ["Admin data"],
        operationId: "listAdminResourceRecords",
        permissions: ["admin:access"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["resource"],
          properties: {
            resource: { type: "string", minLength: 2, maxLength: 100 },
          },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "string", pattern: "^[0-9]{1,3}$" },
            cursor: { type: "string", maxLength: 512 },
            sort: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9]{0,63}$" },
            order: { enum: ["asc", "desc"] },
            filter: { type: "string", maxLength: 2000 },
          },
        },
        response: {
          200: {
            description: "A keyset-paginated, redacted resource page",
            ...pageSchema,
            headers: {
              link: {
                type: "string",
                description:
                  "RFC 8288 next-page link when another page exists.",
              },
              "x-sortable-fields": {
                type: "string",
                description: "Comma-separated fields accepted by sort.",
              },
              "x-filterable-fields": {
                type: "string",
                description: "Comma-separated fields accepted by filter.",
              },
            },
          },
        },
      }),
      preHandler: requirePermissions(options.authenticator, ["admin:access"]),
    },
    async (request, reply) => {
      const { resource } = request.params as { resource: string };
      const query = request.query as Record<string, unknown> & {
        sort?: string;
        order?: "asc" | "desc";
        filter?: string;
      };
      const pageRequest = parsePageRequest(query);
      const result = await options.service.list({
        resource,
        permissions: request.apiPrincipal!.permissions,
        limit: pageRequest.limit,
        ...(pageRequest.cursor === undefined
          ? {}
          : { cursor: decodeCursor(pageRequest.cursor) }),
        ...(query.sort === undefined ? {} : { sort: query.sort }),
        ...(query.order === undefined ? {} : { order: query.order }),
        filters: parseFilters(query.filter),
      });
      reply.header("x-sortable-fields", result.sortableFields.join(","));
      reply.header("x-filterable-fields", result.filterableFields.join(","));
      const page = createPage(request, {
        data: result.data,
        limit: pageRequest.limit,
        ...(result.nextCursor === undefined
          ? {}
          : { nextCursor: encodeCursor(result.nextCursor) }),
      });
      return sendPage(reply, page);
    },
  );
}

function parseFilters(value: string | undefined): AdminFilter[] {
  if (!value) return [];
  const filters = value.split(",");
  if (filters.length > 20)
    throw new PageRequestError("At most 20 admin filters are allowed.");
  return filters.map((raw) => {
    const [field, operation, ...parts] = raw.split(":");
    const filterValue = parts.join(":");
    if (
      !field ||
      !operation ||
      !filterValue ||
      !["eq", "contains", "gte", "lte"].includes(operation)
    )
      throw new PageRequestError(
        "Each filter must use field:operation:value syntax.",
      );
    return {
      field,
      operation: operation as AdminFilter["operation"],
      value: filterValue,
    };
  });
}
