# Backend setup and operations

This is the centralized deployment checklist for the executable API. Package-specific `.env.example` files remain the precise examples for their adapters. Do not commit real values.

## Local development

Requirements are Node.js 22.12 or later, pnpm 12.15.0, Docker, and PostgreSQL 17 through the supplied Compose services.

```sh
pnpm install
cp packages/db/.env.example packages/db/.env
pnpm db:up
pnpm db:migrate
pnpm verify
```

For isolated database integration tests:

```sh
pnpm db:up:test
pnpm db:migrate:test
pnpm --filter @life-optimizer/db test:integration
```

Start the API with the required database and authentication secrets loaded from an ignored environment:

```sh
pnpm --filter @life-optimizer/api dev
```

The API binds to `127.0.0.1:3000` by default. Use `/health/live` for process liveness, `/health/ready` for traffic readiness, `/version` for release verification, and `/docs` for the generated contract.

## Required API settings

| Variable                                   | Required | Purpose and accepted format                                                                                    |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Yes      | PostgreSQL URL used by the API. Local example: `postgresql://postgres:postgres@localhost:5432/life_optimizer`. |
| `EDU_AUTH_PASSWORD_PEPPER`                 | Yes      | Independent secret of at least 32 bytes.                                                                       |
| `EDU_AUTH_TOKEN_HMAC_KEY`                  | Yes      | Independent token HMAC secret of at least 32 bytes.                                                            |
| `EDU_AUTH_BLOOM_HMAC_KEY`                  | Yes      | Independent presence-index HMAC secret of at least 32 bytes.                                                   |
| `EDU_API_HOST`                             | No       | Listener host; defaults to `127.0.0.1`. Use `0.0.0.0` only behind a trusted proxy.                             |
| `EDU_API_PORT`                             | No       | TCP port 1-65535; defaults to `3000`.                                                                          |
| `EDU_API_BUILD_ID`                         | No       | Non-secret release identifier, at most 160 characters.                                                         |
| `EDU_API_ALLOWED_ORIGINS`                  | No       | Comma-separated exact browser origins; omission disables browser CORS.                                         |
| `EDU_API_BLOCKED_ORIGINS`                  | No       | Exact support-safe browser deny list; not authentication.                                                      |
| `EDU_API_BLOCKED_ORIGIN_SUPPORT_REFERENCE` | No       | Bounded non-secret support reference.                                                                          |

Production must use a secret manager or workload identity. The database URL and authentication secrets must not appear in images, telemetry, audit changes, events, or provider configuration tables.

## Optional adapters

An adapter is disabled when every setting in its group is omitted. A partially configured payment or store adapter fails startup.

