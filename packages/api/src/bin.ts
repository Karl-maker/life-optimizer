#!/usr/bin/env node
// The executable API composition root: process/env handling stays at the edge.
import "dotenv/config";
import { fileURLToPath } from "node:url";
import {
  createAuthenticationService,
  createAuthorizationService,
  createAdminDataService,
  createDisposableEmailPolicy,
  type IdentityPresenceIndex,
  type OperationLog,
  type VerificationDelivery,
} from "@edu-service/core";
import {
  createDummyPasswordHash,
  createHmacSecretCodec,
  createScryptPasswordHasher,
  readAuthenticationConfiguration,
} from "@edu-service/auth";
import { createDatabase } from "@edu-service/db";
import {
  createEmailService,
  createResendEmailTransport,
  readEmailConfiguration,
} from "@edu-service/email";
import {
  createBillingService,
  createFinancialReportingService,
  createFinancialService,
  createPowerTranzCheckout,
  createStorePurchaseService,
  readFinancialConfiguration,
  readStoreProviderConfiguration,
} from "@edu-service/financial";
import { createPatronService } from "@edu-service/patron";
import {
  createS3ObjectStore,
  readAwsStorageConfiguration,
} from "@edu-service/storage/aws";
import { createEmailUnsubscribeTokens } from "./email-unsubscribe.js";
import {
  createTwilioSmsAdapter,
  createSmsService,
  readSmsConfiguration,
} from "@edu-service/sms";
import {
  createNotificationInboxService,
  readNotificationConfiguration,
} from "@edu-service/notifications";
import { createFeatureFlagManagementService } from "@edu-service/feature-flags";
import {
  createHttpSink,
  createJsonLinesSink,
  createLocalFileSink,
  createTelemetry,
  type EventSink,
} from "@edu-service/observability";
import {
  createApiServer,
  createCompositeApiAuthenticator,
  readApiConfiguration,
  type ApiServerOptions,
} from "./index.js";
import {
  createSmtpEmailTransport,
  verifySmtpConfiguration,
} from "./smtp-email-transport.js";

const telemetry = createTelemetry({
  service: "edu-service-api",
  sinks: telemetrySinks(process.env),
  onSinkError: () => undefined,
});

const alwaysCheckDatabasePresence: IdentityPresenceIndex = {
  async mightContain() {
    return true;
  },
  async add() {
    // Local single-process API startup does not maintain a shared Bloom filter.
  },
};

