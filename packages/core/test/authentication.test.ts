import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  createAuthenticationService,
  type AuthAccount,
  type AuthRequestContext,
  type AuthStore,
  type StoredSession,
  type CompliancePolicyReader,
} from "../src/index.js";

const context: AuthRequestContext = {
  correlationId: "request-1",
  ipAddress: "198.51.100.4",
  countryCode: "TT" as never,
  deviceId: "device-1",
  platform: "browser",
};

function account(overrides: Partial<AuthAccount> = {}): AuthAccount {
  return {
    userId: "user-1",
    name: "Person",
    email: "person@example.com",
    phone: null,
    emailVerified: true,
    phoneVerified: false,
    countryCode: "TT" as never,
    role: "user",
    status: "active",
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    profileImageUrl: null,
    profileImageSource: null,
    passwordHash: "stored-password",
    ...overrides,
  };
}

function setup(
  options: {
    existing?: AuthAccount | null;
    now?: () => Date;
    compliancePolicies?: CompliancePolicyReader;
    enabledProviders?: readonly ("google" | "github" | "facebook")[];
  } = {},
) {
  const sessions = new Map<string, StoredSession>();
  const existing =
    options.existing === undefined ? account() : options.existing;
  const store: AuthStore = {
    findLocalByEmail: vi.fn(async () => existing),
    findOAuth: vi.fn(async () => null),
    createLocal: vi.fn(async (input) =>
      account({
        name: input.name,
        email: input.email,
        countryCode: (input.countryCode as never) ?? null,
        emailVerified: false,
        status: "pending",
        passwordHash: input.passwordHash,
      }),
    ),
    createOAuth: vi.fn(async (input) =>
      account({
        name: input.name,
        email: input.email,
        emailVerified: input.emailVerified,
        status: "active",
        passwordHash: null,
        profileImageUrl: input.profileImageUrl,
        profileImageSource: input.profileImageUrl ? "provider" : null,
      }),
    ),
    setPassword: vi.fn(),
    markConfirmed: vi.fn(),
    getProfile: vi.fn(async () => existing),
    createSession: vi.fn(
      async (session) => void sessions.set(session.id, session),
    ),
    findSession: vi.fn(async (id) => sessions.get(id) ?? null),
    touchSession: vi.fn(),
    reauthenticateSession: vi.fn(),
    revokeSession: vi.fn(),
    revokeUserSessions: vi.fn(),
    createChallenge: vi.fn(),
    consumeChallenge: vi.fn(),
    recordLogin: vi.fn(),
    registerDevice: vi.fn(),
    setProfileImage: vi.fn(),
    recordConsent: vi.fn(),
    confirmDeletion: vi.fn(),
    cancelDeletion: vi.fn(),
  };
  let counter = 0;
  const service = createAuthenticationService({
    store,
    passwords: {
      dummyHash: "dummy-password",
      hash: vi.fn(async () => "new-password-hash"),
      verify: vi.fn(
        async (hash, password) =>
          hash === "stored-password" && password === "correct password",
      ),
    },
    secrets: {
      issue: () => {
        const value = `secret-${++counter}`;
        return { value, hash: `hash:${value}` };
      },
      hash: (value) => `hash:${value}`,
      matches: (value, hash) => `hash:${value}` === hash,
    },
    presence: {
      mightContain: vi.fn(async () => true),
      add: vi.fn(),
    },
    delivery: { send: vi.fn() },
    ...(options.now === undefined ? {} : { clock: options.now }),
    ...(options.enabledProviders === undefined
      ? {}
      : { enabledProviders: options.enabledProviders }),
    ...(options.compliancePolicies === undefined
      ? {}
      : { compliancePolicies: options.compliancePolicies }),
  });
  return { service, store, sessions };
}

