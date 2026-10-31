# Dunning

**Implementation status:** attempt table and provider event names exist. There is no attempt writer, retry scheduler, grace-policy engine, finalization failure handler, or automated access decision. Do not treat the table or event catalog as an active collection workflow.

Dunning is the collection workflow after an invoice cannot be paid. Record each attempt with invoice ID, attempt number, state, bounded provider failure category/code, whether customer action is required, next attempt time, and provider event ID. Do not store unbounded provider messages.

`financial.dunning.payment_failed` schedules the retry/grace workflow. `financial.dunning.action_required` means SCA/3DS, mandate approval, or payment-method action is needed—send the customer to the provider and avoid blind retries. `financial.dunning.payment_succeeded` clears the workflow. `financial.dunning.overdue` escalates the configured notice/restriction. `financial.dunning.exhausted` is the point at which policy may pause/cancel future service or revoke future grants.

Define the retry schedule, grace duration, notification templates, and access restriction independently from provider “smart retry” settings. Provider retry advice can inform a schedule but must not silently define product access. Keep access during a clearly defined grace period; record every state transition with audit and outbox events.

An implementation must distinguish `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.finalization_failed`, `invoice.overdue`, `invoice.marked_uncollectible`, and `invoice.paid`; also monitor failed PaymentIntents and Checkout asynchronous failures. Use a unique provider event ID or `(invoice, attemptNumber)` to deduplicate attempts, retain only bounded failure categories/codes, and store `nextAttemptAt`. A scheduled worker should claim due rows, apply backoff and a maximum attempt count, emit notification requests, then move to exhausted only after the grace policy says so. The provider may retry independently; reconcile against the current invoice before attempting a local retry.

Stripe's [event type reference](https://docs.stripe.com/api/events/types) documents these distinct signals. A failed attempt is not equivalent to a canceled subscription or immediate entitlement revocation.
