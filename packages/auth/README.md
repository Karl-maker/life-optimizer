# Authentication and authorization

`@edu-service/auth` is the infrastructure edge for the authentication use cases in `@edu-service/core`. Core owns account, session, confirmation, reset, risk, consent and deletion behavior; `@edu-service/db` persists it; `@edu-service/api` exposes it. Provider secrets and framework concerns never enter core.

## Security model

- Local passwords use scrypt (`N=2^17`, `r=8`, `p=1`) with a random 16-byte salt per password and an independent HMAC pepper. The pepper belongs in AWS Secrets Manager, not PostgreSQL or source control.
- Session, confirmation and reset values are 256-bit opaque random secrets. Only HMAC digests are stored. A reset revokes every active session.
- Browser sessions use `Secure`, `HttpOnly`, `SameSite=Lax`, host-only cookies plus a double-submit CSRF value. API, mobile and CLI clients receive the same revocable opaque token as a bearer credential.
- A session has a 30-day absolute lifetime and a 24-hour idle lifetime. Account deletion requires password reauthentication within ten minutes, then a separate verified-channel callback while signed in.
- Every account starts with role `user`. The service never promotes an account from signup, OAuth claims, email domain or feature flags. An administrator must make a separately audited database/application change.
- Login history records bounded IP, country, client, device and optional CloudFront signals. It never records passwords, tokens, cookies, request bodies or OAuth credentials.

These choices follow the [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), and [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) guidance.

## Compose it

At application startup:

1. Load and validate `packages/auth/.env.example` values from AWS Secrets Manager. Generate a deployment-specific dummy password hash with `createDummyPasswordHash`; do not use a shared literal.
2. Build `createScryptPasswordHasher`, `createHmacSecretCodec`, `database.authentication`, a verification delivery adapter, and `RedisIdentityBloomFilter`.
3. Pass them to `createAuthenticationService`. Supply only fully configured OAuth provider names in `enabledProviders`.
4. Pass the service to `createApiServer({ authentication: { service, oauth } })`. The optional OAuth broker is the protocol adapter described below.

RedisBloom is an optimization, never identity truth. A negative skips PostgreSQL; a positive still queries it because Bloom filters have false positives. Redis stores only HMACed normalized email/phone values. A new filter returns “possibly present” until a complete PostgreSQL backfill finishes and the operator calls `markReady(kind)`. New identities are added before their database insert, so a failure can create only a safe false positive, never a false negative. If Redis is unavailable, core safely checks PostgreSQL. Configure Redis 8 (or the RedisBloom module), persistence/replication appropriate to the deployment, no eviction for these keys, and capacity above expected identities. Rebuild and mark ready after HMAC-key rotation.

The verification delivery adapter should enqueue email/SMS through a durable outbox before resolving. Core deliberately keeps signup/reset/resend responses uniform if delivery reports a failure; wire `onDeliveryFailure` to bounded operational telemetry and alerting, then let users retry the generic resend endpoint. Never include the recipient or token in that telemetry.

## HTTP endpoints