const unconfiguredChallengeDelivery: VerificationDelivery = {
  async send() {
    // Local composition stores challenges but does not send email or SMS.
  },
};

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(
    "DATABASE_URL is required, for example: postgresql://postgres:postgres@localhost:5432/edu_service",
  );
  process.exitCode = 1;
} else {
  const database = createDatabase({
    connectionString,
    operationLog: {
      info: (name, attributes, correlationId) =>
        telemetry.info(name, attributes, correlationId),
      error: (name, attributes, correlationId) =>
        telemetry.error(name, attributes, correlationId),
    },
  });
  const emailConfiguration = readEmailConfiguration(
    emailEnvironment(process.env),
  );
  if (emailConfiguration) {
    await database.emails.saveConfiguration(emailConfiguration.configuration);
  }
  const smsConfiguration = readSmsConfiguration(process.env);
  if (smsConfiguration)
    await database.sms.saveConfiguration(smsConfiguration.configuration);
  const notificationConfiguration = readNotificationConfiguration(process.env);
  if (notificationConfiguration)
    await database.notifications.saveConfiguration(
      notificationConfiguration.configuration,
    );
  const challengeDelivery = await createChallengeDelivery({
    database,
    emailConfiguration,
    smsConfiguration,
    operationLog: {
      info: (name, attributes, correlationId) =>
        telemetry.info(name, attributes, correlationId),
      error: (name, attributes, correlationId) =>
        telemetry.error(name, attributes, correlationId),
    },
  });
  if (emailConfiguration?.configuration.transportId === "smtp")
    try {
      await verifySmtpConfiguration(process.env);
      telemetry.info("email.smtp.verified", {
        configurationId: emailConfiguration.configuration.id,
      });
    } catch {
      telemetry.error("email.smtp.verification.failed", {
        configurationId: emailConfiguration.configuration.id,
      });
    }
  const configuration = readApiConfiguration(process.env);
  const authConfiguration = await readLocalAuthConfiguration();
  const authenticationService = createAuthenticationService({
    store: database.authentication,
    passwords: createScryptPasswordHasher({
      pepper: authConfiguration.passwordPepper,
      dummyHash: authConfiguration.dummyHash,
    }),
    secrets: createHmacSecretCodec(authConfiguration.tokenHmacKey),
    presence: alwaysCheckDatabasePresence,
    delivery: challengeDelivery,
    disposableEmailPolicy: createDisposableEmailPolicy(
      csv(process.env.EDU_AUTH_BLOCKED_EMAIL_DOMAINS),
    ),
    enabledProviders: authConfiguration.oauth.map(
      (provider) => provider.provider,
    ),
    deletionGraceMs: authConfiguration.deletionGraceMs,
    onDeliveryFailure: ({ kind, userId }) =>
      telemetry.warn("auth.challenge.delivery.failed", { kind, userId }),
  });
  const authorizationService = createAuthorizationService({
    repository: database.authorization,
    transactions: database.authorizationTransactions,
  });
  const apiAuthenticator = createCompositeApiAuthenticator({
    sessions: authenticationService,
    permissionsForUser: (userId) =>
      authorizationService.permissionsForUser(userId),
  });
  const operationLog: OperationLog = {
    info: (name, attributes, correlationId) =>
      telemetry.info(name, attributes, correlationId),
    error: (name, attributes, correlationId) =>
      telemetry.error(name, attributes, correlationId),
  };
  const billingService = createBillingService({
    repository: database.billing,
    transactions: database.billingTransactions,
    operationLog,
  });
  const financialService = createFinancialService({
    repository: database.financial,
    transactions: database.financialTransactions,
    operationLog,
  });
  const financialReportingService = createFinancialReportingService(
    database.financialReporting,
  );
  const providers = readFinancialConfiguration(process.env, operationLog);
  const storeProviders = readStoreProviderConfiguration(
    process.env,
    operationLog,
  );
  const storePurchaseService = createStorePurchaseService({
    repository: database.storePurchases,
    transactions: database.storePurchaseTransactions,
  });
  const powerTranzCheckout = providers.powertranz
    ? createPowerTranzCheckout({
        adapter: providers.powertranz,
        repository: database.powerTranzSales,
        billing: billingService,
        findInvoice: (id) => database.billing.findInvoice(id),
        findAccountById: (id) => database.financial.findAccountById(id),
        agentId: "powertranz-callback",
        operationLog,
      })
    : null;
  const objectStore =
    process.env.EDU_STORAGE_AWS_REGION?.trim() &&
    process.env.EDU_STORAGE_S3_BUCKET?.trim()
      ? createS3ObjectStore({
          configuration: readAwsStorageConfiguration(process.env),
          audit: { audit: database.auditLog },
        })
      : null;
  const serverOptions: ApiServerOptions = {
    ...(configuration.buildId === undefined
      ? {}
      : { buildId: configuration.buildId }),
    authentication: {
      service: authenticationService,
    },
    authorization: {
      service: authorizationService,
      authenticator: apiAuthenticator,
    },
    adminData: {
      service: createAdminDataService(database.adminData),
      authenticator: apiAuthenticator,
    },
    financialReporting: {
      service: financialReportingService,
      authenticator: apiAuthenticator,
    },
    featureFlags: {
      service: createFeatureFlagManagementService({
        repository: database.featureFlags,
        recorder: database.featureFlagExposures,
        audit: database.featureFlagAudit,
      }),
      authenticator: apiAuthenticator,
    },
    cms: {
      authenticator: apiAuthenticator,
      defaultLocales: ["en"],
    },
    notifications: {
      service: createNotificationInboxService(database.notifications),
      authenticator: apiAuthenticator,
    },
    patrons: {
      service: createPatronService({
        repository: database.patron,
        transactions: database.patronTransactions,
        operationLog,
      }),
      authenticator: apiAuthenticator,
    },
    commerce: {
      billing: billingService,
      financial: financialService,
      reporting: financialReportingService,
      findInvoice: (id) => database.billing.findInvoice(id),
      findAccountById: (id) => database.financial.findAccountById(id),
      authenticator: apiAuthenticator,
      providers: providers.stripe ? [providers.stripe] : [],
    },
    uploads: {
      ...(objectStore ? { store: objectStore } : {}),
      authenticator: apiAuthenticator,
    },
    stripeWebhook: {
      ...(providers.stripe ? { verifier: providers.stripe } : {}),
      actor: {
        kind: "agent" as const,
        agentId: "stripe-webhook",
        onBehalfOf: "00000000-0000-0000-0000-000000000000",
        permissions: ["financial:manage" as const],
      },
      sync: billingService,
    },
    powerTranzCallback: {
      ...(powerTranzCheckout ? { checkout: powerTranzCheckout } : {}),
    },
    storePurchases: {
      service: storePurchaseService,
      ...(storeProviders.apple ? { apple: storeProviders.apple } : {}),
      ...(storeProviders.google ? { google: storeProviders.google } : {}),
      authenticator: apiAuthenticator,
      resolveUserId: (principal) => principal.id,
      webhookActor: {
        kind: "agent" as const,
        agentId: "store-webhook",
        onBehalfOf: "00000000-0000-0000-0000-000000000000",
        permissions: ["financial:manage" as const],
      },
    },
    ...(process.env.EDU_EMAIL_UNSUBSCRIBE_HMAC_KEY?.trim()
      ? {
          emailUnsubscribe: {
            email: createEmailService({
              repository: database.emails,
              transports: [],
            }),
            tokens: createEmailUnsubscribeTokens(
              process.env.EDU_EMAIL_UNSUBSCRIBE_HMAC_KEY,
            ),
          },
        }
      : {}),
    healthChecks: [{ name: "database", check: () => database.ping() }],
    telemetry,
    ...(configuration.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: configuration.allowedOrigins }),
    ...(configuration.blockedOrigins === undefined
      ? {}
      : { blockedOrigins: configuration.blockedOrigins }),
    ...(configuration.blockedOriginSupportReference === undefined
      ? {}
      : {
          blockedOriginSupportReference:
            configuration.blockedOriginSupportReference,
        }),
  };
  const app = await createApiServer(serverOptions);

  const shutdown = async () => {
    await app.close();
    await database.close();
    await telemetry.flush();
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(143));
  });

  try {
    await app.listen({
      host: configuration.host,
      port: configuration.port,
    });
    telemetry.info("api.started", {
      host: configuration.host,
      port: configuration.port,
      emailConfigured: emailConfiguration !== null,
      smsConfigured: smsConfiguration !== null,
    });
    console.error(
      `Edu Service API listening on http://${configuration.host}:${configuration.port}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await shutdown();
    process.exitCode = 1;
  }
}

async function readLocalAuthConfiguration(): Promise<
  ReturnType<typeof readAuthenticationConfiguration> & { dummyHash: string }
> {
  const configuration = readAuthenticationConfiguration(process.env);
  return {
    ...configuration,
    dummyHash: await createDummyPasswordHash(configuration.passwordPepper),
  };
}

async function createChallengeDelivery(input: {
  database: ReturnType<typeof createDatabase>;
  emailConfiguration: ReturnType<typeof readEmailConfiguration>;
  smsConfiguration: ReturnType<typeof readSmsConfiguration>;
  operationLog: OperationLog;
}): Promise<VerificationDelivery> {
  if (!input.emailConfiguration && !input.smsConfiguration)
    return unconfiguredChallengeDelivery;
  const email =
    input.emailConfiguration &&
    input.emailConfiguration.configuration.transportId === "resend"
      ? createEmailService({
          repository: input.database.emails,
          operationLog: input.operationLog,
          transports: [
            createResendEmailTransport({
              apiKey: required(
                process.env.EDU_RESEND_API_KEY,
                "EDU_RESEND_API_KEY",
              ),
            }),
          ],
        })
      : input.emailConfiguration &&
          input.emailConfiguration.configuration.transportId === "smtp"
        ? createEmailService({
            repository: input.database.emails,
            operationLog: input.operationLog,
            transports: [createSmtpEmailTransport(process.env)],
          })
        : undefined;
  const sms =
    input.smsConfiguration &&
    input.smsConfiguration.configuration.adapterId === "twilio"
      ? createSmsService({
          repository: input.database.sms,
          adapters: [
            createTwilioSmsAdapter({
              accountSid: required(
                process.env.EDU_TWILIO_ACCOUNT_SID,
                "EDU_TWILIO_ACCOUNT_SID",
              ),
              authToken: required(
                process.env.EDU_TWILIO_AUTH_TOKEN,
                "EDU_TWILIO_AUTH_TOKEN",
              ),
            }),
          ],
        })
      : undefined;
  if (input.emailConfiguration && !email)
    console.error(
      "Email delivery is disabled: this API composition supports EDU_EMAIL_TRANSPORT_ID=smtp or resend.",
    );
  if (input.smsConfiguration && !sms)
    console.error(
      "SMS delivery is disabled: this API composition supports EDU_SMS_ADAPTER_ID=twilio.",
    );
  if (email)
    await Promise.all(
      [
        "confirm-email",
        "reset-password",
        "delete-account",
        "undo-deletion",
      ].map((kind) =>
        input.database.emails.saveTemplate(challengeEmailTemplate(kind)),
      ),
    );
  if (sms)
    await Promise.all(
      ["confirm-phone"].map((kind) =>
        input.database.sms.saveTemplate({
          id: `auth-${kind}`,
          bodyTemplate:
            "Your Edu Service confirmation code is {{token}}. It expires at {{expiresAt}}.",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    );
  return {
    async send(challenge) {
      if (challenge.kind === "confirm-phone") {
        if (!sms || !input.smsConfiguration || !challenge.phone)
          throw new Error("SMS delivery is not configured.");
        const result = await sms.send({
          configurationId: input.smsConfiguration.configuration.id,
          templateId: "auth-confirm-phone",
          recipient: challenge.phone,
          purpose: "transactional",
          idempotencyKey: `${challenge.kind}:${challenge.token}`,
          data: {
            token: challenge.token,
            expiresAt: challenge.expiresAt.toISOString(),
          },
        });
        if (result.outcome !== "sent") throw new Error("sms_delivery_failed");
        return;
      }
      if (!email || !input.emailConfiguration || !challenge.email)
        throw new Error("Email delivery is not configured.");
      const result = await email.send({
        configurationId: input.emailConfiguration.configuration.id,
        templateId: `auth-${challenge.kind}`,
        recipient: challenge.email,
        purpose: "transactional",
        idempotencyKey: `${challenge.kind}:${challenge.token}`,
        data: {
          token: challenge.token,
          expiresAt: challenge.expiresAt.toISOString(),
        },
      });
      if (result.outcome !== "sent") throw new Error("email_delivery_failed");
    },
  };
}

function challengeEmailTemplate(kind: string) {
  const label =
    kind === "confirm-email"
      ? "Confirm your email"
      : kind === "reset-password"
        ? "Reset your password"
        : kind === "delete-account"
          ? "Confirm account deletion"
          : "Undo account deletion";
  const now = new Date();
  return {
    id: `auth-${kind}`,
    subjectTemplate: `${label} — Edu Service`,
    headerPartial: "",
    mainTemplate: `<p>${label}</p><p>Your one-time code is <strong>{{token}}</strong>.</p><p>It expires at {{expiresAt}}.</p>`,
    footerPartial: "",
    textTemplate: `${label}. Your one-time code is {{token}}. It expires at {{expiresAt}}.`,
    createdAt: now,
    updatedAt: now,
  };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized)
    throw new Error(
      `${name} is required when its delivery provider is configured.`,
    );
  return normalized;
}

function csv(value: string | undefined): readonly string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** SMTP credentials are enough for the standard single-sender local setup. */
function emailEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (
    environment.EDU_EMAIL_CONFIGURATION_ID ||
    environment.EDU_EMAIL_TRANSPORT_ID ||
    environment.EDU_EMAIL_FROM_EMAIL ||
    !environment.EDU_SMTP_HOST
  )
    return environment;
  return {
    ...environment,
    EDU_EMAIL_CONFIGURATION_ID: "transactional-smtp",
    EDU_EMAIL_TRANSPORT_ID: "smtp",
    EDU_EMAIL_FROM_EMAIL: environment.EDU_SMTP_USERNAME,
  };
}

/** Local development always has stderr telemetry; file and HTTP sinks are opt-in. */
function telemetrySinks(environment: NodeJS.ProcessEnv): readonly EventSink[] {
  const defaultFilePath = fileURLToPath(
    new URL("../../../.edu-service-events.jsonl", import.meta.url),
  );
  const sinks: EventSink[] = [
    createLocalFileSink({ filePath: defaultFilePath }),
  ];
  const configuredFilePath = environment.EDU_SERVICE_LOG_FILE?.trim();
  if (configuredFilePath && configuredFilePath !== defaultFilePath)
    sinks.push(createLocalFileSink({ filePath: configuredFilePath }));
  if (environment.EDU_SERVICE_LOG_JSON?.trim() !== "0")
    sinks.push(createJsonLinesSink((line) => process.stderr.write(line)));
  const endpoint = environment.EDU_SERVICE_LOG_HTTP_ENDPOINT?.trim();
  if (endpoint) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:")
      throw new Error("EDU_SERVICE_LOG_HTTP_ENDPOINT must use HTTPS.");
    sinks.push(createHttpSink({ endpoint: url.toString() }));
  }
  return sinks;
}
