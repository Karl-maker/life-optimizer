ALTER TABLE "financial_accounts" ADD COLUMN "default_payment_method_id" UUID;
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_default_payment_method_id_fkey" FOREIGN KEY ("default_payment_method_id") REFERENCES "payment_method_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_method_tokens" ADD COLUMN "provider_detached_at" TIMESTAMPTZ(3);
ALTER TABLE "entitlements" ADD COLUMN "invoice_id" UUID;
CREATE INDEX "entitlements_invoice_id_idx" ON "entitlements"("invoice_id");

ALTER TABLE "subscriptions" ADD COLUMN "current_period_starts_at" TIMESTAMPTZ(3), ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "canceled_at" TIMESTAMPTZ(3);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_period_check" CHECK ("current_period_starts_at" IS NULL OR "current_period_ends_at" IS NULL OR "current_period_starts_at" < "current_period_ends_at");

ALTER TABLE "invoices" ADD COLUMN "idempotency_key" TEXT, ADD COLUMN "serial_number" BIGSERIAL NOT NULL, ADD COLUMN "subtotal_minor" BIGINT NOT NULL DEFAULT 0, ADD COLUMN "discount_minor" BIGINT NOT NULL DEFAULT 0, ADD COLUMN "tax_minor" BIGINT NOT NULL DEFAULT 0, ADD COLUMN "issued_at" TIMESTAMPTZ(3), ADD COLUMN "paid_at" TIMESTAMPTZ(3), ADD COLUMN "subscription_id" UUID;
CREATE UNIQUE INDEX "invoices_idempotency_key_key" ON "invoices"("idempotency_key");
UPDATE "invoices" SET "subtotal_minor" = "total_minor";
CREATE UNIQUE INDEX "invoices_serial_number_key" ON "invoices"("serial_number");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_totals_check" CHECK ("subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0 AND "subtotal_minor" - "discount_minor" + "tax_minor" = "total_minor");

CREATE TABLE "invoice_lines" (
  "id" UUID NOT NULL PRIMARY KEY, "invoice_id" UUID NOT NULL, "product_id" UUID NOT NULL, "price_id" UUID NOT NULL,
  "description" TEXT NOT NULL, "quantity" BIGINT NOT NULL, "unit_amount_minor" BIGINT NOT NULL,
  "subtotal_minor" BIGINT NOT NULL, "discount_minor" BIGINT NOT NULL, "tax_rate_bps" INTEGER NOT NULL,
  "tax_minor" BIGINT NOT NULL, "total_minor" BIGINT NOT NULL,
  "service_starts_at" TIMESTAMPTZ(3), "service_ends_at" TIMESTAMPTZ(3),
  CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_lines_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_lines_amount_check" CHECK ("quantity" > 0 AND "unit_amount_minor" >= 0 AND "subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "discount_minor" <= "subtotal_minor" AND "tax_rate_bps" BETWEEN 0 AND 10000 AND "tax_minor" >= 0 AND "total_minor" = "subtotal_minor" - "discount_minor" + "tax_minor")
);
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");

