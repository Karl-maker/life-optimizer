import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  type AuthenticationService,
  type AuthSession,
} from "@life-optimizer/core";
import {
  createApiServer,
  createCompositeApiAuthenticator,
} from "../src/index.js";

const session: AuthSession = {
  token: "session-id.session-secret",
  expiresAt: new Date("2026-11-30T00:00:00.000Z"),
  idleExpiresAt: new Date("2026-11-01T00:00:00.000Z"),
  riskLevel: "low",
  reauthenticationRequired: false,
  permissions: ["user"],
  profile: {
    userId: "user-1",
    name: "User",
    email: "user@example.test",
    phone: null,
    emailVerified: true,
    phoneVerified: false,
    countryCode: null,
    role: "user",
    status: "active",
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    profileImageUrl: null,
    profileImageSource: null,
  },
};

function authentication(
  overrides: Partial<AuthenticationService> = {},
): AuthenticationService {
  return {
    availableLoginMethods: () => ["local", "google"],
    signUpLocal: vi.fn(async () => ({ userId: "user-1" })),
    loginLocal: vi.fn(async () => session),
    loginOAuth: vi.fn(async () => session),
    authenticate: vi.fn(async () => session),
    logout: vi.fn(),
    requestPasswordReset: vi.fn(),
    requestConfirmation: vi.fn(),
    resetPassword: vi.fn(),
    confirm: vi.fn(),
    reauthenticateLocal: vi.fn(async () => session),
    registerDevice: vi.fn(),
    updateProfileImage: vi.fn(),
    recordConsent: vi.fn(),
    requestAccountDeletion: vi.fn(),
    confirmAccountDeletion: vi.fn(async () => ({
      scheduledFor: new Date("2026-11-30T00:00:00.000Z"),
    })),
    requestDeletionUndo: vi.fn(),
    undoAccountDeletion: vi.fn(async () => session),
    ...overrides,
  };
}

