import type {
  AuthProfile,
  AuthRequestContext,
  AuthSession,
  ClientPlatform,
  LoginAuditRecord,
  LoginProvider,
  RiskLevel,
} from "../../domain/auth/index.js";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /** Valid encoded hash used to equalize unknown-account login work. */
  dummyHash: string;
}

export interface IssuedSecret {
  value: string;
  hash: string;
}

export interface SecretCodec {
  issue(): IssuedSecret;
  hash(value: string): string;
  matches(value: string, hash: string): boolean;
}

export interface IdentityPresenceIndex {
  mightContain(kind: "email" | "phone", value: string): Promise<boolean>;
  add(kind: "email" | "phone", value: string): Promise<void>;
}

export interface AuthAccount extends AuthProfile {
  passwordHash: string | null;
}

export interface VerifiedOAuthIdentity {
  provider: Exclude<LoginProvider, "local">;
  subject: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  profileImageUrl: string | null;
}

export interface StoredSession {
  id: string;
  secretHash: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  idleExpiresAt: Date;
  reauthenticatedAt: Date;
  revokedAt: Date | null;
  riskLevel: RiskLevel;
}

export interface AuthChallenge {
  id: string;
  userId: string;
  kind:
    | "confirm-email"
    | "confirm-phone"
    | "reset-password"
    | "delete-account"
    | "undo-deletion";
  secretHash: string;
  expiresAt: Date;
}

export interface RegisteredDevice {
  deviceId: string;
  platform: ClientPlatform;
  name?: string;
  pushToken?: string;
  appVersion?: string;
  locale?: string;
  timeZone?: string;
}

export interface ConsentReceiptInput {
  policyKey: string;
  policyVersion: string;
  locale: string;
  decision: "accepted" | "rejected" | "withdrawn";
  categories: readonly string[];
}

export interface AuthStore {
  findLocalByEmail(email: string): Promise<AuthAccount | null>;
  findOAuth(
    provider: VerifiedOAuthIdentity["provider"],
    subject: string,
  ): Promise<AuthAccount | null>;
  createLocal(input: {
    name: string;
    email: string;
    phone?: string;
    passwordHash: string;
    countryCode?: string;
  }): Promise<AuthAccount>;
  createOAuth(
    input: VerifiedOAuthIdentity & { countryCode?: string },
  ): Promise<AuthAccount>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
  markConfirmed(userId: string, kind: "email" | "phone"): Promise<void>;
  getProfile(userId: string): Promise<AuthProfile | null>;
  createSession(session: StoredSession): Promise<void>;
  findSession(id: string): Promise<StoredSession | null>;
  touchSession(id: string, at: Date, idleExpiresAt: Date): Promise<void>;
  reauthenticateSession(id: string, at: Date): Promise<void>;
  revokeSession(id: string, at: Date): Promise<void>;
  revokeUserSessions(
    userId: string,
    at: Date,
    reason: "password-reset" | "account-deletion",
  ): Promise<void>;
  createChallenge(challenge: AuthChallenge): Promise<void>;
  consumeChallenge(
    kind: AuthChallenge["kind"],
    secretHash: string,
    at: Date,
  ): Promise<AuthChallenge | null>;
  recordLogin(record: LoginAuditRecord): Promise<void>;
  registerDevice(
    userId: string,
    device: RegisteredDevice,
    at: Date,
  ): Promise<void>;
  recordConsent(
    userId: string,
    receipt: ConsentReceiptInput,
    context: AuthRequestContext,
    at: Date,
  ): Promise<void>;
  setProfileImage(
    userId: string,
    url: string | null,
    source: "provider" | "user",
  ): Promise<void>;
  confirmDeletion(
    userId: string,
    context: AuthRequestContext,
    at: Date,
    scheduledFor: Date,
  ): Promise<void>;
  cancelDeletion(
    userId: string,
    context: AuthRequestContext,
    at: Date,
  ): Promise<void>;
}

export interface VerificationDelivery {
  send(input: {
    kind: AuthChallenge["kind"];
    userId: string;
    email?: string;
    phone?: string;
    token: string;
    expiresAt: Date;
  }): Promise<void>;
}

export interface AuthenticationRiskAssessor {
  assess(
    context: AuthRequestContext,
    account: AuthProfile | null,
  ): Promise<RiskLevel>;
}

export interface SecurityNotification {
  /** Best-effort notification; delivery failure must never change authentication state. */
  highRiskLogin(input: {
    userId: string;
    email: string | null;
    context: AuthRequestContext;
    occurredAt: Date;
  }): Promise<void>;
}

export interface CompliancePolicyReader {
  isPublishedVersion(input: {
    policyKey: string;
    policyVersion: string;
    locale: string;
    at: Date;
  }): Promise<boolean>;
}

export interface AccountDeletionCallback {
  beforeDelete(userId: string, context: AuthRequestContext): Promise<void>;
  beforeRestore?(userId: string, context: AuthRequestContext): Promise<void>;
}

export class AuthenticationError extends Error {
  constructor(
    readonly code:
      | "INVALID_CREDENTIALS"
      | "ACCOUNT_UNAVAILABLE"
      | "INVALID_OR_EXPIRED_TOKEN"
      | "REAUTHENTICATION_REQUIRED"
      | "INVALID_POLICY_VERSION"
      | "INVALID_AUTH_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface AuthenticationService {
  availableLoginMethods(): readonly LoginProvider[];
  signUpLocal(input: {
    name: string;
    email: string;
    phone?: string;
    confirmationChannel?: "email" | "phone";
    password: string;
    countryCode?: string;
    context: AuthRequestContext;
  }): Promise<{ userId: string }>;
  loginLocal(input: {
    email: string;
    password: string;
    context: AuthRequestContext;
  }): Promise<AuthSession>;
  loginOAuth(input: {
    identity: VerifiedOAuthIdentity;
    context: AuthRequestContext;
  }): Promise<AuthSession>;
  authenticate(
    token: string,
    context: AuthRequestContext,
  ): Promise<AuthSession>;
  logout(token: string): Promise<void>;
  requestPasswordReset(
    email: string,
    context: AuthRequestContext,
  ): Promise<void>;
  requestConfirmation(
    email: string,
    channel: "email" | "phone",
    context: AuthRequestContext,
  ): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
  confirm(kind: "email" | "phone", token: string): Promise<void>;
  reauthenticateLocal(token: string, password: string): Promise<AuthSession>;
  registerDevice(
    token: string,
    device: RegisteredDevice,
    context: AuthRequestContext,
  ): Promise<void>;
  updateProfileImage(token: string, url: string | null): Promise<void>;
  recordConsent(
    token: string,
    receipt: ConsentReceiptInput,
    context: AuthRequestContext,
  ): Promise<void>;
  requestAccountDeletion(
    token: string,
    context: AuthRequestContext,
  ): Promise<void>;
  confirmAccountDeletion(
    token: string,
    callbackToken: string,
    context: AuthRequestContext,
  ): Promise<{ scheduledFor: Date }>;
  requestDeletionUndo(
    email: string,
    context: AuthRequestContext,
  ): Promise<void>;
  undoAccountDeletion(
    callbackToken: string,
    context: AuthRequestContext,
  ): Promise<AuthSession>;
}