CREATE TABLE "payment_records" (
  "id" UUID NOT NULL PRIMARY KEY, "invoice_id" UUID NOT NULL, "provider" TEXT NOT NULL, "provider_reference" TEXT NOT NULL,
  "amount_minor" BIGINT NOT NULL, "currency" CHAR(3) NOT NULL, "status" TEXT NOT NULL, "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "payment_records_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_records_amount_check" CHECK ("amount_minor" > 0 AND "currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "payment_records_provider_provider_reference_key" ON "payment_records"("provider", "provider_reference");
CREATE INDEX "payment_records_invoice_id_status_idx" ON "payment_records"("invoice_id", "status");

CREATE TABLE "refund_records" (
  "id" UUID NOT NULL PRIMARY KEY, "payment_id" UUID NOT NULL, "provider" TEXT NOT NULL, "provider_reference" TEXT NOT NULL,
  "amount_minor" BIGINT NOT NULL, "status" TEXT NOT NULL, "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "refund_records_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "refund_records_amount_check" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "refund_records_provider_provider_reference_key" ON "refund_records"("provider", "provider_reference");
CREATE INDEX "refund_records_payment_id_status_idx" ON "refund_records"("payment_id", "status");

CREATE TABLE "credit_notes" (
  "id" UUID NOT NULL PRIMARY KEY, "serial_number" BIGSERIAL NOT NULL, "invoice_id" UUID NOT NULL, "refund_id" UUID,
  "amount_minor" BIGINT NOT NULL, "reason" TEXT NOT NULL, "issued_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_notes_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refund_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_notes_amount_check" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "credit_notes_serial_number_key" ON "credit_notes"("serial_number");
CREATE UNIQUE INDEX "credit_notes_refund_id_key" ON "credit_notes"("refund_id");

CREATE TABLE "subscription_renewals" (
  "id" UUID NOT NULL PRIMARY KEY, "subscription_id" UUID NOT NULL, "invoice_id" UUID NOT NULL,
  "period_starts_at" TIMESTAMPTZ(3) NOT NULL, "period_ends_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "subscription_renewals_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "subscription_renewals_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "subscription_renewals_period_check" CHECK ("period_starts_at" < "period_ends_at")
);
CREATE UNIQUE INDEX "subscription_renewals_invoice_id_key" ON "subscription_renewals"("invoice_id");
CREATE UNIQUE INDEX "subscription_renewals_subscription_id_period_starts_at_key" ON "subscription_renewals"("subscription_id", "period_starts_at");

ALTER TABLE "coupons" ADD COLUMN "product_id" UUID;
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "coupon_redemptions" (
  "id" UUID NOT NULL PRIMARY KEY, "coupon_id" UUID NOT NULL, "invoice_id" UUID NOT NULL, "account_id" UUID NOT NULL,
  "amount_minor" BIGINT NOT NULL, "redeemed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "coupon_redemptions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "coupon_redemptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "coupon_redemptions_amount_check" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "coupon_redemptions_invoice_id_key" ON "coupon_redemptions"("invoice_id");
CREATE INDEX "coupon_redemptions_coupon_id_account_id_idx" ON "coupon_redemptions"("coupon_id", "account_id");

CREATE TABLE "powertranz_sales" (
  "id" UUID NOT NULL PRIMARY KEY, "invoice_id" UUID NOT NULL, "user_id" UUID NOT NULL,
  "transaction_identifier" UUID NOT NULL, "order_identifier" TEXT NOT NULL,
  "amount_minor" BIGINT NOT NULL, "currency" CHAR(3) NOT NULL,
  "token_hash" CHAR(64) NOT NULL, "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "three_d_secure" BOOLEAN NOT NULL, "status" TEXT NOT NULL,
  "processing_started_at" TIMESTAMPTZ(3),
  CONSTRAINT "powertranz_sales_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "powertranz_sales_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "powertranz_sales_amount_check" CHECK ("amount_minor" > 0 AND "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "powertranz_sales_status_check" CHECK ("status" IN ('pending','processing','completed','declined'))
);
CREATE UNIQUE INDEX "powertranz_sales_invoice_id_key" ON "powertranz_sales"("invoice_id");
CREATE UNIQUE INDEX "powertranz_sales_transaction_identifier_key" ON "powertranz_sales"("transaction_identifier");
CREATE UNIQUE INDEX "powertranz_sales_token_hash_key" ON "powertranz_sales"("token_hash");
CREATE INDEX "powertranz_sales_status_processing_started_at_idx" ON "powertranz_sales"("status", "processing_started_at");

ALTER TABLE "dunning_attempts" ADD CONSTRAINT "dunning_attempts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "dunning_attempts_provider_event_id_key" ON "dunning_attempts"("provider_event_id");