describe("authentication HTTP routes", () => {
  it("lists only configured methods and keeps signup account discovery generic", async () => {
    const service = authentication({
      signUpLocal: vi.fn(async () => {
        throw new AuthenticationError("ACCOUNT_UNAVAILABLE", "hidden");
      }),
    });
    const app = await createApiServer({ authentication: { service } });

    const methods = await app.inject({
      method: "GET",
      url: "/auth/methods",
    });
    expect(methods.json()).toEqual({ methods: ["local"] });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/methods",
        })
      ).statusCode,
    ).toBe(404);

    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: { "x-client-country": "TT" },
      payload: {
        email: "existing@example.test",
        password: "a secure passphrase",
      },
    });
    expect(signup.statusCode, signup.body).toBe(202);
    expect(signup.json()).toEqual({ accepted: true });
    expect(service.signUpLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "existing@example.test",
        context: expect.objectContaining({ countryCode: "TT" }),
      }),
    );
    await app.close();
  });

  it("documents signup name, phone, and country as optional edge inputs", async () => {
    const app = await createApiServer({
      authentication: { service: authentication() },
    });
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    const signup =
      response.json().paths["/auth/signup"].post.requestBody.content[
        "application/json"
      ].schema;
    expect(signup.required).toEqual(["email", "password"]);
    expect(signup.properties.name.description).toContain("Optional");
    expect(signup.properties.phone.description).toContain("Optional");
    expect(signup.properties.countryCode).toBeUndefined();
    await app.close();
  });

  it("resends email confirmation by default and accepts an explicit phone channel", async () => {
    const service = authentication();
    const app = await createApiServer({ authentication: { service } });
    const email = await app.inject({
      method: "POST",
      url: "/auth/confirmation/resend",
      payload: { email: "user@example.test" },
    });
    expect(email.statusCode).toBe(202);
    expect(service.requestConfirmation).toHaveBeenLastCalledWith(
      "user@example.test",
      "email",
      expect.any(Object),
    );
    const phone = await app.inject({
      method: "POST",
      url: "/auth/confirmation/resend",
      payload: { email: "user@example.test", channel: "phone" },
    });
    expect(phone.statusCode).toBe(202);
    expect(service.requestConfirmation).toHaveBeenLastCalledWith(
      "user@example.test",
      "phone",
      expect.any(Object),
    );
    await app.close();
  });

  it("keeps password-reset requests generic without an unused channel field", async () => {
    const service = authentication();
    const app = await createApiServer({ authentication: { service } });
    const response = await app.inject({
      method: "POST",
      url: "/auth/password/forgot",
      payload: { email: "user@example.test" },
    });
    expect(response.statusCode).toBe(202);
    expect(service.requestPasswordReset).toHaveBeenCalledWith(
      "user@example.test",
      expect.any(Object),
    );
    await app.close();
  });

  it("uses host-only secure cookies for websites and never returns their token", async () => {
    const app = await createApiServer({
      authentication: { service: authentication() },
    });
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "user@example.test",
        password: "a secure passphrase",
        client: "website",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("token");
    const cookies = response.headers["set-cookie"];
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "__Host-edu_session=session-id.session-secret; HttpOnly; Path=/; Secure; SameSite=Lax",
        ),
      ]),
    );
    await app.close();
  });

  it("returns the current profile for a bearer token without returning that token", async () => {
    const service = authentication();
    const app = await createApiServer({ authentication: { service } });
    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: "Bearer session-id.session-secret" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ profile: { userId: "user-1" } });
    expect(response.json()).not.toHaveProperty("token");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(service.authenticate).toHaveBeenCalledWith(
      "session-id.session-secret",
      expect.any(Object),
    );
    await app.close();
  });

  it("returns opaque bearer sessions to API clients and ignores untrusted CloudFront headers", async () => {
    const loginLocal = vi.fn(
      async (_input: Parameters<AuthenticationService["loginLocal"]>[0]) =>
        session,
    );
    const app = await createApiServer({
      authentication: { service: authentication({ loginLocal }) },
    });
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        "cloudfront-viewer-country": "US",
        "cloudfront-viewer-address": "203.0.113.9:443",
        "x-client-platform": "cli",
      },
      payload: {
        email: "user@example.test",
        password: "a secure passphrase",
        client: "api",
      },
    });
    expect(response.json()).toMatchObject({ token: session.token });
    expect(loginLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ platform: "cli" }),
      }),
    );
    expect(loginLocal.mock.calls[0]?.[0].context.countryCode).toBeUndefined();
    expect(loginLocal.mock.calls[0]?.[0].context.ipAddress).not.toBe(
      "203.0.113.9",
    );
    await app.close();
  });

  it("rejects Domain configuration for __Host cookies", async () => {
    await expect(
      createApiServer({
        authentication: {
          service: authentication(),
          cookieDomain: "example.test",
        },
      }),
    ).rejects.toThrow("__Host-");
  });

  it("passes only broker-verified OAuth identity into the core login use case", async () => {
    const loginOAuth = vi.fn(async () => session);
    const service = authentication({ loginOAuth });
    const identity = {
      provider: "google" as const,
      subject: "google-subject",
      name: "Person",
      email: "person@example.test",
      emailVerified: true,
      profileImageUrl: null,
    };
    const app = await createApiServer({
      authentication: {
        service,
        oauth: {
          begin: vi.fn(async () => ({
            authorizationUrl: "https://accounts.example/authorize",
          })),
          complete: vi.fn(async () => identity),
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/auth/oauth/google/callback",
      payload: {
        code: "authorization-code",
        state: "single-use-state",
        client: "api",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(loginOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ identity }),
    );
    await app.close();
  });

  it("uses separate initiation, signed-in confirmation, and undo callbacks for deletion", async () => {
    const requestAccountDeletion = vi.fn();
    const confirmAccountDeletion = vi.fn(async () => ({
      scheduledFor: new Date("2026-11-30T00:00:00.000Z"),
    }));
    const undoAccountDeletion = vi.fn(async () => session);
    const app = await createApiServer({
      authentication: {
        service: authentication({
          requestAccountDeletion,
          confirmAccountDeletion,
          undoAccountDeletion,
        }),
      },
    });
    const initiated = await app.inject({
      method: "DELETE",
      url: "/auth/account",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(initiated.statusCode).toBe(202);
    expect(initiated.headers["set-cookie"]).toBeUndefined();

    const confirmed = await app.inject({
      method: "POST",
      url: "/auth/account/deletion/confirm",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { token: "email-callback-token" },
    });
    expect(confirmed.statusCode).toBe(202);
    expect(confirmed.json()).toEqual({
      accepted: true,
      scheduledFor: "2026-11-30T00:00:00.000Z",
    });
    expect(confirmAccountDeletion).toHaveBeenCalledWith(
      session.token,
      "email-callback-token",
      expect.any(Object),
    );

    const undone = await app.inject({
      method: "POST",
      url: "/auth/account/deletion/undo",
      payload: { token: "undo-callback-token", client: "api" },
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json()).toMatchObject({ token: session.token });
    await app.close();
  });
});

describe("API principal authentication", () => {
  it("maps a revocable bearer session to its core permissions", async () => {
    const service = authentication();
    const authenticator = createCompositeApiAuthenticator({
      sessions: service,
    });
    await expect(
      authenticator.authenticate({
        bearerToken: session.token,
        requestId: "request-1",
        context: {
          correlationId: "request-1",
          ipAddress: "198.51.100.1",
          platform: "cli",
        },
      }),
    ).resolves.toEqual({ id: "user-1", kind: "bearer", permissions: ["user"] });
  });

  it("rejects requests that send both API-key and bearer credentials", async () => {
    const verify = vi.fn();
    const authenticator = createCompositeApiAuthenticator({
      sessions: authentication(),
      apiKeys: { verify },
    });
    await expect(
      authenticator.authenticate({
        apiKey: "api-key",
        bearerToken: session.token,
        requestId: "request-1",
        context: {
          correlationId: "request-1",
          ipAddress: "198.51.100.1",
          platform: "browser",
        },
      }),
    ).resolves.toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
});
