# Discounts and coupon codes

Call `billing.createCoupon` as a `financial:manage` agent. Provide either `percentOff` (integer 1–100) or `amountOffMinor` plus uppercase currency, never both. Optional `productId` limits eligibility; `maxRedemptions` and `redeemBy` limit use. Omit `code` to generate a cryptographically random uppercase code. User-entered codes are normalized to uppercase and must have 8–64 allowed characters. Keep issued codes out of logs unless disclosure is intended.

Pass `couponCode` to `billing.issueInvoice`. The service checks active state, expiry, currency, product scope, and redemption count in the same serializable transaction as invoice creation. It writes one `coupon_redemptions` row linked to the invoice and account. The applied amount is snapshotted; later edits to the coupon cannot change the issued invoice. Reusing the invoice idempotency key does not redeem again.

Percentage discounts use half-up basis-point rounding on eligible subtotal. Fixed discounts cap at that subtotal. The discount is allocated across eligible lines in minor units, with the final eligible line absorbing the rounding remainder; tax is then calculated per discounted line. A coupon that yields zero discount or is not eligible fails. A 100% discount can yield a zero-total invoice, which fulfills immediately.

The catalog currently has a global redemption cap, not per-account limits, stacking rules, or customer-specific issuance. Add those as explicit columns and transactional checks before advertising them. Rate-limit the HTTP code-entry route and avoid revealing whether a guessed code exists until the customer is authorized to price the order.
