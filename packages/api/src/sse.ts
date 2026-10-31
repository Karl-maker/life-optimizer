import type { FastifyInstance, FastifyRequest } from "fastify";

export interface ServerSentEvent {
  event?: string;
  id?: string;
  retry?: number;
  data: unknown;
}

export interface SseConnection {
  send(event: ServerSentEvent): void;
  close(): void;
  closed: Promise<void>;
}

/**
 * Registers a documented one-way event stream. Authorize before opening it and
 * use bounded event payloads: reconnection/delivery guarantees belong to the
 * event broker, not to this HTTP connection.
 */
export function registerSseRoute(
  app: FastifyInstance,
  options: {
    url: string;
    schema: Record<string, unknown>;
    preHandler?: (request: FastifyRequest) => Promise<void> | void;
    onConnect(
      connection: SseConnection,
      request: FastifyRequest,
    ): Promise<void> | void;
  },
): void {
  app.get(options.url, {
    schema: {
      ...options.schema,
      produces: ["text/event-stream"],
      response: {
        200: {
          description: "An open Server-Sent Events stream.",
          type: "string",
          headers: {
            "content-type": { type: "string", example: "text/event-stream" },
            "cache-control": { type: "string", example: "no-cache" },
            "x-request-id": { type: "string" },
          },
        },
      },
    },
    ...(options.preHandler === undefined
      ? {}
      : { preHandler: options.preHandler }),
    handler: async (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": request.id,
      });
      reply.raw.flushHeaders();
      let resolveClosed: () => void = () => undefined;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      reply.raw.once("close", resolveClosed);
      const connection: SseConnection = {
        closed,
        send(event) {
          if (event.id !== undefined) reply.raw.write(`id: ${event.id}\n`);
          if (event.event !== undefined)
            reply.raw.write(`event: ${event.event}\n`);
          if (event.retry !== undefined)
            reply.raw.write(`retry: ${event.retry}\n`);
          const data =
            typeof event.data === "string"
              ? event.data
              : JSON.stringify(event.data);
          for (const line of data.split("\n"))
            reply.raw.write(`data: ${line}\n`);
          reply.raw.write("\n");
        },
        close() {
          reply.raw.end();
        },
      };
      await options.onConnect(connection, request);
    },
  });
}
