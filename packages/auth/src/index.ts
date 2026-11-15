import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import type { PasswordHasher, SecretCodec } from "@life-optimizer/core";

const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;

/** OWASP-compatible scrypt adapter for the Node 22 runtime; salts are unique per hash. */
export function createScryptPasswordHasher(options: {
  pepper: string;
  dummyHash: string;
}): PasswordHasher {
  if (Buffer.byteLength(options.pepper) < 32)
    throw new Error("Password pepper must contain at least 32 bytes.");
  const prepare = (password: string) =>
    createHmac("sha256", options.pepper).update(password, "utf8").digest();
  return {
    dummyHash: options.dummyHash,
    async hash(password) {
      const salt = randomBytes(16);
      const derived = await derive(prepare(password), salt, 32);
      return `$scrypt$ln=17,r=8,p=1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
    },
    async verify(encoded, password) {
      const match =
        /^\$scrypt\$ln=17,r=8,p=1\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(
          encoded,
        );
      if (!match) return false;
      const salt = Buffer.from(match[1]!, "base64url");
      const expected = Buffer.from(match[2]!, "base64url");
      if (salt.length !== 16 || expected.length !== 32) return false;
      const actual = await derive(prepare(password), salt, expected.length);
      return timingSafeEqual(actual, expected);
    },
  };
}

export function createHmacSecretCodec(hmacKey: string): SecretCodec {
  if (Buffer.byteLength(hmacKey) < 32)
    throw new Error(
      "Authentication token HMAC key must contain at least 32 bytes.",
    );
  const digest = (value: string) =>
    createHmac("sha256", hmacKey).update(value, "utf8").digest("base64url");
  return {
    issue() {
      const value = randomBytes(32).toString("base64url");
      return { value, hash: digest(value) };
    },
    hash: digest,
    matches(value, hash) {
      const actual = Buffer.from(digest(value));
      const expected = Buffer.from(hash);
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    },
  };
}

export interface OAuthProviderConfiguration {
  provider: "google" | "github" | "facebook";
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export interface AuthenticationConfiguration {
  passwordPepper: string;
  tokenHmacKey: string;
  bloomHmacKey: string;
  deletionGraceMs: number;
  oauth: readonly OAuthProviderConfiguration[];
}

/** Optional OAuth providers are enabled only when all three values are present. */
export function readAuthenticationConfiguration(
  environment: NodeJS.ProcessEnv,
): AuthenticationConfiguration {
  const passwordPepper = secret(environment, "EDU_AUTH_PASSWORD_PEPPER");
  const tokenHmacKey = secret(environment, "EDU_AUTH_TOKEN_HMAC_KEY");
  const bloomHmacKey = secret(environment, "EDU_AUTH_BLOOM_HMAC_KEY");
  const deletionGraceDays = readDeletionGraceDays(
    environment.EDU_AUTH_DELETION_GRACE_DAYS,
  );
  const oauth: OAuthProviderConfiguration[] = [];
  for (const provider of ["google", "github", "facebook"] as const) {
    const prefix = `EDU_AUTH_${provider.toUpperCase()}`;
    const values = [
      environment[`${prefix}_CLIENT_ID`]?.trim(),
      environment[`${prefix}_CLIENT_SECRET`]?.trim(),
      environment[`${prefix}_CALLBACK_URL`]?.trim(),
    ] as const;
    if (values.every((value) => value === undefined)) continue;
    if (values.some((value) => !value))
      throw new Error(
        `${prefix} OAuth configuration must be supplied together.`,
      );
    const callback = new URL(values[2]!);
    if (callback.protocol !== "https:" && callback.hostname !== "localhost")
      throw new Error(
        `${prefix}_CALLBACK_URL must use HTTPS outside localhost.`,
      );
    oauth.push({
      provider,
      clientId: values[0]!,
      clientSecret: values[1]!,
      callbackUrl: callback.toString(),
    });
  }
  return {
    passwordPepper,
    tokenHmacKey,
    bloomHmacKey,
    deletionGraceMs: deletionGraceDays * 24 * 60 * 60 * 1_000,
    oauth,
  };
}

/** Creates a valid deployment-specific dummy hash during provisioning. */
export async function createDummyPasswordHash(pepper: string): Promise<string> {
  return createScryptPasswordHasher({
    pepper,
    dummyHash: "$scrypt$invalid",
  }).hash(createHash("sha256").update(randomBytes(32)).digest("hex"));
}

function secret(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value || Buffer.byteLength(value) < 32)
    throw new Error(`${name} is required and must contain at least 32 bytes.`);
  return value;
}

function readDeletionGraceDays(value: string | undefined): number {
  const days = Number(value?.trim() || "30");
  if (!Number.isSafeInteger(days) || days < 1 || days > 90)
    throw new Error(
      "EDU_AUTH_DELETION_GRACE_DAYS must be an integer from 1 through 90.",
    );
  return days;
}

function derive(
  password: Buffer,
  salt: Buffer,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    nodeScrypt(
      password,
      salt,
      length,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, value) => (error ? reject(error) : resolve(value)),
    ),
  );
}
