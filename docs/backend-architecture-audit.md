# Backend architecture audit

Audit date: 2026-11-10. This document describes the executable API composition in `packages/api/src/bin.ts`, not merely exported package capabilities. The generated `/openapi.json` remains the authoritative HTTP contract.

## Architecture and request lifecycle

The executable API authenticates a revocable bearer session, merges persisted RBAC permissions, validates strict Fastify schemas and hostile input, then invokes package services. Core and financial writes use Prisma transaction runners to keep business state, audit records, and outbox rows atomic. Provider callbacks verify provider evidence before changing payment or entitlement state. Operational telemetry is best effort and carries the Fastify request ID as its correlation ID.

```text
Fastify route -> authentication/RBAC -> application service -> Prisma repository/transaction
                                                              |-> audit_events
                                                              `-> event_outbox

Provider callback -> signature/JWS/OIDC/server verification -> billing/store service
                                                        -> payment + entitlement + audit + outbox
```

The packages are intentionally broader than the running service. `@life-optimizer/cache`, `@life-optimizer/cms`, and `@life-optimizer/events` contain useful implementations, but the executable API does not currently compose a Redis cache, CMS store/routes, or an outbox publisher/consumer worker.

## Endpoint inventory

### Operations and authentication

| Method | Path                                 | Purpose                                                |
| ------ | ------------------------------------ | ------------------------------------------------------ |
| GET    | `/health`                            | Backward-compatible detailed readiness snapshot.       |
| GET    | `/health/live`                       | Lightweight process liveness.                          |
| GET    | `/health/ready`                      | Required dependency readiness.                         |
| GET    | `/version`                           | Non-sensitive service, version, and optional build ID. |
| GET    | `/openapi.json`                      | Generated OpenAPI contract.                            |
| GET    | `/docs`                              | Generated Swagger UI.                                  |
| GET    | `/auth/methods`                      | Enabled authentication methods.                        |
| POST   | `/auth/signup`                       | Local account creation.                                |
| POST   | `/auth/login`                        | Local login.                                           |
| POST   | `/auth/logout`                       | Session revocation.                                    |
| GET    | `/auth/me`                           | Authenticated profile.                                 |
| POST   | `/auth/confirm`                      | Contact confirmation.                                  |
| POST   | `/auth/confirmation/resend`          | Resend contact confirmation.                           |
| POST   | `/auth/password/forgot`              | Request password reset.                                |
| POST   | `/auth/password/reset`               | Complete password reset.                               |
| POST   | `/auth/reauthenticate`               | Sensitive-operation reauthentication.                  |
| DELETE | `/auth/account`                      | Request account deletion.                              |
| POST   | `/auth/account/deletion/confirm`     | Schedule confirmed deletion.                           |
| POST   | `/auth/account/deletion/undo`        | Cancel scheduled deletion.                             |
| POST   | `/auth/account/deletion/undo/resend` | Resend deletion undo challenge.                        |
| POST   | `/auth/devices`                      | Register an authenticated device.                      |
| PUT    | `/auth/profile/image`                | Update profile image metadata.                         |
| POST   | `/auth/oauth/{provider}/start`       | Begin OAuth login.                                     |
| POST   | `/auth/oauth/{provider}/callback`    | Complete OAuth login.                                  |
| POST   | `/compliance/consents`               | Append a consent receipt.                              |
| POST   | `/email/unsubscribe`                 | Marketing unsubscribe token callback.                  |

### Feature flags, notifications, and patrons

| Method         | Path                                        | Purpose                                                                      |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| GET            | `/feature-flags`                            | Evaluate all flags for the authenticated user.                               |
| GET            | `/feature-flags/{key}`                      | Read one effective typed flag value.                                         |
| GET            | `/feature-flags/{key}/check`                | Read one effective flag with convenience `enabled`.                          |
| GET/POST       | `/admin/feature-flags`                      | List or create definitions.                                                  |
| GET/PUT/DELETE | `/admin/feature-flags/{key}`                | Read, replace, or delete a definition.                                       |
| PATCH          | `/admin/feature-flags/{key}/status`         | Enable or disable a definition.                                              |
| PUT/DELETE     | `/admin/feature-flags/{key}/users/{userId}` | Set or remove a user override.                                               |
| GET            | `/notifications`                            | List the authenticated inbox.                                                |
| GET            | `/notifications/{id}`                       | Read an owned notification.                                                  |
| PATCH          | `/notifications/{id}/read`                  | Set owned read state.                                                        |
| DELETE         | `/notifications/{id}`                       | Dismiss an owned notification.                                               |
| POST           | `/notifications/read-all`                   | Mark the owned inbox read.                                                   |
| GET            | `/notifications/unread-count`               | Count unread owned notifications.                                            |
| GET/PUT        | `/notification-preferences`                 | Read or replace owned preferences.                                           |
| GET            | `/admin/notification-configurations`        | Read safe persisted push configuration.                                      |
| POST           | `/admin/notifications`                      | Create immediate/scheduled in-app records for an explicit bounded user list. |
| GET            | `/me/patron`                                | Read the authenticated Patron profile/credits.                               |
| GET            | `/admin/patrons`                            | Search Patron profiles.                                                      |
| GET/PUT        | `/admin/patrons/{userId}`                   | Read or upsert a Patron profile.                                             |
| POST           | `/admin/patrons/{userId}/credits`           | Audited idempotent credit adjustment.                                        |

### Products, payments, stores, and storage

| Method | Path                                  | Purpose                                                                             |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/catalog/products`                   | Cursor-paginated active catalog.                                                    |
| GET    | `/products/{id}`                      | Direct active-product lookup.                                                       |
| POST   | `/admin/products`                     | Create product.                                                                     |
| PATCH  | `/admin/products/{id}`                | Update/archive product.                                                             |
| POST   | `/admin/products/{id}/prices`         | Create immutable price and entitlement mapping.                                     |
| DELETE | `/admin/prices/{id}`                  | Retire price.                                                                       |
| POST   | `/payments`                           | Server-priced one-off checkout for a composed `PaymentProvider` (currently Stripe). |
| GET    | `/payments/{id}`                      | Owned invoice/payment status.                                                       |
| GET    | `/me/payments`                        | Owned payment history.                                                              |
| GET    | `/admin/users/{userId}/payments`      | Administrative user payment history.                                                |
| GET    | `/admin/finance/revenue`              | Revenue/refund summary.                                                             |
| POST   | `/admin/payments/{paymentId}/refunds` | Record an already provider-confirmed refund.                                        |
| POST   | `/webhooks/stripe`                    | Signed Stripe callback.                                                             |
| POST   | `/webhooks/powertranz`                | Browser-mediated PowerTranz return, followed by server verification.                |
| POST   | `/webhooks/apple-app-store`           | Signed App Store Server Notification V2.                                            |
| POST   | `/webhooks/google-play`               | OIDC-authenticated Google Play RTDN push.                                           |
| POST   | `/store-purchases/apple/claim`        | Verify/refresh an Apple transaction.                                                |
| POST   | `/store-purchases/google/claim`       | Verify a Google purchase token.                                                     |
| GET    | `/store-purchases`                    | Owned verified store-purchase history.                                              |
| POST   | `/uploads`                            | Create user-scoped S3 upload authorization.                                         |
| POST   | `/uploads/confirm`                    | Verify and audit an uploaded object.                                                |

