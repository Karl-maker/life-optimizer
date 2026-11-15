import {
  AUTH_EVENT,
  AuthenticationError,
  parseCountryCode,
  type AuthAccount,
  type AuthChallenge,
  type AuthProfile,
  type AuthRequestContext,
  type AuthStore,
  type ConsentReceiptInput,
  type LoginAuditRecord,
  type RegisteredDevice,
  type StoredSession,
  type VerifiedOAuthIdentity,
} from "@life-optimizer/core";
import { isUniqueViolation } from "../errors.js";
import { AuditActorKind, AuditOutcome } from "../generated/client.js";
import type { PrismaClient } from "../generated/client.js";

type EventWriter = Pick<PrismaClient, "eventOutbox">;
type EventPayload = Record<string, string | number | boolean | null>;

async function appendAuthEvent(
  writer: EventWriter,
  type: (typeof AUTH_EVENT)[keyof typeof AUTH_EVENT],
  occurredAt: Date,
  payload: EventPayload,
): Promise<void> {
  await writer.eventOutbox.create({
    data: {
      topic: "identity",
      type,
      version: 1,
      occurredAt,
      payload,
    },
  });
}

const accountSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  countryCode: true,
  role: true,
  status: true,
  profileImageUrl: true,
  profileImageSource: true,
  deletionRequestedAt: true,
  deletionScheduledFor: true,
  passwordCredential: { select: { passwordHash: true } },
} as const;

