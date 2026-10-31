# Engineering Instructions

Apply these rules to every code change. Keep this file concise and update it when the repository's architecture or CI contract changes.

Edu Service supports dynamic learning content that people can share and interact with. Preserve the layered architecture while evolving the domain: learning rules belong in core, not in the CLI or database adapters.

## Start with the existing design

- Read the relevant package, nearby implementation, tests, and public exports before editing.
- Before adding a helper, utility, parser, formatter, validator, error type, or abstraction, search the repository for an existing one. Reuse or extend it when its responsibility fits; do not duplicate behavior under a new name.
- Prefer the smallest change that preserves the established API and behavior. Do not add dependencies or speculative abstractions without a demonstrated need.

## Architecture and dependency direction

- Keep business rules and use cases in `packages/core`. Domain code must not depend on database, CLI, filesystem, network, or framework concerns.
- Define application ports in `packages/core/src/application/ports`; implement them in adapters such as `packages/db`.
- Keep persistence and Prisma-specific code in `packages/db`; do not leak Prisma types or database concerns into `packages/core`.
- Keep command parsing, presentation, configuration, and process concerns in `packages/cli`; route business behavior through the core public API rather than recreating it in the CLI.
- Depend inward: CLI and database adapters may depend on core; core must remain independent of them. Avoid imports that cross layers or bypass public package boundaries.

## Public API changes

- Put HTTP route modules in `packages/api/src/routes/<resource>/`; keep a route's schema, authorization, handler, focused tests, and concise consumer-facing explanation together. Register routes only from the API composition root.
- Every public HTTP route must use `defineJsonRoute` (or the equivalent streaming/SOAP helper) and declare a summary, tag, stable operation ID, request schemas, every success response, response headers, problem responses, permissions, cache policy, and OpenAPI links when it returns a related resource. The generated `/openapi.json` and `/docs` are the only API contract; never maintain an undocumented parallel endpoint or hand-maintained duplicate specification.
- Use the standard JSON envelope for collection responses: `{ data, pagination, links }`. Use bounded opaque cursor query parameters (`limit`, `cursor`) and a `Link: rel="next"` response header; never expose offset pagination for mutable public collections.
- Treat every request, header, URL, XML body, and integration event as hostile. Use strict schemas with `additionalProperties: false`, bounded sizes, `assertSafeInput`, parameterized adapter calls, resource-ownership checks in core, and redacted/bounded telemetry. Never log bodies, authorization headers, cookies, API keys, passwords, XML documents, or database connection data.
- Before adding a `GET`, review whether it is public/shared and stable enough to cache. Document `Cache-Control`, validators, and invalidation ownership in the route schema/README. Do not cache personalized, permission-scoped, mutable, or error responses; invalidate through the owning write use case after its transaction commits.
- CORS is a browser policy, not authentication. Use exact configured allow origins, optional explicit blocked origins, API-key/bearer authentication, endpoint permissions, and the core access-policy reader for all clients. A blocked origin or principal returns a support-safe problem response and an operational event; never disclose internal blacklist reasons.

## Correctness and tests

- Every behavior change requires focused automated tests in the owning package. A bug fix requires a regression test.
- Cover the normal path, boundary values, malformed input, empty or missing data where applicable, authorization/ownership boundaries, and expected failure behavior. Test observable contracts, not implementation details.
- Keep unit tests deterministic and isolated. Use mocks only at ports or external boundaries. Add or update database integration tests for persistence, migrations, transactions, constraints, or repository behavior.
- Do not claim completion with failing tests or unexamined failures. State any verification that could not run and why.

## CI/CD parity and change review

- Read `.github/workflows/ci.yml` before adding code, dependencies, build steps, migrations, generated artifacts, or test suites. Ensure the change is included in—not skipped by—the paths, commands, runtime versions, and Docker build exercised in CI.
- Treat automation as the enforcement layer for this policy: the pre-push hook runs `pnpm verify` and the CLI smoke test; GitHub Actions additionally runs database integration tests and the Docker build/test. Do not bypass a failed hook or workflow. Fix the failure or document an approved, temporary exception in the change.
- When creating or changing a workspace package, update its package manifest, workspace consumers, root build/typecheck scripts, lockfile, relevant focused tests, and CI coverage in the same change. Verify `pnpm -r test` includes the package.
- If a workspace consumer imports a package through its published `exports` path, the producer's declaration output must be built before the consumer is typechecked. Do not use a producer's `typecheck` command as a substitute when it has `noEmit`; make the root typecheck pipeline build the producer first. Test this ordering in the same clean CI/Docker path used for a fresh checkout.
- Keep the root pipeline in dependency order. Today, `@edu-service/core` must run `build` (not `typecheck`) before `@edu-service/ai`, and `@edu-service/ai` must build before `@edu-service/db`; a stale local `dist/` directory is never evidence that this ordering is correct.
- When adding adapter configuration, add a non-secret example to the closest `.env.example`, document its required/optional status, accepted format, and local-development exception, and validate it at the adapter startup boundary. Never load provider credentials into core, the model catalog, audit events, or telemetry.
- For code changes, run the narrowest relevant tests while iterating, then run `pnpm verify` before handoff. For database changes, also run the migration and integration-test path that CI uses (`pnpm db:migrate:test` and `pnpm --filter @edu-service/db test:integration`) when local PostgreSQL is available.
- PostgreSQL CI currently runs version 17. Do not introduce database-only defaults or functions (for example, `uuidv7()`) unless an earlier migration establishes them on that version. Prisma-generated UUIDs are application-side here; match nearby migration SQL, then run the clean `migrate:test` path before handoff.
- Review the final diff against CI requirements: TypeScript type checks, unit tests, PostgreSQL integration tests, builds, CLI smoke test, and Docker build/test. Update CI only when the existing workflow cannot build, test, or package the intended supported behavior.
- Keep documentation and public exports aligned with intentional user-visible changes.
- When adding or materially changing non-obvious behaviour, add a concise “how it works” snippet in the nearest relevant README, guide, or code comment. State the trigger or input, the resulting behaviour, and one important constraint or edge case; avoid creating standalone documentation for a small explanation.
- Use the audit trail for meaningful, successful state changes and write it inside the same transaction. Use operational telemetry for diagnostics, errors, timings, and dependency health; it is best effort and must never change business behaviour. Include the adapter correlation ID, stable dotted event names, and only bounded, non-sensitive attributes. Read `docs/observability.md` before adding a sink, audit event, or instrumentation.

## Completion checklist

Before submitting a change, confirm that it reuses existing utilities where appropriate, respects layer boundaries, adds sufficient tests including edge cases, includes a short explanation for non-obvious behaviour, is covered by the current GitHub Actions workflow, and passes the applicable local quality gates without bypassing Husky.
