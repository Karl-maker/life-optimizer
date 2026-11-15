import type { FastifyInstance } from "fastify";
import type { ObjectStore } from "@life-optimizer/storage";
import { requirePermissions, type ApiAuthenticator } from "../../auth.js";
import { defineJsonRoute } from "../../contracts.js";
import { ApiDependencyUnavailableError } from "../../availability.js";

const keyPattern = "^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$";
export function registerUploadRoutes(
  app: FastifyInstance,
  options: { store?: ObjectStore; authenticator: ApiAuthenticator },
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
        problemResponses: [503],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "contentType", "contentLength"],
          properties: {
            key: {
              type: "string",
              pattern: keyPattern,
              description:
                "User-relative object key. The server adds an ownership prefix; absolute paths, .., and duplicate separators are rejected.",
            },
            contentType: {
              type: "string",
              pattern: "^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$",
              maxLength: 100,
              description:
                "Media type expected for the uploaded object, for example image/png.",
            },
            contentLength: {
              type: "integer",
              minimum: 1,
              maximum: 104857600,
              description: "Exact upload size in bytes; maximum 100 MiB.",
            },
            metadata: {
              type: "object",
              maxProperties: 20,
              description:
                "Optional provider-safe key/value map. Swagger's additionalProp1 label is a placeholder; replace it with a real metadata key such as purpose. ownerId is added by the server and cannot change ownership.",
              additionalProperties: { type: "string", maxLength: 200 },
              examples: [{ purpose: "profile-avatar" }],
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
              key: {
                type: "string",
                description:
                  "Server-owned object key to send to the confirm endpoint.",
              },
              path: {
                type: "string",
                description: "Credential-free provider path for diagnostics.",
              },
              url: {
                type: "string",
                format: "uri",
                description: "Configured delivery URL for the object.",
              },
              uploadUrl: {
                type: "string",
                format: "uri",
                description:
                  "Temporary signed PUT URL. Treat it as a credential and do not log it.",
              },
              expiresAt: {
                type: "string",
                format: "date-time",
                description: "Expiry of the signed PUT URL.",
              },
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
      if (!options.store)
        throw new ApiDependencyUnavailableError("Object storage");
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
        problemResponses: [503],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key"],
          properties: {
            key: {
              type: "string",
              pattern: keyPattern,
              description:
                "Same user-relative key supplied when the upload URL was created.",
            },
          },
        },
        response: {
          200: {
            description: "Confirmed object",
            type: "object",
            additionalProperties: false,
            required: ["key", "metadata"],
            properties: {
              key: { type: "string" },
              contentType: { type: "string" },
              contentLength: { type: "integer", minimum: 0 },
              eTag: { type: "string" },
              lastModified: { type: "string", format: "date-time" },
              storageTier: {
                enum: [
                  "hot",
                  "automatic",
                  "cool",
                  "single-zone-cool",
                  "instant-archive",
                  "archive",
                  "deep-archive",
                ],
              },
              metadata: {
                type: "object",
                additionalProperties: { type: "string" },
                description:
                  "Stored provider metadata map. Any additionalProp1 name shown by Swagger is only an example placeholder for the actual metadata key.",
                examples: [
                  {
                    purpose: "profile-avatar",
                    ownerId: "00000000-0000-4000-8000-000000000001",
                  },
                ],
              },
            },
          },
        },
      }),
      preHandler: user,
    },
    async (request) => {
      if (!options.store)
        throw new ApiDependencyUnavailableError("Object storage");
      return options.store.confirmUpload({
        key: ownedKey(
          request.apiPrincipal!.id,
          (request.body as { key: string }).key,
        ),
        audit: {
          actor: { kind: "user", userId: request.apiPrincipal!.id },
          context: { correlationId: request.id, source: "api" },
        },
      });
    },
  );
}
function ownedKey(userId: string, key: string): string {
  if (key.includes("..") || key.includes("//") || key.startsWith("/"))
    throw new Error("Upload key is invalid.");
  return `users/${userId}/${key}`;
}
