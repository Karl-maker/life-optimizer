import type {
  AuthProfile,
  AuthRequestContext,
  AuthSession,
  LoginProvider,
  RiskLevel,
} from "../../domain/auth/index.js";
import type {
  AccountDeletionCallback,
  AuthAccount,
  AuthChallenge,
  AuthenticationService,
  AuthStore,
  ConsentReceiptInput,
  IdentityPresenceIndex,
  PasswordHasher,
  SecretCodec,
  StoredSession,
  VerificationDelivery,
  AuthenticationRiskAssessor,
  SecurityNotification,
  CompliancePolicyReader,
} from "./authentication-service.js";
import { AuthenticationError } from "./authentication-service.js";

const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1_000;
const SESSION_IDLE_MS = 24 * 60 * 60 * 1_000;
const CHALLENGE_MS = 30 * 60 * 1_000;
const REAUTHENTICATION_MS = 10 * 60 * 1_000;
const DEFAULT_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1_000;
const MIN_DELETION_GRACE_MS = 60 * 60 * 1_000;
const MAX_DELETION_GRACE_MS = 90 * 24 * 60 * 60 * 1_000;

export function createAuthenticationService(options: {
  store: AuthStore;
  passwords: PasswordHasher;
  secrets: SecretCodec;
  presence: IdentityPresenceIndex;
  delivery: VerificationDelivery;
  enabledProviders?: readonly Exclude<LoginProvider, "local">[];
  deletionCallbacks?: readonly AccountDeletionCallback[];
  riskAssessor?: AuthenticationRiskAssessor;
  securityNotification?: SecurityNotification;
  compliancePolicies?: CompliancePolicyReader;
  onDeliveryFailure?: (input: {
    kind: AuthChallenge["kind"];
    userId: string;
  }) => void;
  deletionGraceMs?: number;
  clock?: () => Date;
}): AuthenticationService {
  const clock = options.clock ?? (() => new Date());
  const deletionGraceMs = options.deletionGraceMs ?? DEFAULT_DELETION_GRACE_MS;
  if (
    !Number.isSafeInteger(deletionGraceMs) ||
    deletionGraceMs < MIN_DELETION_GRACE_MS ||
    deletionGraceMs > MAX_DELETION_GRACE_MS
  )
    throw new Error(
      "Deletion grace period must be between one hour and 90 days.",
    );

  const findLocal = async (email: string): Promise<AuthAccount | null> => {
    if (!(await mightContain(options.presence, "email", email))) return null;
    return options.store.findLocalByEmail(email);
  };

  const recordRejectedOAuthLogin = async (
    provider: Exclude<LoginProvider, "local">,
    context: AuthRequestContext,
    account: AuthProfile | null,
    reason: string,
  ): Promise<void> => {
    const riskLevel = options.riskAssessor
      ? await options.riskAssessor.assess(context, account)
      : assessRisk(context);
    await options.store.recordLogin({
      userId: account?.userId ?? null,
      provider,
      outcome: "rejected",
      riskLevel,
      reason,
      context,
      occurredAt: clock(),
    });
  };

  const prepareChallenge = async (
    account: AuthProfile,
    kind: AuthChallenge["kind"],
    lifetimeMs = CHALLENGE_MS,
  ) => {
    const secret = options.secrets.issue();
    const expiresAt = new Date(clock().getTime() + lifetimeMs);
    await options.store.createChallenge({
      id: options.secrets.issue().value,
      userId: account.userId,
      kind,
      secretHash: secret.hash,
      expiresAt,
    });
    return { account, kind, token: secret.value, expiresAt };
  };

  const deliverChallenge = async (
    prepared: Awaited<ReturnType<typeof prepareChallenge>>,
  ) => {
    try {
      await options.delivery.send({
        kind: prepared.kind,
        userId: prepared.account.userId,
        ...(prepared.account.email === null
          ? {}
          : { email: prepared.account.email }),
        ...(prepared.account.phone === null
          ? {}
          : { phone: prepared.account.phone }),
        token: prepared.token,
        expiresAt: prepared.expiresAt,
      });
    } catch {
      // Public responses remain uniform. Production delivery should enqueue durably;
      // this bounded callback is for operational telemetry/alerting only.
      options.onDeliveryFailure?.({
        kind: prepared.kind,
        userId: prepared.account.userId,
      });
    }
  };

  const issueChallenge = async (
    account: AuthProfile,
    kind: AuthChallenge["kind"],
    lifetimeMs = CHALLENGE_MS,
  ) => deliverChallenge(await prepareChallenge(account, kind, lifetimeMs));

  const sessionFor = async (
    account: AuthProfile,
    riskLevel: RiskLevel,
  ): Promise<AuthSession> => {
    const id = options.secrets.issue().value;
    const verifier = options.secrets.issue();
    const at = clock();
    const stored: StoredSession = {
      id,
      secretHash: verifier.hash,
      userId: account.userId,
      createdAt: at,
      lastSeenAt: at,
      expiresAt: new Date(at.getTime() + SESSION_ABSOLUTE_MS),
      idleExpiresAt: new Date(at.getTime() + SESSION_IDLE_MS),
      reauthenticatedAt: at,
      revokedAt: null,
      riskLevel,
    };
    await options.store.createSession(stored);
    return toSession(`${id}.${verifier.value}`, stored, account);
  };

  const resolve = async (
    token: string,
  ): Promise<{
    stored: StoredSession;
    profile: AuthProfile;
  }> => {
    const [id, verifier, extra] = token.split(".");
    if (!id || !verifier || extra !== undefined)
      throw unavailable("INVALID_CREDENTIALS");
    const stored = await options.store.findSession(id);
    const at = clock();
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt <= at ||
      stored.idleExpiresAt <= at ||
      !options.secrets.matches(verifier, stored.secretHash)
    )
      throw unavailable("INVALID_CREDENTIALS");
    const profile = await options.store.getProfile(stored.userId);
    if (!profile || profile.status !== "active")
      throw unavailable("ACCOUNT_UNAVAILABLE");
    return { stored, profile };
  };

  return {
    availableLoginMethods: () => ["local", ...(options.enabledProviders ?? [])],
    async signUpLocal(input) {
      const email = normalizeEmail(input.email);
      const phone =
        input.phone === undefined ? undefined : normalizePhone(input.phone);
      if (input.confirmationChannel === "phone" && phone === undefined)
        throw invalidInput();
      validatePassword(input.password);
      // Do the same expensive password work even if the account already exists.
      const passwordHash = await options.passwords.hash(input.password);
      if (
        (await mightContain(options.presence, "email", email)) &&
        (await options.store.findLocalByEmail(email))
      )
        throw unavailable("ACCOUNT_UNAVAILABLE");
      // Add first: a failed create can leave a harmless false positive, while the reverse
      // ordering could leave a false negative that skips a real account lookup.
      await options.presence.add("email", email);
      if (phone !== undefined) await options.presence.add("phone", phone);
      const account = await options.store.createLocal({
        name: bounded(
          input.name ?? defaultNameFromEmail(email),
          1,
          200,
          "Name",
        ),
        email,
        ...(phone === undefined ? {} : { phone }),
        passwordHash,
        ...(input.context.countryCode === undefined
          ? {}
          : { countryCode: input.context.countryCode }),
      });
      await issueChallenge(
        account,
        input.confirmationChannel === "phone"
          ? "confirm-phone"
          : "confirm-email",
      );
      return { userId: account.userId };
    },
    async loginLocal(input) {
      const email = normalizeEmail(input.email);
      const account = await findLocal(email);
      const valid = await options.passwords.verify(
        account?.passwordHash ?? options.passwords.dummyHash,
        input.password,
      );
      const riskLevel = options.riskAssessor
        ? await options.riskAssessor.assess(input.context, account)
        : assessRisk(input.context);
      const accepted =
        account !== null &&
        account.passwordHash !== null &&
        valid &&
        account.status === "active";
      await options.store.recordLogin({
        userId: account?.userId ?? null,
        provider: "local",
        outcome: accepted ? "succeeded" : "rejected",
        riskLevel,
        reason: accepted ? "authenticated" : "invalid-or-unavailable",
        context: input.context,
        occurredAt: clock(),
      });
      if (!accepted) throw unavailable("INVALID_CREDENTIALS");
      if (riskLevel === "high" && options.securityNotification) {
        try {
          await options.securityNotification.highRiskLogin({
            userId: account.userId,
            email: account.email,
            context: input.context,
            occurredAt: clock(),
          });
        } catch {
          // Login alerts are operational delivery. The durable login audit remains authoritative.
        }
      }
      return sessionFor(account, riskLevel);
    },
    async loginOAuth(input) {
      if (!(options.enabledProviders ?? []).includes(input.identity.provider)) {
        await recordRejectedOAuthLogin(
          input.identity.provider,
          input.context,
          null,
          "provider-unavailable",
        );
        throw unavailable("ACCOUNT_UNAVAILABLE");
      }
      const subject = bounded(input.identity.subject, 1, 512, "OAuth subject");
      let account = await options.store.findOAuth(
        input.identity.provider,
        subject,
      );
      if (account && account.status !== "active") {
        await recordRejectedOAuthLogin(
          input.identity.provider,
          input.context,
          account,
          "account-unavailable",
        );
        throw unavailable("ACCOUNT_UNAVAILABLE");
      }
      if (!account) {
        const email =
          input.identity.email && input.identity.emailVerified
            ? normalizeEmail(input.identity.email)
            : null;
        // Email equality is not proof that two provider identities belong to one person.
        // Explicit linking must happen from a recently reauthenticated account instead.
        if (email) {
          const emailAccount = await findLocal(email);
          if (emailAccount) {
            await recordRejectedOAuthLogin(
              input.identity.provider,
              input.context,
              emailAccount,
              "explicit-link-required",
            );
            throw unavailable("ACCOUNT_UNAVAILABLE");
          }
        }
        if (email) await options.presence.add("email", email);
        const profileImageUrl = validHttpsUrl(input.identity.profileImageUrl);
        try {
          account = await options.store.createOAuth({
            ...input.identity,
            subject,
            name: bounded(input.identity.name, 1, 200, "OAuth name"),
            email,
            emailVerified: email !== null,
            profileImageUrl,
            ...(input.context.countryCode === undefined
              ? {}
              : { countryCode: input.context.countryCode }),
          });
        } catch (error) {
          // Two callbacks for the same provider identity may race; they converge on one account.
          const concurrent = await options.store.findOAuth(
            input.identity.provider,
            subject,
          );
          if (!concurrent) throw error;
          account = concurrent;
        }
      }
      const riskLevel = options.riskAssessor
        ? await options.riskAssessor.assess(input.context, account)
        : assessRisk(input.context);
      await options.store.recordLogin({
        userId: account.userId,
        provider: input.identity.provider,
        outcome: "succeeded",
        riskLevel,
        reason: "authenticated",
        context: input.context,
        occurredAt: clock(),
      });
      if (riskLevel === "high" && options.securityNotification) {
        try {
          await options.securityNotification.highRiskLogin({
            userId: account.userId,
            email: account.email,
            context: input.context,
            occurredAt: clock(),
          });
        } catch {
          // The durable login audit remains authoritative.
        }
      }
      return sessionFor(account, riskLevel);
    },
    async authenticate(token, context) {
      const { stored, profile } = await resolve(token);
      const at = clock();
      await options.store.touchSession(
        stored.id,
        at,
        new Date(
          Math.min(stored.expiresAt.getTime(), at.getTime() + SESSION_IDLE_MS),
        ),
      );
      return toSession(
        token,
        { ...stored, lastSeenAt: at },
        profile,
        assessRisk(context),
      );
    },
    async logout(token) {
      const { stored } = await resolve(token);
      await options.store.revokeSession(stored.id, clock());
    },
    async requestPasswordReset(emailInput) {
      const email = normalizeEmail(emailInput);
      const account = await findLocal(email);
      if (account?.passwordHash)
        await issueChallenge(account, "reset-password");
    },
    async requestConfirmation(emailInput, channel) {
      const account = await findLocal(normalizeEmail(emailInput));
      if (account?.status === "pending") {
        if (channel === "email" && account.email && !account.emailVerified)
          await issueChallenge(account, "confirm-email");
        if (channel === "phone" && account.phone && !account.phoneVerified)
          await issueChallenge(account, "confirm-phone");
      }
    },
    async resetPassword(token, password) {
      validatePassword(password);
      const challenge = await options.store.consumeChallenge(
        "reset-password",
        options.secrets.hash(token),
        clock(),
      );
      if (!challenge) throw unavailable("INVALID_OR_EXPIRED_TOKEN");
      await options.store.setPassword(
        challenge.userId,
        await options.passwords.hash(password),
      );
      await options.store.revokeUserSessions(
        challenge.userId,
        clock(),
        "password-reset",
      );
    },
    async confirm(kind, token) {
      const challenge = await options.store.consumeChallenge(
        kind === "email" ? "confirm-email" : "confirm-phone",
        options.secrets.hash(token),
        clock(),
      );
      if (!challenge) throw unavailable("INVALID_OR_EXPIRED_TOKEN");
      await options.store.markConfirmed(challenge.userId, kind);
    },
    async reauthenticateLocal(token, password) {
      const { stored, profile } = await resolve(token);
      if (!profile.email) throw unavailable("INVALID_CREDENTIALS");
      const account = await options.store.findLocalByEmail(profile.email);
      if (
        !account?.passwordHash ||
        !(await options.passwords.verify(account.passwordHash, password))
      )
        throw unavailable("INVALID_CREDENTIALS");
      const at = clock();
      await options.store.reauthenticateSession(stored.id, at);
      return {
        ...toSession(token, { ...stored, reauthenticatedAt: at }, profile),
        reauthenticationRequired: false,
      };
    },
    async registerDevice(token, device) {
      const { stored } = await resolve(token);
      await options.store.registerDevice(stored.userId, device, clock());
    },
    async updateProfileImage(token, url) {
      const { stored } = await resolve(token);
      if (url !== null) {
        if (url.length > 2_048) throw invalidInput();
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw invalidInput();
        }
        if (parsed.protocol !== "https:") throw invalidInput();
      }
      await options.store.setProfileImage(stored.userId, url, "user");
    },
    async recordConsent(token, receipt, context) {
      const { stored } = await resolve(token);
      const validated = validateReceipt(receipt);
      const at = clock();
      const locale = canonicalLocale(receipt.locale);
      const normalized = { ...receipt, ...validated, locale };
      if (
        !options.compliancePolicies ||
        !(await options.compliancePolicies.isPublishedVersion({
          policyKey: normalized.policyKey,
          policyVersion: normalized.policyVersion,
          locale,
          at,
        }))
      )
        throw unavailable("INVALID_POLICY_VERSION");
      await options.store.recordConsent(stored.userId, normalized, context, at);
    },
    async requestAccountDeletion(token, _context) {
      const { stored, profile } = await resolve(token);
      if (
        clock().getTime() - stored.reauthenticatedAt.getTime() >
        REAUTHENTICATION_MS
      )
        throw unavailable("REAUTHENTICATION_REQUIRED");
      await issueChallenge(profile, "delete-account");
    },
    async confirmAccountDeletion(token, callbackToken, context) {
      const { stored, profile } = await resolve(token);
      const at = clock();
      if (
        at.getTime() - stored.reauthenticatedAt.getTime() >
        REAUTHENTICATION_MS
      )
        throw unavailable("REAUTHENTICATION_REQUIRED");
      const challenge = await options.store.consumeChallenge(
        "delete-account",
        options.secrets.hash(callbackToken),
        at,
      );
      if (!challenge || challenge.userId !== stored.userId)
        throw unavailable("INVALID_OR_EXPIRED_TOKEN");
      for (const callback of options.deletionCallbacks ?? [])
        await callback.beforeDelete(stored.userId, context);
      const scheduledFor = new Date(at.getTime() + deletionGraceMs);
      const undo = await prepareChallenge(
        profile,
        "undo-deletion",
        deletionGraceMs,
      );
      await options.store.confirmDeletion(
        stored.userId,
        context,
        at,
        scheduledFor,
      );
      await deliverChallenge(undo);
      return { scheduledFor };
    },
    async requestDeletionUndo(emailInput) {
      const account = await findLocal(normalizeEmail(emailInput));
      const remaining = account?.deletionScheduledFor
        ? account.deletionScheduledFor.getTime() - clock().getTime()
        : 0;
      if (account?.status === "deletion-pending" && remaining > 0)
        await issueChallenge(account, "undo-deletion", remaining);
    },
    async undoAccountDeletion(callbackToken, context) {
      const at = clock();
      const challenge = await options.store.consumeChallenge(
        "undo-deletion",
        options.secrets.hash(callbackToken),
        at,
      );
      if (!challenge) throw unavailable("INVALID_OR_EXPIRED_TOKEN");
      const profile = await options.store.getProfile(challenge.userId);
      if (
        !profile ||
        profile.status !== "deletion-pending" ||
        !profile.deletionScheduledFor ||
        profile.deletionScheduledFor <= at
      )
        throw unavailable("INVALID_OR_EXPIRED_TOKEN");
      for (const callback of options.deletionCallbacks ?? [])
        await callback.beforeRestore?.(challenge.userId, context);
      await options.store.cancelDeletion(challenge.userId, context, at);
      const restored = await options.store.getProfile(challenge.userId);
      if (!restored || restored.status !== "active")
        throw unavailable("ACCOUNT_UNAVAILABLE");
      const riskLevel = options.riskAssessor
        ? await options.riskAssessor.assess(context, restored)
        : assessRisk(context);
      return sessionFor(restored, riskLevel);
    },
  };
}

