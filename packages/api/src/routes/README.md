# Route module layout

Create one folder per public resource, for example `routes/companies/`. Keep its JSON schemas, route registration, authorization policy, and focused route tests together. The composition root imports only the resource registration function.

Every public operation must use `defineJsonRoute`; that is what makes it visible in `/openapi.json` and `/docs`. Put protocol-specific streams in the same resource folder, using `registerSseRoute` or Fastify's WebSocket route option, and document their event/message contract alongside the route.
