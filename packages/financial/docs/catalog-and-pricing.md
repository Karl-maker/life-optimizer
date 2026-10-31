# Catalog and pricing

**Implementation status:** `createBillingService` now provides manager-only `createProduct`, `updateProduct`, `createPrice`, and `retirePrice`, with Prisma persistence, audit records, and outbox events. There is no public catalog CRUD route. A host should expose one only through authenticated, permission-scoped API routes.

`Product` is the sellable capability; `Price` is an immutable commercial offer for that product. Never edit an amount, currency, frequency, or tax/discount calculation after a price is used by an invoice. Retire it (`active=false`) and create a replacement.

Use one product key such as `ai-pro`, then add separate price rows for `ai-pro-monthly-usd`, `ai-pro-yearly-usd`, and `ai-pro-one-time-usd`. `unitAmountMinor` is an integer: USD 19.99 is `1999n`; JPY 2000 is `2000n`. Currency is uppercase ISO-4217. `frequency` is `one_time`, `day`, `week`, `month`, or `year`; `intervalCount` supports offers such as every three months. `trialDays` is a timeline, not a zero-cost price.

Use `product_add_ons` to associate independently priced products, for example `storage-100gb` with `ai-pro`. An add-on is purchased/renewed independently and has its own entitlement mappings.

Map each price to capability limits in `price_entitlements`; this is how two prices for one product grant different access. Example: Starter maps `ai.chat.request` to `20n`, Pro maps it to `2000n`, and Enterprise maps it to `null` (unlimited). Keep mapping changes versioned through a new price where historical behavior matters.

Call `billing.createPrice` with an existing product ID, uppercase currency, nonnegative integer minor amount, frequency, interval count, trial days, and at least one `{ key, quantity }` entitlement mapping. The repository enforces that each key exists in the entitlement catalog. `quantity=null` means unlimited. Retire a price and create a replacement for commercial changes. `billing.issueInvoice` checks that both product and price are active and snapshots its price amount into invoice lines. `grantForPrice` is a lower-level trusted operation; prefer the invoice or trial flow for sales.
Products marked with risk level `blocked` cannot be invoiced or started as a subscription. Other risk levels are catalog metadata for the host's fraud/payment policy; they do not silently override the provider's 3DS or retry rules.

Use integer minor units and store the currency with every amount. Stripe's [currency guide](https://docs.stripe.com/currencies) has zero-decimal currencies and special cases such as ISK/UGX; do not infer an exponent from ISO-4217 format alone. The same currency may have different charge and payout rules. Taxes and exchange rates need explicit dated snapshots, a rounding policy, and provider-specific validation before invoice issuance.
