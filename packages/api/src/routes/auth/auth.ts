import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  AuthenticationService,
  AuthRequestContext,
  AuthSession,
  CountryCode,
  LoginProvider,
  VerifiedOAuthIdentity,
} from "@edu-service/core";
import { parseCountryCode } from "@edu-service/core";
import { defineJsonRoute } from "../../contracts.js";
import { ApiAuthenticationError } from "../../auth.js";

export interface OAuthLoginBroker {
  begin(
    provider: Exclude<LoginProvider, "local">,
    input: { returnTo?: string; context: AuthRequestContext },
  ): Promise<{ authorizationUrl: string }>;
  complete(
    provider: Exclude<LoginProvider, "local">,
    input: { code: string; state: string; context: AuthRequestContext },
  ): Promise<VerifiedOAuthIdentity>;
}

export interface AuthRoutesOptions {
  service: AuthenticationService;
  oauth?: OAuthLoginBroker;
  cookieName?: string;
  cookieDomain?: string;
  trustCloudFrontHeaders?: boolean;
}

const strictObject = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length === 0 ? {} : { required }),
});
const string = (maxLength: number, minLength = 1) => ({
  type: "string",
  minLength,
  maxLength,
});
const email = { ...string(320), format: "email" };
const accepted = strictObject({ accepted: { type: "boolean" } }, ["accepted"]);
const nullableString = (maxLength: number) => ({
  anyOf: [string(maxLength), { type: "null" }],
});
const profileResponse = strictObject(
  {
    userId: string(100),
    name: string(200),
    email: nullableString(320),
    phone: nullableString(30),
    emailVerified: { type: "boolean" },
    phoneVerified: { type: "boolean" },
    countryCode: {
      anyOf: [{ ...string(2, 2), pattern: "^[A-Z]{2}$" }, { type: "null" }],
    },
    role: { enum: ["user", "admin"] },
    status: { enum: ["pending", "active", "deletion-pending", "deleted"] },
    deletionRequestedAt: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
    deletionScheduledFor: {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
    profileImageUrl: nullableString(2048),
    profileImageSource: {
      anyOf: [{ enum: ["provider", "user"] }, { type: "null" }],
    },
  },
  [
    "userId",
    "name",
    "email",
    "phone",
    "emailVerified",
    "phoneVerified",
    "countryCode",
    "role",
    "status",
    "deletionRequestedAt",
    "deletionScheduledFor",
    "profileImageUrl",
    "profileImageSource",
  ],
);
const sessionResponse = strictObject(
  {
    token: { type: "string" },
    expiresAt: { type: "string", format: "date-time" },
    idleExpiresAt: { type: "string", format: "date-time" },
    riskLevel: { enum: ["low", "medium", "high"] },
    reauthenticationRequired: { type: "boolean" },
    permissions: { type: "array", maxItems: 100, items: string(100) },
    profile: profileResponse,
  },
  [
    "expiresAt",
    "idleExpiresAt",
    "riskLevel",
    "reauthenticationRequired",
    "permissions",
    "profile",
  ],
);

export function registerAuthenticationRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions,
) {
  const cookieName = options.cookieName ?? "__Host-edu_session";
  if (cookieName.startsWith("__Host-") && options.cookieDomain !== undefined) {
    throw new Error(
      "A __Host- cookie cannot be configured with a Domain attribute.",
    );
  }
  const context = (request: FastifyRequest) => requestContext(request, options);

  app.get(
    "/v1/auth/methods",
    {
      schema: defineJsonRoute({
        summary: "List available login methods",
        description: "Only fully configured OAuth providers are returned.",
        tags: ["Authentication"],
        operationId: "listAuthenticationMethods",
        response: {
          200: {
            description: "Available methods",
            ...strictObject(
              { methods: { type: "array", items: { type: "string" } } },
              ["methods"],
            ),
          },
        },
      }),
    },
    async () => ({
      methods: options.service
        .availableLoginMethods()
        .filter(
          (provider) => provider === "local" || options.oauth !== undefined,
        ),
    }),
  );

  app.post(
    "/v1/auth/signup",
    {
      schema: defineJsonRoute({
        summary: "Create a local account",
        description:
          "Creates a normal user and sends an email confirmation. Responses do not reveal existing accounts.",
        tags: ["Authentication"],
        operationId: "signUpLocal",
        headers: strictObject({
          "x-client-country": {
            ...string(2, 2),
            pattern: "^[A-Z]{2}$",
            description:
              "Optional ISO 3166-1 alpha-2 country hint. If omitted, trusted CloudFront deployments may use CloudFront-Viewer-Country; otherwise country remains unknown.",
          },
          "x-client-platform": {
            enum: ["browser", "ios", "android", "cli", "other"],
            description:
              "Optional client platform hint. Missing values default to browser.",
          },
          "x-device-id": {
            ...string(200),
            description: "Optional stable client device identifier.",
          },
        }),
        body: strictObject(
          {
            name: {
              ...string(200),
              description:
                "Optional display name. If omitted, the service derives a display name from the email local part.",
            },
            email,
            phone: {
              ...string(30),
              pattern: "^\\+[1-9][0-9]{7,14}$",
              description:
                "Optional E.164 phone number. Required only when confirmationChannel is phone.",
            },
            confirmationChannel: { enum: ["email", "phone"] },
            password: string(128, 12),
          },
          ["email", "password"],
        ),
        response: {
          202: { description: "Confirmation initiated", ...accepted },
        },
      }),
    },
    async (request, reply) => {
      const body = request.body as {
        name?: string;
        email: string;
        phone?: string;
        confirmationChannel?: "email" | "phone";
        password: string;
      };
      try {
        await options.service.signUpLocal({
          ...body,
          context: context(request),
        });
      } catch (error) {
        // Account discovery must not be possible through signup responses.
        if (!isAuthenticationCode(error, "ACCOUNT_UNAVAILABLE")) throw error;
      }
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    "/v1/auth/login",
    {
      schema: defineJsonRoute({
        summary: "Log in with email and password",
        description:
          "Website sessions use a Secure HttpOnly cookie; API, mobile and CLI clients receive an opaque bearer token.",
        tags: ["Authentication"],
        operationId: "loginLocal",
        problemResponses: [401],
        body: strictObject(
          {
            email,
            password: string(128),
            client: { enum: ["website", "api", "mobile", "cli"] },
          },
          ["email", "password", "client"],
        ),
        response: {
          200: { description: "Authenticated session", ...sessionResponse },
        },
      }),
    },
    async (request, reply) => {
      const body = request.body as {
        email: string;
        password: string;
        client: string;
      };
      const session = await options.service.loginLocal({
        email: body.email,
        password: body.password,
        context: context(request),
      });
      if (body.client === "website")
        setSessionCookies(
          reply,
          cookieName,
          session.token,
          options.cookieDomain,
        );
      return serializeSession(session, body.client !== "website");
    },
  );

  app.post(
    "/v1/auth/logout",
    {
      schema: defineJsonRoute({
        summary: "Log out",
        tags: ["Authentication"],
        operationId: "logout",
        permissions: ["user"],
        response: { 204: { description: "Session revoked", type: "null" } },
      }),
    },
    async (request, reply) => {
      const token = requireSessionToken(request, cookieName, true);
      try {
        await options.service.logout(token);
      } catch (error) {
        if (!isAuthenticationCode(error, "INVALID_CREDENTIALS")) throw error;
      }
      clearSessionCookies(reply, cookieName, options.cookieDomain);
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/auth/confirm",
    {
      schema: defineJsonRoute({
        summary: "Confirm an email or phone",
        tags: ["Authentication"],
        operationId: "confirmAccountContact",
        problemResponses: [401],
        body: strictObject(
          { kind: { enum: ["email", "phone"] }, token: string(256) },
          ["kind", "token"],
        ),
        response: { 204: { description: "Contact confirmed", type: "null" } },
      }),
    },
    async (request, reply) => {
      const body = request.body as { kind: "email" | "phone"; token: string };
      await options.service.confirm(body.kind, body.token);
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/auth/password/forgot",
    {
      schema: defineJsonRoute({
        summary: "Request password reset",
        description: "Always returns the same response.",
        tags: ["Authentication"],
        operationId: "requestPasswordReset",
        body: strictObject({ email, channel: { enum: ["email", "phone"] } }, [
          "email",
          "channel",
        ]),
        response: {
          202: { description: "Reset request accepted", ...accepted },
        },
      }),
    },
    async (request, reply) => {
      await options.service.requestPasswordReset(
        (request.body as { email: string }).email,
        context(request),
      );
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    "/v1/auth/confirmation/resend",
    {
      schema: defineJsonRoute({
        summary: "Resend account confirmation",
        description: "Always returns the same response.",
        tags: ["Authentication"],
        operationId: "resendAccountConfirmation",
        body: strictObject({ email }, ["email"]),
        response: {
          202: { description: "Confirmation request accepted", ...accepted },
        },
      }),
    },
    async (request, reply) => {
      const body = request.body as {
        email: string;
        channel: "email" | "phone";
      };
      await options.service.requestConfirmation(
        body.email,
        body.channel,
        context(request),
      );
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    "/v1/auth/password/reset",
    {
      schema: defineJsonRoute({
        summary: "Reset password",
        tags: ["Authentication"],
        operationId: "resetPassword",
        problemResponses: [401],
        body: strictObject({ token: string(256), password: string(128, 12) }, [
          "token",
          "password",
        ]),
        response: {
          204: {
            description: "Password reset; sessions revoked",
            type: "null",
          },
        },
      }),
    },
    async (request, reply) => {
      const body = request.body as { token: string; password: string };
      await options.service.resetPassword(body.token, body.password);
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/auth/reauthenticate",
    {
      schema: defineJsonRoute({
        summary: "Reauthenticate for sensitive actions",
        tags: ["Authentication"],
        operationId: "reauthenticate",
        permissions: ["user"],
        body: strictObject({ password: string(128) }, ["password"]),
        response: {
          200: { description: "Session assurance renewed", ...sessionResponse },
        },
      }),
    },
    async (request) =>
      serializeSession(
        await options.service.reauthenticateLocal(
          requireSessionToken(request, cookieName, true),
          (request.body as { password: string }).password,
        ),
        false,
      ),
  );

  app.delete(
    "/v1/auth/account",
    {
      schema: defineJsonRoute({
        summary: "Request account deletion",
        description:
          "Requires reauthentication within ten minutes and sends a separate confirmation callback. No deletion state changes yet.",
        tags: ["Authentication", "Compliance"],
        operationId: "requestAccountDeletion",
        permissions: ["user"],
        response: { 202: { description: "Deletion requested", ...accepted } },
      }),
    },
    async (request, reply) => {
      await options.service.requestAccountDeletion(
        requireSessionToken(request, cookieName, true),
        context(request),
      );
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    "/v1/auth/account/deletion/confirm",
    {
      schema: defineJsonRoute({
        summary: "Confirm account deletion",
        description:
          "Requires a signed-in session reauthenticated within ten minutes plus the one-time email/SMS callback. Every session is then revoked and the recovery grace period begins.",
        tags: ["Authentication", "Compliance"],
        operationId: "confirmAccountDeletion",
        permissions: ["user"],
        problemResponses: [401],
        body: strictObject({ token: string(256) }, ["token"]),
        response: {
          202: {
            description: "Deletion scheduled",
            ...strictObject(
              {
                accepted: { type: "boolean" },
                scheduledFor: { type: "string", format: "date-time" },
              },
              ["accepted", "scheduledFor"],
            ),
          },
        },
      }),
    },
    async (request, reply) => {
      const result = await options.service.confirmAccountDeletion(
        requireSessionToken(request, cookieName, true),
        (request.body as { token: string }).token,
        context(request),
      );
      clearSessionCookies(reply, cookieName, options.cookieDomain);
      return reply.code(202).send({
        accepted: true,
        scheduledFor: result.scheduledFor.toISOString(),
      });
    },
  );

  app.post(
    "/v1/auth/account/deletion/undo/resend",
    {
      schema: defineJsonRoute({
        summary: "Resend account deletion recovery callback",
        description: "Always returns the same response.",
        tags: ["Authentication", "Compliance"],
        operationId: "resendAccountDeletionUndo",
        body: strictObject({ email }, ["email"]),
        response: {
          202: { description: "Recovery request accepted", ...accepted },
        },
      }),
    },
    async (request, reply) => {
      await options.service.requestDeletionUndo(
        (request.body as { email: string }).email,
        context(request),
      );
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    "/v1/auth/account/deletion/undo",
    {
      schema: defineJsonRoute({
        summary: "Undo pending account deletion",
        description:
          "Consumes the recovery callback before the grace period expires, restores the account and issues a new session.",
        tags: ["Authentication", "Compliance"],
        operationId: "undoAccountDeletion",
        problemResponses: [401],
        body: strictObject(
          {
            token: string(256),
            client: { enum: ["website", "api", "mobile", "cli"] },
          },
          ["token", "client"],
        ),
        response: {
          200: { description: "Deletion cancelled", ...sessionResponse },
        },
      }),
    },
    async (request, reply) => {
      const body = request.body as { token: string; client: string };
      const session = await options.service.undoAccountDeletion(
        body.token,
        context(request),
      );
      if (body.client === "website")
        setSessionCookies(
          reply,
          cookieName,
          session.token,
          options.cookieDomain,
        );
      return serializeSession(session, body.client !== "website");
    },
  );

  app.post(
    "/v1/auth/devices",
    {
      schema: defineJsonRoute({
        summary: "Register or update a client device",
        tags: ["Authentication"],
        operationId: "registerAuthDevice",
        permissions: ["user"],
        body: strictObject(
          {
            deviceId: string(200),
            platform: { enum: ["browser", "ios", "android", "cli", "other"] },
            name: string(200),
            pushToken: string(4096),
            appVersion: string(100),
            locale: string(50),
            timeZone: string(100),
          },
          ["deviceId", "platform"],
        ),
        response: { 204: { description: "Device registered", type: "null" } },
      }),
    },
    async (request, reply) => {
      await options.service.registerDevice(
        requireSessionToken(request, cookieName, true),
        request.body as never,
        context(request),
      );
      return reply.code(204).send();
    },
  );

  app.put(
    "/v1/auth/profile/image",
    {
      schema: defineJsonRoute({
        summary: "Attach or clear a user-uploaded profile image",
        description:
          "Upload through the storage workflow first, then attach its HTTPS delivery URL. User images are not overwritten by later provider logins.",
        tags: ["Authentication"],
        operationId: "updateAuthProfileImage",
        permissions: ["user"],
        body: strictObject(
          {
            url: {
              anyOf: [
                {
                  type: "string",
                  format: "uri",
                  pattern: "^https://",
                  maxLength: 2048,
                },
                { type: "null" },
              ],
            },
          },
          ["url"],
        ),
        response: {
          204: { description: "Profile image updated", type: "null" },
        },
      }),
    },
    async (request, reply) => {
      await options.service.updateProfileImage(
        requireSessionToken(request, cookieName, true),
        (request.body as { url: string | null }).url,
      );
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/compliance/consents",
    {
      schema: defineJsonRoute({
        summary: "Record consent decision",
        description:
          "Validates and records the exact immutable published policy version and locale; policy documents must not contain feature gates.",
        tags: ["Compliance"],
        operationId: "recordConsent",
        permissions: ["user"],
        problemResponses: [422],
        body: strictObject(
          {
            policyKey: string(128),
            policyVersion: string(128),
            locale: string(50),
            decision: { enum: ["accepted", "rejected", "withdrawn"] },
            categories: { type: "array", maxItems: 50, items: string(100) },
          },
          ["policyKey", "policyVersion", "locale", "decision", "categories"],
        ),
        response: { 204: { description: "Consent recorded", type: "null" } },
      }),
    },
    async (request, reply) => {
      await options.service.recordConsent(
        requireSessionToken(request, cookieName, true),
        request.body as never,
        context(request),
      );
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/auth/oauth/:provider/start",
    {
      schema: defineJsonRoute({
        summary: "Begin OAuth login",
        tags: ["Authentication"],
        operationId: "beginOAuthLogin",
        problemResponses: [401],
        params: strictObject(
          { provider: { enum: ["google", "github", "facebook"] } },
          ["provider"],
        ),
        body: strictObject({
          returnTo: { ...string(2048), pattern: "^/(?!/)" },
        }),
        response: {
          200: {
            description: "Provider authorization URL",
            ...strictObject(
              { authorizationUrl: { type: "string", format: "uri" } },
              ["authorizationUrl"],
            ),
          },
        },
      }),
    },
    async (request) => {
      if (!options.oauth)
        throw new ApiAuthenticationError("OAuth login is unavailable.");
      const provider = (
        request.params as { provider: Exclude<LoginProvider, "local"> }
      ).provider;
      if (!options.service.availableLoginMethods().includes(provider))
        throw new ApiAuthenticationError("OAuth login is unavailable.");
      const returnTo = (request.body as { returnTo?: string }).returnTo;
      return options.oauth.begin(provider, {
        ...(returnTo === undefined ? {} : { returnTo }),
        context: context(request),
      });
    },
  );

  app.post(
    "/v1/auth/oauth/:provider/callback",
    {
      schema: defineJsonRoute({
        summary: "Complete OAuth login",
        tags: ["Authentication"],
        operationId: "completeOAuthLogin",
        problemResponses: [401, 409],
        params: strictObject(
          { provider: { enum: ["google", "github", "facebook"] } },
          ["provider"],
        ),
        body: strictObject(
          {
            code: string(4096),
            state: string(4096),
            client: { enum: ["website", "api", "mobile", "cli"] },
          },
          ["code", "state", "client"],
        ),
        response: {
          200: { description: "Authenticated session", ...sessionResponse },
        },
      }),
    },
    async (request, reply) => {
      if (!options.oauth)
        throw new ApiAuthenticationError("OAuth login is unavailable.");
      const provider = (
        request.params as { provider: Exclude<LoginProvider, "local"> }
      ).provider;
      const body = request.body as {
        code: string;
        state: string;
        client: string;
      };
      if (!options.service.availableLoginMethods().includes(provider))
        throw new ApiAuthenticationError("OAuth login is unavailable.");
      const identity = await options.oauth.complete(provider, {
        code: body.code,
        state: body.state,
        context: context(request),
      });
      if (identity.provider !== provider)
        throw new ApiAuthenticationError("OAuth identity mismatch.");
      const session = await options.service.loginOAuth({
        identity,
        context: context(request),
      });
      if (body.client === "website")
        setSessionCookies(
          reply,
          cookieName,
          session.token,
          options.cookieDomain,
        );
      return serializeSession(session, body.client !== "website");
    },
  );
}

function requestContext(
  request: FastifyRequest,
  options: AuthRoutesOptions,
): AuthRequestContext {
  const trusted = options.trustCloudFrontHeaders === true;
  const country =
    header(request, "x-client-country") ??
    (trusted ? header(request, "cloudfront-viewer-country") : undefined);
  const ja3 = trusted
    ? header(request, "cloudfront-viewer-ja3-fingerprint")
    : undefined;
  const ja4 = trusted
    ? header(request, "cloudfront-viewer-ja4-fingerprint")
    : undefined;
  const asn = trusted ? header(request, "cloudfront-viewer-asn") : undefined;
  let countryCode: CountryCode | undefined;
  try {
    if (country) countryCode = parseCountryCode(country);
  } catch {
    countryCode = undefined;
  }
  return {
    correlationId: request.id,
    ipAddress: trusted
      ? (parseViewerAddress(header(request, "cloudfront-viewer-address")) ??
        request.ip)
      : request.ip,
    platform: parsePlatform(header(request, "x-client-platform")),
    ...(countryCode === undefined ? {} : { countryCode }),
    ...(request.headers["user-agent"] === undefined
      ? {}
      : { userAgent: request.headers["user-agent"] }),
    ...(header(request, "x-device-id") === undefined
      ? {}
      : { deviceId: header(request, "x-device-id")! }),
    ...(trusted
      ? {
          cloudFront: {
            ...(ja3 === undefined ? {} : { ja3 }),
            ...(ja4 === undefined ? {} : { ja4 }),
            ...(asn === undefined ? {} : { asn }),
          },
        }
      : {}),
  };
}

function requireSessionToken(
  request: FastifyRequest,
  cookieName: string,
  csrf: boolean,
): string {
  const bearer = /^Bearer\s+(.+)$/i.exec(
    request.headers.authorization ?? "",
  )?.[1];
  if (bearer) return bearer;
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[cookieName];
  if (!token) throw new ApiAuthenticationError();
  if (csrf) {
    const headerToken = header(request, "x-csrf-token");
    const cookieToken = cookies[`${cookieName}_csrf`];
    if (!headerToken || !cookieToken || !safeEqual(headerToken, cookieToken))
      throw new ApiAuthenticationError("CSRF validation failed.");
  }
  return token;
}

function setSessionCookies(
  reply: import("fastify").FastifyReply,
  name: string,
  token: string,
  domain?: string,
) {
  const csrf = randomUUID();
  const suffix = `Path=/; Secure; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
  reply.header("set-cookie", [
    `${name}=${encodeURIComponent(token)}; HttpOnly; ${suffix}`,
    `${name}_csrf=${csrf}; ${suffix}`,
  ]);
}
function clearSessionCookies(
  reply: import("fastify").FastifyReply,
  name: string,
  domain?: string,
) {
  const suffix = `Path=/; Secure; SameSite=Lax; Max-Age=0${domain ? `; Domain=${domain}` : ""}`;
  reply.header("set-cookie", [
    `${name}=; HttpOnly; ${suffix}`,
    `${name}_csrf=; ${suffix}`,
  ]);
}
function parseCookies(value?: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (value ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    try {
      result[part.slice(0, separator).trim()] = decodeURIComponent(
        part.slice(separator + 1),
      );
    } catch {
      // Ignore malformed cookie encodings instead of turning hostile input into a 500.
    }
  }
  return result;
}
function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function parsePlatform(value?: string): AuthRequestContext["platform"] {
  return value === "ios" ||
    value === "android" ||
    value === "browser" ||
    value === "cli" ||
    value === "other"
    ? value
    : "browser";
}
function parseViewerAddress(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    return close > 1 ? value.slice(1, close) : undefined;
  }
  const lastColon = value.lastIndexOf(":");
  return lastColon > 0 && /^\d+$/.test(value.slice(lastColon + 1))
    ? value.slice(0, lastColon)
    : value;
}
function serializeSession(session: AuthSession, includeToken: boolean) {
  return {
    ...(includeToken ? { token: session.token } : {}),
    expiresAt: session.expiresAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    riskLevel: session.riskLevel,
    reauthenticationRequired: session.reauthenticationRequired,
    permissions: session.permissions,
    profile: session.profile,
  };
}
function isAuthenticationCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
