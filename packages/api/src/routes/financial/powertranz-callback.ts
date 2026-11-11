import type { FastifyInstance } from "fastify";
import type { AuditContext } from "@edu-service/core";
import { InvalidWebhookError } from "@edu-service/financial";
import { defineJsonRoute } from "../../contracts.js";

/** PowerTranz posts a browser-mediated `Response` form field; it is not a signed webhook. */
export async function registerPowerTranzCallbackRoute(input: {
  app: FastifyInstance;
  checkout: {
    complete(request: {
      audit: AuditContext;
      browserResult: unknown;
    }): Promise<{ status: "completed" | "declined" | "processing" }>;
  };
}): Promise<void> {
  await input.app.register(async (route) => {
    route.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 65_536 },
      (_request, body, done) => done(null, body),
    );
    route.post(
      "/webhooks/powertranz",
      {
        bodyLimit: 65_536,
        schema: defineJsonRoute({
          summary: "Complete a PowerTranz hosted payment return",
          description:
            "The browser return is matched to a stored SPI token hash and completed through PowerTranz's server API. It is not proof of payment. The response never contains the SPI token or card data. Always no-store.",
          tags: ["Financial webhooks"],
          operationId: "receivePowerTranzCallback",
          body: { type: "string", minLength: 10, maxLength: 65_536 },
          response: {
            200: {
              description: "The payment completed or was declined",
              type: "object",
              additionalProperties: false,
              required: ["status"],
              properties: {
                status: { type: "string", enum: ["completed", "declined"] },
              },
            },
            202: {
              description: "The payment is being reconciled",
              type: "object",
              additionalProperties: false,
              required: ["status"],
              properties: { status: { type: "string", const: "processing" } },
            },
          },
        }),
      },
      async (request, reply) => {
        if (typeof request.body !== "string") throw new InvalidWebhookError();
        const fields = new URLSearchParams(request.body);
        if (
          [...fields.keys()].some((key) => key !== "Response") ||
          fields.getAll("Response").length !== 1
        )
          throw new InvalidWebhookError();
        const raw = fields.get("Response")!;
        if (raw.length < 2 || raw.length > 60_000)
          throw new InvalidWebhookError();
        let browserResult: unknown;
        try {
          browserResult = JSON.parse(raw);
        } catch {
          throw new InvalidWebhookError();
        }
        const result = await input.checkout.complete({
          audit: {
            correlationId: request.id,
            source: "api",
            actorSource: "service",
          },
          browserResult,
        });
        return reply
          .code(result.status === "processing" ? 202 : 200)
          .send(result);
      },
    );
  });
}
