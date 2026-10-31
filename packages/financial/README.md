# `@edu-service/financial`

Provider-neutral financial domain for user entitlements, metered usage, provider-token payment methods, internal credits, and signed Stripe event ingestion. The database also contains initial product, price, subscription, invoice, coupon, and dunning tables. Those tables are **not yet a complete billing service**: catalog authoring, invoice issuance and lines, coupon redemption, refunds, subscription lifecycle, dunning retries, and PowerTranz payments do not have production use cases. Do not expose the unfinished flows as a selling API.

For implementation-level procedures, start with the [financial developer guide](./docs/README.md). It contains separate documents for catalog/pricing, usage limits, one-off payments and payment methods, subscriptions/trials, invoices/discounts/refunds/wallets, dunning, and provider webhooks.

## Storage contract

`packages/db` supplies the PostgreSQL implementation. Prices, invoice totals, wallet entries, and payment values are `BIGINT` integer minor units paired with uppercase ISO-4217 currency codes. Never use JavaScript floating-point values for money. For example, USD 10.00 is `{ currency: "USD", amountMinor: 1000n }`; JPY 10 is `{ currency: "JPY", amountMinor: 10n }`. Currency exponent and provider-specific exceptions must be checked against the provider's currency rules when accepting a price; a three-letter format check alone does not establish support. Preserve the original price, currency, amount, frequency, interval, tax/discount result, and provider references on issued invoices. The current schema lacks invoice lines and applied-discount snapshots, so invoice issuance is not enabled.

The schema includes product and price catalogs (with risk level, trial timeline, billing frequency, and interval), subscriptions, invoices, provider-token payment methods, dunning attempts, coupons, and payment-provider events. Payment-method rows hold only a provider token/reference and optional display metadata such as brand/last four digits. They never hold a PAN, CVC/CVV, track data, or 3DS cryptograms.

`financial_accounts` is one account per user. A trusted manager can bind or remove a stable external key through `bindAccountKey`/`removeAccountKey`; resolve it through `findAccountByKey`. Keys are unique and cannot be transferred to another account. `entitlement_definitions` is the sole catalog for stable entitlement keys.

## Use it from a composition service

```ts
import { createFinancialService } from "@edu-service/financial";

const financial = createFinancialService({
  repository: database.financial,
  transactions: database.financialTransactions,
  operationLog,
});

await financial.registerEntitlementDefinition({
  key: "ai.chat.request",
  description: "One chat completion request",
  unit: "request",
  resetStrategy: "calendar_day",
  resetIntervalSeconds: null,
});
// manager is a trusted agent acting for this user with financial:manage permission.
await financial.grant({
  actor: manager,
  audit,
  userId,
  key: "ai.chat.request",
  quantity: 100n,
});
await financial.recordUsage({
  actor,
  audit,
  userId,
  entitlementKey: "ai.chat.request",
  quantity: 1n,
  idempotencyKey: requestId,
});
```

## Limits and reset strategies

A price does not contain a hard-coded limit. Instead, it maps to one or more stable entitlement definitions in `price_entitlements`. Each mapping supplies the allowance; the definition supplies the unit and reset rule. This lets `starter-monthly` grant 20 `ai.chat.request` per calendar day while `pro-monthly` grants 2,000 per calendar month, even though both use the same feature key.

| Reset strategy   | Meaning                                            | Example                      |
| ---------------- | -------------------------------------------------- | ---------------------------- |
| `never`          | One allowance for the whole active grant           | A 100-credit add-on pack     |
| `calendar_day`   | Resets at 00:00 UTC                                | 20 requests/day              |
| `calendar_week`  | Resets Monday 00:00 UTC                            | 500 requests/week            |
| `calendar_month` | Resets on day one, 00:00 UTC                       | 10,000 tokens/month          |
| `rolling`        | Counts use in the preceding `resetIntervalSeconds` | 60 requests per rolling hour |

All calendar windows use UTC deliberately; a product that needs a customer-local boundary should create a distinct explicit policy rather than silently applying a browser timezone. `recordUsage` sums append-only records within the applicable window before adding the new record. An allowance of `null` is unlimited. Usage still requires an idempotency key, so a retry does not consume allowance twice.

`grantForPrice` atomically grants all mappings in one transaction. It requires a trusted `financial:manage` actor. The caller must first validate that the price belongs to the product and is eligible; that catalog validation is not implemented yet. Do not call it directly from a checkout request or an unverified webhook.

Grant, revoke, usage, reversal, wallet, payment-method, and provider-event writes append audit and outbox records in the same transaction. Consumers must deduplicate events. Usage and wallet operations require caller-provided idempotency keys; retries return the original record. A missing active entitlement or insufficient wallet credit raises `DomainError("PAYMENT_REQUIRED")`. Its details identify the entitlement/currency; price selection is not yet wired to the error.

