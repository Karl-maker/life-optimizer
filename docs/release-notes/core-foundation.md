# Core Foundation Release Note

Date: 2026-10-31

This release is the first real Life Optimizer core: a strong starting point for the product we want to build. It is not the final learning experience yet, but it gives us the reusable foundation for authentication, authorization, API delivery, events, audit, storage, feature flags, CMS, payments, communications, AI contracts, and safe infrastructure boundaries.

The most important thing this release gives us is shape. Business rules live in `@life-optimizer/core`; adapters live outside it; meaningful state changes can be audited; public routes can be documented from their runtime schemas; and future browser, mobile, CLI, worker, and API clients can share the same core behavior instead of rebuilding it in every surface.

## What Works Now

### Core domain and application layer

- Company and user use cases are available through the core package, with repository ports, transaction ports, audit ports, event-outbox ports, operation logging, domain errors, permissions, actors, country codes, and registry-code validation.
- Core stays independent of database, CLI, HTTP, filesystem, provider SDK, and framework details.
- API access authorization exists as a core policy reader/authorizer contract so endpoint allow/deny decisions can be enforced consistently.
- Audit-event definitions and auth-domain event names are centralized in core for meaningful user and account state changes.

### Authentication, authorization, and compliance

- Local signup, local login, OAuth login composition, confirmation, forgot/reset password, reauthentication, logout, device registration, profile image updates, consent receipts, account deletion scheduling, deletion undo, and auth-method discovery are modeled.
- OAuth can be enabled for Google, GitHub, and Facebook when configured; unavailable providers are reported safely rather than breaking clients.
- Sessions are revocable opaque credentials. Website flows can use secure HTTP-only cookies, while API, mobile, and CLI clients can use bearer sessions.
- Passwords use salted scrypt hashing with a deployment pepper. Confirmation, reset, deletion, undo, and session secrets are stored as HMAC digests rather than plaintext.
- RedisBloom-backed identity presence checks are available as an optimization for known email/phone lookups, with PostgreSQL remaining the source of truth.
- Login auditing captures bounded risk, IP/country/device/client/CloudFront context without storing passwords, tokens, cookies, or request bodies.
- High-risk actions, especially account deletion, require recent reauthentication plus a separate verified-channel callback.
- Account deletion is recoverable during a grace window and revokes sessions once scheduled.
- Compliance consent receipts are append-only and tied to exact policy keys, versions, locales, categories, and decisions.
- All currently implemented auth state changes and security-relevant login outcomes emit documented auth events through the transactional outbox.

### API foundation

- The Fastify API package can serve JSON routes with one schema declaration for runtime validation and generated OpenAPI documentation.
- `/docs` and `/openapi.json` expose the generated API contract.
- Standard problem responses, request IDs, security headers, baseline rate limiting, no-store defaults, CORS configuration, access-policy enforcement, and body-safe telemetry are available.
- Auth endpoints are present under the API adapter.
- Financial webhook/callback routes exist for PowerTranz, Stripe, and store-purchase flows.
- SSE, WebSocket, and SOAP helper patterns are documented for future routes.

### Feature flags and experimentation

- Feature definitions support deterministic targeting and A/B variants by stable user targeting key.
- Targeting supports trusted attributes such as country, profile type, email/domain patterns, content interests, CIDR blocks, booleans, set membership, array containment, and custom deterministic conditions.
- Percentage rollouts use stable SHA-256 bucketing so a user keeps the same assignment while the rule, salt, and targeting key stay stable.
- Exposure recording is required for every decision, including flag, revision, variant, rule, bucket, assignment ID, evaluation ID, time, user ID, and correlation ID.
- Flag-aware filtering can narrow already-authorized data, such as products or prices, without turning feature flags into authorization.
- Definitions are versioned and designed to grow without coupling flags to product, pricing, CMS, or user storage.

### CMS and static content delivery

- The CMS package can model localized pages and screens for browser and mobile clients.
- Content supports create, edit, delete, restore, publish, unpublish, and resolve workflows.
- Editors work against an auditable CRDT draft history so concurrent edits can converge while preserving who changed what.
- Published client projections can be written to object storage under the `/cms/` prefix for static S3/CDN delivery.
- Resolution supports locale fallback, publish dates, expiration dates, cache invalidation hints, and feature-flag filtering of components.
- Content can describe client UI components such as text, buttons, images, video, colors, highlights, design tokens, actions, accessibility labels, and mobile/browser variants.
- Compliance policy content can use language and scheduled publishing, but feature gates are intentionally rejected for policy documents.

### Events, audit, and observability

- The events package provides versioned event envelopes, typed event contracts, topics, publishers, consumers, retry/DLQ contracts, and local/AWS broker adapters.
- Authentication events are documented with payloads and are written through PostgreSQL `event_outbox` in the same transaction as the owning auth state change.
- Storage and speech packages also expose typed event handoff points for progress, completion, and usage-style events.
- Observability provides vendor-neutral structured telemetry through JSON-lines, local-file, and HTTP sinks.
- The codebase separates durable audit/business facts from best-effort diagnostics, which keeps debugging data from becoming product state.

### Database and persistence

- The DB package owns Prisma repositories, migrations, PostgreSQL persistence, durable audit storage, event outbox persistence, auth storage, notifications, SMS, email, financial records, and API access policies.
- Database concerns do not leak into core public contracts.
- Integration-test scripts and Docker Compose services exist for local PostgreSQL and test PostgreSQL.