/** PostgreSQL implementation of the core authentication persistence port. */
export class PrismaAuthStore implements AuthStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findLocalByEmail(email: string): Promise<AuthAccount | null> {
    const value = await this.prisma.user.findUnique({
      where: { email },
      select: accountSelect,
    });
    return value ? toAccount(value) : null;
  }

  async findOAuth(
    provider: VerifiedOAuthIdentity["provider"],
    subject: string,
  ): Promise<AuthAccount | null> {
    const identity = await this.prisma.oAuthIdentity.findUnique({
      where: { provider_subject: { provider, subject } },
      select: { user: { select: accountSelect } },
    });
    return identity ? toAccount(identity.user) : null;
  }

  async createLocal(input: {
    name: string;
    email: string;
    phone?: string;
    passwordHash: string;
    countryCode?: string;
  }): Promise<AuthAccount> {
    try {
      const at = new Date();
      const value = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            name: input.name,
            email: input.email,
            phone: input.phone ?? null,
            countryCode: input.countryCode ?? null,
            status: "pending",
            passwordCredential: {
              create: { passwordHash: input.passwordHash },
            },
          },
          select: accountSelect,
        });
        await appendAuthEvent(transaction, AUTH_EVENT.accountCreated, at, {
          userId: created.id,
          provider: "local",
          hasEmail: created.email !== null,
          hasPhone: created.phone !== null,
        });
        return created;
      });
      return toAccount(value);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthenticationError(
          "ACCOUNT_UNAVAILABLE",
          "The authentication request could not be completed.",
        );
      }
      throw error;
    }
  }

  async createOAuth(
    input: VerifiedOAuthIdentity & { countryCode?: string },
  ): Promise<AuthAccount> {
    try {
      const at = new Date();
      const value = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            name: input.name,
            email: input.email,
            emailVerifiedAt: input.emailVerified ? at : null,
            countryCode: input.countryCode ?? null,
            status: "active",
            profileImageUrl: input.profileImageUrl,
            profileImageSource: input.profileImageUrl ? "provider" : null,
            oauthIdentities: {
              create: {
                provider: input.provider,
                subject: input.subject,
                providerEmail: input.email,
                profileImageUrl: input.profileImageUrl,
              },
            },
          },
          select: accountSelect,
        });
        await appendAuthEvent(transaction, AUTH_EVENT.accountCreated, at, {
          userId: created.id,
          provider: input.provider,
          hasEmail: created.email !== null,
          hasPhone: created.phone !== null,
        });
        return created;
      });
      return toAccount(value);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AuthenticationError(
          "ACCOUNT_UNAVAILABLE",
          "The authentication request could not be completed.",
        );
      throw error;
    }
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    const at = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordCredential.upsert({
        where: { userId },
        create: { userId, passwordHash },
        update: { passwordHash },
      });
      await appendAuthEvent(transaction, AUTH_EVENT.passwordReset, at, {
        userId,
      });
    });
  }

  async markConfirmed(userId: string, kind: "email" | "phone"): Promise<void> {
    const at = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data:
          kind === "email"
            ? { emailVerifiedAt: at, status: "active" }
            : { phoneVerifiedAt: at, status: "active" },
      });
      await appendAuthEvent(transaction, AUTH_EVENT.contactConfirmed, at, {
        userId,
        channel: kind,
      });
    });
  }

  async getProfile(userId: string): Promise<AuthProfile | null> {
    const value = await this.prisma.user.findUnique({
      where: { id: userId },
      select: accountSelect,
    });
    return value ? toProfile(value) : null;
  }

  async createSession(session: StoredSession): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.authSessionRecord.create({ data: session });
      await appendAuthEvent(
        transaction,
        AUTH_EVENT.sessionCreated,
        session.createdAt,
        { userId: session.userId, riskLevel: session.riskLevel },
      );
    });
  }

  async findSession(id: string): Promise<StoredSession | null> {
    return this.prisma.authSessionRecord.findUnique({
      where: { id },
      select: {
        id: true,
        secretHash: true,
        userId: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        idleExpiresAt: true,
        reauthenticatedAt: true,
        revokedAt: true,
        riskLevel: true,
      },
    }) as Promise<StoredSession | null>;
  }

  async touchSession(id: string, at: Date, idleExpiresAt: Date): Promise<void> {
    await this.prisma.authSessionRecord.updateMany({
      where: {
        id,
        revokedAt: null,
        expiresAt: { gt: at },
        idleExpiresAt: { gt: at },
      },
      data: { lastSeenAt: at, idleExpiresAt },
    });
  }

  async reauthenticateSession(id: string, at: Date): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const session = await transaction.authSessionRecord.update({
        where: { id },
        data: { reauthenticatedAt: at },
        select: { userId: true },
      });
      await appendAuthEvent(
        transaction,
        AUTH_EVENT.sessionReauthenticated,
        at,
        { userId: session.userId },
      );
    });
  }

  async revokeSession(id: string, at: Date): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const session = await transaction.authSessionRecord.findUnique({
        where: { id },
        select: { userId: true, revokedAt: true },
      });
      if (!session || session.revokedAt) return;
      await transaction.authSessionRecord.update({
        where: { id },
        data: { revokedAt: at },
      });
      await appendAuthEvent(transaction, AUTH_EVENT.sessionRevoked, at, {
        userId: session.userId,
        reason: "logout",
      });
    });
  }

  async revokeUserSessions(
    userId: string,
    at: Date,
    reason: "password-reset" | "account-deletion",
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.authSessionRecord.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: at },
      });
      await appendAuthEvent(transaction, AUTH_EVENT.sessionsRevoked, at, {
        userId,
        reason,
        count: revoked.count,
      });
    });
  }

  async createChallenge(challenge: AuthChallenge): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.authChallengeRecord.create({ data: challenge });
      const event = challengeEvent(challenge);
      await appendAuthEvent(transaction, event.type, new Date(), event.payload);
    });
  }

  async consumeChallenge(
    kind: AuthChallenge["kind"],
    secretHash: string,
    at: Date,
  ): Promise<AuthChallenge | null> {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.authChallengeRecord.updateMany({
        where: { kind, secretHash, consumedAt: null, expiresAt: { gt: at } },
        data: { consumedAt: at },
      });
      if (claimed.count !== 1) return null;
      const value = await transaction.authChallengeRecord.findUniqueOrThrow({
        where: { secretHash },
        select: {
          id: true,
          userId: true,
          kind: true,
          secretHash: true,
          expiresAt: true,
        },
      });
      return value as AuthChallenge;
    });
  }

  async recordLogin(record: LoginAuditRecord): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.loginAudit.create({
        data: {
          userId: record.userId,
          provider: record.provider,
          outcome: record.outcome,
          riskLevel: record.riskLevel,
          reason: record.reason.slice(0, 200),
          correlationId: record.context.correlationId.slice(0, 200),
          ipAddress: record.context.ipAddress,
          countryCode: record.context.countryCode ?? null,
          userAgent: record.context.userAgent?.slice(0, 512) ?? null,
          deviceId: record.context.deviceId?.slice(0, 200) ?? null,
          platform: record.context.platform,
          ja3: record.context.cloudFront?.ja3?.slice(0, 128) ?? null,
          ja4: record.context.cloudFront?.ja4?.slice(0, 128) ?? null,
          asn: record.context.cloudFront?.asn?.slice(0, 32) ?? null,
          occurredAt: record.occurredAt,
        },
      });
      await appendAuthEvent(
        transaction,
        record.outcome === "succeeded"
          ? AUTH_EVENT.loginSucceeded
          : AUTH_EVENT.loginRejected,
        record.occurredAt,
        {
          userId: record.userId,
          provider: record.provider,
          riskLevel: record.riskLevel,
          ...(record.outcome === "rejected"
            ? { reason: record.reason.slice(0, 200) }
            : {}),
        },
      );
    });
  }

  async registerDevice(
    userId: string,
    device: RegisteredDevice,
    at: Date,
  ): Promise<void> {
    const data = {
      platform: device.platform,
      name: device.name ?? null,
      pushToken: device.pushToken ?? null,
      appVersion: device.appVersion ?? null,
      locale: device.locale ?? null,
      timeZone: device.timeZone ?? null,
      lastSeenAt: at,
    };
    await this.prisma.$transaction(async (transaction) => {
      await transaction.userDevice.upsert({
        where: { userId_deviceId: { userId, deviceId: device.deviceId } },
        create: { userId, deviceId: device.deviceId, ...data },
        update: data,
      });
      await appendAuthEvent(transaction, AUTH_EVENT.deviceUpserted, at, {
        userId,
        platform: device.platform,
      });
    });
  }

  async recordConsent(
    userId: string,
    receipt: ConsentReceiptInput,
    context: AuthRequestContext,
    at: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.consentReceipt.create({
        data: {
          userId,
          policyKey: receipt.policyKey,
          policyVersion: receipt.policyVersion,
          locale: receipt.locale,
          decision: receipt.decision,
          categories: [...receipt.categories],
          correlationId: context.correlationId.slice(0, 200),
          ipAddress: context.ipAddress,
          countryCode: context.countryCode ?? null,
          occurredAt: at,
        },
      });
      await appendAuthEvent(transaction, AUTH_EVENT.consentRecorded, at, {
        userId,
        policyKey: receipt.policyKey,
        policyVersion: receipt.policyVersion,
        locale: receipt.locale,
        decision: receipt.decision,
      });
    });
  }

  async setProfileImage(
    userId: string,
    url: string | null,
    source: "provider" | "user",
  ): Promise<void> {
    const at = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data: {
          profileImageUrl: url,
          profileImageSource: url === null ? null : source,
        },
      });
      await appendAuthEvent(transaction, AUTH_EVENT.profileImageUpdated, at, {
        userId,
        operation: url === null ? "cleared" : "set",
        source,
      });
    });
  }

  async confirmDeletion(
    userId: string,
    context: AuthRequestContext,
    at: Date,
    scheduledFor: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data: {
          status: "deletion-pending",
          deletionRequestedAt: at,
          deletionScheduledFor: scheduledFor,
        },
      });
      const revoked = await transaction.authSessionRecord.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: at },
      });
      await transaction.auditEvent.create({
        data: {
          occurredAt: at,
          actorKind: AuditActorKind.USER,
          actorId: userId,
          action: "auth.account.deletion_scheduled",
          outcome: AuditOutcome.SUCCEEDED,
          resourceType: "user",
          resourceId: userId,
          correlationId: context.correlationId,
          source: "api",
          changes: { scheduledFor: scheduledFor.toISOString() },
        },
      });
      await appendAuthEvent(transaction, AUTH_EVENT.sessionsRevoked, at, {
        userId,
        reason: "account-deletion",
        count: revoked.count,
      });
      await appendAuthEvent(transaction, AUTH_EVENT.deletionScheduled, at, {
        userId,
        scheduledFor: scheduledFor.toISOString(),
      });
    });
  }

  async cancelDeletion(
    userId: string,
    context: AuthRequestContext,
    at: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const restored = await transaction.user.updateMany({
        where: {
          id: userId,
          status: "deletion-pending",
          deletionScheduledFor: { gt: at },
        },
        data: {
          status: "active",
          deletionRequestedAt: null,
          deletionScheduledFor: null,
        },
      });
      if (restored.count !== 1) return;
      await transaction.auditEvent.create({
        data: {
          occurredAt: at,
          actorKind: AuditActorKind.USER,
          actorId: userId,
          action: "auth.account.deletion_cancelled",
          outcome: AuditOutcome.SUCCEEDED,
          resourceType: "user",
          resourceId: userId,
          correlationId: context.correlationId,
          source: "api",
        },
      });
      await appendAuthEvent(transaction, AUTH_EVENT.deletionCancelled, at, {
        userId,
      });
    });
  }
}

