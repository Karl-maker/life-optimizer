import type { Actor } from "../../domain/actor/index.js";

/**
 * Stable names for facts in the business audit trail. These are an API: do not
 * rename an existing value after it has been stored; introduce a new one instead.
 */
export const AUDIT_ACTION = {
  companyCreated: "company.created",
  companyArchived: "company.archived",
  aiModelRegistered: "ai.model.registered",
  patronConfigurationUpdated: "patron.configuration.updated",
  patronActionCreditConfigured: "patron.action_credit.configured",
  patronProfileUpdated: "patron.profile.updated",
  patronCreditsAdded: "patron.credits.added",
  patronCreditsSubtracted: "patron.credits.subtracted",
  storageUploadRequested: "storage.upload.requested",
  storageObjectUploaded: "storage.object.uploaded",
  storageObjectDeleted: "storage.object.deleted",
  storageObjectTierChanged: "storage.object.tier.changed",
  entitlementGranted: "financial.entitlement.granted",
  financialAccountKeyBound: "financial.account-key.bound",
  financialAccountKeyRemoved: "financial.account-key.removed",
  entitlementRevoked: "financial.entitlement.revoked",
  usageRecorded: "financial.usage.recorded",
  usageReversed: "financial.usage.reversed",
  walletCredited: "financial.wallet.credited",
  walletDebited: "financial.wallet.debited",
  providerEventApplied: "financial.provider-event.applied",
  paymentMethodRegistered: "financial.payment-method.registered",
  paymentMethodUpdated: "financial.payment-method.updated",
  paymentMethodRevoked: "financial.payment-method.revoked",
  productCreated: "financial.product.created",
  productUpdated: "financial.product.updated",
  priceCreated: "financial.price.created",
  priceRetired: "financial.price.retired",
  couponCreated: "financial.coupon.created",
  couponRedeemed: "financial.coupon.redeemed",
  invoiceIssued: "financial.invoice.issued",
  invoiceProviderBound: "financial.invoice.provider_bound",
  invoicePaid: "financial.invoice.paid_local",
  paymentRecorded: "financial.payment.recorded",
  refundRecorded: "financial.refund.recorded",
  creditNoteIssued: "financial.credit_note.issued",
  subscriptionCreated: "financial.subscription.created",
  subscriptionTrialStarted: "financial.subscription.trial_started",
  subscriptionRenewed: "financial.subscription.renewed",
  subscriptionCancellationScheduled:
    "financial.subscription.cancellation_scheduled",
  subscriptionCanceled: "financial.subscription.canceled_local",
  dunningPaymentFailed: "financial.dunning.failure_recorded",
  dunningActionRequired: "financial.dunning.action_required_recorded",
  dunningExhausted: "financial.dunning.exhausted_recorded",
  paymentMethodDefaultChanged: "financial.payment_method.default_changed",
  paymentMethodDetached: "financial.payment_method.provider_detached",
  storeProductMapped: "financial.store-product.mapped",
  storePurchaseSynced: "financial.store-purchase.synced",
  storeNotificationReceived: "financial.store-notification.received",
  storeVoidRecorded: "financial.store-void.recorded",
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/** Information supplied by an adapter about one command, request, or job run. */
export interface AuditContext {
  /** Groups every audit event and operational log from one external invocation. */
  correlationId: string;
  /** The adapter that initiated the work, not a user-controlled value. */
  source: "cli" | "web" | "job" | "api";
  /** How a CLI identity was selected. Omitted for non-CLI adapters. */
  actorSource?: "flag" | "env" | "config" | "session" | "service";
}

export type AuditOutcome = "succeeded" | "rejected" | "failed";

/** A deliberately small JSON shape: audit payloads must be allow-listed and bounded. */
export type AuditChanges = Record<
  string,
  string | number | boolean | null | readonly string[]
>;

/** The complete, domain-level description of an event before persistence. */
export interface AuditEventDraft {
  occurredAt: Date;
  companyId: string | null;
  actor: Actor;
  action: AuditAction;
  outcome: AuditOutcome;
  resource: {
    type:
      | "company"
      | "ai-model"
      | "patron-config"
      | "patron-action-credit"
      | "patron-profile"
      | "patron-credit-entry"
      | "storage-object"
      | "financial-account"
      | "entitlement"
      | "usage"
      | "wallet-entry"
      | "provider-event"
      | "payment-method"
      | "product"
      | "price"
      | "coupon"
      | "invoice"
      | "payment"
      | "refund"
      | "credit-note"
      | "subscription"
      | "dunning-attempt"
      | "store-product-mapping"
      | "store-purchase"
      | "store-notification"
      | "store-void";
    id: string;
  };
  context: AuditContext;
  /** Never place credentials, document contents, bank data, or unrestricted input here. */
  changes?: AuditChanges | undefined;
}
