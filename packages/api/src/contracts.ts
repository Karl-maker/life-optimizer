import type { FastifySchema } from "fastify";

export const PROBLEM_SCHEMA = {
  $id: "Problem",
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "status", "code", "requestId"],
  properties: {
    type: { type: "string", format: "uri-reference" },
    title: { type: "string" },
    status: { type: "integer", minimum: 400, maximum: 599 },
    code: { type: "string" },
    detail: { type: "string" },
    requestId: { type: "string" },
    errors: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "message"],
        properties: { path: { type: "string" }, message: { type: "string" } },
      },
    },
  },
} as const;

const requestIdHeader = {
  type: "string",
  description:
    "Server-generated correlation identifier. Include it when contacting support.",
} as const;

const problem = (description: string) => ({
  description,
  $ref: "Problem",
});

/** Standard problem responses included in every JSON contract. */
export const STANDARD_PROBLEM_RESPONSES = {
  400: problem("Malformed or invalid request."),
  500: problem("Unexpected server error."),
} as const;

/**
 * Starting point for every documented JSON route. Add body, params, querystring,
 * response schemas and OpenAPI links to this object; Fastify then validates and
 * serializes the same contract it publishes at /openapi.json.
 */
export function defineJsonRoute(input: {
  summary: string;
  description?: string;
  tags: readonly string[];
  operationId: string;
  permissions?: readonly string[];
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  querystring?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  response: Record<number, Record<string, unknown>>;
}): FastifySchema {
  const documentedResponses = {
    ...STANDARD_PROBLEM_RESPONSES,
    ...(input.permissions === undefined
      ? {}
      : {
          401: problem("Authentication is required."),
          403: problem("Permission denied."),
        }),
    ...input.response,
  };
  const response = Object.fromEntries(
    Object.entries(documentedResponses).map(([status, schema]) => [
      status,
      {
        ...schema,
        headers: {
          "x-request-id": requestIdHeader,
          ...((schema as Record<string, unknown>).headers as object),
        },
      },
    ]),
  );
  return {
    summary: input.summary,
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    tags: [...input.tags],
    operationId: input.operationId,
    ...(input.permissions === undefined
      ? {}
      : {
          security: [
            { ApiKeyAuth: input.permissions },
            { BearerAuth: input.permissions },
          ],
        }),
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.params === undefined ? {} : { params: input.params }),
    ...(input.querystring === undefined
      ? {}
      : { querystring: input.querystring }),
    ...(input.headers === undefined ? {} : { headers: input.headers }),
    response,
  } as FastifySchema;
}
