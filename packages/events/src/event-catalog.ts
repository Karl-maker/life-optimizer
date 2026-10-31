/**
 * The single TypeScript catalog for integration-event contracts. Add one entry
 * here for every new event.
 */
export interface EventCatalog {
  "financial.entitlement.granted": {
    topic: "financial";
    version: 1;
    payload: { accountId: string; entitlementId: string; key: string };
  };
  "financial.account-key.bound": {
    topic: "financial";
    version: 1;
    payload: { accountId: string };
  };
  "financial.account-key.removed": {
    topic: "financial";
    version: 1;
    payload: { accountId: string };
  };
  "financial.entitlement.revoked": {
    topic: "financial";
    version: 1;
    payload: { entitlementId: string; key: string };
  };
  "financial.usage.recorded": {
    topic: "financial";
    version: 1;
    payload: { accountId: string; usageId: string; key: string };
  };
  "financial.usage.reversed": {
    topic: "financial";
    version: 1;
    payload: {
      accountId: string;
      usageId: string;
      originalUsageId: string;
      key: string;
    };
  };
  "financial.wallet.credited": {
    topic: "financial";
    version: 1;
    payload: { accountId: string; walletEntryId: string; currency: string };
  };
  "financial.wallet.debited": {
    topic: "financial";
    version: 1;
    payload: { accountId: string; walletEntryId: string; currency: string };
  };
  "financial.provider-event.applied": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.dunning.payment_failed": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.dunning.action_required": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.dunning.payment_succeeded": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.dunning.overdue": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.dunning.exhausted": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.invoice.paid": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.invoice.finalized": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.invoice.uncollectible": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.invoice.voided": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.subscription.updated": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.subscription.canceled": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.subscription.trial_ending": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.payment_method.attached": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.payment_method.detached": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.payment.refunded": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.payment.disputed": {
    topic: "financial";
    version: 1;
    payload: { provider: string; eventId: string; type: string };
  };
  "financial.payment-method.registered": {
    topic: "financial";
    version: 1;
    payload: { accountId: string; paymentMethodId: string; provider: string };
  };
  "financial.payment-method.updated": {
    topic: "financial";
    version: 1;
    payload: { paymentMethodId: string; provider: string };
  };
  "financial.payment-method.revoked": {
    topic: "financial";
    version: 1;
    payload: { paymentMethodId: string; provider: string };
  };
  "user.created": {
    topic: "identity";
    version: 1;
    payload: { userId: string; hasEmail: boolean };
  };
  "storage.upload.requested": {
    topic: "storage";
    version: 1;
    payload: {
      key: string;
      contentType: string | null;
      contentLength: number | null;
    };
  };
  "storage.upload.progressed": {
    topic: "storage";
    version: 1;
    payload: { key: string; loaded: number; total: number | null };
  };
  "storage.object.uploaded": {
    topic: "storage";
    version: 1;
    payload: {
      key: string;
      contentType: string | null;
      contentLength: number | null;
    };
  };
  "storage.upload.failed": {
    topic: "storage";
    version: 1;
    payload: { key: string; operation: "direct" | "server" };
  };
  "storage.object.deleted": {
    topic: "storage";
    version: 1;
    payload: { key: string };
  };
  "storage.object.tier.changed": {
    topic: "storage";
    version: 1;
    payload: { key: string; storageTier: string };
  };
  "speech.synthesis.started": {
    topic: "speech";
    version: 1;
    payload: {
      provider: "elevenlabs" | "openai" | "aws";
      voiceId: string;
      inputCharacters: number;
    };
  };
  "speech.synthesis.ready": {
    topic: "speech";
    version: 1;
    payload: {
      provider: "elevenlabs" | "openai" | "aws";
      voiceId: string;
      delivery: "stream" | "bytes" | "blob";
      inputCharacters: number | null;
      outputAudioBytes: number | null;
      inputAudioSeconds: number | null;
      outputAudioSeconds: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      estimatedCostMicrousd: number | null;
    };
  };
  "speech.synthesis.failed": {
    topic: "speech";
    version: 1;
    payload: { provider: "elevenlabs" | "openai" | "aws"; voiceId: string };
  };
  "speech.transcription.completed": {
    topic: "speech";
    version: 1;
    payload: {
      provider: "elevenlabs" | "openai" | "aws";
      inputCharacters: number | null;
      outputAudioBytes: number | null;
      inputAudioSeconds: number | null;
      outputAudioSeconds: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      estimatedCostMicrousd: number | null;
    };
  };
  "speech.transcription.failed": {
    topic: "speech";
    version: 1;
    payload: { provider: "elevenlabs" | "openai" | "aws" };
  };
}

export type EventType = keyof EventCatalog;
export type EventDefinition<T extends EventType> = EventCatalog[T];

export const EVENT_DEFINITION: {
  readonly [T in EventType]: Pick<EventDefinition<T>, "topic" | "version">;
} = {
  "financial.entitlement.granted": { topic: "financial", version: 1 },
  "financial.account-key.bound": { topic: "financial", version: 1 },
  "financial.account-key.removed": { topic: "financial", version: 1 },
  "financial.entitlement.revoked": { topic: "financial", version: 1 },
  "financial.usage.recorded": { topic: "financial", version: 1 },
  "financial.usage.reversed": { topic: "financial", version: 1 },
  "financial.wallet.credited": { topic: "financial", version: 1 },
  "financial.wallet.debited": { topic: "financial", version: 1 },
  "financial.provider-event.applied": { topic: "financial", version: 1 },
  "financial.dunning.payment_failed": { topic: "financial", version: 1 },
  "financial.dunning.action_required": { topic: "financial", version: 1 },
  "financial.dunning.payment_succeeded": { topic: "financial", version: 1 },
  "financial.dunning.overdue": { topic: "financial", version: 1 },
  "financial.dunning.exhausted": { topic: "financial", version: 1 },
  "financial.invoice.paid": { topic: "financial", version: 1 },
  "financial.invoice.finalized": { topic: "financial", version: 1 },
  "financial.invoice.uncollectible": { topic: "financial", version: 1 },
  "financial.invoice.voided": { topic: "financial", version: 1 },
  "financial.subscription.updated": { topic: "financial", version: 1 },
  "financial.subscription.canceled": { topic: "financial", version: 1 },
  "financial.subscription.trial_ending": { topic: "financial", version: 1 },
  "financial.payment_method.attached": { topic: "financial", version: 1 },
  "financial.payment_method.detached": { topic: "financial", version: 1 },
  "financial.payment.refunded": { topic: "financial", version: 1 },
  "financial.payment.disputed": { topic: "financial", version: 1 },
  "financial.payment-method.registered": { topic: "financial", version: 1 },
  "financial.payment-method.updated": { topic: "financial", version: 1 },
  "financial.payment-method.revoked": { topic: "financial", version: 1 },
  "user.created": { topic: "identity", version: 1 },
  "storage.upload.requested": { topic: "storage", version: 1 },
  "storage.upload.progressed": { topic: "storage", version: 1 },
  "storage.object.uploaded": { topic: "storage", version: 1 },
  "storage.upload.failed": { topic: "storage", version: 1 },
  "storage.object.deleted": { topic: "storage", version: 1 },
  "storage.object.tier.changed": { topic: "storage", version: 1 },
  "speech.synthesis.started": { topic: "speech", version: 1 },
  "speech.synthesis.ready": { topic: "speech", version: 1 },
  "speech.synthesis.failed": { topic: "speech", version: 1 },
  "speech.transcription.completed": { topic: "speech", version: 1 },
  "speech.transcription.failed": { topic: "speech", version: 1 },
};
