# Financial developer guide

This guide is the operational companion to the package [README](../README.md). Read the documents in this order when implementing a new selling flow:

1. [Catalog and pricing](./catalog-and-pricing.md)
2. [Entitlements and usage](./entitlements-and-usage.md)
3. [One-off payments and payment methods](./payments-and-methods.md)
4. [Subscriptions, trials, and add-ons](./subscriptions-and-trials.md)
5. [Discounts, invoices, refunds, and wallet credits](./invoices-discounts-refunds-wallet.md)
6. [Dunning](./dunning.md)
7. [Provider synchronization and webhooks](./provider-webhooks.md)
8. [Compliance and deployment boundaries](./compliance.md)

All provider credentials, raw callback bodies, full card data, CVC/CVV, and PANs are prohibited from this package, its database tables, audit trail, and telemetry.
