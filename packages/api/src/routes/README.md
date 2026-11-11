# Route module layout

Create one folder per public resource, for example `routes/companies/`. Keep its JSON schemas, route registration, authorization policy, and focused route tests together. The composition root imports only the resource registration function.

Every public operation must use `defineJsonRoute`; that is what makes it visible in `/openapi.json` and `/docs`. Put protocol-specific streams in the same resource folder, using `registerSseRoute` or Fastify's WebSocket route option, and document their event/message contract alongside the route.

# Route modules

Every public route is registered from `server.ts`, uses `defineJsonRoute`, and is therefore represented in `/openapi.json` and `/docs`. Platform workflows and examples are documented in [`docs/platform-api.md`](../../../../docs/platform-api.md).
