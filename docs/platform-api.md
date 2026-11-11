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

The response contains `enabled`, the selected `variant`, its typed JSON `value`, and the evaluation reason. Application code should gate the capability on `enabled` and use `value` only for trusted, allow-listed presentation configuration.

Evaluation precedence is: explicit user override; global disabled state; first matching targeting rule; deterministic rollout allocation; default variant. Every successful evaluation writes an idempotent exposure record without copying targeting attributes. Management and override changes write business audit records.

## Notification configuration and inbox

`GET /admin/notification-configurations` returns the actual persisted push configuration: enabled adapter, fallback configuration IDs, active state, and delivery rate window. Provider credentials are runtime-only and are never returned.

Administrators create immediate or scheduled in-app notifications for an explicit bounded user list with `POST /admin/notifications`. Users use `/notifications`, `/notifications/{id}`, `/notifications/{id}/read`, `/notifications/read-all`, `/notifications/unread-count`, and `/notification-preferences`. Every user route derives ownership from the authenticated bearer session, so another user's identifier cannot be supplied.

Scheduled inbox records are not returned before `scheduledAt`. Push delivery remains separately idempotent per device and honors subscription/rate-limit configuration.