function toSession(
  token: string,
  stored: StoredSession,
  profile: AuthProfile,
  currentRisk: RiskLevel = stored.riskLevel,
): AuthSession {
  const riskLevel: RiskLevel =
    stored.riskLevel === "high" || currentRisk === "high"
      ? "high"
      : stored.riskLevel === "medium" || currentRisk === "medium"
        ? "medium"
        : "low";
  return {
    token,
    expiresAt: stored.expiresAt,
    idleExpiresAt: stored.idleExpiresAt,
    profile,
    permissions: profile.role === "admin" ? ["user", "admin"] : ["user"],
    riskLevel,
    reauthenticationRequired: riskLevel === "high",
  };
}

function assessRisk(context: AuthRequestContext): RiskLevel {
  if (!context.ipAddress || context.platform === "other") return "high";
  if (!context.deviceId || !context.countryCode) return "medium";
  return "low";
}

async function mightContain(
  index: IdentityPresenceIndex,
  kind: "email" | "phone",
  value: string,
): Promise<boolean> {
  try {
    return await index.mightContain(kind, value);
  } catch {
    return true;
  }
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw invalidInput();
  return email;
}

function defaultNameFromEmail(email: string): string {
  const localPart = email.slice(0, email.indexOf("@")).trim();
  return localPart || "Learner";
}

