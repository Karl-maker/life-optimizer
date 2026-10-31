import { readFileSync } from "node:fs";
import type { OperationLog } from "@edu-service/core";
import { AppleStoreAdapter } from "./apple-store.js";
import { GooglePlayAdapter } from "./google-play.js";

/** Provider credentials are read at adapter startup, never copied into core, audit or telemetry. */
export function readStoreProviderConfiguration(
  environment: NodeJS.ProcessEnv,
  operationLog?: OperationLog,
) {
  if (
    environment.EDU_APPLE_ALLOW_SANDBOX &&
    !["true", "false"].includes(environment.EDU_APPLE_ALLOW_SANDBOX)
  )
    throw new Error("EDU_APPLE_ALLOW_SANDBOX must be true or false.");
  const appleFields = [
    "EDU_APPLE_BUNDLE_ID",
    "EDU_APPLE_APP_ID",
    "EDU_APPLE_ISSUER_ID",
    "EDU_APPLE_KEY_ID",
    "EDU_APPLE_PRIVATE_KEY_FILE",
    "EDU_APPLE_ROOT_CERT_FILES",
  ] as const;
  const googleFields = [
    "EDU_GOOGLE_PLAY_PACKAGE_NAME",
    "EDU_GOOGLE_PUBSUB_AUDIENCE",
    "EDU_GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL",
  ] as const;
  const appleReady = appleFields.every((field) => environment[field]?.trim());
  const googleReady = googleFields.every((field) => environment[field]?.trim());
  if (!appleReady)
    operationLog?.error("financial.provider.unavailable", {
      provider: "apple",
      reason: "missing_configuration",
    });
  if (!googleReady)
    operationLog?.error("financial.provider.unavailable", {
      provider: "google",
      reason: "missing_configuration",
    });
  const apple = appleReady
    ? new AppleStoreAdapter({
        bundleId: environment.EDU_APPLE_BUNDLE_ID!.trim(),
        appAppleId: Number(environment.EDU_APPLE_APP_ID),
        issuerId: environment.EDU_APPLE_ISSUER_ID!.trim(),
        keyId: environment.EDU_APPLE_KEY_ID!.trim(),
        privateKey: readFileSync(
          environment.EDU_APPLE_PRIVATE_KEY_FILE!.trim(),
          "utf8",
        ),
        rootCertificates: environment
          .EDU_APPLE_ROOT_CERT_FILES!.split(",")
          .map((file) => readFileSync(file.trim())),
        allowSandbox: environment.EDU_APPLE_ALLOW_SANDBOX === "true",
      })
    : null;
  const google = googleReady
    ? new GooglePlayAdapter({
        packageName: environment.EDU_GOOGLE_PLAY_PACKAGE_NAME!.trim(),
        pubsubAudience: environment.EDU_GOOGLE_PUBSUB_AUDIENCE!.trim(),
        pubsubServiceAccountEmail:
          environment.EDU_GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL!.trim(),
      })
    : null;
  return { apple, google };
}
