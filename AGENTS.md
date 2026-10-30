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
