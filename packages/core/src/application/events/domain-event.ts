/** A durable integration fact written with the business change, then delivered at-least-once. */
export interface DomainEvent {
  topic: string;
  type: string;
  version: 1;
  occurredAt: Date;
  payload: Record<string, string | number | boolean | null>;
}
export const DOMAIN_EVENT = { userCreated: "user.created" } as const;

export const AUTH_EVENT = {
  accountCreated: "auth.account.created",
  loginSucceeded: "auth.login.succeeded",
  loginRejected: "auth.login.rejected",
  contactConfirmationRequested: "auth.contact.confirmation-requested",
  contactConfirmed: "auth.contact.confirmed",
  passwordResetRequested: "auth.password-reset.requested",
  passwordReset: "auth.password.reset",
  sessionCreated: "auth.session.created",
  sessionReauthenticated: "auth.session.reauthenticated",
  sessionRevoked: "auth.session.revoked",
  sessionsRevoked: "auth.sessions.revoked",
  deviceUpserted: "auth.device.upserted",
  consentRecorded: "auth.consent.recorded",
  profileImageUpdated: "auth.profile-image.updated",
  deletionRequested: "auth.account.deletion.requested",
  deletionScheduled: "auth.account.deletion.scheduled",
  deletionUndoRequested: "auth.account.deletion.undo-requested",
  deletionCancelled: "auth.account.deletion.cancelled",
} as const;
