import type { FastifySchema } from "fastify";

export const PROBLEM_SCHEMA = {
  $id: "Problem",
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "status", "code", "requestId"],
  properties: {
    type: {
      type: "string",
      format: "uri-reference",
      description: "Stable problem type URI used to classify the failure.",
      examples: ["/problems/validation"],
    },
    title: {
      type: "string",
      description: "Short, support-safe summary of the problem.",
    },
    status: {
      type: "integer",
      minimum: 400,
      maximum: 599,
      description: "HTTP status code returned with this problem.",
    },
    code: {
      type: "string",
      description: "Stable machine-readable application error code.",
      examples: ["VALIDATION_ERROR"],
    },
    detail: {
      type: "string",
      description: "Optional support-safe explanation of this occurrence.",
    },
    requestId: {
      type: "string",
      description: "Correlation identifier also returned in X-Request-ID.",
    },
    errors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "message"],
        properties: {
          path: {
            type: "string",
            description:
              "JSON path or request location that failed validation.",
          },
          message: {
            type: "string",
            description: "Support-safe validation explanation.",
          },
        },
      },
    },
  },
} as const;

const requestIdHeader = {
  type: "string",
  description:
    "Server-generated correlation identifier. Include it when contacting support.",
} as const;
const cacheControlHeader = {
  type: "string",
  description:
    "Caching policy. Authentication and personalized responses are no-store.",
} as const;

const problem = (description: string) => ({
  description,
  $ref: "Problem",
});

/** Standard problem responses included in every JSON contract. */
export const STANDARD_PROBLEM_RESPONSES = {
  400: problem("Malformed or invalid request."),
  429: problem("Rate limit exceeded."),
  500: problem("Unexpected server error."),
} as const;

/**
 * Starting point for every documented JSON route. Add body, params, querystring,
 * response schemas and OpenAPI links to this object; Fastify then validates and
 * serializes the same contract it publishes at /openapi.json.
 */
export function defineJsonRoute(input: {
  summary: string;
  description: string;
  tags: readonly string[];
  operationId: string;
  permissions?: readonly string[];
  problemResponses?: readonly (401 | 403 | 404 | 409 | 422 | 503)[];
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  querystring?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  response: Record<number, Record<string, unknown>>;
}): FastifySchema {
  const documentedResponses = {
    ...STANDARD_PROBLEM_RESPONSES,
    ...Object.fromEntries(
      (input.problemResponses ?? []).map((status) => [
        status,
        problem(
          status === 401
            ? "Authentication failed."
            : status === 403
              ? "Permission or assurance denied."
              : status === 404
                ? "The requested resource was not found or is not visible to the caller."
                : status === 409
                  ? "The request conflicts with the current resource state."
                  : status === 422
                    ? "The request is valid JSON but violates a business rule or provider policy."
                    : "A required deployment integration is unavailable.",
        ),
      ]),
    ),
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
          "cache-control": cacheControlHeader,
          ...((schema as Record<string, unknown>).headers as object),
        },
      },
    ]),
  );
  return {
    summary: input.summary,
    description: input.description,
    tags: [...input.tags],
    operationId: input.operationId,
    ...(input.permissions === undefined
      ? {}
      : {
          security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
          "x-required-permissions": [...input.permissions],
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
