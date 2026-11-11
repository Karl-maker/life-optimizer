# PowerTranz hosted Sale

This integration implements the hosted **Sale** path described in the supplied [`docs/powertranz`](../../../docs/powertranz/) examples and checked against the working sibling PowerTranz project. It uses merchant headers for `/Api/spi/Sale`, receives `SP4`, `RedirectData`, and a five-minute `SpiToken`, then completes `/Api/spi/Payment` server to server after the hosted page or 3DS result. A Sale is authorization and capture in one path. The adapter does not accept PAN or CVC.

Set the eight `EDU_POWERTRANZ_*` values in [`packages/api/.env.example`](../../../packages/api/.env.example) at the host boundary. `readFinancialConfiguration` creates the adapter only when all are present and valid; it reports `financial.provider.unavailable` without secrets otherwise. The merchant response URL must be HTTPS. Configure its exact path as `/webhooks/powertranz` and enable the route with `createApiServer({ powerTranzCallback: { checkout } })`.

```ts
const billing = createBillingService({
  repository: db.billing,
  transactions: db.billingTransactions,
});
const checkout = createPowerTranzCheckout({
  adapter: providers.powertranz!,
  repository: db.powerTranzSales,
  billing,
  findInvoice: (id) => db.billing.findInvoice(id),
  findAccountById: (id) => db.financial.findAccountById(id),
  agentId: "powertranz-callback",
});
const started = await checkout.begin({
  actor: managerForUser,
  audit,
  userId,
  invoiceId,
  merchantResponseUrl,
  threeDSecure: true,
});
// Render started.redirectData only in a provider iframe. Never return or log SpiToken.
```

`begin` requires an open, positive, unbound invoice. It calls PowerTranz with an independent UUID transaction ID and the invoice ID as order ID, binds the invoice to that transaction, and stores only a SHA-256 hash of the SPI token with the amount, currency, expiry, and 3DS policy. The browser sees only `RedirectData` and public transaction ID. Protect the rendered HTML boundary: the provider's script belongs inside the iframe, not the application's DOM.

The browser posts a single URL-encoded `Response` JSON field to the callback. The API route bounds and parses it, but the response is **not signed** and is **not proof of payment**. `checkout.complete` looks up the stored token hash, claims the pending sale, compares token, transaction/order IDs, amount and numeric currency, and applies the configured 3DS policy (`3D0`, authenticated `Y`, accepted ECI, CAVV; or `HP0` for a no-3DS hosted page). It then posts the SPI token to `/spi/Payment`. Only an approved `00` response with matching identifiers and money reaches `billing.recordPayment`, which fulfills the invoice transactionally. Repeated completed callbacks return `completed` without a second charge; an in-flight duplicate returns HTTP 202 `processing`. A declined financial response records a dunning failure and returns `declined`. The callback response contains no token or card metadata.
An authenticated but unsuccessful 3DS result records an action-required dunning attempt and returns `declined` without calling `/spi/Payment`. A malformed or mismatched return remains unfulfilled and is not accepted as a decline.

If a provider call or local commit fails after the claim, the sale remains `processing`. After two minutes, a repeated callback queries PowerTranz by transaction ID and can reconcile a matching approved transaction. Do not reinterpret a missing or ambiguous query result as a decline; investigate it operationally. The query and payment response are compared against the stored invoice before recording payment. A five-minute SPI expiry prevents new completion calls after expiry.

**Limits:** the supplied material identifies `/Capture`, `/Refund`, and `/Void` but does not establish the complete original-transaction linkage, merchant body, token reuse, and partial amount rules for this account. No provider requests for those operations are implemented. Card-on-file token ownership and provider-side detach are likewise not established. Use the confirmed Sale path for one-off payments only. A production host also needs scheduled reconciliation for sales left `processing` when the browser never retries.
