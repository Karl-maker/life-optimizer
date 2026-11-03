import type { DisposableEmailPolicy } from "./authentication-service.js";

const KNOWN_DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "dispostable.com",
  "guerrillamail.com",
  "mailinator.com",
  "maildrop.cc",
  "sharklasers.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
]);

export function createDisposableEmailPolicy(
  additionalDomains: readonly string[] = [],
): DisposableEmailPolicy {
  const domains = new Set(KNOWN_DISPOSABLE_DOMAINS);
  for (const value of additionalDomains) {
    const domain = value.trim().toLowerCase();
    if (
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
        domain,
      )
    )
      domains.add(domain);
  }
  return {
    isDisposable(email) {
      return domains.has(email.slice(email.lastIndexOf("@") + 1).toLowerCase());
    },
  };
}
