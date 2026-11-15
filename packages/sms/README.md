# `@life-optimizer/sms`

SMS uses durable configuration, templates, recipient-wide rate limits, idempotency, consent suppression, fallback provider accounts, and 90-day delivery-body retention. `send()` always returns a safe outcome; it does not throw normal provider failures into an owning use case.

## Twilio

Create the adapter at application composition, never store its account token in PostgreSQL. Configuration records hold a sender number and adapter ID (`twilio`), allowing several phone numbers/accounts.

```ts
const sms = createSmsService({
  repository: database.sms,
  adapters: [
    createTwilioSmsAdapter({
      accountSid: process.env.TWILIO_ACCOUNT_SID!,
      authToken: process.env.TWILIO_AUTH_TOKEN!,
    }),
  ],
});
await database.sms.saveTemplate({
  id: "lesson-reminder",
  bodyTemplate: "Hi {{name}}, your {{lesson}} starts soon.",
  createdAt: new Date(),
  updatedAt: new Date(),
});
await sms.send({
  configurationId: "reminders",
  templateId: "lesson-reminder",
  recipient: "+15551234567",
  purpose: "transactional",
  idempotencyKey: "lesson:42:reminder",
  data: { name: "Avery", lesson: "math lesson" },
});
```

Recipients must be E.164 numbers. HBS escapes values; raw HBS is rejected, body data is capped at 16 KB, and rendered text at 1,600 characters. Marketing sends require an unsubscribe topic; call `sms.unsubscribe()` from a trusted opt-out webhook or UI handler. Call `purgeExpiredDeliveryLogs()` from a scheduled job. Twilio’s [Messages API](https://www.twilio.com/docs/messaging/api/message-resource) is the concrete provider contract used by this adapter.