### Administration

| Method      | Path                                     | Purpose                                                 |
| ----------- | ---------------------------------------- | ------------------------------------------------------- |
| GET         | `/admin/permissions`                     | Permission catalogue.                                   |
| GET/POST    | `/admin/roles`                           | List/create RBAC roles.                                 |
| PUT         | `/admin/roles/{roleId}/permissions`      | Replace a role permission set.                          |
| POST/DELETE | `/admin/users/{userId}/roles[/{roleId}]` | Grant/revoke role.                                      |
| GET         | `/admin/resources`                       | List visible redacted database resources.               |
| GET         | `/admin/resources/{resource}/records`    | Keyset-paginated, filtered, redacted read-only browser. |

The generic admin resource browser is not a substitute for domain mutation APIs. Append-only, read-only, and domain-only resources deliberately cannot be mutated through it.

## Gap matrix

| Area                 | Existing implementation                                                                                                                                           | Missing or incomplete                                                                                                                                                                                                                                  | Required action                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| API endpoints        | Auth, RBAC, flags, inbox, Patron, catalog, payments, stores, uploads, and redacted admin reads are registered.                                                    | No CMS HTTP surface; no dedicated entitlement list/admin mutation API; no subscription management API; no audit-filter API.                                                                                                                            | Add domain ports first, then focused routes with ownership and cursor tests.                                                               |
| Admin notifications  | Bounded explicit-user in-app creation, preferences, device delivery service, and delivery persistence exist.                                                      | No durable dispatch aggregate, `/admin/notifications/send`, all/segment audience resolution, queue worker, retry control, dispatch status/history, or composed push adapter.                                                                           | Add a transactional dispatch/recipient queue and worker before advertising multi-channel dispatch.                                         |
| Feature flags        | Full definition CRUD/toggle, override set/remove, authenticated evaluation, exposure records.                                                                     | Definition/override mutation and audit are separate DB operations; no cache. Trusted targeting attributes are currently empty in HTTP evaluation.                                                                                                      | Add a Prisma transaction runner for mutation+audit+outbox, then cache definitions with post-commit invalidation.                           |
| Caching              | Cache-aside library, Redis store, telemetry, and CMS raw-publication caching exist. Catalog responses declare a 60-second client cache.                           | The executable API creates no cache. Flags, catalog, notification configuration, and CMS therefore receive no server cache; catalog has no ETag.                                                                                                       | Compose one Redis-backed cache, add resource namespaces/TTLs, and invalidate only after owning transactions commit.                        |
| Webhooks/callbacks   | Stripe HMAC/raw-body verification; Apple JWS; Google OIDC plus provider query; PowerTranz token matching plus server payment call; durable provider-event dedupe. | Provider-side registration remains manual. PowerTranz payment initiation is not exposed by `/payments`; the callback alone cannot create a sale.                                                                                                       | Add an idempotent PowerTranz-specific hosted-form initiation contract or extend the payment next-action union safely.                      |
| Payment/entitlements | Verified settlement grants mapped entitlements in the billing transaction; full refund/store reversal can revoke and emits outbox facts.                          | No scheduled expiration worker; no generic admin grant/revoke use case; no invariant/reconciliation job comparing payment/subscription and entitlement state.                                                                                          | Centralize all manual/expiry changes in an entitlement application service and schedule reconciliation.                                    |
| Event reliability    | Business transactions append committed outbox rows; broker contracts support retry, leases, and DLQs.                                                             | No process claims/publishes `event_outbox`; `publishedAt` is never updated. No consumer registry runs. Domain events do not carry a first-class correlation/causation field.                                                                           | Implement leased outbox publishing, metrics/backlog health, idempotent consumer storage, and correlation columns before claiming delivery. |
| Event coverage       | Auth, financial, Patron, company, authorization, storage, and speech facts exist in varying forms.                                                                | Notification, feature-flag, and CMS business events are absent. Entitlement only has granted/revoked rather than updated/expired/renewed/suspended/restored. Several emitted store/Patron/authorization types are absent from the typed event catalog. | Reconcile producers with one typed catalog and add transaction-level event assertions.                                                     |
| Background jobs      | Package methods exist for renewal, dunning, reconciliation, log purging, and account deletion scheduling.                                                         | No scheduler/worker process is composed. Final account erasure is explicitly unimplemented.                                                                                                                                                            | Add a worker executable with leases, retries, dead-letter/failed-job visibility, and readiness.                                            |
| Configuration        | Package `.env.example` files validate most provider boundaries. Partial payment/store configurations now fail fast.                                               | No single deploy-time manifest validates every enabled worker/cache/event dependency. Cache/events/CMS are not consumed by the API process.                                                                                                            | Use the setup guide below as the deployment checklist and add startup validation when each adapter is composed.                            |
| Observability        | Request IDs, safe request completion telemetry, provider/cache/package events, durable audit table, redacted admin audit browsing.                                | No outbox backlog/worker metrics, cache dependency health, queue health, or callback reconciliation dashboard.                                                                                                                                         | Add bounded worker/cache/queue health checks and alerts without exposing infrastructure details publicly.                                  |
| Health               | Liveness, readiness, dependency status, and release identity are separate.                                                                                        | Only the database is currently injected as a readiness dependency.                                                                                                                                                                                     | Add cache/queue checks when those dependencies are actually required by the running process.                                               |

