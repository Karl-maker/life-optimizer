import { describe, expect, it } from "vitest";
import {
  createHmacSecretCodec,
  createScryptPasswordHasher,
  readAuthenticationConfiguration,
} from "../src/index.js";

const secret = "0123456789abcdef0123456789abcdef";

describe("authentication security adapters", () => {
  it("uses unique salts and verifies peppered scrypt hashes", async () => {
    const temporary = createScryptPasswordHasher({
      pepper: secret,
      dummyHash:
        "$scrypt$ln=17,r=8,p=1$MDAwMDAwMDAwMDAwMDAwMA$MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA",
    });
    const first = await temporary.hash("a long example password");
    const second = await temporary.hash("a long example password");
    expect(first).not.toBe(second);
    await expect(
      temporary.verify(first, "a long example password"),
    ).resolves.toBe(true);
    await expect(temporary.verify(first, "wrong password")).resolves.toBe(
      false,
    );
  }, 20_000);

  it("issues independent random secrets and stores deterministic HMAC verifiers", () => {
    const codec = createHmacSecretCodec(secret);
    const first = codec.issue();
    const second = codec.issue();
    expect(first.value).not.toBe(second.value);
    expect(first.hash).toBe(codec.hash(first.value));
    expect(first.hash).not.toContain(first.value);
  });

  it("keeps absent OAuth providers disabled and rejects partial configuration", () => {
    expect(
      readAuthenticationConfiguration({
        EDU_AUTH_PASSWORD_PEPPER: secret,
        EDU_AUTH_TOKEN_HMAC_KEY: secret,
        EDU_AUTH_BLOOM_HMAC_KEY: secret,
      }),
    ).toMatchObject({ oauth: [], deletionGraceMs: 30 * 24 * 60 * 60 * 1_000 });
    expect(() =>
      readAuthenticationConfiguration({
        EDU_AUTH_PASSWORD_PEPPER: secret,
        EDU_AUTH_TOKEN_HMAC_KEY: secret,
        EDU_AUTH_BLOOM_HMAC_KEY: secret,
        EDU_AUTH_GOOGLE_CLIENT_ID: "client",
      }),
    ).toThrow("supplied together");
    expect(() =>
      readAuthenticationConfiguration({
        EDU_AUTH_PASSWORD_PEPPER: secret,
        EDU_AUTH_TOKEN_HMAC_KEY: secret,
        EDU_AUTH_BLOOM_HMAC_KEY: secret,
        EDU_AUTH_DELETION_GRACE_DAYS: "0",
      }),
    ).toThrow("DELETION_GRACE_DAYS");
  });
});
