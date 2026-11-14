/**
 * Non-secret presentation values for branded HBS templates.
 * Resolve these at the composition edge; never put provider credentials here.
 */
export interface EmailPresentation {
  brandName: string;
  logoUrl: string;
  /** Origin used for auth action links and marketing unsubscribe pages. */
  clientBaseUrl: string;
  supportEmail: string;
  termsUrl: string;
  privacyUrl: string;
}

/**
 * Reads branded-template settings. Omit every EDU_EMAIL_* presentation value to skip them.
 * When any value is present, the full group is required together.
 */
export function readEmailPresentationConfiguration(
  environment: NodeJS.ProcessEnv,
): EmailPresentation | null {
  const logoUrl = optional(environment, "EDU_EMAIL_LOGO_URL");
  const clientBaseUrl = optional(environment, "EDU_EMAIL_CLIENT_BASE_URL");
  const supportEmail = optional(environment, "EDU_EMAIL_SUPPORT_EMAIL");
  const termsUrl = optional(environment, "EDU_EMAIL_TERMS_URL");
  const privacyUrl = optional(environment, "EDU_EMAIL_PRIVACY_URL");
  const brandName = optional(environment, "EDU_EMAIL_BRAND_NAME");
  const anyConfigured =
    logoUrl !== undefined ||
    clientBaseUrl !== undefined ||
    supportEmail !== undefined ||
    termsUrl !== undefined ||
    privacyUrl !== undefined ||
    brandName !== undefined;
  if (!anyConfigured) return null;
  if (!logoUrl || !clientBaseUrl || !supportEmail || !termsUrl || !privacyUrl)
    throw new Error(
      "EDU_EMAIL_LOGO_URL, EDU_EMAIL_CLIENT_BASE_URL, EDU_EMAIL_SUPPORT_EMAIL, EDU_EMAIL_TERMS_URL, and EDU_EMAIL_PRIVACY_URL must be supplied together.",
    );
  return {
    brandName: brandName ?? "Edu Service",
    logoUrl: assertHttpUrl(logoUrl, "EDU_EMAIL_LOGO_URL"),
    clientBaseUrl: assertClientBaseUrl(clientBaseUrl),
    supportEmail: normalizeRecipient(supportEmail),
    termsUrl: assertHttpUrl(termsUrl, "EDU_EMAIL_TERMS_URL"),
    privacyUrl: assertHttpUrl(privacyUrl, "EDU_EMAIL_PRIVACY_URL"),
  };
}

/** Builds the client unsubscribe page URL; the opaque token must not include the recipient email. */
export function marketingUnsubscribeUrl(input: {
  clientBaseUrl: string;
  token: string;
}): string {
  if (input.token.length < 20 || input.token.length > 2_048)
    throw new Error("Unsubscribe tokens must be opaque, bounded values.");
  const url = new URL("/unsubscribe", `${input.clientBaseUrl}/`);
  url.searchParams.set("token", input.token);
  return url.toString();
}

/**
 * Auth challenge links for email must use a query token.
 * Many mail clients (and click trackers) strip URL fragments, so `#token=` never arrives.
 */
export function authActionUrl(input: {
  clientBaseUrl: string;
  path: "/confirm" | "/reset-password";
  token: string;
}): string {
  if (!input.token.trim() || /[\r\n#?]/.test(input.token))
    throw new Error("Auth action tokens must be opaque, bounded values.");
  const url = new URL(input.path, `${input.clientBaseUrl}/`);
  url.searchParams.set("token", input.token);
  return url.toString();
}

/**
 * Relative expiry for email bodies, e.g. "in 30 minutes" / "in 2 hours".
 * Prefer this over a clock time — clearer across time zones.
 */
export function formatEmailExpiry(value: Date, now = new Date()): string {
  const ms = value.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) {
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

function optional(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  return environment[name]?.trim() || undefined;
}

function normalizeRecipient(value: string): string {
  const recipient = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 320)
    throw new Error("EDU_EMAIL_SUPPORT_EMAIL must be a valid email address.");
  return recipient;
}

function assertHttpUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    )
  )
    throw new Error(
      `${name} must use HTTPS (http is allowed only on localhost).`,
    );
  if (/[\r\n]/.test(value)) throw new Error(`${name} is invalid.`);
  return parsed.toString().replace(/\/$/, "");
}

function assertClientBaseUrl(value: string): string {
  const normalized = assertHttpUrl(value, "EDU_EMAIL_CLIENT_BASE_URL");
  const parsed = new URL(normalized);
  if (parsed.pathname !== "" && parsed.pathname !== "/")
    throw new Error(
      "EDU_EMAIL_CLIENT_BASE_URL must be an origin without a path (for example https://app.example.com).",
    );
  return parsed.origin;
}
