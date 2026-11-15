import type { FastifyInstance } from "fastify";
import type { Actor } from "@life-optimizer/core";
import type {
  PaymentProviderSync,
  WebhookVerifier,
} from "@life-optimizer/financial";
import { defineJsonRoute } from "../../contracts.js";
import { ApiDependencyUnavailableError } from "../../availability.js";

/** A scoped parser preserves the exact JSON bytes for Stripe's HMAC verification. */
export async function registerStripeWebhookRoute(input: {
  app: FastifyInstance;
  verifier?: WebhookVerifier;
  actor: Actor;
  sync: PaymentProviderSync;
}): Promise<void> {
  await input.app.register(async (route) => {
    route.removeContentTypeParser("application/json");
    route.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: 65_536 },
      (_request, body, done) => done(null, body),
    );
    route.post(
      "/webhooks/stripe",
      {
        bodyLimit: 65_536,
        schema: defineJsonRoute({
          summary: "Receive a signed Stripe event",
          tags: ["Financial webhooks"],
          operationId: "receiveStripeWebhook",
          problemResponses: [503],
          description:
            "Verifies the timestamp and signature over the exact JSON body, then durably deduplicates and applies the event. No-store; Stripe-Signature is the credential.",
          body: { type: "string", minLength: 2, maxLength: 65_536 },
          headers: {
            type: "object",
            additionalProperties: true,
            required: ["stripe-signature"],
            properties: {
              "stripe-signature": {
                type: "string",
                minLength: 1,
                maxLength: 4096,
              },
            },
          },
          response: {
            200: {
              description: "Processed or duplicate",
              type: "object",
              additionalProperties: false,
              required: ["received"],
              properties: { received: { type: "boolean" } },
              headers: {
                "cache-control": {
                  type: "string",
                  description: "Always no-store",
                },
              },
            },
          },
        }),
      },
      async (request) => {
        if (!input.verifier)
          throw new ApiDependencyUnavailableError("Stripe webhooks");
        if (typeof request.body !== "string")
          throw new Error("Webhook body parser was not installed.");
        const event = input.verifier.verify({
          headers: request.headers,
          rawBody: request.body,
        });
        await input.sync.applyProviderEvent({
          actor: input.actor,
          audit: {
            correlationId: request.id,
            source: "api",
            actorSource: "service",
          },
          event,
        });
        return { received: true };
      },
    );
  });
}
