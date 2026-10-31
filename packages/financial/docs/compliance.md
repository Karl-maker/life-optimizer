# Compliance and production boundary

This package is **not a claim of PCI, tax, privacy, or financial regulatory compliance**. A production launch needs a review for the merchant entity, jurisdictions, processors, card-data flow, tax collection, invoice format, refund rights, retention, and internal credit terms.

## Card data and payment methods

Use Stripe Checkout or a provider-hosted page/field so raw PAN and CVC never enter this API, logs, database, or telemetry. Store a provider-scoped token and only needed display metadata (brand, last four, expiry), with restricted access and a retention policy. Provider tokens can still be sensitive and may keep systems in PCI scope depending on the implementation; an assessor/acquirer decides the applicable validation. [PCI SSC explains](https://www.pcisecuritystandards.org/faqs/1319/) that CVC/CVV cannot be stored after authorization even encrypted, and [its retention guidance](https://www.pcisecuritystandards.org/faqs/1318/) requires retaining cardholder data only as long as necessary. Never make a token reference available in a user-facing response.

## Financial integrity

Keep money as integer minor units plus currency. Validate the provider's actual currency rules and transaction bounds; [Stripe's currency table](https://docs.stripe.com/currencies) includes zero-decimal and special-case currencies. A payment provider is the source of truth for a charge/refund, and the local ledger must reconcile every provider reference. This package now stores immutable invoice line/tax/discount snapshots, separate payment and refund rows, and linked credit notes. Its local serial number and input tax rate do **not** establish a jurisdiction-compliant tax invoice. Add seller/buyer legal identity, tax evidence, place of supply, required wording, invoice numbering policy, and export/retention rules before issuing one legally.

Use serializable database transactions for balance and quota checks, unique idempotency keys, and transactional audit/outbox writes. Keep operational telemetry bounded and free of payment payloads, credentials, card data, customer addresses, and unbounded decline messages. Preserve enough provider IDs, local IDs, timestamps, and statuses for dispute and refund reconciliation.

## Customer and legal obligations

Obtain consent and provider confirmation before saving a reusable payment method. Offer a method removal flow that detaches at the provider as well as soft-deleting the local reference. Set a transparent dunning/grace policy, notices, cancellation timing, refund policy, and support path. Tax and invoice fields, numbering, retention, privacy rights, consumer cancellation rules, and treatment of prepaid credits vary by jurisdiction; obtain local advice before relying on this package for accounting or regulated stored value.

## Design references

The open-source [Kill Bill architecture](https://killbill.io/kill-bill-architecture) separates catalog, subscriptions, invoices, payments, gateway plugins, and overdue/dunning. [Lago's open-source README](https://github.com/getlago/lago/blob/main/README.md) documents event idempotency, usage metering, invoices, credits, and pricing as separate concerns. The current implementation follows that separation but still needs host scheduling, provider refund and saved-method orchestration, and jurisdiction-specific tax invoicing before it is a full billing operation.
