# Financial developer guide

`@life-optimizer/financial` owns provider-neutral billing rules; `@life-optimizer/db` persists them with Prisma, and `@life-optimizer/api` handles provider HTTP callbacks. Create the services from `createBillingService({ repository: db.billing, transactions: db.billingTransactions })` and `createFinancialService({ repository: db.financial, transactions: db.financialTransactions })`. Pass a trusted agent with `financial:manage` and an `AuditContext` containing a correlation ID for billing writes. The database transaction runner writes the state change, audit record, and outbox event together.

## Guides

1. [Catalog and pricing](./catalog-and-pricing.md): products, immutable prices, price entitlement mapping, currency.
2. [Entitlements and usage](./entitlements-and-usage.md): limits, windows, reversals, access checks.
3. [Purchase flow](./purchase-flow.md): end-to-end product sale, provider callback, fulfillment, and access.
4. [Invoices](./invoices.md): issue, tax and line snapshots, payment allocation, fulfillment.
5. [Coupons and discounts](./discounts-and-coupons.md): creation, redemption, rounding, limits.
6. [One-off payments and payment methods](./payments-and-methods.md): Stripe Checkout, method metadata, defaults, detach.
7. [PowerTranz](./powertranz.md): hosted Sale, browser return, server settlement, recovery.
8. [Subscriptions, trials, and add-ons](./subscriptions-and-trials.md): trial grants, renewal invoices, cancellation.
9. [Dunning](./dunning.md): attempts, failures, customer action, retry scheduling.
10. [Refunds and credit notes](./refunds-and-credit-notes.md): provider confirmation, allocations, access revocation.
11. [Wallet credits](./wallet.md): append-only internal credits and debits.
12. [Provider synchronization and webhooks](./provider-webhooks.md): signature handling, event mapping, replay.
13. [Published events](./events.md): event names, payloads, and consumer rules.
14. [Compliance and deployment boundaries](./compliance.md): card data, invoices, retention, PCI scope.
15. [In-app purchases](./in-app-purchases.md): store purchase ledger, account binding, entitlement fulfillment, refunds and history.

## Provider setup

- [Stripe setup](./setup-stripe.md): API key, signed webhook, subscribed events and invoice fulfillment.
- [PowerTranz setup](./setup-powertranz.md): hosted Sale, browser return, server settlement and reconciliation.
- [Apple App Store setup](./setup-apple-app-store.md): StoreKit, signed transaction and Notification V2 verification.
- [Google Play setup](./setup-google-play.md): Play Developer API, authenticated RTDN push and acknowledgement.

The older [combined invoice guide](./invoices-discounts-refunds-wallet.md) links to the focused guides above.

## What runs today

The service issues immutable local invoice lines with tax and discount snapshots, redeems coupons, records payments and refunds, issues linked credit notes, grants access after full payment, and revokes grants on a full invoice refund when requested. It starts one trial per account and product, issues idempotent renewal invoices, schedules and finishes cancellation, records dunning failures, and persists provider events. Stripe's signed Checkout payment event can fulfill a bound invoice through `billing.applyProviderEvent`. PowerTranz's hosted Sale completes through a stored token hash, strict callback matching, and a server-side SPI payment response. See each guide for the exact call sequence.

Apple and Google in-app purchases use a separate store purchase ledger. Signed Apple transactions and Play API lookups map store SKUs to local prices and grant entitlements only when the verified store account token matches a bound financial account. Their notification endpoints update renewal, suspension, expiry and refund state. `GET /store-purchases` exposes authenticated purchase history. Store receipts and actual charged amounts remain with Apple or Google; local invoices and payment records are for web/provider sales.

## Operations still supplied by the host

The host must schedule `issueRenewalInvoice`, `finishSubscription`, dunning retries, and provider reconciliation; no worker starts automatically. Tax rates and legal seller/buyer invoice data must come from a jurisdiction-aware tax/invoicing integration. Stripe provider-side refund, default-method changes, and detach now have adapter calls, but the host must orchestrate their confirmed results with the local ledger and reconcile failures between the two systems. PowerTranz refund/capture/void/card-on-file APIs are not wired because the supplied material does not establish their full merchant request and token ownership contracts. Do not advertise those operations as available.

No PAN, CVC/CVV, raw provider payload, provider credential, or full card data belongs in this package, its tables, events, audit trail, or logs.
