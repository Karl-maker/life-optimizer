# `@life-optimizer/email`

Provider-neutral email delivery for notices, updates, newsletters, and operational alerts. The package does not open a network connection or hold credentials: an application injects an `EmailTransport`, which resolves the configuration's `credentialReference` at the infrastructure edge.

## How it works

An owning package calls `send()` with a configuration, template, recipient, purpose, and bounded HBS data. The service renders escaped `header`, `main`, and `footer` partials, atomically reserves one recipient-rate-limit slot, then tries the primary transport configuration and its ordered fallbacks. It returns `sent`, `skipped`, or `failed`; provider and persistence failures therefore do not throw into the caller's business operation. A retry should reuse `idempotencyKey`.

Marketing sends require an `unsubscribeTopic`. The repository checks a durable recipient/topic suppression before reserving the send. A trusted owning application can call `unsubscribe()` after handling its own link/token; this package intentionally exposes no HTTP endpoint. When it supplies `unsubscribeUrl`, the sender also sets standard `List-Unsubscribe` headers and injects `unsubscribeUrl` / `unsubscribeToken` into HBS context.

Rendered subject, HTML, and text are retained in the delivery log for support for exactly 90 days when a scheduled owner calls `purgeExpiredDeliveryLogs()`. Do not place credentials or message bodies in telemetry: this package logs only purpose, configuration ID, fallback status, duration, and an outcome.

## Standard templates and footers

`createStandardEmailTemplates(presentation)` builds the seeded catalog. Presentation comes from `readEmailPresentationConfiguration()` (`EDU_EMAIL_LOGO_URL`, `EDU_EMAIL_CLIENT_BASE_URL`, `EDU_EMAIL_SUPPORT_EMAIL`, `EDU_EMAIL_TERMS_URL`, `EDU_EMAIL_PRIVACY_URL`, optional `EDU_EMAIL_BRAND_NAME`).

| Template id                                  | Purpose                                                           | Footer        |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------- |
| `forget-password`                            | Password reset link (`{{client}}/reset-password#token={{token}}`) | Transactional |
| `confirmation`                               | Email confirmation link (`…/confirm#token={{token}}`)             | Transactional |
| `auth-delete-account` / `auth-undo-deletion` | Account-deletion codes                                            | Transactional |
| `upcoming-policy-change`                     | Policy notice                                                     | Marketing     |
| `welcome`                                    | Welcome / onboarding                                              | Marketing     |
| `newsletter`                                 | Recurring updates (`{{subject}}`, `{{body}}`)                     | Marketing     |
| `general-notice`                             | One-off notice; optional CTA via `{{#if ctaUrl}}`                 | Marketing     |

Transactional footers include support, terms, and privacy only. Marketing footers add:

```html
<a href="{{clientBaseUrl}}/unsubscribe?token={{unsubscribeToken}}">
  Unsubscribe from these emails
</a>
```

Auth / reset / confirmation mail must never include an unsubscribe control.

## Marketing unsubscribe

Best practice: the unsubscribe link should still work far into the future.

When clicked:

1. Accept the opaque token without requiring login.
2. Immediately create/update a durable suppression record for that email + topic.
3. Show “You’ve been unsubscribed.”
4. Never include the recipient email in the URL.
5. Keep the suppression record even if the user later deletes their account, so you do not accidentally market to them again.

A forwarded link could unsubscribe the recipient it belongs to. That is generally an acceptable tradeoff for an opt-out; it cannot expose account data or subscribe anyone.

Compliance-wise, marketing opt-out must be easy, prompt, and effective. GDPR requires withdrawal to be as easy as consent was given, and UK direct-marketing guidance says to stop the covered marketing and retain a suppression/do-not-contact record.

Composition wiring:

