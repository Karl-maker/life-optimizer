# Platform administration API

The generated `/openapi.json` and `/docs` remain the authoritative endpoint contract. This guide explains the two platform workflows currently exposed by dedicated domain routes.

## Feature flags

Administrators with `feature-flags:manage` create a flag with `POST /admin/feature-flags`, replace it with `PUT /admin/feature-flags/{key}`, toggle it with `PATCH /admin/feature-flags/{key}/status`, and assign a user override with `PUT /admin/feature-flags/{key}/users/{userId}`.

```http
POST /admin/feature-flags
Authorization: Bearer <admin-session>
Content-Type: application/json

{"schemaVersion":1,"key":"new.reader","version":"1","enabled":true,"offVariant":"off","defaultVariant":"on","variants":[{"key":"off","value":false},{"key":"on","value":{"layout":"reader-v2"}}],"rules":[]}
```

An authenticated application checks its own subject only; it never accepts a user ID from the client:

```http
GET /feature-flags/new.reader/check
Authorization: Bearer <user-session>
```

`GET /feature-flags/{key}` returns the same effective decision when a client needs the typed value rather than a Boolean-style check. The response contains `enabled`, the selected `variant`, its typed JSON `value`, and the evaluation reason. Application code should gate the capability on `enabled` and use `value` only for trusted, allow-listed presentation configuration. Remove a user override with `DELETE /admin/feature-flags/{key}/users/{userId}` to return that user to normal rule evaluation.

Evaluation precedence is: explicit user override; global disabled state; first matching targeting rule; deterministic rollout allocation; default variant. Every successful evaluation writes an idempotent exposure record without copying targeting attributes. Management and override changes write business audit records.

## Notification configuration and inbox

`GET /admin/notification-configurations` returns the actual persisted push configuration: enabled adapter, fallback configuration IDs, active state, and delivery rate window. Provider credentials are runtime-only and are never returned.

Administrators create immediate or scheduled in-app notifications for an explicit bounded user list with `POST /admin/notifications`. Users use `/notifications`, `/notifications/{id}`, `/notifications/{id}/read`, `/notifications/read-all`, `/notifications/unread-count`, and `/notification-preferences`. Every user route derives ownership from the authenticated bearer session, so another user's identifier cannot be supplied.

Scheduled inbox records are not returned before `scheduledAt`. Push delivery remains separately idempotent per device and honors subscription/rate-limit configuration.

## Patron administration

Administrators with `financial:manage` use `GET /admin/patrons` for cursor-based listing, tier filtering, and name/email search. `GET /admin/patrons/{userId}` returns the profile, balance, and recent ledger entries; `PUT /admin/patrons/{userId}` creates or replaces a profile; and `POST /admin/patrons/{userId}/credits` performs an audited idempotent adjustment. A user can inspect only their own data at `GET /me/patron`.

## Products, pricing, and payments

Product administrators create and update products at `POST /admin/products` and `PATCH /admin/products/{id}`. Prices are immutable offers: create one at `POST /admin/products/{id}/prices` with its entitlement mappings, then retire it with `DELETE /admin/prices/{id}`. Active products remain available from `GET /catalog/products` and `GET /products/{id}`.

To buy a product, the client sends a price identifier—not an amount—and an `Idempotency-Key`:

```http
POST /payments
Authorization: Bearer <user-session>
Idempotency-Key: checkout-018f8f35
Content-Type: application/json

{"priceId":"<uuid>","provider":"stripe","successUrl":"https://app.example/success","cancelUrl":"https://app.example/cancel"}
```

The service resolves the active price, calculates invoice totals, creates the pending invoice, creates an idempotent provider checkout, and binds its reference. The response's `nextAction.url` is the provider-hosted checkout. Verified Stripe webhook processing records payment and grants the price's entitlements transactionally. Users inspect status through `GET /payments/{invoiceId}` and history through `GET /me/payments`. Administrators record an already provider-confirmed refund through `POST /admin/payments/{paymentId}/refunds`; this endpoint does not claim to initiate a refund at the provider.

## Direct S3 uploads

When `EDU_STORAGE_AWS_REGION` and `EDU_STORAGE_S3_BUCKET` are configured, `POST /uploads` returns a 15-minute S3 PUT URL for a bounded content type and size. Keys are always rewritten under `users/{authenticatedUserId}/`, preventing cross-user object selection. After PUT succeeds, call `POST /uploads/confirm` with the same relative key so the service verifies the object and records the completion audit. AWS credentials and signed URLs are never stored in business records.