### Cache and data structures

- Cache-aside coordination supports TTLs, invalidation, pre-warming, concurrent request coalescing, bounded in-memory LFU/LRU eviction, Redis storage, and telemetry.
- Redis cache configuration and local Redis development scripts are documented.
- Shared dependency-free structures include Bloom filter, trie, graph, tree, and related helpers.

### Storage

- A provider-neutral object-store contract and AWS S3 adapter exist.
- The storage package supports presigned uploads, upload confirmation, direct uploads, object metadata/head/existence checks, storage tier changes, metadata updates, deletion, audit handoff, and progress events.
- S3 credentials and CDN configuration stay at the adapter boundary, outside core.

### Financial foundation

- The financial package models products, prices, entitlements, usage, wallets, invoices, subscriptions, payments, dunning, tax/compliance snapshots, and app-store purchase synchronization.
- PowerTranz documentation and API callback support are present.
- Stripe webhook and store-purchase route surfaces are present in the API adapter.
- Financial workflows are designed around explicit transactions, audit context, and external worker responsibilities.

### Messaging and notifications

- Email supports provider-neutral templated delivery, rate limits, unsubscribe handling, fallback adapters, delivery logs, and 90-day retention behavior.
- SMS supports templated delivery, E.164 validation, rate limits, consent suppression for marketing, Twilio adapter support, fallback providers, delivery logs, and opt-out handling.
- Notifications support mobile/browser push device records, rate limiting, consent suppression for marketing, idempotent per-device sends, FCM, AWS SNS, and web push adapter contracts.

### Speech and media AI boundaries

- Speech supports provider-neutral synthesis, transcription, sound effects, streaming or buffered delivery, bounded usage metrics, and telemetry/events that avoid storing raw text, audio, URLs, credentials, or provider error bodies.
- ElevenLabs, OpenAI transcription, and AWS Transcribe Streaming adapter boundaries are present.

### AI contracts

- The AI package has a provider-neutral model catalog, capability-aware routing, fallbacks, deprecation checks, human-review gates, structured-output validation, evaluator hooks, and safe telemetry.
- It deliberately does not include provider credentials or SDK-specific secrets.
- OpenAI, Anthropic/Claude, DeepSeek, and Jev are documented as adapter candidates through the shared contracts.

### CLI

- The CLI is a thin adapter that validates command input, calls public application APIs, and renders output.
- Auth login/logout are supported through the public API. Login reads passwords from a hidden prompt and stores only the returned opaque session token in the local mode-0600 config.

## What We Missed Or Still Need To Improve

- The actual learning-content domain is still early. We have the foundation, but we still need the core models for lessons, activities, responses, collaboration, sharing, moderation, assessments, and learner progress.
- The final irreversible account-erasure worker is not implemented yet. We can schedule deletion and undo it during the grace period, but the final deletion/anonymization job still needs to be built with its own completion event.
- OAuth provider protocol adapters still need production composition around each vendor, including PKCE state storage, exact redirect validation, nonce handling, token verification, and provider-specific setup.
- RedisBloom, Redis cache, S3, notification providers, SMS, email, AI providers, and speech providers are adapter-ready, but production deployment still needs real infrastructure wiring, credentials in Secrets Manager/KMS, monitoring, and runbooks.
- Feature flag definitions and CMS documents are local/package-level contracts today. We still need admin/editor APIs, operator UI, approval workflows, and production persistence around those workflows.
- CMS client renderers for browser and mobile still need to be built against the component contracts.
- Public API coverage is not complete. We have the route framework and auth/financial surfaces, but we need endpoints for CMS, feature flags, storage workflows, learning content, search/discovery, financial management, notifications, and admin operations.
- Permissions are intentionally conservative, but we still need the full admin/operator tooling for granting roles, managing API keys, managing access policies, and reviewing audit trails.
- Financial provider implementations and reconciliation workers need to be completed and hardened before live money movement.
- We need SDKs or client helpers for browser, mobile, CLI, and third-party API consumers.
- We need stronger end-to-end tests once the production composition service wires API, DB, Redis, object storage, event brokers, and provider adapters together.
- We need deployment IaC, environment templates at the final composition boundary, operational dashboards, alerting, backup/restore procedures, and disaster-recovery exercises.
- The AI package is contract-first today. Provider adapters, agent runtime, tool execution, memory, retrieval, evaluation datasets, safety controls, and human approval flows are next.

## Next: AI Agentic Build

The next build phase should start the AI agentic layer on top of this foundation. The goal is not just to call a model; it is to let agents safely use the core platform.

The next phase should focus on:

- Agent identities, permissions, and audit trails so agent actions are attributable and reviewable.
- Tool contracts for learning content, CMS edits, feature flag reads, storage, notifications, search, and financial-safe operations.
- Human-review gates for high-impact actions such as publishing, pricing changes, account/admin changes, policy content, notifications, and destructive workflows.
- Retrieval and memory boundaries that respect authorization, privacy, consent, and tenant/resource ownership.
- Evaluation datasets, regression tests, and cost/latency budgets for agent tasks.
- Event-driven workflows so agents can react to approved platform events without bypassing core use cases.
- Browser, mobile, API, and CLI surfaces that expose agent capabilities without coupling the user experience to one provider.

This core release gives us the rails. The AI agentic build should now add intelligence on those rails, keeping the same rule: business decisions stay in core, provider-specific power stays at the edges, and every meaningful action remains explainable, authorized, and auditable.