1. Keep `EDU_EMAIL_UNSUBSCRIBE_HMAC_KEY` stable (32+ bytes). Tokens deliberately do not expire.
2. Issue a token with `createEmailUnsubscribeTokens(key).issue({ recipient, topic })`.
3. Build the client page URL with `marketingUnsubscribeUrl({ clientBaseUrl, token })` → `https://app.example.com/unsubscribe?token=…`.
4. Send marketing mail with `purpose: "marketing"`, `unsubscribeTopic`, `unsubscribeUrl`, and `unsubscribeToken`.
5. The IsEd web app serves `/unsubscribe?token=…` (locale middleware may prefix `/en`). It strips the token from the address bar, then the BFF `POST /api/email/unsubscribe` forwards `{ token }` to `POST /email/unsubscribe`. The API verifies the token and calls `email.unsubscribe()`.

## Creating HBS templates

Create an `EmailTemplate` through `database.emails.saveTemplate()`. The service always composes the HTML email as `headerPartial + mainTemplate + footerPartial`; do not include `{{> header}}` or `{{> footer}}` in `mainTemplate` yourself. Subject and text are compiled separately. `{{year}}` is injected automatically for copyright lines.

```ts
import {
  createStandardEmailTemplates,
  marketingUnsubscribeUrl,
  readEmailPresentationConfiguration,
} from "@life-optimizer/email";

const presentation = readEmailPresentationConfiguration(process.env)!;
await Promise.all(
  createStandardEmailTemplates(presentation).map((template) =>
    database.emails.saveTemplate(template),
  ),
);

const token = unsubscribeTokens.issue({
  recipient: "learner@example.edu",
  topic: "newsletter",
});
const unsubscribeUrl = marketingUnsubscribeUrl({
  clientBaseUrl: presentation.clientBaseUrl,
  token,
});

await email.send({
  configurationId: "transactional-smtp-primary",
  templateId: "newsletter",
  recipient: "learner@example.edu",
  purpose: "marketing",
  unsubscribeTopic: "newsletter",
  unsubscribeUrl,
  unsubscribeToken: token,
  idempotencyKey: "newsletter:learner-42:2026-W44",
  data: {
    subject: "This week in learning",
    body: "You completed two new lessons this week.",
    recipientName: "Avery",
  },
});
```

General notices can omit the CTA card by passing empty `ctaUrl` / `ctaLabel` strings (strict HBS requires the keys):

```ts
await email.send({
  configurationId: "transactional-smtp-primary",
  templateId: "general-notice",
  recipient: "learner@example.edu",
  purpose: "marketing",
  unsubscribeTopic: "product-updates",
  unsubscribeUrl,
  unsubscribeToken: token,
  data: {
    subject: "Maintenance window",
    body: "We will be offline on Saturday from 02:00–04:00 UTC.",
    recipientName: "",
    ctaUrl: "https://status.example.com",
    ctaLabel: "View status",
  },
});
```

Handlebars values are HTML-escaped, so `{{summary}}` is safe for ordinary text. Triple-stash (`{{{value}}}`) and unescaped (`{{& value}}`) expressions are rejected. Template data is capped at 64 KB and each template field at 100 KB. Use plain HBS values and built-in control flow only; do not use templates as a way to inject trusted raw HTML.

## Configuration constraints

- Store only a credential reference, never SMTP/API secrets.
- Use a recipient-wide database reservation, not an in-memory counter, so multiple workers cannot oversend.
- HBS triple-stash/unescaped output is rejected; HTML values are escaped by default.
- Fallback configurations retry the same reserved email through another provider account. They do not bypass recipient limits or unsubscribe choices.

## Design references

This deliberately keeps the useful operational boundaries of open-source mailing-list systems such as [listmonk](https://github.com/knadh/listmonk): separate subscriber suppression, templates, and sender accounts. The one-click `List-Unsubscribe-Post` header follows [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058). The transport port also permits SMTP or provider-API adapters without locking the domain to either; SMTP's portability is described in [Nodemailer’s transport documentation](https://nodemailer.com/smtp).