## Trials, coupons, billing, and dunning

`Price.trialDays`, `Subscription.trialEndsAt`, coupon rules, and dunning attempt fields are schema placeholders. No trial scheduler, coupon redemption, invoice issuance, or collection retry policy is implemented. The feature guides describe the intended contract and identify missing work explicitly.

Verified Stripe invoice/subscription events can update a matching local provider reference if the event is newer. A dunning attempt scheduler and policy are still required. Do not revoke a paid-period entitlement merely because a notification fails.

### Payment and dunning event contract

This table is the target contract. Today only recognized events for a bound invoice or subscription can advance local status and emit their specific event. Payment-method, refund, dispute, and trial-notice events are retained as generic provider events until their local handlers exist.

Save every signed provider notification as a deduplicated `PaymentProviderEvent` first. Emit the state event only if the event matched a local invoice/subscription and advanced its status; otherwise emit `financial.provider-event.applied` for reconciliation. A payment failure is not synonymous with subscription cancellation. Failure classification and next-attempt extraction are not yet implemented.

| Provider condition                                | Stable event                                                                                               | Required policy decision                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| invoice payment failed                            | `financial.dunning.payment_failed`                                                                         | Schedule retry/grace communication; retain access during configured grace    |
| user action/SCA needed                            | `financial.dunning.action_required`                                                                        | Ask customer to authenticate/update the payment method; do not blindly retry |
| payment succeeds / invoice paid                   | `financial.dunning.payment_succeeded` / `financial.invoice.paid`                                           | Clear dunning, extend grant, issue receipt                                   |
| due date passes                                   | `financial.dunning.overdue`                                                                                | Escalate notification or restrict only policy-defined features               |
| retry policy exhausted / uncollectible            | `financial.invoice.uncollectible`                                                                          | Apply a separately configured exhaustion policy before changing access       |
| invoice voided/refunded/disputed                  | `financial.invoice.voided`, `financial.payment.refunded`, `financial.payment.disputed`                     | Reconcile entitlement and wallet policy; disputes need manual-risk workflow  |
| subscription changes/cancels/trial approaches end | `financial.subscription.updated`, `financial.subscription.canceled`, `financial.subscription.trial_ending` | Recalculate grants or notify; do not infer access solely from an email event |
| payment method attaches/detaches                  | `financial.payment_method.attached`, `financial.payment_method.detached`                                   | Update token reference only; never store card credentials                    |

Subscribe to the corresponding provider events: Stripe’s invoice failures/successes/action-required, invoice finalization/overdue/uncollectible/voided, subscription lifecycle/trial ending, payment method lifecycle, refunds and disputes. The sync adapter must tolerate duplicate and out-of-order delivery; where a later transition is ambiguous, fetch the provider object before applying it.

## Stripe and PowerTranz

`StripeAdapter` creates one-off hosted Checkout sessions and verifies the `Stripe-Signature` header over the unmodified JSON text with a five-minute timestamp tolerance. Configure `EDU_STRIPE_SECRET_KEY` and `EDU_STRIPE_WEBHOOK_SECRET` only in the adapter host. If either is absent, `readFinancialConfiguration(environment, operationLog)` returns no Stripe adapter and emits the bounded `financial.provider.unavailable` operational event. Inject `stripeWebhook` into `createApiServer`; it installs the scoped raw-body parser and route. The application must supply a trusted actor and the financial sync service.

PowerTranz is disabled. Its public Swagger describes transaction endpoints but does not establish the merchant-specific authentication, hosted-page completion, and callback authenticity contract needed to handle funds safely. `readFinancialConfiguration` emits `financial.provider.unavailable` for it. See the provider guide for the exact contract required before implementation.

## Webhook synchronization checklist

1. Capture the raw body with a small bounded limit before JSON parsing.
2. Verify the provider signature and timestamp before interpreting the payload.
3. Derive a stable `(provider, eventId)` and save it first in the financial transaction. A duplicate is a successful no-op.
4. Resolve only a trusted provider-to-account key; do not trust a user ID copied from arbitrary payload fields.
5. Apply state transitions monotonically: compare provider event timestamps/version references and fetch the provider object when delivery order is uncertain.
6. Append the audit record and outbox event in the same transaction. Telemetry includes only provider, event type, result, correlation ID, and bounded IDs.

## Security and extension rules

Keep product, pricing, subscription, entitlement, wallet and invoice rules in this package; keep Prisma in `@edu-service/db`; keep HTTP parsing in `@edu-service/api`. Implement providers at the boundary with their credentials injected from runtime configuration. Use hosted fields/Checkout/HPP when possible. Never persist card numbers, CVC/CVV, magnetic-stripe data, full raw webhook payloads, authorization headers, or provider secrets. Add a non-secret configuration example, an adapter-specific health check, unit tests for signature failure/idempotency/out-of-order events, and integration tests for every schema or transaction change.