describe("authentication service", () => {
  it("derives optional signup fields from email and request context", async () => {
    const env = setup({ existing: null });
    await env.service.signUpLocal({
      email: "learner@example.com",
      password: "a secure passphrase",
      context,
    });
    expect(env.store.createLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "learner",
        email: "learner@example.com",
        countryCode: "TT",
      }),
    );
  });

  it("uses a Bloom negative to skip the database but still performs dummy password work", async () => {
    const env = setup({ existing: null });
    const presence = {
      mightContain: vi.fn(async () => false),
      add: vi.fn(),
    };
    const passwords = {
      dummyHash: "dummy",
      hash: vi.fn(async () => "hash"),
      verify: vi.fn(async () => false),
    };
    const service = createAuthenticationService({
      store: env.store,
      passwords,
      secrets: {
        issue: () => ({ value: "value", hash: "hash:value" }),
        hash: (v) => `hash:${v}`,
        matches: (v, hash) => `hash:${v}` === hash,
      },
      presence,
      delivery: { send: vi.fn() },
    });
    await expect(
      service.loginLocal({
        email: "absent@example.com",
        password: "incorrect password",
        context,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(env.store.findLocalByEmail).not.toHaveBeenCalled();
    expect(passwords.verify).toHaveBeenCalledWith(
      "dummy",
      "incorrect password",
    );
    expect(env.store.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rejected", userId: null }),
    );
  });

  it("creates a revocable opaque session and grants normal-user permissions only", async () => {
    const env = setup();
    const session = await env.service.loginLocal({
      email: "PERSON@example.com",
      password: "correct password",
      context,
    });
    expect(session.token).toMatch(/^secret-\d+\.secret-\d+$/);
    expect(session.permissions).toEqual(["user"]);
    expect(session.riskLevel).toBe("low");
    expect([...env.sessions.values()][0]?.secretHash).not.toContain(
      session.token,
    );
  });

  it("requires recent reauthentication before deletion callbacks", async () => {
    let now = new Date("2026-10-31T12:00:00.000Z");
    const env = setup({ now: () => now });
    const session = await env.service.loginLocal({
      email: "person@example.com",
      password: "correct password",
      context,
    });
    now = new Date("2026-10-31T12:11:00.000Z");
    await expect(
      env.service.requestAccountDeletion(session.token, context),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AuthenticationError>>({
        code: "REAUTHENTICATION_REQUIRED",
      }),
    );
    expect(env.store.confirmDeletion).not.toHaveBeenCalled();
  });

  it("requires a signed-in session plus a separate callback before scheduling deletion", async () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    const env = setup({ now: () => now });
    const session = await env.service.loginLocal({
      email: "person@example.com",
      password: "correct password",
      context,
    });

    await env.service.requestAccountDeletion(session.token, context);
    expect(env.store.createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", kind: "delete-account" }),
    );
    expect(env.store.confirmDeletion).not.toHaveBeenCalled();

    vi.mocked(env.store.consumeChallenge).mockResolvedValue({
      id: "delete-challenge",
      userId: "user-1",
      kind: "delete-account",
      secretHash: "hash:delete-callback",
      expiresAt: new Date("2026-10-31T12:30:00.000Z"),
    });
    const result = await env.service.confirmAccountDeletion(
      session.token,
      "delete-callback",
      context,
    );
    expect(result.scheduledFor).toEqual(new Date("2026-11-30T12:00:00.000Z"));
    expect(env.store.confirmDeletion).toHaveBeenCalledWith(
      "user-1",
      context,
      now,
      result.scheduledFor,
    );
    expect(env.store.createChallenge).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "undo-deletion", userId: "user-1" }),
    );
  });

  it("requires fresh reauthentication again when the deletion callback is confirmed", async () => {
    let now = new Date("2026-10-31T12:00:00.000Z");
    const env = setup({ now: () => now });
    const session = await env.service.loginLocal({
      email: "person@example.com",
      password: "correct password",
      context,
    });
    await env.service.requestAccountDeletion(session.token, context);
    now = new Date("2026-10-31T12:11:00.000Z");

    await expect(
      env.service.confirmAccountDeletion(
        session.token,
        "delete-callback",
        context,
      ),
    ).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    expect(env.store.consumeChallenge).not.toHaveBeenCalled();
    expect(env.store.confirmDeletion).not.toHaveBeenCalled();
  });

  it("restores a deletion-pending account during the grace period and issues a new session", async () => {
    const now = new Date("2026-11-01T12:00:00.000Z");
    const pending = account({
      status: "deletion-pending",
      deletionRequestedAt: new Date("2026-10-31T12:00:00.000Z"),
      deletionScheduledFor: new Date("2026-11-30T12:00:00.000Z"),
    });
    const restored = account();
    const env = setup({ existing: pending, now: () => now });
    vi.mocked(env.store.consumeChallenge).mockResolvedValue({
      id: "undo-challenge",
      userId: "user-1",
      kind: "undo-deletion",
      secretHash: "hash:undo-callback",
      expiresAt: pending.deletionScheduledFor!,
    });
    vi.mocked(env.store.getProfile)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(restored);

    const session = await env.service.undoAccountDeletion(
      "undo-callback",
      context,
    );
    expect(env.store.cancelDeletion).toHaveBeenCalledWith(
      "user-1",
      context,
      now,
    );
    expect(session.profile.status).toBe("active");
    expect(session.token).toContain(".");
  });

  it("records consent only for an exact published policy version and canonical locale", async () => {
    const isPublishedVersion = vi.fn(async () => true);
    const env = setup({ compliancePolicies: { isPublishedVersion } });
    const session = await env.service.loginLocal({
      email: "person@example.com",
      password: "correct password",
      context,
    });
    await env.service.recordConsent(
      session.token,
      {
        policyKey: "policies/privacy",
        policyVersion: "privacy-2026-10",
        locale: "en-tt",
        decision: "accepted",
        categories: ["necessary"],
      },
      context,
    );
    expect(isPublishedVersion).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en-TT" }),
    );
    expect(env.store.recordConsent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ locale: "en-TT" }),
      context,
      expect.any(Date),
    );
  });

  it("creates a normal OAuth user from a broker-verified identity", async () => {
    const env = setup({ existing: null, enabledProviders: ["google"] });
    const session = await env.service.loginOAuth({
      identity: {
        provider: "google",
        subject: "provider-subject",
        name: "OAuth Person",
        email: "person@example.com",
        emailVerified: true,
        profileImageUrl: "https://images.example.test/person.jpg",
      },
      context,
    });
    expect(env.store.createOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        email: "person@example.com",
        profileImageUrl: "https://images.example.test/person.jpg",
      }),
    );
    expect(session.permissions).toEqual(["user"]);
  });

  it("does not automatically link an OAuth identity by matching email", async () => {
    const env = setup({ enabledProviders: ["github"] });
    await expect(
      env.service.loginOAuth({
        identity: {
          provider: "github",
          subject: "github-subject",
          name: "Person",
          email: "person@example.com",
          emailVerified: true,
          profileImageUrl: null,
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
    expect(env.store.createOAuth).not.toHaveBeenCalled();
    expect(env.store.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        provider: "github",
        outcome: "rejected",
        reason: "explicit-link-required",
      }),
    );
  });
});
