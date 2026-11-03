import type { EmailService } from "@edu-service/email";
import type { FastifyInstance } from "fastify";
import { defineJsonRoute } from "../../contracts.js";
import type { EmailUnsubscribeTokens } from "../../email-unsubscribe.js";

export function registerEmailUnsubscribeRoute(input: {
  app: FastifyInstance;
  email: EmailService;
  tokens: EmailUnsubscribeTokens;
}): void {
  input.app.post(
    "/v1/email/unsubscribe",
    {
      schema: defineJsonRoute({
        summary: "Unsubscribe from a marketing email topic",
        description:
          "Consumes an opaque link token and records a durable marketing-email suppression. No login is required.",
        tags: ["Email"],
        operationId: "unsubscribeEmailMarketing",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: {
            token: { type: "string", minLength: 20, maxLength: 2048 },
          },
        },
        response: { 204: { description: "Unsubscribed", type: "null" } },
      }),
    },
    async (request, reply) => {
      const token = (request.body as { token: string }).token;
      const claim = input.tokens.verify(token);
      // A generic success prevents token probing and makes a repeated click harmless.
      if (claim) await input.email.unsubscribe(claim);
      return reply.code(204).send();
    },
  );
}