| Endpoint                                  | Purpose                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /auth/methods`                       | Returns local plus only fully configured OAuth providers.                                                |
| `POST /auth/signup`                       | Creates a normal local account and sends confirmation; the response does not reveal an existing email.   |
| `POST /auth/login`                        | Local login. `client=website` sets cookies; `api`, `mobile`, or `cli` returns a bearer token.            |
| `POST /auth/oauth/:provider/start`        | Starts an enabled provider transaction.                                                                  |
| `POST /auth/oauth/:provider/callback`     | Completes the provider authorization-code transaction.                                                   |
| `POST /auth/confirm`                      | Consumes a one-time email or phone confirmation.                                                         |
| `POST /auth/confirmation/resend`          | Reissues a pending confirmation with a generic response.                                                 |
| `POST /auth/password/forgot`              | Always returns the same accepted response.                                                               |
| `POST /auth/password/reset`               | Consumes a one-time reset and revokes all sessions.                                                      |
| `POST /auth/reauthenticate`               | Renews assurance for sensitive actions.                                                                  |
| `POST /auth/logout`                       | Revokes the current server-side session.                                                                 |
| `POST /auth/devices`                      | Upserts mobile/browser device and push metadata.                                                         |
| `PUT /auth/profile/image`                 | Attaches/clears a user-uploaded HTTPS image after the storage workflow.                                  |
| `DELETE /auth/account`                    | After recent reauthentication, sends a one-time deletion confirmation callback.                          |
| `POST /auth/account/deletion/confirm`     | Requires fresh reauthentication plus callback, schedules deletion, revokes sessions and sends undo link. |
| `POST /auth/account/deletion/undo`        | Restores the account during its grace period and creates a new session.                                  |
| `POST /auth/account/deletion/undo/resend` | Generically resends recovery for an eligible pending account.                                            |
| `POST /compliance/consents`               | Appends a receipt for an exact policy key/version and category decision.                                 |

All request objects are strict and bounded. Add rate limits keyed by both IP and normalized account identifier at the deployment/WAF boundary; the API's global limiter is only a baseline. Never cache authentication, personalized, permission-scoped or error responses.

## Authentication events

Successful auth actions and security-relevant login outcomes append a versioned event to PostgreSQL `event_outbox`. The row is written in the same transaction as the credential, session, challenge, consent, device, profile, or deletion change. An outbox worker publishes these immutable facts on the `identity` topic through `@edu-service/events`; delivery is at least once, so consumers must deduplicate by envelope `id`. Payloads intentionally contain stable IDs and classifications only—never email addresses, phone numbers, IP addresses, device IDs, push tokens, secrets, cookies, or callback tokens.

All current contracts are version `1`:

| Event                                  | Emitted when                                                                  | Payload                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| `auth.account.created`                 | A local or OAuth account is persisted.                                        | `{ userId, provider, hasEmail, hasPhone }`                |
| `auth.login.succeeded`                 | A login audit records a successful local or OAuth login.                      | `{ userId, provider, riskLevel }`                         |
| `auth.login.rejected`                  | A login audit records a rejected attempt.                                     | `{ userId: string \| null, provider, riskLevel, reason }` |
| `auth.contact.confirmation-requested`  | An email/phone confirmation challenge is persisted, including a resend.       | `{ userId, channel }`                                     |
| `auth.contact.confirmed`               | The verified contact is committed.                                            | `{ userId, channel }`                                     |
| `auth.password-reset.requested`        | A password-reset challenge is persisted.                                      | `{ userId }`                                              |
| `auth.password.reset`                  | The replacement password hash is committed.                                   | `{ userId }`                                              |
| `auth.session.created`                 | A browser, API, mobile, or CLI session is persisted.                          | `{ userId, riskLevel }`                                   |
| `auth.session.reauthenticated`         | Recent-login assurance is renewed.                                            | `{ userId }`                                              |
| `auth.session.revoked`                 | The current session is revoked by logout.                                     | `{ userId, reason: "logout" }`                            |
| `auth.sessions.revoked`                | All active sessions are revoked after a password reset or confirmed deletion. | `{ userId, reason, count }`                               |
| `auth.device.upserted`                 | A registered client device is created or refreshed.                           | `{ userId, platform }`                                    |
| `auth.consent.recorded`                | An append-only policy receipt is committed.                                   | `{ userId, policyKey, policyVersion, locale, decision }`  |
| `auth.profile-image.updated`           | A profile image is set or cleared.                                            | `{ userId, operation, source }`                           |
| `auth.account.deletion.requested`      | The verified-channel deletion callback is persisted.                          | `{ userId }`                                              |
| `auth.account.deletion.scheduled`      | Callback confirmation commits `deletion-pending` and its grace deadline.      | `{ userId, scheduledFor }`                                |
| `auth.account.deletion.undo-requested` | An undo callback is persisted, including a resend.                            | `{ userId, expiresAt }`                                   |
| `auth.account.deletion.cancelled`      | A pending deletion is restored during the grace period.                       | `{ userId }`                                              |

Payload field types are fixed by `EventCatalog`: IDs and policy/locale fields are bounded strings; `provider` is `local | google | github | facebook`; `riskLevel` is `low | medium | high`; `channel` is `email | phone`; `platform` is `browser | ios | android | cli | other`; `decision` is `accepted | rejected | withdrawn`; `operation` is `set | cleared`; `source` is `provider | user`; session-revocation `reason` is `logout` for one session or `password-reset | account-deletion` for bulk revocation; `count` is a number; and `scheduledFor`/`expiresAt` are ISO-8601 timestamps. Rejection `reason` is a bounded stable code, not a provider error or user-supplied message. Consumers must reject unknown versions or invalid payloads at their JSON boundary rather than silently guessing.

The login audit remains the restricted security record for bounded IP, country, device, CloudFront signals, correlation ID, and rejection detail; the integration event is deliberately less sensitive. Deletion scheduling and cancellation additionally write append-only audit events with actor, resource, correlation ID, and deadline. Sliding session touches do not emit an integration event because they are high-volume liveness updates, and invalid/replayed callbacks do not emit business facts because no state changed. Verification-delivery failures are operational telemetry through `onDeliveryFailure`, not domain events. The future final-erasure worker must define and atomically emit a new versioned completion event when it implements irreversible deletion; `auth.account.deletion.scheduled` must not be interpreted as erasure.

### Third-party API callers

Human/API/mobile/CLI bearer sessions and third-party integrations share authorization semantics but not credentials. Compose `createCompositeApiAuthenticator({ sessions, apiKeys })`: bearer tokens resolve through the revocable core session, while external services use `X-API-Key` through a deployment-owned `ApiKeyVerifier`. Both produce a stable principal ID and explicit permission allow-list. The core `ApiAccessAuthorizer` and database access-policy reader can then deny or require an explicit allow rule per endpoint. Store only a keyed hash of each generated high-entropy API secret, show the plaintext once, support overlapping credentials during rotation, record last use, and revoke server-side. Never derive permissions from a key prefix, caller-supplied claims, OAuth profile, feature flag or CMS data. Route handlers declare permissions in `defineJsonRoute`, so the generated OpenAPI contract and runtime enforcement stay aligned.

Use bearer sessions for a person acting interactively and API keys for a service/integration. Do not put either in URLs, logs or analytics. In AWS, keep credential HMAC keys in Secrets Manager/KMS, restrict the origin to CloudFront/API Gateway as applicable, and use the existing global/endpoint access policy for incident blocking without disclosing the operator reason.

## OAuth setup

A provider is disabled unless client ID, client secret, and exact HTTPS callback URL are all present. Register the callback URL shown in `.env.example` in the Google, GitHub and Facebook consoles. Google should request OpenID Connect scopes `openid email profile`; GitHub needs the minimum user/email scopes; Facebook needs only the minimum public profile/email permissions actually used.

The injected `OAuthLoginBroker` must implement Authorization Code with PKCE (`S256`), unpredictable single-use state, an OIDC nonce where supported, exact redirect matching, short transaction expiry, and provider token/issuer/audience/signature validation. Store transaction state and PKCE verifier server-side (Redis is suitable). The broker returns only a verified issuer subject/profile; core creates or finds the normal-user account, audits the login, assesses risk and issues the session. Never accept an access token supplied by the client as proof of identity, and never automatically link accounts solely because two providers report the same email. Require an authenticated, recently reauthenticated user for explicit linking. Auth.js documents the same [dangerous email-linking boundary](https://authjs.dev/reference/core/providers#allowdangerousemailaccountlinking), and Google documents server-side [OpenID Connect verification](https://developers.google.com/identity/openid-connect/openid-connect).

Provider profile images may populate `profileImageUrl` with source `provider` on first login. Once a user uploads an image, set source `user`; subsequent provider logins must not overwrite it.

## Risk, devices and CloudFront

Core's conservative default marks missing IP/unknown platforms high risk and incomplete device/country context medium risk. Production should inject an `AuthenticationRiskAssessor` that compares known devices, impossible travel, ASN/reputation, velocity and recent account changes. High-risk sessions set `reauthenticationRequired`; an optional `SecurityNotification` sends a best-effort email/push alert while the durable login audit remains authoritative.

Only enable `trustCloudFrontHeaders` when the origin is inaccessible except through your distribution and the origin/request policy overwrites viewer headers. `CloudFront-Viewer-Country`, viewer address, ASN and JA3/JA4 are risk signals—not identity or authorization evidence. AWS documents the available [CloudFront viewer headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html). Strip spoofed copies at the edge.

Mobile clients call `/auth/devices` after login and whenever push token, app version, locale or time zone changes. A push token is sensitive operational data: restrict access, rotate it, delete it during account erasure, and never place it in telemetry.

## Compliance and deletion

Publish privacy, terms and cookie policies through `@edu-service/cms` under `policies/<policy-key>`. The CMS enforces that policy content has no feature gates: language and scheduled publication may vary, but every user in the same legal scope receives the same published version. Consent receipts are append-only and retain exact policy version, decision, categories, time, correlation ID, country and IP.

Deletion is a workflow, not an immediate cascading `DELETE`. The initial request requires reauthentication within ten minutes but changes no account state. A one-time email/SMS callback must then be submitted with an active session that is still recently reauthenticated; if it has aged out, the user signs in or reauthenticates again before confirming. Only that confirmation runs `beforeDelete` callbacks, atomically marks the account `deletion-pending`, records `deletionScheduledFor`, writes the audit event, revokes every session, and sends an independent undo callback.

The default recovery window is 30 days. Deployments may set `deletionGraceMs` from one hour through 90 days. During that window the undo callback runs optional `beforeRestore` callbacks, clears the deletion timestamps, restores `active`, and issues a fresh risk-assessed session. Resend responses are uniform to prevent account discovery. Once `deletionScheduledFor` passes, a worker should erase or irreversibly anonymize data according to retention/legal-hold rules, preserve only legally required audit evidence, and mark the account `deleted`; an expired callback cannot restore it. Document retention periods and data processors outside code.

## CLI

The CLI uses the public API, not direct credential tables:

```sh
edu-service auth login --api-url https://api.example.com --email person@example.com
edu-service auth logout
```

Login reads the password from a hidden interactive prompt; there is intentionally no password flag. The opaque token is stored in the existing mode-0600 CLI config and is never printed. Logout revokes it remotely before removing the local copy; if the API is unreachable the local copy is retained so revocation can be retried.

## Extending authentication

Add business behavior to core interfaces/use cases first, persistence to `PrismaAuthStore`, transport validation to the colocated API route, and provider/network code to this adapter package or the composition root. For a meaningful successful state change, add its name to core's `AUTH_EVENT`, its typed versioned payload to `@edu-service/events`, and append it to `event_outbox` in the same Prisma transaction; never publish directly from a request transaction. Add normal, malformed, boundary, ownership, replay, event-shape, and transaction tests. New risk inputs must be bounded and privacy-reviewed. New roles or permissions require explicit authorization-policy changes and migration; they must never be inferred from a feature flag, CMS document or external profile.
