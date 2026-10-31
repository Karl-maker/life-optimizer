# Entitlements and usage

**Implementation status:** catalog registration, grants/revocations, usage, reversals, UTC reset windows, wallet balances, audit/outbox events, and `PAYMENT_REQUIRED` exist. Invoice settlement and trials can now create price grants. Automatic price selection for a purchase prompt and a high-volume aggregate projection do not.

Create an `EntitlementDefinition` before any product uses it. Keys are lower-case stable API names, for example `ai.chat.request`, `storage.byte`, or `workspace.seat`. The unit describes what quantity means; it does not perform conversion.

An entitlement grant has an active timeline (`startsAt`, optional `endsAt`) and is revocable. Paid invoice fulfillment and subscription trials create price grants; a manual support grant uses `grant`. `grantForPrice` is a trusted lower-level operation, not a payment confirmation. Every usage call needs a unique idempotency key. The service records a durable usage entry, audit event, and outbox event atomically.

Both grant methods and revocation require an `agent` actor with `financial:manage`, acting for the same user. Ordinary user actors may consume their own usage but cannot grant access or credit a wallet. `reverseUsage` requires that manager actor, a reference to a positive original usage row, a positive correction amount, and a new idempotency key. It appends a negative entry anchored to the original usage period, so a correction cannot erase history or be applied twice. The sum of reversals may not exceed the original quantity.

Reset policies apply to the definition: `never`, `calendar_day`, `calendar_week` (Monday), `calendar_month`, or `rolling` with `resetIntervalSeconds`. Calendar boundaries are UTC. A finite allowance is the sum of active grants and usage is summed only inside the current window. Unlimited (`null`) grants override finite grants. Insufficient access throws `PAYMENT_REQUIRED` with the entitlement key; if exactly one active, unblocked price maps to it, the error also includes its product and price IDs. Callers use these details for a purchase prompt and choose among offers when the mapping is ambiguous.

Do not decrement a mutable “remaining quota” column. The append-only usage ledger gives support and finance a traceable explanation for every access decision. A future high-throughput projection may cache usage totals, but it must be derived from this ledger and repaired from it.

The `never` reset strategy counts all usage for the key over the account lifetime. It is suitable for a lifetime allowance, but it does not currently isolate separate packs or subscription periods. For period-specific packs, add a grant/usage allocation key before selling them. A rolling window includes usage whose original timestamp falls within the window; a later reversal changes that original window, not the current one. Financial writes run in serializable PostgreSQL transactions with retry on serialization conflict.
