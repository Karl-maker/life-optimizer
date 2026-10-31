# Internal wallet credits

The wallet is an append-only ledger of internal credits, debits, and adjustments per financial account and currency. Use `financial.adjustWallet({ actor, audit, userId, currency, amountMinor, type, idempotencyKey })`; inspect `financial.walletBalance` before displaying a balance. Currency is uppercase and amount is a signed integer minor unit. A credit/manager adjustment requires `financial:manage`; a debit can be made by the owning user. A debit that would make the balance negative fails under a serializable transaction. Duplicate idempotency keys return the existing entry.

The wallet is an internal access-credit mechanism. It does not represent safeguarded customer funds, stored value redeemable for cash, a card charge, or tax settlement. There are no expiring lots, holds, transfers, or automatic invoice application. Add these as separately audited ledger operations if product policy requires them. Never silently net a refund against a wallet balance.
