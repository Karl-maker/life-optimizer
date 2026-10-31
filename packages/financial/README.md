# `@edu-service/financial`

Provider-neutral billing, entitlements, metered usage, wallet credits, and payment synchronization. The package defines use cases and ports; `@edu-service/db` implements persistence and serializable transactions; `@edu-service/api` parses Stripe and PowerTranz callbacks. Start with the [financial developer guide](./docs/README.md) for a separate, detailed file on each feature and the [published event catalog](./docs/events.md).

```ts
import {
  createBillingService,
  createFinancialService,
  readFinancialConfiguration,
} from "@edu-service/financial";

const financial = createFinancialService({
  repository: database.financial,
  transactions: database.financialTransactions,
  operationLog,
});
const billing = createBillingService({
  repository: database.billing,
  transactions: database.billingTransactions,
  operationLog,
});
const providers = readFinancialConfiguration(process.env, operationLog);
```

Use `financial.registerEntitlementDefinition` to catalog stable access keys, then `billing.createProduct` and `billing.createPrice` to map a sellable price to those keys and their limits. `billing.issueInvoice` snapshots lines, discount, and tax. Bind it to a provider, then record only verified payment confirmation. Full settlement grants the mapped entitlements and emits `financial.fulfillment.completed`; partial payment grants nothing. A zero-total invoice fulfills at issuance. `financial.recordUsage` and `financial.reverseUsage` enforce UTC daily, weekly, monthly, rolling, or never-reset limits with idempotency keys. A missing entitlement or exhausted allowance produces `DomainError("PAYMENT_REQUIRED")` with the entitlement key and a product/price ID when exactly one active offer grants it; otherwise the host selects a suitable offer for the purchase prompt.

Store all money as signed `BIGINT` minor units plus uppercase ISO 4217 currency. The host supplies tax rates and verifies provider currency rules. The package stores tokenized payment-method display metadata only; no PAN, CVC/CVV, cardholder authentication data, raw provider payload, or credential enters the ledger, audit trail, events, or telemetry.

Billing writes need a trusted `financial:manage` agent acting for the relevant user and an `AuditContext` with a correlation ID. The transaction runner commits the state change, audit entry, and outbox event together. The host must schedule renewal, cancellation completion, dunning collection, and reconciliation work; no background worker starts when this package is imported. The local invoice serial and tax snapshot are not a jurisdiction-specific tax invoice format. See [compliance](./docs/compliance.md) before launch.