| Group        | Variables                                                                                                                                                                                                                                         | Result                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Stripe       | `EDU_STRIPE_SECRET_KEY`, `EDU_STRIPE_WEBHOOK_SECRET`                                                                                                                                                                                              | Checkout plus signed `/webhooks/stripe`. Both are required together.                                                    |
| PowerTranz   | `EDU_POWERTRANZ_BASE_URL`, `EDU_POWERTRANZ_MERCHANT_ID`, `EDU_POWERTRANZ_MERCHANT_PASSWORD`, `EDU_POWERTRANZ_PAGE_SET`, `EDU_POWERTRANZ_PAGE_NAME`, `EDU_POWERTRANZ_CURRENCY`, `EDU_POWERTRANZ_CURRENCY_CODE`, `EDU_POWERTRANZ_CURRENCY_EXPONENT` | Verified hosted-sale callback. All are required together. API payment initiation is still outstanding; see the audit.   |
| Apple stores | `EDU_APPLE_BUNDLE_ID`, `EDU_APPLE_APP_ID`, `EDU_APPLE_ISSUER_ID`, `EDU_APPLE_KEY_ID`, `EDU_APPLE_PRIVATE_KEY_FILE`, `EDU_APPLE_ROOT_CERT_FILES`; optional `EDU_APPLE_ALLOW_SANDBOX`                                                               | Claim and App Store Server Notification routes. Secret values are mounted files.                                        |
| Google Play  | `EDU_GOOGLE_PLAY_PACKAGE_NAME`, `EDU_GOOGLE_PUBSUB_AUDIENCE`, `EDU_GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL`, plus Application Default Credentials                                                                                                     | Claim and authenticated RTDN routes.                                                                                    |
| S3           | `EDU_STORAGE_AWS_REGION`, `EDU_STORAGE_S3_BUCKET`; optional `EDU_STORAGE_CDN_BASE_URL`, `EDU_STORAGE_AWS_ENDPOINT`                                                                                                                                | User-scoped direct upload routes. Prefer an IAM role; static AWS keys are only a local exception.                       |
| Email        | `EDU_EMAIL_*` sender settings plus either `EDU_SMTP_*` or `EDU_RESEND_API_KEY`; branded templates also need `EDU_EMAIL_LOGO_URL`, `EDU_EMAIL_CLIENT_BASE_URL`, `EDU_EMAIL_SUPPORT_EMAIL`, `EDU_EMAIL_TERMS_URL`, `EDU_EMAIL_PRIVACY_URL`          | Authentication and marketing email delivery. `EDU_EMAIL_UNSUBSCRIBE_HMAC_KEY` enables durable public unsubscribe links. |
| SMS          | `EDU_SMS_*`, `EDU_TWILIO_ACCOUNT_SID`, `EDU_TWILIO_AUTH_TOKEN`                                                                                                                                                                                    | Authentication phone challenges through Twilio.                                                                         |
| Push         | `EDU_NOTIFICATION_*`                                                                                                                                                                                                                              | Persists safe sender configuration only. Provider credential adapters are not yet composed into the executable API.     |
| OAuth        | `EDU_AUTH_{GOOGLE,GITHUB,FACEBOOK}_{CLIENT_ID,CLIENT_SECRET,CALLBACK_URL}`                                                                                                                                                                        | Enables a provider only when its complete triple is present. Non-local callback URLs must be HTTPS.                     |
| Telemetry    | `LIFE_OPTIMIZER_LOG_JSON`, `LIFE_OPTIMIZER_LOG_FILE`, `LIFE_OPTIMIZER_LOG_HTTP_ENDPOINT`                                                                                                                                                          | Safe structured operational events. HTTP collection must use HTTPS.                                                     |

## Cache, events, CMS, and workers

`pnpm cache:up` starts local Redis and `EDU_CACHE_REDIS_URL=redis://localhost:6379/0` validates the cache adapter. The executable API does not yet construct that adapter, so Redis is not currently a readiness dependency and no API read is server-cached.

`pnpm events:up` starts LocalStack SNS/SQS. `EDU_EVENTS_AWS_REGION`, optional local `EDU_EVENTS_AWS_ENDPOINT`, AWS credentials/workload identity, and topic ARNs configure the event adapter. The API writes transactional outbox rows, but no outbox publisher process is currently shipped; LocalStack alone does not deliver database outbox rows.

The CMS package has in-memory draft/publication stores and an S3 publisher contract, but the API has no CMS composition or routes. Do not use the in-memory stores as production persistence.

No scheduler executable currently runs subscription renewals, dunning, entitlement expiration/reconciliation, final account erasure, notification delivery/purging, or outbox publishing. A deployment must not approximate these with unleased ad-hoc cron requests. Add a leased, retrying worker and observable failed-job state first.

## Provider callback checklist

1. Deploy the API behind HTTPS and confirm `/health/ready` is healthy.
2. Register the exact callback URL and event selection documented under `packages/financial/docs/setup-*.md`.
3. Keep webhook signing secrets/provider credentials only in deployment secrets.
4. Send a provider sandbox/test event and verify the callback returns success, the provider event is deduplicated, and the expected payment/entitlement/audit/outbox rows exist.
5. Retry the same event and verify that no second financial or entitlement change occurs.
6. Configure provider retry and alerting. PowerTranz additionally needs reconciliation for a browser that never returns.

## Production checks and troubleshooting

- `401`: bearer/API-key authentication failed; do not log the credential.
- `403`: inspect the caller's persisted role permissions and support-safe access policy. CORS is unrelated to server authorization.
- `422 PROVIDER_UNAVAILABLE`: the requested checkout adapter is not composed.
- `503 /health/ready`: inspect only the named failed dependency in internal telemetry; the response intentionally hides connection details.
- Webhook retry loop: verify exact secret/audience/service-account configuration and raw-body handling, then inspect dedupe/provider-event state by correlation ID.
- Stale access: the current executable API has no entitlement cache. Inspect payment/store state and entitlement dates/revocation directly, then run reconciliation manually until a worker exists.

Before deployment run `pnpm verify`, the PostgreSQL migration/integration path, the CLI smoke test, and the Docker test target used by GitHub Actions.