## Payment and entitlement trace

The Stripe one-off happy path is connected: an authenticated user supplies a price ID and idempotency key; the server snapshots the active price into an invoice; Stripe checkout is bound; a signed event is deduplicated; exact provider reference, currency, and amount are checked; payment and entitlements are committed with audit/outbox rows; and the user can read the invoice and payment history. Store purchases similarly verify Apple/Google evidence and update purchase, entitlement, audit, and outbox state transactionally.

The reverse path is only partly automated. Provider-confirmed refunds can revoke grants when requested, and verified store refunds/revocations revoke store grants. Subscription renewal/dunning/cancellation use cases exist, but no scheduler invokes them. Expiration is represented by entitlement end dates and checked during access, but no worker emits a distinct expiration event. A production deployment must not claim automated subscription lifecycle operation until those jobs are composed and monitored.

## Cache coverage

| Read                                    | Current cache                            | Recommended policy                                                                                                                       |
| --------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Public catalog/product                  | Client/CDN `max-age=60`; no server cache | Global `catalog:v1:*`, 30-60 seconds, ETag; invalidate product and price namespaces after commit.                                        |
| Feature definitions                     | None                                     | Global `feature-flags:v1:definitions`, 30 seconds; invalidate after mutation audit/outbox commits.                                       |
| Feature evaluation                      | None                                     | Usually do not cache personalized decisions until a key includes flag version, user ID, and trusted context fingerprint.                 |
| CMS publication                         | Optional package cache only; API absent  | Cache raw locale/release lists, never a shared personalized projection. Invalidate on publish/unpublish.                                 |
| Notification configuration              | None                                     | Global safe configuration cache, about 60 seconds; invalidate on configuration save.                                                     |
| Entitlements/subscriptions              | None                                     | Prefer source-of-truth reads. If added, use user/account-scoped keys and synchronous post-commit invalidation; never serve stale grants. |
| Payments/transactions/inbox/preferences | None                                     | Keep `private, no-store`; avoid shared caching.                                                                                          |

