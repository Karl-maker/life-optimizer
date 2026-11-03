import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface EmailUnsubscribeTokens {
  issue(input: { recipient: string; topic: string }): string;
  verify(token: string): { recipient: string; topic: string } | null;
}

/** Opaque, signed marketing opt-out tokens. They deliberately carry no expiry. */
export function createEmailUnsubscribeTokens(
  key: string,
): EmailUnsubscribeTokens {
  if (Buffer.byteLength(key) < 32)
    throw new Error(
      "EDU_EMAIL_UNSUBSCRIBE_HMAC_KEY must be at least 32 bytes.",
    );
  const encryptionKey = createHash("sha256").update(key).digest();
  return {
    issue({ recipient, topic }) {
      const payload = Buffer.from(
        JSON.stringify({ recipient: recipient.trim().toLowerCase(), topic }),
      );
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
      return `${iv.toString("base64url")}.${Buffer.concat([cipher.update(payload), cipher.final()]).toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    },
    verify(token) {
      const [iv, ciphertext, tag, extra] = token.split(".");
      if (!iv || !ciphertext || !tag || extra !== undefined) return null;
      try {
        const value: unknown = JSON.parse(
          (() => {
            const decipher = createDecipheriv(
              "aes-256-gcm",
              encryptionKey,
              Buffer.from(iv, "base64url"),
            );
            decipher.setAuthTag(Buffer.from(tag, "base64url"));
            return Buffer.concat([
              decipher.update(Buffer.from(ciphertext, "base64url")),
              decipher.final(),
            ]);
          })().toString("utf8"),
        );
        if (
          typeof value !== "object" ||
          value === null ||
          !("recipient" in value) ||
          !("topic" in value) ||
          typeof value.recipient !== "string" ||
          typeof value.topic !== "string"
        )
          return null;
        return { recipient: value.recipient, topic: value.topic };
      } catch {
        return null;
      }
    },
  };
}
