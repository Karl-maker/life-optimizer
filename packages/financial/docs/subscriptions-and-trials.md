# Subscriptions, trials, and add-ons

**Implementation status:** data types/tables and verified Stripe status synchronization by a bound provider reference exist. Creation, renewal, cancellation, proration, trial scheduler, and automatic entitlement provisioning are not implemented. A `customer.subscription.updated` event does not by itself grant access.

Create a subscription from a product and immutable price. Persist the provider subscription reference, status, current period end, and trial end. A trial starts an entitlement grant ending at `trialEndsAt`; it does not bypass entitlement checks. Choose the post-trial no-payment-method policy explicitly: cancel, pause, or invoice/mark past due.

On a verified renewal payment, create or extend the entitlement grants through the new period end. On downgrade/upgrade, create a clear price transition and handle provider prorations as invoice lines; never mutate historical usage or invoice amounts. An add-on subscription is a separate product/price relationship and grants only its mapped entitlements.

Use `financial.subscription.trial_ending`, `financial.subscription.updated`, and `financial.subscription.canceled` for notifications and access-policy orchestration. Do not revoke the current paid-period grant merely because a cancellation is scheduled for period end.

To implement this flow, create a pending local subscription linked to a validated product/price before calling the provider. Store its provider reference with a unique `(provider, reference)` pair. On a verified event, compare the event time with `lastProviderEventAt`; stale events cannot regress status. For ambiguous equal timestamps or complex provider changes, fetch the current provider object and reconcile it explicitly. Create trial/paid grants through a trusted financial manager in the same transaction as the local subscription state and outbox entry. The current `applyProviderEvent` only updates status, so it is insufficient for selling subscriptions until this orchestration exists.
