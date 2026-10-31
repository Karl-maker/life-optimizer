CREATE TYPE "email_delivery_status" AS ENUM ('RESERVED', 'SENT', 'FAILED');

CREATE TABLE "email_configurations" (
  "id" TEXT NOT NULL, "transport_id" TEXT NOT NULL, "credential_reference" TEXT,
  "from_email" TEXT NOT NULL, "from_name" TEXT, "reply_to" TEXT,
  "fallback_configuration_ids" JSONB NOT NULL, "rate_limit_max" INTEGER NOT NULL,
  "rate_limit_window_seconds" INTEGER NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "email_configurations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_configurations_rate_limit_positive" CHECK ("rate_limit_max" > 0 AND "rate_limit_window_seconds" > 0)
);
CREATE TABLE "email_templates" (
  "id" TEXT NOT NULL, "subject_template" TEXT NOT NULL, "header_partial" TEXT NOT NULL,
  "main_template" TEXT NOT NULL, "footer_partial" TEXT NOT NULL, "text_template" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "email_deliveries" (
  "id" UUID NOT NULL, "configuration_id" TEXT NOT NULL, "recipient" TEXT NOT NULL,
  "purpose" TEXT NOT NULL, "unsubscribe_topic" TEXT, "idempotency_key" TEXT,
  "status" "email_delivery_status" NOT NULL, "rendered_subject" TEXT NOT NULL,
  "rendered_html" TEXT NOT NULL, "rendered_text" TEXT NOT NULL, "provider_message_id" TEXT,
  "failure_code" TEXT, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMPTZ(3), CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_deliveries_recipient_created_at_idx" ON "email_deliveries"("recipient", "created_at");
CREATE INDEX "email_deliveries_created_at_idx" ON "email_deliveries"("created_at");
CREATE UNIQUE INDEX "email_deliveries_recipient_idempotency_key_unique"
  ON "email_deliveries"("recipient", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE TABLE "email_subscriptions" (
  "recipient" TEXT NOT NULL, "topic" TEXT NOT NULL, "unsubscribed_at" TIMESTAMPTZ(3),
  CONSTRAINT "email_subscriptions_pkey" PRIMARY KEY ("recipient", "topic")
);