Cache outages must fall back to the source of truth. A cache key must never contain email, credentials, provider tokens, or unbounded request data.

## Provider-side setup still required

- Stripe: configure an HTTPS snapshot-event destination at `/webhooks/stripe` with the matching signing secret and the event set in `packages/financial/docs/setup-stripe.md`.
- PowerTranz: configure the merchant response URL `/webhooks/powertranz`. It is a browser return, not payment proof; operational reconciliation is required when the browser never returns.
- Apple: configure App Store Server Notifications V2 at `/webhooks/apple-app-store`, mount Apple root certificates/private key, and choose sandbox acceptance explicitly.
- Google: configure Pub/Sub push to `/webhooks/google-play`, its exact audience and service-account identity, and Application Default Credentials with Android Publisher access.
- OAuth: register the exact configured callback URLs for each enabled provider.
- S3, push, cache, and events: provision buckets/provider applications, Redis, and broker topology outside request startup. The API currently composes only S3 among these.

## Changes completed during this audit

- Added separate liveness, readiness, and version/build endpoints while retaining `/health` compatibility.
- Added the missing authenticated single-flag endpoint and administrative override removal endpoint.
- Made unknown user-facing flag keys return a safe 404.
- Wired configured Apple/Google store routes and PowerTranz callback into the executable API composition.
- Made partial Stripe, PowerTranz, Apple, and Google configuration fail at startup.
- Replaced the bounded-page scan in `GET /products/{id}` with a direct repository lookup.

## Verification contract

Focused API and financial tests cover the changes above. Before release, run `pnpm verify`; with PostgreSQL 17 available also run `pnpm db:migrate:test` and `pnpm --filter @life-optimizer/db test:integration`. The remaining blockers in the matrix are intentionally documented rather than represented by placeholder endpoints or unreliable in-process background work.
