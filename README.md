# Edu Service

Edu Service is an open, self-hostable foundation for dynamic learning content. It enables people to create, share, discover, and interact with learning experiences while preserving clear ownership, safe collaboration, and an auditable history of important changes.

> **Status:** early foundation. The current codebase establishes the core, persistence, and command-line layers; the learning-content model and user experience will evolve within those boundaries.

## Product direction

Edu Service is designed for learners, educators, and communities that want learning material to be living rather than static. People should be able to publish content, respond to it, build on it, and learn together without making the system dependent on one interface or platform.

The service will support:

- Dynamic learning content that can be created, revised, organised, and shared.
- Interaction around content, such as responses, feedback, discussion, and collaboration.
- Clear ownership and access rules for private, shared, and public material.
- Traceable changes and moderation-friendly records for meaningful user actions.
- Multiple delivery channels across the CLI, public API, browser, and mobile clients.

## Principles

| Principle             | What it means                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Learner-centred       | Content and interactions should help people understand, practise, and contribute.              |
| Dynamic by design     | Learning materials can evolve; changes must retain useful history and ownership.               |
| Open collaboration    | Sharing and interaction are first-class capabilities, bounded by explicit permissions.         |
| Privacy and safety    | Collect the minimum data necessary and avoid exposing private learning activity.               |
| Accessible foundation | Interfaces and content models should support varied devices, abilities, and learning contexts. |
| Portable              | Keep core data and business rules independent of a particular client or hosting provider.      |
| Auditable             | Important state changes have structured, append-only audit records.                            |

## Architecture

The architecture keeps learning-domain rules independent of delivery and infrastructure.

```
CLI / API / browser / mobile clients
                │
                ▼
       packages/core
domain rules, use cases, ports, permissions, audit-event definitions
                │
                ▼
        packages/db
Prisma repositories, transactions, PostgreSQL persistence, audit + event outbox
                │
                ▼
         packages/ai
provider-neutral model catalog, routing, evaluation and human-review contracts
```

