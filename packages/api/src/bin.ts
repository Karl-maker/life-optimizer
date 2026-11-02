#!/usr/bin/env node
// The executable API composition root: process/env handling stays at the edge.
import "dotenv/config";
import {
  createAuthenticationService,
  type IdentityPresenceIndex,
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
  createJsonLinesSink,
  createTelemetry,
} from "@edu-service/observability";
import {
  createApiServer,
  readApiConfiguration,
  type ApiServerOptions,
} from "./index.js";

const telemetry = createTelemetry({
  service: "edu-service-api",
  sinks:
    process.env.EDU_SERVICE_LOG_JSON === "1"
      ? [createJsonLinesSink((line) => process.stderr.write(line))]
      : [],
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

const localChallengeDelivery: VerificationDelivery = {
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
  const configuration = readApiConfiguration(process.env);
  const authConfiguration = await readLocalAuthConfiguration();
  const serverOptions: ApiServerOptions = {
    authentication: {
      service: createAuthenticationService({
        store: database.authentication,
        passwords: createScryptPasswordHasher({
          pepper: authConfiguration.passwordPepper,
          dummyHash: authConfiguration.dummyHash,
        }),
        secrets: createHmacSecretCodec(authConfiguration.tokenHmacKey),
        presence: alwaysCheckDatabasePresence,
        delivery: localChallengeDelivery,
        enabledProviders: authConfiguration.oauth.map(
          (provider) => provider.provider,
        ),
        deletionGraceMs: authConfiguration.deletionGraceMs,
        onDeliveryFailure: ({ kind, userId }) =>
          telemetry.warn("auth.challenge.delivery.failed", { kind, userId }),
      }),
    },
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
