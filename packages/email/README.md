# `@edu-service/email`

Provider-neutral email delivery for notices, updates, newsletters, and operational alerts. The package does not open a network connection or hold credentials: an application injects an `EmailTransport`, which resolves the configuration's `credentialReference` at the infrastructure edge.

## How it works

An owning package calls `send()` with a configuration, template, recipient, purpose, and bounded HBS data. The service renders escaped `header`, `main`, and `footer` partials, atomically reserves one recipient-rate-limit slot, then tries the primary transport configuration and its ordered fallbacks. It returns `sent`, `skipped`, or `failed`; provider and persistence failures therefore do not throw into the caller's business operation. A retry should reuse `idempotencyKey`.

Marketing sends require an `unsubscribeTopic`. The repository checks a durable recipient/topic suppression before reserving the send. A trusted owning application can call `unsubscribe()` after handling its own link/token; this package intentionally exposes no HTTP endpoint. When it supplies `unsubscribeUrl`, the sender also sets standard `List-Unsubscribe` headers and injects `unsubscribeUrl` into HBS context.

Rendered subject, HTML, and text are retained in the delivery log for support for exactly 90 days when a scheduled owner calls `purgeExpiredDeliveryLogs()`. Do not place credentials or message bodies in telemetry: this package logs only purpose, configuration ID, fallback status, duration, and an outcome.

## Creating HBS templates

Create an `EmailTemplate` through `database.emails.saveTemplate()`. The service always composes the HTML email as `headerPartial + mainTemplate + footerPartial`; do not include `{{> header}}` or `{{> footer}}` in `mainTemplate` yourself. Subject and text are compiled separately.

```ts
await database.emails.saveTemplate({
  id: "weekly-learning-update",
  subjectTemplate: "Your weekly update, {{learnerName}}",
  headerPartial: `
    <header style="font-family: sans-serif">
      <strong>{{schoolName}}</strong>
    </header>`,
  mainTemplate: `
    <main style="font-family: sans-serif">
      <h1>Keep learning, {{learnerName}}</h1>
      <p>{{summary}}</p>
    </main>`,
  footerPartial: `
    <footer style="font-family: sans-serif">
      <p>You received this because you subscribed to {{schoolName}} updates.</p>
      <a href="{{unsubscribeUrl}}">Unsubscribe</a>
    </footer>`,
  textTemplate: "{{schoolName}}: {{summary}}\nUnsubscribe: {{unsubscribeUrl}}",
  createdAt: new Date(),
  updatedAt: new Date(),
});
```

Then send it with matching data. Marketing email requires both a stable topic and an HTTPS unsubscribe URL; the owning application is responsible for making that URL authenticate or verify the recipient before it calls `email.unsubscribe()`.

```ts
await email.send({
  configurationId: "transactional-smtp-primary",
  templateId: "weekly-learning-update",
  recipient: "learner@example.edu",
  purpose: "marketing",
  unsubscribeTopic: "weekly-learning-update",
  unsubscribeUrl: "https://app.example.edu/unsubscribe/signed-token",
  idempotencyKey: "weekly-update:learner-42:2026-W44",
  data: {
    learnerName: "Avery",
    schoolName: "Edu Service",
    summary: "You completed two new lessons this week.",
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