function challengeEvent(challenge: AuthChallenge): {
  type: (typeof AUTH_EVENT)[keyof typeof AUTH_EVENT];
  payload: EventPayload;
} {
  switch (challenge.kind) {
    case "confirm-email":
      return {
        type: AUTH_EVENT.contactConfirmationRequested,
        payload: { userId: challenge.userId, channel: "email" },
      };
    case "confirm-phone":
      return {
        type: AUTH_EVENT.contactConfirmationRequested,
        payload: { userId: challenge.userId, channel: "phone" },
      };
    case "reset-password":
      return {
        type: AUTH_EVENT.passwordResetRequested,
        payload: { userId: challenge.userId },
      };
    case "delete-account":
      return {
        type: AUTH_EVENT.deletionRequested,
        payload: { userId: challenge.userId },
      };
    case "undo-deletion":
      return {
        type: AUTH_EVENT.deletionUndoRequested,
        payload: {
          userId: challenge.userId,
          expiresAt: challenge.expiresAt.toISOString(),
        },
      };
  }
}

interface AccountRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  countryCode: string | null;
  role: string;
  status: string;
  profileImageUrl: string | null;
  profileImageSource: string | null;
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
  passwordCredential: { passwordHash: string } | null;
}

function toAccount(value: AccountRow): AuthAccount {
  return {
    ...toProfile(value),
    passwordHash: value.passwordCredential?.passwordHash ?? null,
  };
}

function toProfile(value: AccountRow): AuthProfile {
  return {
    userId: value.id,
    name: value.name,
    email: value.email,
    phone: value.phone,
    emailVerified: value.emailVerifiedAt !== null,
    phoneVerified: value.phoneVerifiedAt !== null,
    countryCode:
      value.countryCode === null ? null : parseCountryCode(value.countryCode),
    role: value.role === "admin" ? "admin" : "user",
    status: isStatus(value.status) ? value.status : "deleted",
    deletionRequestedAt: value.deletionRequestedAt,
    deletionScheduledFor: value.deletionScheduledFor,
    profileImageUrl: value.profileImageUrl,
    profileImageSource:
      value.profileImageSource === "provider" ||
      value.profileImageSource === "user"
        ? value.profileImageSource
        : null,
  };
}

function isStatus(value: string): value is AuthProfile["status"] {
  return ["pending", "active", "deletion-pending", "deleted"].includes(value);
}