function normalizePhone(value: string): string {
  const phone = value.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw invalidInput();
  return phone;
}

function validHttpsUrl(value: string | null): string | null {
  if (value === null || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function validatePassword(value: string): void {
  if (value.length < 12 || value.length > 128) throw invalidInput();
}

function validateReceipt(receipt: ConsentReceiptInput): {
  policyKey: string;
  policyVersion: string;
  categories: string[];
} {
  if (receipt.categories.length > 50) throw invalidInput();
  const categories = receipt.categories.map((category) =>
    bounded(category, 1, 100, "Consent category"),
  );
  if (new Set(categories).size !== categories.length) throw invalidInput();
  return {
    policyKey: bounded(receipt.policyKey, 1, 128, "Policy key"),
    policyVersion: bounded(receipt.policyVersion, 1, 128, "Policy version"),
    categories,
  };
}

function canonicalLocale(value: string): string {
  try {
    const locale = Intl.getCanonicalLocales(value)[0];
    if (locale && locale.length <= 50) return locale;
  } catch {
    // Uniform validation error below.
  }
  throw invalidInput();
}

function bounded(
  value: string,
  min: number,
  max: number,
  _label: string,
): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw invalidInput();
  return normalized;
}

function invalidInput() {
  return new AuthenticationError(
    "INVALID_AUTH_INPUT",
    "The authentication request is invalid.",
  );
}

function unavailable(
  code: ConstructorParameters<typeof AuthenticationError>[0],
) {
  return new AuthenticationError(
    code,
    "The authentication request could not be completed.",
  );
}
