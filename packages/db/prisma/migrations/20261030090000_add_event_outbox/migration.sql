CREATE TABLE "event_outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "topic" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_outbox_published_at_created_at_idx" ON "event_outbox"("published_at", "created_at");
