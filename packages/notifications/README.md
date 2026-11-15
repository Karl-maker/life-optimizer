# `@life-optimizer/notifications`

Push notifications are stored per recipient/device, rate-limited before dispatch, consent-suppressed for marketing, idempotent per device, and retained for support for 90 days. Register devices with `database.notifications.saveDevice()`; a user may have multiple Android, iOS, desktop, or browser endpoints.

```ts
const notifications = createNotificationService({
  repository: database.notifications,
  adapters: [
    createFcmAdapter({ projectId: "life-optimizer", accessToken }),
    createAwsSnsAdapter(snsClient),
    createWebPushAdapter(vapidSender),
  ],
});
await notifications.send({
  configurationId: "mobile-primary",
  recipientId: "user-42",
  purpose: "transactional",
  title: "Lesson ready",
  body: "Your new lesson is available.",
  data: { lessonId: "lesson-9" },
  idempotencyKey: "lesson-ready:lesson-9",
});
```

Use FCM device tokens with `fcm`, and SNS endpoint ARNs with `aws-sns`; AWS SNS can deliver APNs and FCM. Browser endpoints are sent through a composition-owned VAPID/web-push sender. Provider credentials and VAPID private keys remain outside this package and database. Call `unsubscribe()` for marketing preferences and `purgeExpiredDeliveryLogs()` from a scheduler. These adapters follow [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send-message), [AWS SNS mobile push](https://docs.aws.amazon.com/sns/latest/dg/sns-mobile-application-as-subscriber.html), and the browser [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).
