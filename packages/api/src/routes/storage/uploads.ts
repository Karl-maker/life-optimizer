import type { FastifyInstance } from "fastify";
import type { ObjectStore } from "@edu-service/storage";
import { requirePermissions, type ApiAuthenticator } from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";

const keyPattern = "^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$";
export function registerUploadRoutes(
  app: FastifyInstance,
  options: { store: ObjectStore; authenticator: ApiAuthenticator },
): void {
  const user = requirePermissions(options.authenticator, ["user"]);
  app.post(
    "/uploads",
    {
      schema: defineJsonRoute({
        summary: "Create an S3 upload URL",
        description:
          "Returns a short-lived object-scoped PUT URL. The server prefixes the requested key with the authenticated user ID; AWS credentials are never exposed.",
        tags: ["Storage"],
        operationId: "createUploadUrl",
        permissions: ["user"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "contentType", "contentLength"],
          properties: {
            key: { type: "string", pattern: keyPattern },
            contentType: {
              type: "string",
              pattern: "^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$",
              maxLength: 100,
            },
            contentLength: { type: "integer", minimum: 1, maximum: 104857600 },
            metadata: {
              type: "object",
              maxProperties: 20,
              additionalProperties: { type: "string", maxLength: 200 },
            },
          },
        },
        response: {
          201: {
            description: "Presigned S3 PUT target",
            type: "object",
            additionalProperties: false,
            required: ["key", "path", "url", "uploadUrl", "expiresAt"],
            properties: {
              key: { type: "string" },
              path: { type: "string" },
              url: { type: "string" },
              uploadUrl: { type: "string" },
              expiresAt: { type: "string", format: "date-time" },
            },
          },
        },
      }),
      preHandler: user,
    },
    async (request, reply) => {
      const body = request.body as {
        key: string;
        contentType: string;
        contentLength: number;
        metadata?: Record<string, string>;
      };
      const key = ownedKey(request.apiPrincipal!.id, body.key);
      const result = await options.store.createUploadUrl({
        key,
        contentType: body.contentType,
        contentLength: body.contentLength,
        expiresInSeconds: 900,
        metadata: {
          ...(body.metadata ?? {}),
          ownerId: request.apiPrincipal!.id,
        },
        audit: {
          actor: { kind: "user", userId: request.apiPrincipal!.id },
          context: { correlationId: request.id, source: "api" },
        },
      });
      return reply
        .code(201)
        .send({ ...result, expiresAt: result.expiresAt.toISOString() });
    },
  );
  app.post(
    "/uploads/confirm",
    {
      schema: defineJsonRoute({
        summary: "Confirm my S3 upload",
        description:
          "Checks provider metadata after the direct PUT completed and returns the safe object description.",
        tags: ["Storage"],
        operationId: "confirmUpload",
        permissions: ["user"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key"],
          properties: { key: { type: "string", pattern: keyPattern } },
        },
        response: {
          200: {
            description: "Confirmed object",
            type: "object",
            additionalProperties: true,
          },
        },
      }),
      preHandler: user,
    },
    async (request) =>
      options.store.confirmUpload({
        key: ownedKey(
          request.apiPrincipal!.id,
          (request.body as { key: string }).key,
        ),
        audit: {
          actor: { kind: "user", userId: request.apiPrincipal!.id },
          context: { correlationId: request.id, source: "api" },
        },
      }),
  );
}
function ownedKey(userId: string, key: string): string {
  if (key.includes("..") || key.includes("//") || key.startsWith("/"))
    throw new Error("Upload key is invalid.");
  return `users/${userId}/${key}`;
}
