CREATE TABLE "store_product_mappings" (
  "id" UUID NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "price_id" UUID NOT NULL REFERENCES "prices"("id") ON DELETE RESTRICT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "store_product_mappings_provider_sku_key" UNIQUE ("provider", "sku"),
  CONSTRAINT "store_product_mappings_provider_check" CHECK ("provider" IN ('apple', 'google'))
);
CREATE TABLE "store_purchases" (
  "id" UUID NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "original_transaction_id" TEXT NOT NULL,
  "token_hash" CHAR(64),
  "account_id" UUID REFERENCES "financial_accounts"("id") ON DELETE RESTRICT,
  "mapping_id" UUID NOT NULL REFERENCES "store_product_mappings"("id") ON DELETE RESTRICT,
  "sku" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "permanently_revoked" BOOLEAN NOT NULL DEFAULT false,
  "quantity" INTEGER NOT NULL,
  "currency" CHAR(3),
  "price_milliunits" BIGINT,
  "purchased_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_purchases_provider_transaction_id_key" UNIQUE ("provider", "transaction_id"),
  CONSTRAINT "store_purchases_kind_check" CHECK ("kind" IN ('one_time', 'subscription')),
  CONSTRAINT "store_purchases_status_check" CHECK ("status" IN ('pending', 'active', 'expired', 'suspended', 'revoked')),
  CONSTRAINT "store_purchases_quantity_check" CHECK ("quantity" > 0 AND "quantity" <= 1000),
  CONSTRAINT "store_purchases_currency_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "store_purchases_price_check" CHECK ("price_milliunits" IS NULL OR "price_milliunits" >= 0)
);
CREATE INDEX "store_purchases_provider_original_transaction_id_idx" ON "store_purchases"("provider", "original_transaction_id");
CREATE INDEX "store_purchases_provider_token_hash_idx" ON "store_purchases"("provider", "token_hash");
CREATE INDEX "store_purchases_account_id_created_at_id_idx" ON "store_purchases"("account_id", "created_at", "id");
ALTER TABLE "entitlements" ADD COLUMN "store_purchase_id" UUID REFERENCES "store_purchases"("id") ON DELETE RESTRICT;
CREATE INDEX "entitlements_store_purchase_id_idx" ON "entitlements"("store_purchase_id");
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_single_purchase_source_check" CHECK ("invoice_id" IS NULL OR "store_purchase_id" IS NULL);
CREATE TABLE "store_notifications" (
  "id" UUID NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "purchase_id" UUID,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_notifications_provider_event_id_key" UNIQUE ("provider", "event_id")
);
CREATE TABLE "store_voids" (
  "id" UUID NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "event_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "store_voids_provider_transaction_id_key" UNIQUE ("provider", "transaction_id"),
  CONSTRAINT "store_voids_token_hash_check" CHECK ("token_hash" ~ '^[a-f0-9]{64}$')
);
