# Catalog and pricing

**Implementation status:** Prisma tables and domain types exist. There is no catalog authoring service, price lookup/validation use case, or public route. Do not populate these tables as a billing workflow through ad hoc SQL.

`Product` is the sellable capability; `Price` is an immutable commercial offer for that product. Never edit an amount, currency, frequency, or tax/discount calculation after a price is used by an invoice. Retire it (`active=false`) and create a replacement.

Use one product key such as `ai-pro`, then add separate price rows for `ai-pro-monthly-usd`, `ai-pro-yearly-usd`, and `ai-pro-one-time-usd`. `unitAmountMinor` is an integer: USD 19.99 is `1999n`; JPY 2000 is `2000n`. Currency is uppercase ISO-4217. `frequency` is `one_time`, `day`, `week`, `month`, or `year`; `intervalCount` supports offers such as every three months. `trialDays` is a timeline, not a zero-cost price.

Use `product_add_ons` to associate independently priced products, for example `storage-100gb` with `ai-pro`. An add-on is purchased/renewed independently and has its own entitlement mappings.

Map each price to capability limits in `price_entitlements`; this is how two prices for one product grant different access. Example: Starter maps `ai.chat.request` to `20n`, Pro maps it to `2000n`, and Enterprise maps it to `null` (unlimited). Keep mapping changes versioned through a new price where historical behavior matters.

Before selling a price, implement a manager-only catalog writer that validates: the product and price are active, price ownership, nonnegative amount, provider-supported currency and amount bounds, positive interval, one-time prices without trial, and the entitlement definitions behind every mapping. Snapshot the chosen price and mapping version into the purchase/invoice. `grantForPrice` currently trusts its caller's product/price IDs and must be called only after that validation and verified payment/trial policy.

Use integer minor units and store the currency with every amount. Stripe's [currency guide](https://docs.stripe.com/currencies) has zero-decimal currencies and special cases such as ISK/UGX; do not infer an exponent from ISO-4217 format alone. The same currency may have different charge and payout rules. Taxes and exchange rates need explicit dated snapshots, a rounding policy, and provider-specific validation before invoice issuance.