| Package                    | Responsibility                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai`              | Provider-neutral AI model catalog, routing, execution, evaluation, and human-review contracts.                                               |
| `packages/api`             | Fastify HTTP, WebSocket, SSE, SOAP, security, pagination, and generated OpenAPI adapter.                                                     |
| `packages/auth`            | Password/token security adapters, optional OAuth configuration, and authentication deployment helpers.                                       |
| `packages/cache`           | Cache-aside coordination with TTL, invalidation, pre-warming, bounded in-memory LFU/LRU eviction, and Redis storage.                         |
| `packages/cli`             | Thin command-line adapter that validates input, invokes public application APIs, and renders output.                                         |
| `packages/cms`             | Localized page/screen content, feature-aware client projections, auditable CRDT editing, caching, and static S3 publishing.                  |
| `packages/core`            | Domain concepts, application use cases, ports, permission checks, and audit-event definitions; independent of infrastructure and frameworks. |
| `packages/data-structures` | Dependency-free reusable Bloom filter, trie, tree, graph, and supporting data structures.                                                    |
| `packages/db`              | PostgreSQL and Prisma adapters, transactions, migrations, durable audit storage, and event outbox persistence.                               |
| `packages/email`           | Provider-neutral, rate-limited, unsubscribe-aware templated email delivery.                                                                  |
| `packages/events`          | Transport-neutral event envelopes, topology, consumer leases, batching, retry/DLQ contracts, and local/AWS brokers.                          |
| `packages/feature-flags`   | Deterministic, auditable targeting, A/B variants, remote configuration, and flag-aware filtering.                                            |
| `packages/financial`       | Products, prices, entitlements, usage, wallets, invoices, subscriptions, payments, and store-purchase synchronization.                       |
| `packages/notifications`   | Rate-limited mobile and browser push notification contracts.                                                                                 |
| `packages/observability`   | Structured operational events with filtered JSON-lines, local-file, and HTTP sinks.                                                          |
| `packages/sms`             | Rate-limited, consent-aware SMS delivery with a Twilio adapter.                                                                              |
| `packages/speech`          | Provider-neutral speech contracts with ElevenLabs, OpenAI, and AWS adapters.                                                                 |
| `packages/storage`         | Object-storage contracts, upload lifecycle, storage tiers, audit/event handoff, and AWS S3 adapter.                                          |
| `packages/util`            | Small dependency-free JSON-safe-value and structured-output validation utilities for boundaries.                                             |

This dependency direction is deliberate: adapters may depend on core, but core never depends on adapters. New APIs, jobs, or web clients must call core through its public contracts rather than duplicating domain logic.

## Development

Requirements: Node.js 22 or later and pnpm 12.15.0.

```sh
pnpm install
cp packages/db/.env.example packages/db/.env
pnpm db:up
pnpm db:migrate
pnpm verify
```

`pnpm verify` runs the repository's build, type checks, and unit tests. GitHub Actions also runs PostgreSQL integration tests, a CLI smoke test, and the Docker test build on pull requests and pushes to `main`.

`packages/db/.env` is intentionally git-ignored. It needs two distinct PostgreSQL URLs: `DATABASE_URL` for development on port 5432 and `TEST_DATABASE_URL` for the disposable integration database on port 5433. The integration suite rejects a missing test URL or a test URL that targets the development database.

For database-backed integration tests locally:

```sh
pnpm db:up:test
pnpm db:migrate:test
pnpm --filter @edu-service/db test:integration
```

Stop local database containers with `pnpm db:down`.

### AI configuration

The shipped AI package has no provider API-key environment variables: it defines provider-neutral contracts only. A deployment composes its own `AiProvider` adapter and reads credentials at that outer boundary. Do not put credentials in the model catalog, migrations, audit records, or telemetry.

When introducing an adapter-specific setting, add it to the adapter's `.env.example` with a non-secret placeholder, document its accepted format and whether it is required, and validate it at startup before requests are accepted. API keys must be non-empty strings; URLs must be valid `https:` URLs unless a local-development exception is explicitly documented; model IDs must be non-empty and must correspond to a catalog entry with the required capability.

## Quality standards

Repository-wide engineering rules for Codex and Claude Code live in [AGENTS.md](AGENTS.md). They require contributors to reuse suitable existing utilities, preserve the architecture, test normal and edge cases, and review every change against the GitHub Actions workflow. [CLAUDE.md](CLAUDE.md) imports the same policy for Claude Code.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations and [docs/logging.md](docs/logging.md) for logging and audit-trail guidance.
See [observability and audit architecture](docs/observability.md) for event sinks, audit use, and extension guidance.
See [`@edu-service/ai`](packages/ai/README.md) for AI model registration, deprecation checks, structured outputs, human review, evaluation, routing, and provider-extension guidance.
See [`@edu-service/events`](packages/events/README.md) for event topology, transactional-outbox delivery, consumers, DLQs, AWS configuration, and saga guidance.
See [`@edu-service/cache`](packages/cache/README.md) for cache-aside use, TTL/invalidation, structured cache telemetry, Redis capacity policy, and safe startup pre-warming.
See [`@edu-service/auth`](packages/auth/README.md) for local/OAuth login composition, revocable sessions, RedisBloom identity checks, risk/device handling, account deletion, consent history, and CLI setup.
See [`@edu-service/feature-flags`](packages/feature-flags/README.md) for country/profile/email/CIDR targeting, sticky rollouts, exposure records, extension rules, and safe data filtering.
See [`@edu-service/cms`](packages/cms/README.md) for localized page/screen editing, CRDT audit history, feature-aware delivery, caching, and static S3 publishing.
The [`@edu-service/events`](packages/events/README.md) `@edu-service/events/aws` export provides the SNS/SQS adapter, required infrastructure, and LocalStack development environment. Run `pnpm events:up` to start the local SNS/SQS-compatible endpoint; it never contacts AWS.

## Roadmap

1. Establish learning-content, authoring, sharing, and interaction domain models.
2. Deliver content creation, discovery, access control, and interaction workflows through core and the CLI.
3. Add API and web adapters without moving business rules out of core.
4. Add moderation, accessibility, observability, and export capabilities as the collaborative product surface grows.

## License

Licensed under the PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE).
